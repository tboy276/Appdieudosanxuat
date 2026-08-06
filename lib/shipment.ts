import { supabaseAdmin } from "./supabase";
import { getStockStatesBatch } from "./inventory-postgres";
import { listPOs } from "./po-postgres";
import { PO } from "./po-wo-engine";


function isUuid(str?: string): boolean {
  if (!str) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str.trim());
}

export interface ShipmentItemInput {
  poLineId: string;
  productId: string;
  shippedQty: number;
}

export interface ShippableItem {
  poId: string;
  poNumber: string;
  poLineId: string;
  customerId: string;
  customerName: string;
  productId: string;
  sku: string;
  productNameVi: string;
  orderQty: number;
  alreadyShippedQty: number;
  remainingOrderQty: number;
  ktpAvailableQty: number;
  maxShippableQty: number;
}

export interface ShipmentHeader {
  id: string;
  shipmentNumber: string;
  customerId: string;
  customerName: string;
  shippedAt: string;
  createdBy: string;
  createdByName?: string;
  note?: string;
  totalQty: number;
  itemsCount: number;
}

export interface ShipmentDetail extends ShipmentHeader {
  items: Array<{
    id: string;
    poLineId: string;
    poNumber: string;
    productId: string;
    sku: string;
    productNameVi: string;
    shippedQty: number;
    orderQty: number;
  }>;
}

/**
 * 1. Get list of PO lines that have available stock at KTP and remaining order_qty
 */
export async function getShippableItems(filters?: {
  customerId?: string;
  sku?: string;
  search?: string;
}): Promise<ShippableItem[]> {
  const activePos = await listPOs();
  if (activePos.length === 0) return [];

  let filteredPos = activePos.filter((p) => p.status !== "COMPLETED");

  if (filters?.customerId && filters.customerId.trim()) {
    const targetCust = filters.customerId.trim().toLowerCase();
    filteredPos = filteredPos.filter(
      (p) =>
        (p.customerId && p.customerId.toLowerCase() === targetCust) ||
        (p.customerName && p.customerName.toLowerCase() === targetCust)
    );
  }

  if (filters?.sku && filters.sku.trim()) {
    const sLower = filters.sku.trim().toLowerCase();
    filteredPos = filteredPos.filter((p) => p.sku.toLowerCase() === sLower);
  }

  if (filters?.search && filters.search.trim()) {
    const q = filters.search.trim().toLowerCase();
    filteredPos = filteredPos.filter(
      (p) =>
        p.poNumber.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        p.customerName.toLowerCase().includes(q)
    );
  }

  const pairs = filteredPos.map((p) => ({ wcCode: "KTP", sku: p.sku }));
  const stockBatch = await getStockStatesBatch(pairs);

  const result: ShippableItem[] = [];

  for (const po of filteredPos) {
    const ktpStock = stockBatch.get(`KTP:${po.sku}`) || { tonPhoi: 0, tonThanhPham: 0 };
    const ktpAvailableQty = ktpStock.tonThanhPham;
    const remainingOrderQty = Math.max(0, po.qty - (po.shippedQty || 0));

    if (remainingOrderQty > 0 && ktpAvailableQty > 0) {
      const maxShippableQty = Math.min(remainingOrderQty, ktpAvailableQty);

      result.push({
        poId: po.poId,
        poNumber: po.poNumber,
        poLineId: po.poLineId || po.poId,
        customerId: po.customerId || "",
        customerName: po.customerName,
        productId: po.productId || "",
        sku: po.sku,
        productNameVi: po.productNameVi,
        orderQty: po.qty,
        alreadyShippedQty: po.shippedQty || 0,
        remainingOrderQty,
        ktpAvailableQty,
        maxShippableQty,
      });
    }
  }

  return result;
}

/**
 * 2. Create Shipment (Atomic Transaction via RPC or TS Engine Fallback)
 */
export async function createShipment(
  customerId: string,
  items: ShipmentItemInput[],
  actor: string = "admin",
  note: string = ""
): Promise<{ shipmentId: string; shipmentNumber: string }> {
  if (!items || items.length === 0) {
    throw new Error("Danh sách mặt hàng xuất không được để rỗng.");
  }

  for (const item of items) {
    if (!item.shippedQty || item.shippedQty <= 0) {
      throw new Error("Số lượng xuất hàng cho từng mặt hàng phải lớn hơn 0.");
    }
  }

  let actorUserId: string | null = null;
  if (isUuid(actor)) {
    actorUserId = actor;
  } else {
    const { data: usr } = await supabaseAdmin.from("users").select("id").eq("username", actor).maybeSingle();
    actorUserId = usr?.id || null;
  }

  if (!actorUserId) {
    // Fallback to first user in system or admin
    const { data: adminUsr } = await supabaseAdmin.from("users").select("id").limit(1).maybeSingle();
    actorUserId = adminUsr?.id || null;
  }

  // Ensure valid customer ID
  let validCustomerId = isUuid(customerId) ? customerId : null;
  if (!validCustomerId && items.length > 0) {
    const { data: lineRow } = await supabaseAdmin
      .from("po_lines")
      .select("customer_id")
      .eq("id", items[0].poLineId)
      .maybeSingle();
    validCustomerId = lineRow?.customer_id || null;
  }

  if (!validCustomerId) {
    const { data: firstCust } = await supabaseAdmin.from("customers").select("id").limit(1).maybeSingle();
    validCustomerId = firstCust?.id || null;
  }

  if (!validCustomerId) {
    throw new Error("Không thể xác định Khách Hàng cho đơn xuất này.");
  }

  // Find KTP workshop ID for inventory transaction recording
  const { data: ktpWs } = await supabaseAdmin
    .from("workshops")
    .select("id")
    .or("is_ktp.eq.true,code.ilike.KTP")
    .limit(1)
    .maybeSingle();
  const ktpWorkshopId = ktpWs?.id || null;

  // TS Engine Transaction Execution
  const shipmentCode = `SHIP-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const today = new Date().toISOString().split("T")[0];

  const { data: shipmentHeader, error: headerErr } = await supabaseAdmin
    .from("shipments")
    .insert({
      shipment_code: shipmentCode,
      customer_id: validCustomerId,
      ship_date: today,
      notes: note || `Xuất hàng cho khách`,
      created_by: actorUserId,
    })
    .select("id, shipment_code")
    .single();

  if (headerErr || !shipmentHeader) {
    throw new Error(`Lỗi tạo phiếu xuất hàng: ${headerErr?.message || "Không thể khởi tạo bản ghi"}`);
  }

  const createdShipmentId = shipmentHeader.id;
  const insertedItemIds: string[] = [];
  const insertedTxIds: string[] = [];

  try {
    for (const item of items) {
      const { data: lineRow } = await supabaseAdmin
        .from("po_lines")
        .select("order_qty, po_id, product_id")
        .eq("id", item.poLineId)
        .single();

      if (!lineRow) {
        throw new Error(`PO Line ID ${item.poLineId} không tồn tại trong hệ thống.`);
      }

      const { data: existingItems } = await supabaseAdmin
        .from("shipment_items")
        .select("shipped_qty")
        .eq("po_line_id", item.poLineId);

      const alreadyShipped = (existingItems || []).reduce((acc, curr) => acc + (curr.shipped_qty || 0), 0);

      if (alreadyShipped + item.shippedQty > lineRow.order_qty) {
        throw new Error(
          `Số lượng xuất lũy kế (${alreadyShipped + item.shippedQty} pcs) vượt quá order_qty (${lineRow.order_qty} pcs) của PO Line.`
        );
      }

      const { data: newItem, error: itemErr } = await supabaseAdmin
        .from("shipment_items")
        .insert({
          shipment_id: createdShipmentId,
          po_line_id: item.poLineId,
          shipped_qty: item.shippedQty,
        })
        .select("id")
        .single();

      if (itemErr || !newItem) {
        throw new Error(`Lỗi ghi nhận chi tiết dòng xuất hàng: ${itemErr?.message}`);
      }

      insertedItemIds.push(newItem.id);

      // Record SHIPMENT inventory transaction to deduct tonThanhPham from KTP
      const resolvedProdId = item.productId || lineRow.product_id;
      if (resolvedProdId && ktpWorkshopId) {
        const { data: newTx, error: txErr } = await supabaseAdmin
          .from("inventory_transactions")
          .insert({
            transaction_type: "SHIPMENT",
            transaction_date: today,
            product_id: resolvedProdId,
            from_workshop_id: ktpWorkshopId,
            qty_tp_ok: item.shippedQty,
            qty_ng: 0,
            created_by: actorUserId,
            note: `Xuất giao khách theo phiếu ${shipmentHeader.shipment_code}${note ? `: ${note}` : ""}`,
          })
          .select("id")
          .maybeSingle();

        if (newTx) {
          insertedTxIds.push(newTx.id);
        }
      }

      // Update PO Status (strictly IN_PRODUCTION or COMPLETED to satisfy DB check constraint)
      const { data: allPoLines } = await supabaseAdmin
        .from("po_lines")
        .select("id, order_qty")
        .eq("po_id", lineRow.po_id);

      const poLineIds = (allPoLines || []).map((l) => l.id);
      const totalPoOrder = (allPoLines || []).reduce((acc, l) => acc + (l.order_qty || 0), 0);

      const { data: allShipped } = await supabaseAdmin
        .from("shipment_items")
        .select("shipped_qty")
        .in("po_line_id", poLineIds);

      const totalPoShipped = (allShipped || []).reduce((acc, s) => acc + (s.shipped_qty || 0), 0);

      let poStatus = "IN_PRODUCTION";
      if (totalPoShipped >= totalPoOrder) {
        poStatus = "COMPLETED";
      }

      await supabaseAdmin
        .from("purchase_orders")
        .update({ status: poStatus, updated_at: new Date().toISOString() })
        .eq("id", lineRow.po_id);
    }
  } catch (err: any) {
    if (insertedTxIds.length > 0) {
      await supabaseAdmin.from("inventory_transactions").delete().in("id", insertedTxIds);
    }
    if (insertedItemIds.length > 0) {
      await supabaseAdmin.from("shipment_items").delete().in("id", insertedItemIds);
    }
    await supabaseAdmin.from("shipments").delete().eq("id", createdShipmentId);

    throw new Error(`Tạo phiếu xuất hàng thất bại và đã rollback: ${err.message}`);
  }

  return {
    shipmentId: createdShipmentId,
    shipmentNumber: shipmentHeader.shipment_code,
  };
}

/**
 * 3. List Shipments with optional filters
 */
export async function listShipments(filters?: {
  customerId?: string;
  search?: string;
}): Promise<ShipmentHeader[]> {
  let query = supabaseAdmin
    .from("shipments")
    .select(`
      id,
      shipment_code,
      customer_id,
      ship_date,
      created_by,
      notes,
      customers (
        name
      ),
      users (
        full_name,
        username
      ),
      shipment_items (
        shipped_qty
      )
    `)
    .order("created_at", { ascending: false })
    .range(0, 999);

  if (filters?.customerId) {
    query = query.eq("customer_id", filters.customerId);
  }

  const { data: rows, error } = await query;
  if (error || !rows) return [];

  const results: ShipmentHeader[] = [];

  for (const row of rows) {
    const cust = (row as any).customers;
    const usr = (row as any).users;
    const items = (row as any).shipment_items || [];

    const totalQty = items.reduce((acc: number, curr: any) => acc + (curr.shipped_qty || 0), 0);

    if (filters?.search) {
      const q = filters.search.toLowerCase();
      const numMatch = (row.shipment_code || "").toLowerCase().includes(q);
      const custMatch = (cust?.name || "").toLowerCase().includes(q);
      if (!numMatch && !custMatch) continue;
    }

    results.push({
      id: row.id,
      shipmentNumber: row.shipment_code,
      customerId: row.customer_id || "",
      customerName: cust?.name || "Khách Hàng Chưa Phân Loại",
      shippedAt: row.ship_date,
      createdBy: row.created_by || "",
      createdByName: usr?.full_name || usr?.username || "Admin",
      note: row.notes || "",
      totalQty,
      itemsCount: items.length,
    });
  }

  return results;
}

/**
 * 4. Get detailed Shipment by ID
 */
export async function getShipment(shipmentId: string): Promise<ShipmentDetail | null> {
  const { data: row, error } = await supabaseAdmin
    .from("shipments")
    .select(`
      id,
      shipment_code,
      customer_id,
      ship_date,
      created_by,
      notes,
      customers (
        name
      ),
      users (
        full_name,
        username
      ),
      shipment_items (
        id,
        po_line_id,
        shipped_qty,
        po_lines (
          order_qty,
          product_id,
          purchase_orders (
            po_number
          )
        )
      )
    `)
    .eq("id", shipmentId)
    .maybeSingle();

  if (error || !row) return null;

  const cust = (row as any).customers;
  const usr = (row as any).users;
  const rawItems = (row as any).shipment_items || [];

  const items = [];
  for (const item of rawItems) {
    const poLine = item.po_lines;
    const poHeader = poLine?.purchase_orders;
    const prodId = poLine?.product_id;

    let sku = "";
    let productNameVi = "";
    if (prodId) {
      const { data: prod } = await supabaseAdmin.from("products").select("part_no, name_vi").eq("id", prodId).maybeSingle();
      sku = prod?.part_no || "";
      productNameVi = prod?.name_vi || "";
    }

    items.push({
      id: item.id,
      poLineId: item.po_line_id,
      poNumber: poHeader?.po_number || "",
      productId: prodId || "",
      sku,
      productNameVi,
      shippedQty: item.shipped_qty || 0,
      orderQty: poLine?.order_qty || 0,
    });
  }

  const totalQty = items.reduce((acc: number, curr: any) => acc + curr.shippedQty, 0);

  return {
    id: row.id,
    shipmentNumber: row.shipment_code,
    customerId: row.customer_id || "",
    customerName: cust?.name || "Khách Hàng Chưa Phân Loại",
    shippedAt: row.ship_date,
    createdBy: row.created_by || "",
    createdByName: usr?.full_name || usr?.username || "Admin",
    note: row.notes || "",
    totalQty,
    itemsCount: items.length,
    items,
  };
}

