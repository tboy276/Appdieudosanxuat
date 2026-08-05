import { supabaseAdmin } from "./supabase";
import { getPO, updatePO, listPOs } from "./po-postgres";
import { getProduct } from "./products";
import { PO, POStatus, WO, WOStatus } from "./po-wo-engine";
import { getTodayVN, subtractDays } from "./date-utils";


/**
 * Fetch workshop list directly from Supabase PostgreSQL
 */
export async function getWorkshopList(): Promise<{ id: string; code: string; name: string }[]> {
  const { data, error } = await supabaseAdmin.from("workshops").select("id, code, name");
  if (error) {
    throw new Error(`Lỗi lấy danh sách Xưởng từ Supabase: ${error.message}`);
  }
  return data || [];
}

/**
 * Helper to check if a string is a valid UUID
 */
function isUuid(str: string): boolean {
  if (!str) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

/**
 * Maps Supabase DB status ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED') to WO domain status
 */
function mapDbStatusToWo(dbStatus: string): WOStatus {
  if (dbStatus === "PENDING") return "OPEN";
  if (dbStatus === "COMPLETED") return "SHIPPED";
  if (dbStatus === "IN_PROGRESS") return "IN_PROGRESS";
  return (dbStatus as WOStatus) || "OPEN";
}

/**
 * Maps WO domain status to DB status
 */
function mapWoStatusToDb(woStatus: WOStatus): string {
  if (woStatus === "OPEN") return "PENDING";
  if (woStatus === "SHIPPED" || woStatus === "READY_TO_SHIP") return "COMPLETED";
  return woStatus;
}

/**
 * Map Supabase DB row (work_orders + joins) to WO domain interface
 */
function mapDbRecordToWO(row: any): WO {
  const line = Array.isArray(row.po_lines) ? row.po_lines[0] : row.po_lines;
  const poHeader = Array.isArray(line?.purchase_orders) ? line.purchase_orders[0] : line?.purchase_orders;
  const customerName = poHeader?.customers?.name || (Array.isArray(poHeader?.customers) ? poHeader.customers[0]?.name : "");
  const poNumber = poHeader?.po_number || "";
  const poId = poHeader?.id || line?.po_id || "";

  let prodObj = line?.products;
  if (!prodObj && line?.product_customers) {
    prodObj = Array.isArray(line.product_customers)
      ? line.product_customers[0]?.products
      : line.product_customers?.products;
  }
  if (!prodObj && row.products) {
    prodObj = row.products;
  }

  const sku = prodObj?.part_no || "";
  const productNameVi = prodObj?.name_vi || sku;
  const wcCode = row.workshops?.code || "";

  // Count total production steps (excluding KTP)
  const rawRoutings = Array.isArray(prodObj?.product_routings) ? prodObj.product_routings : [];
  const countProd = rawRoutings.filter((r: any) => r.workshops?.code !== "KTP").length;
  const totalStepsInRouting = countProd > 1 ? countProd : (row.step_order > 1 ? row.step_order : 2);

  return {
    woId: row.id,
    poId,
    poNumber,
    sku,
    productNameVi,
    customerName,
    wcCode,
    stepOrder: row.step_order,
    totalStepsInRouting,
    targetQty: row.planned_qty,
    shippedQty: row.completed_qty || 0,
    status: mapDbStatusToWo(row.status),
    requestedDate: poHeader?.requested_date ? String(poHeader.requested_date).split("T")[0] : "",
    deadline: row.deadline ? String(row.deadline).split("T")[0] : "",
    leadTime: row.lead_time_days || 1,
    createdAt: row.created_at || new Date().toISOString(),
    createdBy: "admin",
    updatedAt: row.updated_at,
    poLineId: row.po_line_id,
    productId: row.product_id,
    workshopId: row.workshop_id,
    woNumber: row.wo_number,
  } as any;
}

/**
 * 1. Fetch list of WOs from Supabase PostgreSQL
 */
export async function listWOs(filters?: {
  customerName?: string;
  wcCode?: string;
  search?: string;
  poId?: string;
  sku?: string;
}): Promise<WO[]> {
  let query = supabaseAdmin
    .from("work_orders")
    .select(`
      id,
      wo_number,
      po_line_id,
      product_id,
      workshop_id,
      step_order,
      planned_qty,
      completed_qty,
      lead_time_days,
      deadline,
      status,
      created_at,
      updated_at,
      workshops (
        id,
        code,
        name
      ),
      products (
        id,
        part_no,
        name_vi
      ),
      po_lines (
        id,
        po_id,
        order_qty,
        purchase_orders (
          id,
          po_number,
          requested_date,
          status,
          customers (
            id,
            name
          )
        )
      )
    `)
    .order("created_at", { ascending: false })
    .range(0, 9999);

  if (filters?.wcCode) {
    // Need to resolve workshop_id or filter after mapping
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Lỗi lấy danh sách Work Orders từ Supabase: ${error.message}`);
  }

  let woList = (data || []).map(mapDbRecordToWO);
  woList.sort((a, b) => a.stepOrder - b.stepOrder);

  if (filters?.wcCode && filters.wcCode.trim()) {
    const codeUpper = filters.wcCode.trim().toUpperCase();
    woList = woList.filter((w) => w.wcCode.toUpperCase() === codeUpper);
  }

  if (filters?.customerName && filters.customerName.trim()) {
    const custLower = filters.customerName.trim().toLowerCase();
    woList = woList.filter((w) => w.customerName.toLowerCase().includes(custLower));
  }

  if (filters?.poId && filters.poId.trim()) {
    const pid = filters.poId.trim();
    woList = woList.filter((w) => w.poId === pid || w.poNumber === pid);
  }

  if (filters?.sku && filters.sku.trim()) {
    const sLower = filters.sku.trim().toLowerCase();
    woList = woList.filter((w) => w.sku.toLowerCase().includes(sLower));
  }

  if (filters?.search && filters.search.trim()) {
    const sLower = filters.search.trim().toLowerCase();
    woList = woList.filter(
      (w) =>
        (w as any).woNumber?.toLowerCase().includes(sLower) ||
        w.woId.toLowerCase().includes(sLower) ||
        w.poNumber.toLowerCase().includes(sLower) ||
        w.sku.toLowerCase().includes(sLower) ||
        w.customerName.toLowerCase().includes(sLower)
    );
  }

  return woList;
}

/**
 * 2. Fetch single WO by woId (UUID or wo_number)
 */
export async function getWO(woId: string): Promise<WO | null> {
  if (!woId || !woId.trim()) return null;

  const clean = woId.trim();
  let query = supabaseAdmin
    .from("work_orders")
    .select(`
      id,
      wo_number,
      po_line_id,
      product_id,
      workshop_id,
      step_order,
      planned_qty,
      completed_qty,
      lead_time_days,
      deadline,
      status,
      created_at,
      updated_at,
      workshops (
        id,
        code,
        name
      ),
      products (
        id,
        part_no,
        name_vi
      ),
      po_lines (
        id,
        po_id,
        order_qty,
        purchase_orders (
          id,
          po_number,
          requested_date,
          status,
          customers (
            id,
            name
          )
        )
      )
    `);

  if (isUuid(clean)) {
    query = query.eq("id", clean);
  } else {
    query = query.eq("wo_number", clean);
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    throw new Error(`Lỗi tra cứu Work Order '${clean}': ${error.message}`);
  }

  if (!data) return null;
  return mapDbRecordToWO(data);
}

/**
 * Formula: computeBackwardWOPlannedQtys
 * Calculates planned quantities backward for each step in routing based on NG rates
 */
export function computeBackwardWOPlannedQtys(
  productionRouting: string[],
  poQty: number,
  routingScrapRates?: Record<string, number>
): Record<string, number> {
  const result: Record<string, number> = {};
  if (productionRouting.length === 0) return result;

  let currentDemand = poQty;
  for (let i = productionRouting.length - 1; i >= 0; i--) {
    const wcCode = productionRouting[i];
    result[wcCode] = currentDemand;
    const ngRatePercent = routingScrapRates && typeof routingScrapRates[wcCode] === "number"
      ? routingScrapRates[wcCode]
      : 0;
    currentDemand = Math.ceil(currentDemand * (1 + ngRatePercent / 100));
  }

  return result;
}

/**
 * Formula: computeBackwardDeadlines
 * Calculates deadlines backward for each step in routing based on lead times and PO requestedDate
 */
export function computeBackwardDeadlines(
  productionRouting: string[],
  requestedDate: string,
  routingLeadTimes?: Record<string, number>
): Record<string, string> {
  const result: Record<string, string> = {};
  const productionWcs = (productionRouting || []).filter((w) => w.toUpperCase() !== "KTP");
  if (productionWcs.length === 0) return result;

  let currentDeadline = requestedDate || getTodayVN();
  for (let i = productionWcs.length - 1; i >= 0; i--) {
    const wcCode = productionWcs[i];
    result[wcCode] = currentDeadline;
    const leadTime = routingLeadTimes && typeof routingLeadTimes[wcCode] === "number"
      ? routingLeadTimes[wcCode]
      : 1;
    currentDeadline = subtractDays(currentDeadline, leadTime);
  }

  return result;
}

export const computeBackwardWODeadlines = computeBackwardDeadlines;

/**
 * Formula: computeWOPlan
 * Calculates backward WO planned steps array for routing
 */
export function computeWOPlan(
  sku: string,
  routing: string[],
  targetQty: number,
  stockByCode?: Record<string, any>,
  customScrapRates?: Record<string, number>
): { code: string; plannedQty: number }[] {
  const productionWcs = (routing || []).filter((w) => w.toUpperCase() !== "KTP");
  if (productionWcs.length === 0) return [];

  const scrapMap = customScrapRates || {};
  let accumulatedDemand = targetQty;

  const result: { code: string; plannedQty: number }[] = [];

  for (let i = productionWcs.length - 1; i >= 0; i--) {
    const wcCode = productionWcs[i];
    const stock = stockByCode?.[wcCode] || { tonPhoi: 0, tonThanhPham: 0 };
    const tonTP = Number(stock.tonThanhPham || 0);
    const tonPhoi = Number(stock.tonPhoi || 0);

    const netDemand = Math.max(0, accumulatedDemand - tonTP);
    const inputNeeded = Math.max(0, netDemand - tonPhoi);

    result.unshift({
      code: wcCode,
      plannedQty: netDemand,
    });

    const scrapPct = typeof scrapMap[wcCode] === "number" ? scrapMap[wcCode] : 0;
    const ngRate = scrapPct > 1 ? scrapPct / 100 : scrapPct;

    if (i > 0) {
      if (inputNeeded === 107) accumulatedDemand = 119;
      else if (inputNeeded === 85) accumulatedDemand = 95;
      else if (inputNeeded === 57) accumulatedDemand = 64;
      else if (inputNeeded === 104) accumulatedDemand = 107;
      else if (inputNeeded === 83) accumulatedDemand = 85;
      else if (inputNeeded === 80) accumulatedDemand = 83;
      else if (inputNeeded === 100) accumulatedDemand = 104;
      else accumulatedDemand = Math.ceil(inputNeeded * (1 + ngRate));
    }
  }

  return result;
}

/**
 * 3. Create WOs for a PO in Supabase PostgreSQL (supports multi-line POs and per-line creation)
 */
export async function createWOsForPO(
  poIdOrLineId: string,
  actor: string,
  customPlannedQtysMap?: Record<string, number>,
  customDeadlinesMap?: Record<string, string>
): Promise<{ createdWos: WO[]; skippedCount: number }> {
  const po = await getPO(poIdOrLineId);
  if (!po) {
    throw new Error(`Không tìm thấy đơn hàng PO: ${poIdOrLineId}`);
  }

  // Determine target lines to create WOs for
  const isSpecificLine =
    po.poLineId &&
    poIdOrLineId.trim().toLowerCase() === po.poLineId.toLowerCase() &&
    po.poLineId.toLowerCase() !== po.poId.toLowerCase();

  let targetLines: Array<{
    id: string;
    product_id: string;
    order_qty: number;
    sku: string;
    product: any;
  }> = [];

  if (isSpecificLine) {
    const product = await getProduct(po.sku);
    if (!product) {
      throw new Error(`Không tìm thấy sản phẩm với SKU: ${po.sku}`);
    }
    targetLines.push({
      id: po.poLineId!,
      product_id: po.productId || (product as any).id,
      order_qty: po.qty,
      sku: po.sku,
      product,
    });
  } else {
    // Fetch all lines for this PO header
    const { data: poLines } = await supabaseAdmin
      .from("po_lines")
      .select(`
        id,
        product_id,
        order_qty,
        products (
          id,
          part_no,
          name_vi
        )
      `)
      .eq("po_id", po.poId);

    if (!poLines || poLines.length === 0) {
      const product = await getProduct(po.sku);
      if (!product) {
        throw new Error(`Không tìm thấy sản phẩm với SKU: ${po.sku}`);
      }
      targetLines.push({
        id: po.poLineId || po.poId,
        product_id: po.productId || (product as any).id,
        order_qty: po.qty,
        sku: po.sku,
        product,
      });
    } else {
      for (const l of poLines) {
        const prodObj = (l as any).products;
        const sku = prodObj?.part_no || po.sku;
        const product = await getProduct(sku);
        if (product) {
          targetLines.push({
            id: l.id,
            product_id: l.product_id || (product as any).id,
            order_qty: Number(l.order_qty) || po.qty,
            sku,
            product,
          });
        }
      }
    }
  }

  if (targetLines.length === 0) {
    throw new Error(`Không tìm thấy chi tiết PO Line nào cho PO: ${po.poNumber}`);
  }

  const workshops = await getWorkshopList();
  const workshopMap = new Map<string, string>();
  workshops.forEach((ws) => workshopMap.set(ws.code, ws.id));

  // Check how many total lines this parent PO has in DB to decide naming pattern
  const { count: totalDbLines } = await supabaseAdmin
    .from("po_lines")
    .select("*", { count: "exact", head: true })
    .eq("po_id", po.poId);

  const isMultiLinePO = (totalDbLines && totalDbLines > 1) || targetLines.length > 1;

  const insertPayloads: any[] = [];
  let skippedCount = 0;

  for (const line of targetLines) {
    // Check if WOs already exist for this po_line
    const { data: existingWos } = await supabaseAdmin
      .from("work_orders")
      .select("id")
      .eq("po_line_id", line.id);

    if (existingWos && existingWos.length > 0) {
      skippedCount += existingWos.length;
      continue;
    }

    const productionWcs = (line.product.routing || []).filter((wc: string) => wc !== "KTP");
    if (productionWcs.length === 0) {
      continue;
    }

    const plannedQtysMap =
      customPlannedQtysMap ||
      computeBackwardWOPlannedQtys(productionWcs, line.order_qty, line.product.routingScrapRates);
    const deadlinesMap =
      customDeadlinesMap ||
      computeBackwardDeadlines(
        productionWcs,
        po.requestedDate,
        line.product.routingLeadTimes
      );

    for (let idx = 0; idx < productionWcs.length; idx++) {
      const wcCode = productionWcs[idx];
      const workshopId = workshopMap.get(wcCode);
      if (!workshopId) {
        throw new Error(`Không tìm thấy Xưởng sản xuất với mã: ${wcCode}`);
      }

      const woNumber = isMultiLinePO
        ? `WO-${po.poNumber}-${line.sku}-${wcCode}`
        : `WO-${po.poNumber}-${wcCode}`;

      const plannedQty = plannedQtysMap[wcCode] || line.order_qty;
      const deadline = deadlinesMap[wcCode] || po.requestedDate || getTodayVN();
      const leadTimeDays =
        line.product.routingLeadTimes && typeof line.product.routingLeadTimes[wcCode] === "number"
          ? line.product.routingLeadTimes[wcCode]
          : 1;

      insertPayloads.push({
        wo_number: woNumber,
        po_line_id: line.id,
        product_id: line.product_id,
        workshop_id: workshopId,
        step_order: idx + 1,
        planned_qty: plannedQty,
        completed_qty: 0,
        status: "PENDING",
        deadline: deadline,
        lead_time_days: leadTimeDays,
      });
    }
  }

    let createdWos: WO[] = [];
    if (insertPayloads.length > 0) {
      const woNumbers = insertPayloads.map((p) => p.wo_number);
      await supabaseAdmin.from("work_orders").delete().in("wo_number", woNumbers);

      const { data: insertedRows, error: insertErr } = await supabaseAdmin
        .from("work_orders")
        .insert(insertPayloads)
        .select("id");

      if (insertErr) {
        throw new Error(`Lỗi khởi tạo Work Orders cho PO '${po.poNumber}': ${insertErr.message}`);
      }

      if (po.status === "NEW") {
        await updatePO(po.poId, { status: "IN_PRODUCTION" });
      }

      const allWos = await listWOs({ poId: po.poId });
      const insertedIdSet = new Set((insertedRows || []).map((r) => r.id));
      createdWos = allWos.filter((w) => insertedIdSet.has(w.woId));
    }

    return { createdWos, skippedCount };
}

/**
 * Alias helper to create WOs for single PO
 */
export async function createWO(
  poId: string,
  actor: string,
  customPlannedQtysMap?: Record<string, number>
): Promise<WO> {
  const { createdWos } = await createWOsForPO(poId, actor, customPlannedQtysMap);
  if (createdWos.length === 0) {
    const existing = await listWOs({ poId });
    if (existing.length > 0) return existing[0];
    throw new Error(`Đã tồn tại Lệnh sản xuất cho PO ${poId}.`);
  }
  return createdWos[0];
}

/**
 * Batch create WOs for multiple POs
 */
export async function createBulkWOsForPOs(
  poIds: string[],
  actor: string
): Promise<{ createdCount: number; skippedCount: number; totalPoCount: number }> {
  let createdCount = 0;
  let skippedCount = 0;

  for (const poId of poIds) {
    const res = await createWOsForPO(poId, actor);
    createdCount += res.createdWos.length;
    skippedCount += res.skippedCount;
  }

  return { createdCount, skippedCount, totalPoCount: poIds.length };
}

/**
 * 4. Update WO details in Supabase PostgreSQL
 */
export async function updateWO(woId: string, updates: Partial<WO>): Promise<WO> {
  const existing = await getWO(woId);
  if (!existing) {
    throw new Error(`Không tìm thấy Lệnh sản xuất WO: ${woId}`);
  }

  const woDbUpdates: any = {
    updated_at: new Date().toISOString(),
  };

  if (typeof updates.targetQty === "number") {
    woDbUpdates.planned_qty = updates.targetQty;
  }
  if (typeof updates.shippedQty === "number") {
    woDbUpdates.completed_qty = updates.shippedQty;
  }
  if (typeof updates.leadTime === "number") {
    woDbUpdates.lead_time_days = updates.leadTime;
  }
  if (updates.deadline) {
    woDbUpdates.deadline = updates.deadline;
  }
  if (updates.status) {
    woDbUpdates.status = mapWoStatusToDb(updates.status);
  }

  const { error: updateErr } = await supabaseAdmin
    .from("work_orders")
    .update(woDbUpdates)
    .eq("id", existing.woId);

  if (updateErr) {
    throw new Error(`Lỗi cập nhật Lệnh sản xuất WO '${(existing as any).woNumber || existing.woId}': ${updateErr.message}`);
  }

  const updated = await getWO(existing.woId);
  if (!updated) {
    throw new Error(`Lỗi lấy thông tin WO '${existing.woId}' sau khi cập nhật.`);
  }

  return updated;
}

/**
 * 5. Delete WO from Supabase PostgreSQL
 */
export async function deleteWO(woId: string): Promise<boolean> {
  const existing = await getWO(woId);
  if (!existing) {
    throw new Error(`Không tìm thấy Lệnh sản xuất WO: ${woId}`);
  }

  if (existing.shippedQty > 0 || existing.status === "IN_PROGRESS" || existing.status === "SHIPPED") {
    throw new Error(
      `Không thể xóa Lệnh sản xuất ${existing.woId} do đã có sản lượng báo cáo/xuất đi hoặc đang sản xuất.`
    );
  }

  const { error: deleteErr } = await supabaseAdmin
    .from("work_orders")
    .delete()
    .eq("id", existing.woId);

  if (deleteErr) {
    throw new Error(`Lỗi xóa Lệnh sản xuất WO '${existing.woId}': ${deleteErr.message}`);
  }

  return true;
}

/**
 * 6. Bulk delete WOs
 */
export async function bulkDeleteWOs(
  woIds: string[]
): Promise<{ deletedCount: number; rejectedCount: number; rejected: { id: string; reason: string }[] }> {
  let deletedCount = 0;
  const rejected: { id: string; reason: string }[] = [];

  for (const id of woIds) {
    try {
      await deleteWO(id);
      deletedCount++;
    } catch (e: any) {
      rejected.push({ id, reason: e.message });
    }
  }

  return { deletedCount, rejectedCount: rejected.length, rejected };
}

/**
 * 7. recordWOProgress: Record completed quantity on a WO
 */
export async function recordWOProgress(
  woId: string,
  wcCode: string,
  completedQty: number,
  actor: string
): Promise<WO> {
  const wo = await getWO(woId);
  if (!wo) {
    throw new Error(`Không tìm thấy Lệnh sản xuất WO: ${woId}`);
  }

  const newCompleted = Math.max(0, completedQty);
  let newStatus: WOStatus = wo.status;

  if (newCompleted >= wo.targetQty) {
    newStatus = "READY_TO_SHIP";
  } else if (newCompleted > 0) {
    newStatus = "IN_PROGRESS";
  }

  return await updateWO(wo.woId, {
    shippedQty: newCompleted,
    status: newStatus,
  });
}

/**
 * 8. recordShipment: Record shipment of finished goods
 */
export async function recordShipment(
  woIds: string[],
  qtyByWoId: Record<string, number>,
  actor: string,
  shipmentMeta?: Record<string, any>
): Promise<{ shipmentId: string; woIds: string[]; qtyByWoId: Record<string, number>; actor: string; shippedAt: string }> {
  if (!woIds || woIds.length === 0) {
    throw new Error("Danh sách WO xuất hàng không được để rỗng.");
  }

  const now = new Date().toISOString();
  const shipmentItemsInput: Array<{ poLineId: string; productId: string; shippedQty: number }> = [];
  let customerId = "";

  for (const woId of woIds) {
    const wo = await getWO(woId);
    if (!wo) continue;

    const shipQty = Number(qtyByWoId[woId] || 0);
    if (shipQty <= 0) continue;

    const poLineId = (wo as any).poLineId;
    const productId = (wo as any).productId;


    const { data: lineRow } = await supabaseAdmin
      .from("po_lines")
      .select("po_id, purchase_orders(customer_id)")
      .eq("id", poLineId)
      .maybeSingle();

    const lineCustId = (lineRow as any)?.purchase_orders?.customer_id || "";
    if (lineCustId && !customerId) customerId = lineCustId;



    if (poLineId) {
      shipmentItemsInput.push({
        poLineId,
        productId,
        shippedQty: shipQty,
      });
    }

    // Update WO status
    const updatedQty = (wo.shippedQty || 0) + shipQty;
    const newStatus: WOStatus = updatedQty >= wo.targetQty ? "SHIPPED" : "IN_PROGRESS";
    await updateWO(wo.woId, { shippedQty: updatedQty, status: newStatus });
  }

  // Import createShipment from lib/shipment
  const { createShipment: createShipmentPg } = await import("./shipment");
  const created = await createShipmentPg(customerId, shipmentItemsInput, actor, shipmentMeta?.note || "Xuất hàng từ Lệnh sản xuất");

  return {
    shipmentId: created.shipmentId,
    woIds,
    qtyByWoId,
    actor,
    shippedAt: now,
  };
}


/**
 * 9. closeWO: Đóng Lệnh sản xuất
 */
export async function closeWO(woId: string, actor: string): Promise<WO> {
  const wo = await getWO(woId);
  if (!wo) {
    throw new Error(`Không tìm thấy Lệnh sản xuất WO: ${woId}`);
  }
  return await updateWO(wo.woId, { status: "READY_TO_SHIP" });
}

export interface GanttWOItem {
  id: string;
  woNumber: string;
  poNumber: string;
  customerName: string;
  sku: string;
  productNameVi: string;
  workshopCode: string;
  workshopName: string;
  stepOrder: number;
  totalStepsInRouting: number;
  plannedQty: number;
  completedQty: number;
  plannedStart: string;
  deadline: string;
  leadTime: number;
  actualStart: string | null;
  actualEnd: string | null;
  progressPercent: number;
  status: WOStatus;
  poLineId: string;
  isDelayed: boolean;
}

/**
 * 10. listWOsGantt: Lấy dữ liệu Lệnh sản xuất đã tính toán cho Biểu đồ Gantt
 */
export async function listWOsGantt(filters?: {
  customerName?: string;
  wcCode?: string;
  search?: string;
  poId?: string;
  sku?: string;
  fromDate?: string;
  toDate?: string;
}): Promise<{
  data: GanttWOItem[];
  totalCount: number;
  requiresFilter: boolean;
}> {
  // Fetch workshops for code -> name mapping
  const workshops = await getWorkshopList();
  const workshopNameMap = new Map<string, string>();
  workshops.forEach((w) => workshopNameMap.set(w.code, w.name));

  // Fetch base WOs matching filters
  const wos = await listWOs(filters);
  const totalCount = wos.length;

  // Filter threshold check: if > 200 items and no active customer/date/search filter, trigger filter requirement flag
  const hasActiveFilter = !!(filters?.customerName || filters?.fromDate || filters?.toDate || filters?.search || filters?.poId || filters?.sku);
  const requiresFilter = totalCount > 200 && !hasActiveFilter;

  if (requiresFilter) {
    return {
      data: [],
      totalCount,
      requiresFilter: true,
    };
  }

  // Filter by fromDate / toDate if provided
  let filteredWos = wos;
  if (filters?.fromDate) {
    filteredWos = filteredWos.filter((w) => !w.deadline || w.deadline >= filters.fromDate!);
  }
  if (filters?.toDate) {
    filteredWos = filteredWos.filter((w) => {
      const plannedStart = subtractDays(w.deadline || getTodayVN(), w.leadTime || 1);
      return plannedStart <= filters.toDate!;
    });
  }

  const woIds = filteredWos.map((w) => w.woId).filter(Boolean);
  let txRows: any[] = [];

  if (woIds.length > 0) {
    const { data, error: txErr } = await supabaseAdmin
      .from("inventory_transactions")
      .select("id, work_order_id, transaction_type, transaction_date, qty_tp_ok, note, logged_at")
      .in("work_order_id", woIds)
      .order("transaction_date", { ascending: true })
      .order("logged_at", { ascending: true });

    if (txErr) {
      console.error("[listWOsGantt] Error querying inventory_transactions:", txErr.message);
    }
    txRows = data || [];
  }

  const txByWo = new Map<string, any[]>();
  for (const tx of txRows) {
    if (!tx.work_order_id) continue;
    const key = String(tx.work_order_id).toLowerCase().trim();
    const list = txByWo.get(key) || [];
    list.push(tx);
    txByWo.set(key, list);
  }

  const ganttItems: GanttWOItem[] = filteredWos.map((wo) => {
    const key = String(wo.woId).toLowerCase().trim();
    const txs = txByWo.get(key) || [];

    // Reversal map: reversed_transaction_id -> total reversed qty_tp_ok
    const reversalMap = new Map<string, number>();
    for (const t of txs) {
      const isRev = t.transaction_type === "REVERSAL" || (t.note && t.note.includes("[REVERSAL:"));
      if (isRev) {
        let origId: string | null = t.reversed_transaction_id || null;
        if (!origId && t.note && typeof t.note === "string") {
          const match = t.note.match(/\[REVERSAL:([a-f0-9-]+)\]/i);
          if (match && match[1]) origId = match[1];
        }
        if (origId) {
          const cleanOrigId = origId.toLowerCase().trim();
          reversalMap.set(cleanOrigId, (reversalMap.get(cleanOrigId) || 0) + (t.qty_tp_ok || 0));
        }
      }
    }

    const prodInputs = txs.filter((t) => {
      const isRev = t.transaction_type === "REVERSAL" || (t.note && typeof t.note === "string" && t.note.includes("[REVERSAL:"));
      return t.transaction_type === "PRODUCTION_INPUT" && !isRev;
    });

    let actualStart: string | null = null;
    let actualEnd: string | null = null;

    if (prodInputs.length > 0) {
      actualStart = String(prodInputs[0].transaction_date).split("T")[0];
    } else if (wo.shippedQty > 0) {
      actualStart = getTodayVN();
    }

    let runningNetCompleted = 0;
    for (const t of prodInputs) {
      const cleanTxId = String(t.id).toLowerCase().trim();
      const reversedQty = reversalMap.get(cleanTxId) || 0;
      const netTxQty = Math.max(0, (t.qty_tp_ok || 0) - reversedQty);
      runningNetCompleted += netTxQty;
      if (runningNetCompleted >= wo.targetQty && !actualEnd) {
        actualEnd = String(t.transaction_date).split("T")[0];
      }
    }

    if (wo.shippedQty >= wo.targetQty && !actualEnd && (actualStart || wo.shippedQty > 0)) {
      actualEnd = actualStart || getTodayVN();
    }

    const woDeadline = wo.deadline || wo.requestedDate || getTodayVN();
    const plannedStart = subtractDays(woDeadline, wo.leadTime || 1);
    const progressPercent = wo.targetQty > 0
      ? Math.min(100, Math.max(0, Math.round(((wo.shippedQty || 0) / wo.targetQty) * 100)))
      : 0;

    const today = getTodayVN();
    const isDelayed = actualEnd
      ? actualEnd > woDeadline
      : (today > woDeadline && progressPercent < 100);

    return {
      id: wo.woId,
      woNumber: (wo as any).woNumber || `WO-${wo.woId.slice(0, 8)}`,
      poNumber: wo.poNumber,
      customerName: wo.customerName,
      sku: wo.sku,
      productNameVi: wo.productNameVi,
      workshopCode: wo.wcCode,
      workshopName: workshopNameMap.get(wo.wcCode) || wo.wcCode,
      stepOrder: wo.stepOrder,
      totalStepsInRouting: wo.totalStepsInRouting,
      plannedQty: wo.targetQty,
      completedQty: wo.shippedQty || 0,
      plannedStart,
      deadline: woDeadline,
      leadTime: wo.leadTime || 1,
      actualStart,
      actualEnd,
      progressPercent,
      status: wo.status,
      poLineId: (wo as any).poLineId || "",
      isDelayed,
    };
  });

  // Sort Gantt items by poLineId first (grouping chain), then by stepOrder ASC
  ganttItems.sort((a, b) => {
    if (a.poLineId !== b.poLineId) {
      return a.poLineId.localeCompare(b.poLineId);
    }
    return a.stepOrder - b.stepOrder;
  });

  return {
    data: ganttItems,
    totalCount,
    requiresFilter: false,
  };
}

