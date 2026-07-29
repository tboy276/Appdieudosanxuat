import { redis } from "./redis";
import { getStockState } from "./inventory";
import { getProduct } from "./products";
import { WorkCenter, StockState } from "./types";

export type POStatus = "NEW" | "IN_PRODUCTION" | "PARTIALLY_SHIPPED" | "COMPLETED";

export interface PO {
  poId: string;
  poNumber: string;
  accountId?: string;
  customerName: string;
  sku: string;
  productNameVi: string;
  productNameEn?: string;
  qty: number;
  requestedDate: string;
  tolerance?: number;
  currency?: string;
  techRequirement?: string;
  specialRequirement?: string;
  shippedQty: number;
  status: POStatus;
  createdAt: string;
  createdBy: string;
}

export type WOStatus = "OPEN" | "IN_PROGRESS" | "READY_TO_SHIP" | "SHIPPED";

export interface WOStep {
  code: string;
  plannedQty: number;
  actualQty: number;
  status: "PENDING" | "DONE";
}

export interface WO {
  woId: string;
  poId: string;
  sku: string;
  targetQty: number;
  routing: string[];
  shippedQty: number;
  status: WOStatus;
  steps: WOStep[];
  createdAt: string;
  createdBy: string;
}

export interface ShipmentRecord {
  shipmentId: string;
  woIds: string[];
  qtyByWoId: Record<string, number>;
  actor: string;
  shippedAt: string;
  meta?: Record<string, any>;
}

export interface WOPlanStep {
  code: string;
  plannedQty: number;
}

export const DEFAULT_SCRAP_RATES: Record<string, number> = {
  CUAPHOI: 0.01,
  D1: 0.10,
  D2: 0.10,
  R1: 0.05,
  R2: 0.05,
  CK1: 0.02,
  CK2: 0.02,
  CK3: 0.02,
  MNL: 0.03,
  LR: 0.00,
};

/**
 * Pure calculation function: computeWOPlan
 * Computes planned quantity for each step in product routing working BACKWARD from final step to start.
 * Refactored for Dual-State Model (reading tonThanhPham at final step and tonPhoi at next step).
 */
export function computeWOPlan(
  sku: string,
  routing: string[],
  targetQty: number,
  stockByCode: Record<string, StockState>,
  scrapRateByCode: Record<string, number> = DEFAULT_SCRAP_RATES
): WOPlanStep[] {
  if (!routing || routing.length === 0) {
    throw new Error(`SKU ${sku} chưa khai báo routing, vui lòng bổ sung ở Tab Danh mục Sản phẩm.`);
  }

  const n = routing.length;
  const plannedQtyMap: Record<string, number> = {};

  // 1. Final Step (LR)
  const finalCode = routing[n - 1];
  const finalStock = stockByCode[finalCode] || { tonPhoi: 0, tonThanhPham: 0 };
  const finalScrapRate = scrapRateByCode[finalCode] ?? DEFAULT_SCRAP_RATES[finalCode] ?? 0;

  const requiredOutFinal = Math.max(0, targetQty - (finalStock.tonThanhPham || 0));
  plannedQtyMap[finalCode] = Math.ceil(requiredOutFinal / (1 - finalScrapRate));

  // 2. Backward Calculation from (n - 2) down to 0
  for (let i = n - 2; i >= 0; i--) {
    const currentCode = routing[i];
    const nextCode = routing[i + 1];

    const nextPlanned = plannedQtyMap[nextCode];
    const stockNext = stockByCode[nextCode] || { tonPhoi: 0, tonThanhPham: 0 };
    const scrapRate = scrapRateByCode[currentCode] ?? DEFAULT_SCRAP_RATES[currentCode] ?? 0;

    // Phoi already sitting at next step reduces required output from current step
    const availablePhoiAtNext = stockNext.tonPhoi || 0;
    const need = Math.max(0, nextPlanned - availablePhoiAtNext);
    plannedQtyMap[currentCode] = Math.ceil(need / (1 - scrapRate));
  }

  return routing.map((code) => ({
    code,
    plannedQty: plannedQtyMap[code],
  }));
}

/**
 * Pure calculation function: computeEquivalentFinishedQty
 * Computes equivalent finished quantity at the final step for all stock across routing steps.
 * Forward calculation incorporating remaining cumulative scrap rates.
 */
export function computeEquivalentFinishedQty(
  sku: string,
  routing: string[],
  stockByCode: Record<string, StockState>,
  scrapRateByCode: Record<string, number> = DEFAULT_SCRAP_RATES
): number {
  if (!routing || routing.length === 0) return 0;

  let totalEquivalent = 0;
  const n = routing.length;

  for (let i = 0; i < n; i++) {
    const currentCode = routing[i];
    const stock = stockByCode[currentCode] || { tonPhoi: 0, tonThanhPham: 0 };
    const tonPhoi = stock.tonPhoi || 0;
    const tonThanhPham = stock.tonThanhPham || 0;

    if (tonPhoi <= 0 && tonThanhPham <= 0) continue;

    // Yield for tonPhoi at step i: j from i to n-1
    let phoiYieldFactor = 1;
    for (let j = i; j < n; j++) {
      const codeJ = routing[j];
      const rateJ = scrapRateByCode[codeJ] ?? DEFAULT_SCRAP_RATES[codeJ] ?? 0;
      phoiYieldFactor *= (1 - rateJ);
    }

    // Yield for tonThanhPham at step i: j from i+1 to n-1 (since step i is already completed)
    let tpYieldFactor = 1;
    for (let j = i + 1; j < n; j++) {
      const codeJ = routing[j];
      const rateJ = scrapRateByCode[codeJ] ?? DEFAULT_SCRAP_RATES[codeJ] ?? 0;
      tpYieldFactor *= (1 - rateJ);
    }

    totalEquivalent += (tonPhoi * phoiYieldFactor) + (tonThanhPham * tpYieldFactor);
  }

  return totalEquivalent;
}

/**
 * PO & WO Storage Helpers
 */
export async function getPO(poId: string): Promise<PO | null> {
  const raw = await redis.get<PO | string>(`po:${poId}`);
  if (!raw) return null;
  return typeof raw === "string" ? JSON.parse(raw) : raw;
}

export async function listPOs(): Promise<PO[]> {
  const poIds = await redis.smembers("pos");
  if (!poIds || poIds.length === 0) return [];

  const results = await Promise.all(poIds.map((id) => getPO(id)));
  return results.filter((po): po is PO => po !== null && po !== undefined);
}

export async function getWO(woId: string): Promise<WO | null> {
  const raw = await redis.get<WO | string>(`wo:${woId}`);
  if (!raw) return null;
  return typeof raw === "string" ? JSON.parse(raw) : raw;
}

export async function listWOs(): Promise<WO[]> {
  const woIds = await redis.smembers("wos");
  if (!woIds || woIds.length === 0) return [];

  const results = await Promise.all(woIds.map((id) => getWO(id)));
  return results.filter((wo): wo is WO => wo !== null && wo !== undefined);
}

/**
 * 1. createPO: Khởi tạo Đơn hàng mới (PO)
 */
export async function createPO(
  input: Omit<PO, "poId" | "shippedQty" | "status" | "createdAt"> & { poId?: string }
): Promise<PO> {
  const poId = input.poId || `PO-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const now = new Date().toISOString();

  const po: PO = {
    ...input,
    poId,
    poNumber: input.poNumber || poId,
    shippedQty: 0,
    status: "NEW",
    createdAt: now,
    createdBy: input.createdBy || "system",
  };

  await redis.set(`po:${poId}`, po);
  await redis.sadd("pos", poId);
  return po;
}

/**
 * Update PO details
 */
export async function updatePO(poId: string, updates: Partial<PO>): Promise<PO> {
  const existing = await getPO(poId);
  if (!existing) throw new Error(`Không tìm thấy đơn hàng PO: ${poId}`);

  const updated: PO = {
    ...existing,
    ...updates,
    poId,
  };

  await redis.set(`po:${poId}`, updated);
  return updated;
}

/**
 * Delete PO with safety checks
 */
export async function deletePO(poId: string): Promise<void> {
  const allWos = await listWOs();
  const connectedWo = allWos.find((w) => w.poId === poId);
  if (connectedWo) {
    throw new Error(`Không thể xóa PO ${poId} do đã có Lệnh sản xuất WO (${connectedWo.woId}) liên quan. Vui lòng xóa WO trước.`);
  }

  await redis.del(`po:${poId}`);
  await redis.srem("pos", poId);
}

/**
 * 2. createWO: Tạo Lệnh sản xuất (WO) từ PO
 * Strict 1-PO-to-1-WO mapping & supports user custom planned quantities per workshop.
 */
export async function createWO(
  poId: string,
  actor: string,
  customPlannedQtys?: Record<string, number>
): Promise<WO> {
  const po = await getPO(poId);
  if (!po) {
    throw new Error(`Không tìm thấy đơn hàng PO: ${poId}`);
  }

  // 1-to-1 PO-WO Mapping Check
  const existingWos = await listWOs();
  const duplicate = existingWos.find((w) => w.poId === poId);
  if (duplicate) {
    throw new Error(`Đơn hàng PO ${po.poNumber} (${poId}) đã có Lệnh sản xuất ${duplicate.woId}. Mỗi PO chỉ được tạo 1 WO duy nhất.`);
  }

  const product = await getProduct(po.sku);
  if (!product || !product.routing || product.routing.length === 0) {
    throw new Error(`SKU ${po.sku} chưa khai báo routing, vui lòng bổ sung ở Tab Danh mục Sản phẩm.`);
  }

  // Read workcenters for scrap rates
  const rawWcs = await redis.get<WorkCenter[] | string>("workcenters");
  const scrapRateByCode: Record<string, number> = { ...DEFAULT_SCRAP_RATES };
  if (rawWcs) {
    const wcs: WorkCenter[] = typeof rawWcs === "string" ? JSON.parse(rawWcs) : rawWcs;
    wcs.forEach((wc) => {
      scrapRateByCode[wc.code] = wc.scrapRate;
    });
  }

  // Read current stock state for each workcenter in product routing
  const stockByCode: Record<string, StockState> = {};
  for (const code of product.routing) {
    stockByCode[code] = await getStockState(code, po.sku);
  }

  // Calculate default planned quantity backward
  const autoPlanSteps = computeWOPlan(po.sku, product.routing, po.qty, stockByCode, scrapRateByCode);

  // Map steps with custom user planned quantities if provided
  const finalSteps: WOStep[] = product.routing.map((code) => {
    const autoQty = autoPlanSteps.find((s) => s.code === code)?.plannedQty || po.qty;
    let plannedQty = autoQty;

    if (customPlannedQtys && customPlannedQtys[code] !== undefined && Number(customPlannedQtys[code]) > 0) {
      plannedQty = Number(customPlannedQtys[code]);
    }

    return {
      code,
      plannedQty,
      actualQty: 0,
      status: "PENDING",
    };
  });

  const woId = `WO-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
  const now = new Date().toISOString();

  const wo: WO = {
    woId,
    poId: po.poId,
    sku: po.sku,
    targetQty: po.qty,
    routing: product.routing,
    shippedQty: 0,
    status: "OPEN",
    steps: finalSteps,
    createdAt: now,
    createdBy: actor,
  };

  await redis.set(`wo:${woId}`, wo);
  await redis.sadd("wos", woId);

  // Transition PO status to IN_PRODUCTION if it was NEW
  if (po.status === "NEW") {
    po.status = "IN_PRODUCTION";
    await redis.set(`po:${po.poId}`, po);
  }

  return wo;
}

/**
 * Update WO details
 */
export async function updateWO(woId: string, updates: Partial<WO>): Promise<WO> {
  const existing = await getWO(woId);
  if (!existing) throw new Error(`Không tìm thấy Lệnh sản xuất WO: ${woId}`);

  let updatedSteps = existing.steps;
  let updatedStatus = updates.status !== undefined ? updates.status : existing.status;

  if (updates.targetQty !== undefined && Number(updates.targetQty) !== existing.targetQty) {
    const newTargetQty = Number(updates.targetQty);
    if (newTargetQty <= 0) {
      throw new Error("Số lượng mục tiêu WO phải lớn hơn 0.");
    }

    if (newTargetQty < existing.shippedQty) {
      throw new Error(`Không thể giảm targetQty (${newTargetQty} pcs) xuống dưới số lượng đã xuất hàng (${existing.shippedQty} pcs).`);
    }

    // 1. Fetch current stock states for each workcenter in product routing
    const stockByCode: Record<string, StockState> = {};
    for (const code of existing.routing) {
      stockByCode[code] = await getStockState(code, existing.sku);
    }

    // 2. Fetch workcenter scrap rates
    const rawWcs = await redis.get<WorkCenter[] | string>("workcenters");
    const scrapRateByCode: Record<string, number> = { ...DEFAULT_SCRAP_RATES };
    if (rawWcs) {
      const wcs: WorkCenter[] = typeof rawWcs === "string" ? JSON.parse(rawWcs) : rawWcs;
      wcs.forEach((wc) => {
        scrapRateByCode[wc.code] = wc.scrapRate;
      });
    }

    // 3. Compute recalculated WO plan steps based on current stock
    const autoPlanSteps = computeWOPlan(
      existing.sku,
      existing.routing,
      newTargetQty,
      stockByCode,
      scrapRateByCode
    );

    const planMap = Object.fromEntries(autoPlanSteps.map((s) => [s.code, s.plannedQty]));

    // 4. Update each step's plannedQty & transition status if actualQty < newPlannedQty
    updatedSteps = existing.steps.map((step) => {
      const newPlannedQty = planMap[step.code] ?? newTargetQty;
      let newStatus = step.status;

      if (step.actualQty < newPlannedQty) {
        // If actualQty is less than new plannedQty, step is not done yet -> PENDING
        newStatus = "PENDING";
      } else {
        // If actualQty >= newPlannedQty, step is DONE
        newStatus = "DONE";
      }

      return {
        ...step,
        plannedQty: newPlannedQty,
        status: newStatus,
      };
    });

    // 5. Sync overall WO status: if final step is no longer DONE, downgrade READY_TO_SHIP -> IN_PROGRESS
    const lastStep = updatedSteps[updatedSteps.length - 1];
    if (lastStep && lastStep.status !== "DONE" && (updatedStatus === "READY_TO_SHIP" || existing.status === "READY_TO_SHIP")) {
      updatedStatus = "IN_PROGRESS";
    }
  }

  const updated: WO = {
    ...existing,
    ...updates,
    steps: updatedSteps,
    status: updatedStatus,
    woId,
  };

  await redis.set(`wo:${woId}`, updated);
  return updated;
}

/**
 * Delete WO with safety checks
 */
export async function deleteWO(woId: string): Promise<void> {
  const existing = await getWO(woId);
  if (!existing) throw new Error(`Không tìm thấy Lệnh sản xuất WO: ${woId}`);

  if (existing.shippedQty > 0) {
    throw new Error(`Không thể xóa Lệnh sản xuất WO ${woId} do đã có hàng xuất đi (${existing.shippedQty} pcs).`);
  }

  const hasActualQty = existing.steps?.some((s) => s.actualQty > 0);
  if (hasActualQty) {
    throw new Error(`Không thể xóa Lệnh sản xuất WO ${woId} do đã có báo cáo sản lượng thực tế tại xưởng.`);
  }

  await redis.del(`wo:${woId}`);
  await redis.srem("wos", woId);

  // Reset parent PO status to NEW if no remaining active WOs for that PO
  const allWos = await listWOs();
  const remainingWosForPo = allWos.filter((w) => w.poId === existing.poId && w.woId !== woId);
  if (remainingWosForPo.length === 0) {
    const parentPo = await getPO(existing.poId);
    if (parentPo && parentPo.status === "IN_PRODUCTION") {
      parentPo.status = "NEW";
      await redis.set(`po:${parentPo.poId}`, parentPo);
    }
  }
}

/**
 * 3. recordWOProgress: Ghi nhận tiến độ sản xuất tại 1 công đoạn của WO
 */
export async function recordWOProgress(
  woId: string,
  wcCode: string,
  actualQty: number,
  actor: string
): Promise<WO> {
  const wo = await getWO(woId);
  if (!wo) {
    throw new Error(`Không tìm thấy Lệnh sản xuất WO: ${woId}`);
  }

  const stepIndex = wo.steps.findIndex((s) => s.code === wcCode);
  if (stepIndex === -1) {
    throw new Error(`Xưởng ${wcCode} không nằm trong quy trình (routing) của WO ${woId}.`);
  }

  const step = wo.steps[stepIndex];
  step.actualQty += actualQty;
  if (step.actualQty >= step.plannedQty) {
    step.status = "DONE";
  }

  if (wo.status === "OPEN") {
    wo.status = "IN_PROGRESS";
  }

  await redis.set(`wo:${woId}`, wo);
  return wo;
}

/**
 * 4. closeWO: Đóng Lệnh sản xuất khi bước LR hoàn thành
 */
export async function closeWO(woId: string, actor: string): Promise<WO> {
  const wo = await getWO(woId);
  if (!wo) {
    throw new Error(`Không tìm thấy Lệnh sản xuất WO: ${woId}`);
  }

  const lastStep = wo.steps[wo.steps.length - 1];
  if (!lastStep || lastStep.status !== "DONE") {
    throw new Error(`Không thể đóng WO: Bước lắp ráp cuối cùng (${lastStep?.code || "LR"}) chưa hoàn thành.`);
  }

  wo.status = "READY_TO_SHIP";
  await redis.set(`wo:${woId}`, wo);
  return wo;
}

/**
 * 5. recordShipment: Ghi nhận xuất hàng (cho phép xuất một phần)
 */
export async function recordShipment(
  woIds: string[],
  qtyByWoId: Record<string, number>,
  actor: string,
  shipmentMeta?: Record<string, any>
): Promise<ShipmentRecord> {
  if (!woIds || woIds.length === 0) {
    throw new Error("Danh sách WO xuất hàng không được để rỗng.");
  }

  const shipmentId = `SHIP-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const now = new Date().toISOString();

  for (const woId of woIds) {
    const shipQty = Number(qtyByWoId[woId] || 0);
    if (shipQty <= 0) continue;

    const wo = await getWO(woId);
    if (!wo) continue;

    wo.shippedQty += shipQty;
    if (wo.shippedQty >= wo.targetQty) {
      wo.status = "SHIPPED";
    }
    await redis.set(`wo:${woId}`, wo);

    // Update PO
    const po = await getPO(wo.poId);
    if (po) {
      po.shippedQty += shipQty;
      if (po.shippedQty >= po.qty) {
        po.status = "COMPLETED";
      } else if (po.shippedQty > 0) {
        po.status = "PARTIALLY_SHIPPED";
      }
      await redis.set(`po:${po.poId}`, po);
    }
  }

  const record: ShipmentRecord = {
    shipmentId,
    woIds,
    qtyByWoId,
    actor,
    shippedAt: now,
    meta: shipmentMeta,
  };

  await redis.set(`shipment:${shipmentId}`, record);
  await redis.sadd("shipments", shipmentId);
  return record;
}
