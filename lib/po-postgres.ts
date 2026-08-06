import { supabaseAdmin } from "./supabase";
import { getProduct, upsertProduct } from "./products";
import { PO, POStatus } from "./po-wo-engine";

export interface BulkDeletePosResult {
  deletedCount: number;
  rejectedCount: number;
  rejected: { id: string; reason: string }[];
}

/**
 * Helper to check if a string is a valid UUID
 */
function isUuid(str: string): boolean {
  if (!str) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

/**
 * Ensures customer exists in Supabase PostgreSQL by name, returns customer_id
 */
export async function ensureCustomerByName(customerName: string): Promise<string> {
  const trimmed = (customerName || "").trim();
  if (!trimmed) {
    throw new Error("Tên Khách hàng không được để rỗng khi tạo Đơn hàng PO.");
  }

  const { data: existing, error: selectErr } = await supabaseAdmin
    .from("customers")
    .select("id, name")
    .ilike("name", trimmed)
    .maybeSingle();

  if (selectErr) {
    throw new Error(`Lỗi tra cứu Khách hàng '${trimmed}': ${selectErr.message}`);
  }

  if (existing) {
    return existing.id;
  }

  const codePrefix = "KH-" + Math.random().toString(36).substring(2, 7).toUpperCase();
  const { data: inserted, error: insertErr } = await supabaseAdmin
    .from("customers")
    .insert({
      customer_code: codePrefix,
      name: trimmed,
    })
    .select("id")
    .single();

  if (insertErr) {
    throw new Error(`Lỗi tạo Khách hàng mới '${trimmed}': ${insertErr.message}`);
  }

  return inserted.id;
}

/**
 * Helper to map Supabase DB purchase_orders + single po_lines record to PO domain shape
 */
function mapDbLineToPO(row: any, line: any): PO {
  const customerName = row?.customers?.name || (Array.isArray(row?.customers) ? row?.customers[0]?.name : "") || "";

  let prodObj = line?.products;
  if (!prodObj && line?.product_customers) {
    prodObj = Array.isArray(line.product_customers)
      ? line.product_customers[0]?.products
      : line.product_customers?.products;
  }

  const sku = prodObj?.part_no || "";
  const productNameVi = prodObj?.name_vi || sku;
  const qty = Number(line?.order_qty || 0);

  return {
    poId: row?.id || line?.po_id || "",
    poLineId: line?.id || row?.id || "",
    productId: prodObj?.id || line?.product_id,
    customerId: row?.customer_id || line?.customer_id || row?.customers?.id,
    poNumber: row?.po_number || "",
    customerName,
    sku,
    productNameVi,
    qty,
    requestedDate: row?.requested_date ? String(row.requested_date).split("T")[0] : "",
    status: (row?.status || "NEW") as POStatus,
    shippedQty: 0,
    createdAt: row?.created_at || new Date().toISOString(),
    createdBy: "admin",
  };
}

/**
 * Maps a single purchase_orders DB record into an array of PO objects (1 per po_lines record)
 */
function mapDbRecordToPOList(row: any): PO[] {
  const lines = Array.isArray(row?.po_lines) ? row.po_lines : [];
  if (lines.length === 0) {
    return [mapDbLineToPO(row, null)];
  }
  return lines.map((line: any) => mapDbLineToPO(row, line));
}

/**
 * Backward compatibility alias for single line mapping
 */
function mapDbRecordToPO(row: any): PO {
  const list = mapDbRecordToPOList(row);
  return list[0];
}

async function enrichPOWithShippedQty(po: PO): Promise<PO> {
  try {
    const targetLineId = po.poLineId || po.poId;
    if (targetLineId && isUuid(targetLineId)) {
      const { data: items } = await supabaseAdmin
        .from("shipment_items")
        .select("shipped_qty")
        .eq("po_line_id", targetLineId);

      if (items && items.length > 0) {
        const totalShipped = items.reduce((acc, curr) => acc + (curr.shipped_qty || 0), 0);
        po.shippedQty = totalShipped;
        return po;
      }
    }

    if (po.poId && isUuid(po.poId)) {
      const { data: poLines } = await supabaseAdmin
        .from("po_lines")
        .select("id")
        .eq("po_id", po.poId);

      const lineIds = (poLines || []).map((l) => l.id);
      if (lineIds.length > 0) {
        const { data: items } = await supabaseAdmin
          .from("shipment_items")
          .select("shipped_qty")
          .in("po_line_id", lineIds);

        const totalShipped = (items || []).reduce((acc, curr) => acc + (curr.shipped_qty || 0), 0);
        po.shippedQty = totalShipped;
      }
    }
  } catch (e) {
    po.shippedQty = 0;
  }
  return po;
}

/**
 * Evaluates delivery status for PO list / Excel export
 */
export function evaluatePODeliveryStatus(requestedDate: string, status: POStatus): string {
  if (status === "COMPLETED") return "Đã hoàn thành";
  if (status === "CANCELLED") return "Đã hủy";
  if (!requestedDate) return "Chưa xác định";

  const reqTime = new Date(requestedDate).getTime();
  const todayStr = new Date().toISOString().split("T")[0];
  const todayTime = new Date(todayStr).getTime();

  if (isNaN(reqTime)) return "Ngày không hợp lệ";

  const diffDays = Math.round((reqTime - todayTime) / (1000 * 60 * 60 * 24));

  if (diffDays > 0) return `Còn ${diffDays} ngày`;
  if (diffDays === 0) return "Hôm nay hết hạn";
  return `Đã quá hạn ${Math.abs(diffDays)} ngày`;
}

/**
 * Fetch all POs from Supabase PostgreSQL (flattened per po_lines) with optional filters
 */
export async function listPOs(filters?: { customerName?: string; status?: string; search?: string }): Promise<PO[]> {
  let query = supabaseAdmin
    .from("purchase_orders")
    .select(`
      id,
      po_number,
      order_date,
      requested_date,
      status,
      created_at,
      updated_at,
      customers (
        id,
        name
      ),
      po_lines (
        id,
        product_id,
        order_qty,
        product_customers (
          products (
            id,
            part_no,
            name_vi
          )
        )
      )
    `)
    .order("created_at", { ascending: false })
    .range(0, 9999);

  if (filters?.status) {
    query = query.eq("status", filters.status);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Lỗi lấy danh sách Đơn hàng PO từ Supabase: ${error.message}`);
  }

  // Flatten all lines across all PO headers
  const poList: PO[] = [];
  for (const row of data || []) {
    poList.push(...mapDbRecordToPOList(row));
  }

  try {
    const allLineIds: string[] = [];
    for (const po of poList) {
      if (po.poLineId && isUuid(po.poLineId)) {
        allLineIds.push(po.poLineId);
      }
    }

    if (allLineIds.length > 0) {
      const { data: shipItems } = await supabaseAdmin
        .from("shipment_items")
        .select("po_line_id, shipped_qty")
        .range(0, 9999);

      const lineShippedTotals = new Map<string, number>();
      for (const item of shipItems || []) {
        const lineId = String(item.po_line_id).toLowerCase();
        const current = lineShippedTotals.get(lineId) || 0;
        lineShippedTotals.set(lineId, current + (Number(item.shipped_qty) || 0));
      }

      for (const po of poList) {
        if (po.poLineId) {
          const normLineId = String(po.poLineId).toLowerCase();
          po.shippedQty = lineShippedTotals.get(normLineId) || 0;
        }
      }
    }
  } catch (e) {}

  let results = poList;

  if (filters?.customerName && filters.customerName.trim()) {
    const custLower = filters.customerName.trim().toLowerCase();
    results = results.filter((p) => p.customerName.toLowerCase().includes(custLower));
  }

  if (filters?.search && filters.search.trim()) {
    const sLower = filters.search.trim().toLowerCase();
    results = results.filter(
      (p) =>
        p.poNumber.toLowerCase().includes(sLower) ||
        p.sku.toLowerCase().includes(sLower) ||
        p.customerName.toLowerCase().includes(sLower)
    );
  }

  return results;
}

/**
 * Fetch single PO by poId (po_lines.id, purchase_orders.id, or po_number)
 */
export async function getPO(poId: string): Promise<PO | null> {
  if (!poId || !poId.trim()) return null;

  const clean = poId.trim();

  // A. If UUID, first try looking up by po_lines.id (precise line lookup)
  if (isUuid(clean)) {
    const { data: lineRow } = await supabaseAdmin
      .from("po_lines")
      .select(`
        id,
        po_id,
        order_qty,
        product_id,
        product_customers (
          products (
            id,
            part_no,
            name_vi
          )
        ),
        purchase_orders (
          id,
          po_number,
          order_date,
          requested_date,
          status,
          created_at,
          updated_at,
          customers (
            id,
            name
          )
        )
      `)
      .eq("id", clean)
      .maybeSingle();

    if (lineRow && lineRow.purchase_orders) {
      const header = Array.isArray(lineRow.purchase_orders) ? lineRow.purchase_orders[0] : lineRow.purchase_orders;
      const poObj = mapDbLineToPO(header, lineRow);
      return await enrichPOWithShippedQty(poObj);
    }
  }

  // B. Lookup by purchase_orders.id or purchase_orders.po_number
  let query = supabaseAdmin
    .from("purchase_orders")
    .select(`
      id,
      po_number,
      order_date,
      requested_date,
      status,
      created_at,
      updated_at,
      customers (
        id,
        name
      ),
      po_lines (
        id,
        product_id,
        order_qty,
        product_customers (
          products (
            id,
            part_no,
            name_vi
          )
        )
      )
    `);

  if (isUuid(clean)) {
    query = query.eq("id", clean);
  } else {
    query = query.eq("po_number", clean);
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    throw new Error(`Lỗi tra cứu đơn hàng PO '${clean}': ${error.message}`);
  }

  if (!data) return null;

  const poList = mapDbRecordToPOList(data);
  const po = poList[0];
  return await enrichPOWithShippedQty(po);
}

/**
 * Create PO in Supabase PostgreSQL (purchase_orders + po_lines)
 */
export async function createPO(
  input: Omit<PO, "poId" | "shippedQty" | "status" | "createdAt"> & { poId?: string; status?: POStatus }
): Promise<PO> {
  const poNumber = input.poNumber || input.poId || `PO-${Date.now()}`;
  const now = new Date().toISOString();
  const reqDate = input.requestedDate || now.split("T")[0];

  // 1. Ensure Customer ID
  const customerId = await ensureCustomerByName(input.customerName);

  // 2. Ensure SKU / Product ID
  let product = await getProduct(input.sku);
  if (!product && input.sku && input.customerName) {
    product = await upsertProduct({
      sku: input.sku,
      nameVi: input.productNameVi || input.sku,
      customerNames: [input.customerName],
      customerName: input.customerName,
      routing: [],
      needsRouting: true,
      unit: "Cái",
      createdAt: now,
      updatedAt: now,
    });
  }

  if (!product) {
    throw new Error(`Không tìm thấy hoặc khởi tạo được Part No. '${input.sku}' trong hệ thống.`);
  }

  const { data: prodData, error: prodLookupErr } = await supabaseAdmin
    .from("products")
    .select("id")
    .eq("part_no", input.sku.trim())
    .single();

  if (prodLookupErr || !prodData) {
    throw new Error(`Không tìm thấy mã sản phẩm ID cho Part No. '${input.sku}'`);
  }

  const productId = prodData.id;

  // Ensure product-customer link exists in product_customers table
  await supabaseAdmin
    .from("product_customers")
    .upsert({ product_id: productId, customer_id: customerId }, { onConflict: "product_id,customer_id" });

  // 3. Upsert into purchase_orders (idempotent by customer_id + po_number)
  const { data: poHeader, error: poErr } = await supabaseAdmin
    .from("purchase_orders")
    .upsert(
      {
        po_number: poNumber,
        customer_id: customerId,
        requested_date: reqDate,
        status: input.status || "NEW",
        created_at: now,
        updated_at: now,
      },
      { onConflict: "customer_id,po_number" }
    )
    .select("id")
    .single();

  if (poErr || !poHeader) {
    throw new Error(`Lỗi khởi tạo đơn hàng PO '${poNumber}': ${poErr?.message}`);
  }

  const poId = poHeader.id;

  // 4. Upsert into po_lines
  await supabaseAdmin.from("po_lines").delete().eq("po_id", poId);

  const { error: lineErr } = await supabaseAdmin.from("po_lines").insert({
    po_id: poId,
    customer_id: customerId,
    product_id: productId,
    order_qty: Math.max(1, Number(input.qty || 1)),
  });

  if (lineErr) {
    // Rollback PO header if line insert fails
    await supabaseAdmin.from("purchase_orders").delete().eq("id", poId);
    throw new Error(`Lỗi tạo chi tiết đơn hàng (PO Line) cho PO '${poNumber}': ${lineErr.message}`);
  }

  const created = await getPO(poId);
  if (!created) {
    throw new Error(`Không thể tra cứu đơn hàng PO '${poNumber}' sau khi lưu.`);
  }

  return created;
}

/**
 * Bulk create POs in Supabase PostgreSQL
 */
export async function bulkCreatePOs(
  pos: Array<Omit<PO, "poId" | "shippedQty" | "status" | "createdAt"> & { poId?: string; status?: POStatus; createdAt?: string; createdBy?: string }>
): Promise<PO[]> {
  if (!pos || pos.length === 0) return [];

  const now = new Date().toISOString();
  const todayStr = now.split("T")[0];

  // 1. Gather distinct customer names and ensure all customer IDs
  const customerNamesSet = new Set<string>();
  pos.forEach((p) => {
    const c = (p.customerName || "").trim();
    if (c) customerNamesSet.add(c);
  });

  const customerIdMap = new Map<string, string>(); // lower(name) -> customer_id
  for (const name of customerNamesSet) {
    const custId = await ensureCustomerByName(name);
    customerIdMap.set(name.toLowerCase(), custId);
  }

  // 2. Gather distinct SKUs and ensure all product IDs
  const skuSet = new Set<string>();
  pos.forEach((p) => {
    const s = (p.sku || "").trim();
    if (s) skuSet.add(s);
  });

  const { data: dbProducts, error: prodErr } = await supabaseAdmin
    .from("products")
    .select("id, part_no")
    .in("part_no", Array.from(skuSet));

  if (prodErr) {
    throw new Error(`Lỗi tra cứu sản phẩm khi import PO: ${prodErr.message}`);
  }

  const productIdMap = new Map<string, string>(); // lower(part_no) -> product_id
  (dbProducts || []).forEach((p) => {
    productIdMap.set(p.part_no.toLowerCase().trim(), p.id);
  });

  // For any missing SKU, create draft product in products
  for (const p of pos) {
    const sLower = (p.sku || "").trim().toLowerCase();
    if (!productIdMap.has(sLower)) {
      await upsertProduct({
        sku: p.sku.trim(),
        nameVi: p.productNameVi || p.sku.trim(),
        customerNames: [p.customerName.trim()],
        customerName: p.customerName.trim(),
        routing: [],
        needsRouting: true,
        unit: "Cái",
        createdAt: now,
        updatedAt: now,
      });
      const { data: newProd } = await supabaseAdmin
        .from("products")
        .select("id")
        .eq("part_no", p.sku.trim())
        .single();
      if (newProd) {
        productIdMap.set(sLower, newProd.id);
      }
    }
  }

  // 3. Ensure product_customers relationships
  const pcPairsToUpsert: { product_id: string; customer_id: string }[] = [];
  const pcKeySet = new Set<string>();

  for (const p of pos) {
    const custId = customerIdMap.get(p.customerName.trim().toLowerCase());
    const prodId = productIdMap.get(p.sku.trim().toLowerCase());
    if (custId && prodId) {
      const key = `${prodId}:${custId}`;
      if (!pcKeySet.has(key)) {
        pcKeySet.add(key);
        pcPairsToUpsert.push({ product_id: prodId, customer_id: custId });
      }
    }
  }

  if (pcPairsToUpsert.length > 0) {
    const { error: pcErr } = await supabaseAdmin
      .from("product_customers")
      .upsert(pcPairsToUpsert, { onConflict: "product_id,customer_id" });
    if (pcErr) {
      console.error("[bulkCreatePOs] Error upserting product_customers:", pcErr);
    }
  }

  // 4. Batch upsert purchase_orders headers (deduplicated by customer_id + po_number)
  const poHeadersToUpsertMap = new Map<string, any>();
  pos.forEach((p, idx) => {
    const custId = customerIdMap.get(p.customerName.trim().toLowerCase());
    if (!custId) return;
    const poNum = (p.poNumber || p.poId || `PO-${Date.now()}-${idx + 1}`).trim();
    const key = `${poNum.toLowerCase()}:${custId}`;
    if (!poHeadersToUpsertMap.has(key)) {
      poHeadersToUpsertMap.set(key, {
        po_number: poNum,
        customer_id: custId,
        requested_date: p.requestedDate || todayStr,
        status: p.status || "NEW",
        created_at: p.createdAt || now,
        updated_at: now,
      });
    }
  });

  const poHeadersToUpsert = Array.from(poHeadersToUpsertMap.values());
  const poHeaderIdMap = new Map<string, string>(); // `${po_number.toLowerCase()}:${customer_id}` -> po_id

  // Chunk header upserts in batches of 100
  const BATCH_SIZE = 100;
  for (let i = 0; i < poHeadersToUpsert.length; i += BATCH_SIZE) {
    const chunk = poHeadersToUpsert.slice(i, i + BATCH_SIZE);
    const { data: createdHeaders, error: headerErr } = await supabaseAdmin
      .from("purchase_orders")
      .upsert(chunk, { onConflict: "customer_id,po_number" })
      .select("id, po_number, customer_id");

    if (headerErr || !createdHeaders) {
      throw new Error(`Lỗi khởi tạo danh sách đơn hàng PO: ${headerErr?.message}`);
    }

    createdHeaders.forEach((h) => {
      poHeaderIdMap.set(`${h.po_number.toLowerCase()}:${h.customer_id}`, h.id);
    });
  }

  // 5. Batch insert/update po_lines
  const allPoIds = Array.from(poHeaderIdMap.values());
  const { data: existingLines } = await supabaseAdmin
    .from("po_lines")
    .select("id, po_id, product_id")
    .in("po_id", allPoIds);

  const existingLineMap = new Map<string, string>(); // `${po_id}:${product_id}` -> line_id
  (existingLines || []).forEach((l) => {
    existingLineMap.set(`${l.po_id}:${l.product_id}`, l.id);
  });

  const linesToInsert: any[] = [];
  const linesToUpdate: { id: string; order_qty: number }[] = [];

  for (let idx = 0; idx < pos.length; idx++) {
    const p = pos[idx];
    const custId = customerIdMap.get(p.customerName.trim().toLowerCase());
    const prodId = productIdMap.get(p.sku.trim().toLowerCase());
    const poNum = (p.poNumber || p.poId || `PO-${Date.now()}-${idx + 1}`).trim();
    const poId = custId ? poHeaderIdMap.get(`${poNum.toLowerCase()}:${custId}`) : undefined;

    if (poId && prodId && custId) {
      const lineKey = `${poId}:${prodId}`;
      const existingLineId = existingLineMap.get(lineKey);
      const targetQty = Math.max(1, Number(p.qty || 1));

      if (existingLineId) {
        linesToUpdate.push({ id: existingLineId, order_qty: targetQty });
      } else {
        linesToInsert.push({
          po_id: poId,
          customer_id: custId,
          product_id: prodId,
          order_qty: targetQty,
        });
      }
    }
  }

  // Update existing lines
  for (const item of linesToUpdate) {
    await supabaseAdmin
      .from("po_lines")
      .update({ order_qty: item.order_qty })
      .eq("id", item.id);
  }

  // Insert new lines in batches of 100
  for (let i = 0; i < linesToInsert.length; i += BATCH_SIZE) {
    const chunk = linesToInsert.slice(i, i + BATCH_SIZE);
    const { error: lineErr } = await supabaseAdmin.from("po_lines").insert(chunk);
    if (lineErr) {
      throw new Error(`Lỗi khởi tạo chi tiết đơn hàng (PO Lines): ${lineErr.message}`);
    }
  }

  // 6. Reconciliation check & Fetch created POs
  const totalRequested = pos.length;
  const totalProcessed = linesToInsert.length + linesToUpdate.length;
  if (totalProcessed !== totalRequested) {
    console.warn(
      `[bulkCreatePOs Reconciliation] Cảnh báo chênh lệch dòng: Yêu cầu ${totalRequested} dòng, xử lý ${totalProcessed} dòng (${linesToInsert.length} tạo mới, ${linesToUpdate.length} cập nhật).`
    );
  }

  return linesToInsert.map(r => ({ poId: r.po_id, sku: r.product_id } as any));
}

/**
 * Update PO details in Supabase PostgreSQL (supports per-line updates)
 */
export async function updatePO(poId: string, updates: Partial<PO>): Promise<PO> {
  const existing = await getPO(poId);
  if (!existing) {
    throw new Error(`Không tìm thấy đơn hàng PO: ${poId}`);
  }

  // 1. Update PO Line specific fields (order_qty)
  if (typeof updates.qty === "number" && updates.qty > 0) {
    if (existing.poLineId) {
      const { error: lineUpdateErr } = await supabaseAdmin
        .from("po_lines")
        .update({ order_qty: updates.qty })
        .eq("id", existing.poLineId);

      if (lineUpdateErr) {
        throw new Error(`Lỗi cập nhật số lượng dòng PO '${existing.poNumber}': ${lineUpdateErr.message}`);
      }
    } else {
      const { error: lineUpdateErr } = await supabaseAdmin
        .from("po_lines")
        .update({ order_qty: updates.qty })
        .eq("po_id", existing.poId);

      if (lineUpdateErr) {
        throw new Error(`Lỗi cập nhật số lượng PO Line cho PO '${existing.poNumber}': ${lineUpdateErr.message}`);
      }
    }
  }

  // 2. Update PO Header fields (requested_date, status, po_number, customer_id)
  const poHeaderUpdates: any = {
    updated_at: new Date().toISOString(),
  };

  if (updates.requestedDate) {
    poHeaderUpdates.requested_date = updates.requestedDate;
  }
  if (updates.status) {
    let s = updates.status;
    if (s === ("PARTIALLY_SHIPPED" as any)) s = "IN_PRODUCTION";
    poHeaderUpdates.status = s;
  }
  if (updates.poNumber) {
    poHeaderUpdates.po_number = updates.poNumber;
  }

  if (updates.customerName) {
    const custId = await ensureCustomerByName(updates.customerName);

    // Call PostgreSQL PL/pgSQL function update_po_customer inside an atomic transaction
    const { error: rpcErr } = await supabaseAdmin.rpc("update_po_customer", {
      p_po_id: existing.poId,
      p_new_customer_id: custId,
    });

    if (rpcErr) {
      // If function doesn't exist yet in Supabase schema cache (PGRST202), use atomic fallback sequence
      if (rpcErr.code === "PGRST202") {
        const { data: currentLines } = await supabaseAdmin
          .from("po_lines")
          .select("*")
          .eq("po_id", existing.poId);

        if (currentLines && currentLines.length > 0) {
          for (const line of currentLines) {
            if (line.product_id) {
              const { data: pc } = await supabaseAdmin
                .from("product_customers")
                .select("*")
                .eq("product_id", line.product_id)
                .eq("customer_id", custId)
                .maybeSingle();

              if (!pc) {
                throw new Error(
                  `Không thể chuyển PO '${existing.poNumber}' sang Khách hàng '${updates.customerName}' do SKU chưa được đăng ký cho Khách hàng này.`
                );
              }
            }
          }

          const { error: deleteErr } = await supabaseAdmin
            .from("po_lines")
            .delete()
            .eq("po_id", existing.poId);

          if (deleteErr) {
            throw new Error(
              `Không thể đổi Khách hàng cho PO '${existing.poNumber}' do đã có Lệnh sản xuất (WO) liên quan. Vui lòng xóa WO trước.`
            );
          }

          const { error: headerErr } = await supabaseAdmin
            .from("purchase_orders")
            .update({ customer_id: custId, updated_at: new Date().toISOString() })
            .eq("id", existing.poId);

          if (headerErr) {
            throw new Error(`Lỗi cập nhật Khách hàng cho PO '${existing.poNumber}': ${headerErr.message}`);
          }

          const newLines = currentLines.map((l) => ({
            ...l,
            customer_id: custId,
          }));
          const { error: insertErr } = await supabaseAdmin.from("po_lines").insert(newLines);
          if (insertErr) {
            await supabaseAdmin
              .from("purchase_orders")
              .update({ customer_id: (existing as any).customerId || (currentLines[0] as any).customer_id })
              .eq("id", existing.poId);

            throw new Error(
              `Không thể chuyển PO '${existing.poNumber}' sang Khách hàng '${updates.customerName}': ${insertErr.message}`
            );
          }
        } else {
          poHeaderUpdates.customer_id = custId;
        }
      } else {
        if (
          rpcErr.message?.includes("product_customers") ||
          rpcErr.message?.includes("fk_poline_product_customer")
        ) {
          throw new Error(
            `Không thể chuyển PO '${existing.poNumber}' sang Khách hàng '${updates.customerName}' do SKU '${existing.sku}' chưa được đăng ký cho Khách hàng này.`
          );
        }
        if (
          rpcErr.message?.includes("work_orders") ||
          rpcErr.message?.includes("fk_work_orders")
        ) {
          throw new Error(
            `Không thể đổi Khách hàng cho PO '${existing.poNumber}' do đã có Lệnh sản xuất (WO) liên quan. Vui lòng xóa WO trước.`
          );
        }
        throw new Error(`Lỗi cập nhật Khách hàng cho PO '${existing.poNumber}': ${rpcErr.message}`);
      }
    }
  }

  if (Object.keys(poHeaderUpdates).length > 1) {
    const { error: poUpdateErr } = await supabaseAdmin
      .from("purchase_orders")
      .update(poHeaderUpdates)
      .eq("id", existing.poId);

    if (poUpdateErr) {
      throw new Error(`Lỗi cập nhật thông tin PO '${existing.poNumber}': ${poUpdateErr.message}`);
    }
  }

  const lookupKey = existing.poLineId || existing.poId;
  const updatedPO = await getPO(lookupKey);
  if (!updatedPO) {
    throw new Error(`Lỗi lấy thông tin PO '${existing.poNumber}' sau khi cập nhật.`);
  }

  if (updates.requestedDate && updates.requestedDate !== existing.requestedDate) {
    try {
      const { recalculateChainDeadlines } = await import("./po-wo-engine");
      await recalculateChainDeadlines(existing.poId);
    } catch (e) {
      console.warn(`[updatePO] Recalculate chain deadlines warning:`, e);
    }
  }

  return updatedPO;
}

/**
 * Delete a PO with FK constraint protection (supports deleting single PO line or whole PO)
 */
export async function deletePO(poId: string): Promise<void> {
  const existing = await getPO(poId);
  if (!existing) return;

  const poNumber = existing.poNumber || existing.poId;

  // Case A: Deleting a single PO line (when poId passed is poLineId and not the whole PO header id)
  const isSpecificLine =
    existing.poLineId &&
    poId.trim().toLowerCase() === existing.poLineId.toLowerCase() &&
    existing.poLineId.toLowerCase() !== existing.poId.toLowerCase();

  if (isSpecificLine) {
    // 1. Check if any Work Orders reference this specific po_line_id
    const { count: woCount } = await supabaseAdmin
      .from("work_orders")
      .select("*", { count: "exact", head: true })
      .eq("po_line_id", existing.poLineId);

    if (woCount && woCount > 0) {
      throw new Error(`Không thể xóa dòng PO ${poNumber} (SKU ${existing.sku}) do đã có Lệnh sản xuất (WO) liên quan. Vui lòng xóa WO trước.`);
    }

    // 2. Check total lines remaining in this PO
    const { count: totalLines } = await supabaseAdmin
      .from("po_lines")
      .select("*", { count: "exact", head: true })
      .eq("po_id", existing.poId);

    if (!totalLines || totalLines <= 1) {
      // Last remaining line: delete the entire PO header
      const { error: delPoErr } = await supabaseAdmin
        .from("purchase_orders")
        .delete()
        .eq("id", existing.poId);

      if (delPoErr) {
        throw new Error(`Xóa đơn hàng PO '${poNumber}' thất bại: ${delPoErr.message}`);
      }
    } else {
      // Multi-line PO: delete only this po_lines record
      const { error: delLineErr } = await supabaseAdmin
        .from("po_lines")
        .delete()
        .eq("id", existing.poLineId);

      if (delLineErr) {
        throw new Error(`Xóa dòng PO '${poNumber}' (SKU ${existing.sku}) thất bại: ${delLineErr.message}`);
      }
    }
    return;
  }

  // Case B: Deleting the entire PO header (or single-line PO where poId is header id/number)
  // 1. Fetch all po_lines IDs for this PO in Supabase
  const { data: poLines } = await supabaseAdmin
    .from("po_lines")
    .select("id")
    .eq("po_id", existing.poId);

  const poLineIds = (poLines || []).map((l) => l.id);

  if (poLineIds.length > 0) {
    // Check if any Work Orders in Supabase reference these po_lines
    const { count: woCount } = await supabaseAdmin
      .from("work_orders")
      .select("*", { count: "exact", head: true })
      .in("po_line_id", poLineIds);

    if (woCount && woCount > 0) {
      throw new Error(`Không thể xóa PO ${poNumber} do đã có Lệnh sản xuất (WO) liên quan. Vui lòng xóa WO trước.`);
    }
  }

  // 2. Delete PO header (CASCADE deletes po_lines in schema v4)
  const { error: deleteErr } = await supabaseAdmin
    .from("purchase_orders")
    .delete()
    .eq("id", existing.poId);

  if (deleteErr) {
    if (deleteErr.message && (deleteErr.message.includes("foreign key") || deleteErr.message.includes("RESTRICT"))) {
      throw new Error(`Không thể xóa PO ${poNumber} do đã có Lệnh sản xuất (WO) liên quan. Vui lòng xóa WO trước.`);
    }
    throw new Error(`Xóa đơn hàng PO '${poNumber}' thất bại: ${deleteErr.message}`);
  }
}

/**
 * Bulk delete POs with individual error collection
 */
export async function bulkDeletePOs(poIds: string[]): Promise<BulkDeletePosResult> {
  if (!poIds || poIds.length === 0) {
    return { deletedCount: 0, rejectedCount: 0, rejected: [] };
  }

  let deletedCount = 0;
  const rejected: { id: string; reason: string }[] = [];

  for (const id of poIds) {
    try {
      await deletePO(id);
      deletedCount++;
    } catch (err: any) {
      rejected.push({
        id,
        reason: err.message || "Xóa đơn hàng PO thất bại.",
      });
    }
  }

  return {
    deletedCount,
    rejectedCount: rejected.length,
    rejected,
  };
}
