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

const DEFAULT_SCRAP_RATES: Record<string, number> = {
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
 */
export function computeWOPlan(
  sku: string,
  routing: string[],
  targetQty: number,
  stockByCode: Record<string, StockState>,
  scrapRateByCode: Record<string, number>
): WOPlanStep[] {
  if (!routing || routing.length === 0) {
    throw new Error(`SKU ${sku} chưa khai báo routing, vui lòng bổ sung ở Tab Danh mục Sản phẩm.`);
  }

  const n = routing.length;
  const plannedQtyMap: Record<string, number> = {};

  // 1. Final Step (LR)
  const finalCode = routing[n - 1];
  const finalStock = stockByCode[finalCode] || { tonPhoi: 0, tonPhoiDauVao: 0, tonBanThanhPham: 0 };
  const finalScrapRate = scrapRateByCode[finalCode] ?? DEFAULT_SCRAP_RATES[finalCode] ?? 0;

  const requiredOutFinal = Math.max(0, targetQty - finalStock.tonBanThanhPham);
  plannedQtyMap[finalCode] = Math.ceil(requiredOutFinal / (1 - finalScrapRate));

  // 2. Backward Calculation from (n - 2) down to 0
  for (let i = n - 2; i >= 0; i--) {
    const currentCode = routing[i];
    const nextCode = routing[i + 1];

    const nextPlanned = plannedQtyMap[nextCode];
    const stockCurrent = stockByCode[currentCode] || { tonPhoi: 0, tonPhoiDauVao: 0, tonBanThanhPham: 0 };
    const stockNext = stockByCode[nextCode] || { tonPhoi: 0, tonPhoiDauVao: 0, tonBanThanhPham: 0 };
    const scrapRate = scrapRateByCode[currentCode] ?? DEFAULT_SCRAP_RATES[currentCode] ?? 0;

    const need = Math.max(0, nextPlanned - stockNext.tonPhoiDauVao - stockCurrent.tonPhoi);
    plannedQtyMap[currentCode] = Math.ceil(need / (1 - scrapRate));
  }

  return routing.map((code) => ({
    code,
    plannedQty: plannedQtyMap[code],
  }));
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

  const pos: PO[] = [];
  for (const id of poIds) {
    const po = await getPO(id);
    if (po) pos.push(po);
  }
  return pos;
}

export async function getWO(woId: string): Promise<WO | null> {
  const raw = await redis.get<WO | string>(`wo:${woId}`);
  if (!raw) return null;
  return typeof raw === "string" ? JSON.parse(raw) : raw;
}

export async function listWOs(): Promise<WO[]> {
  const woIds = await redis.smembers("wos");
  if (!woIds || woIds.length === 0) return [];

  const wos: WO[] = [];
  for (const id of woIds) {
    const wo = await getWO(id);
    if (wo) wos.push(wo);
  }
  return wos;
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
 * 2. createWO: Tạo Lệnh sản xuất (WO) từ PO
 */
export async function createWO(poId: string, actor: string): Promise<WO> {
  const po = await getPO(poId);
  if (!po) {
    throw new Error(`Không tìm thấy đơn hàng PO: ${poId}`);
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

  // Compute planned quantity backward
  const planSteps = computeWOPlan(po.sku, product.routing, po.qty, stockByCode, scrapRateByCode);

  const woId = `WO-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const now = new Date().toISOString();

  const wo: WO = {
    woId,
    poId: po.poId,
    sku: po.sku,
    targetQty: po.qty,
    routing: product.routing,
    shippedQty: 0,
    status: "OPEN",
    steps: planSteps.map((step) => ({
      code: step.code,
      plannedQty: step.plannedQty,
      actualQty: 0,
      status: "PENDING",
    })),
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
