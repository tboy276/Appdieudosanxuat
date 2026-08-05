import { getStockState } from "./inventory";
import { getProduct, upsertProduct } from "./products";
import {
  listPOs,
  getPO,
  createPO,
  bulkCreatePOs,
  updatePO,
  deletePO,
  bulkDeletePOs,
  evaluatePODeliveryStatus,
} from "./po-postgres";
import {
  listWOs,
  getWO,
  createWOsForPO,
  createWO,
  createBulkWOsForPOs,
  updateWO,
  deleteWO,
  bulkDeleteWOs,
  recordWOProgress,
  recordShipment,
  closeWO,
  computeBackwardWOPlannedQtys,
  computeBackwardDeadlines,
  computeBackwardWODeadlines,
  computeWOPlan,
} from "./wo-postgres";
import { WorkCenter, StockState } from "./types";
import { getTodayVN, subtractDays } from "./date-utils";

export {
  listPOs,
  getPO,
  createPO,
  bulkCreatePOs,
  updatePO,
  deletePO,
  bulkDeletePOs,
  evaluatePODeliveryStatus,
  listWOs,
  getWO,
  createWOsForPO,
  createWO,
  createBulkWOsForPOs,
  updateWO,
  deleteWO,
  bulkDeleteWOs,
  recordWOProgress,
  recordShipment,
  closeWO,
  computeBackwardWOPlannedQtys,
  computeBackwardDeadlines,
  computeBackwardWODeadlines,
  computeWOPlan,
};

export type POStatus = "NEW" | "IN_PRODUCTION" | "PARTIALLY_SHIPPED" | "COMPLETED" | "CANCELLED";


export interface PO {
  poId: string;
  poLineId?: string;
  productId?: string;
  customerId?: string;
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
  poNumber: string;
  sku: string;
  productNameVi: string;
  customerName: string;
  wcCode: string;
  stepOrder: number;
  totalStepsInRouting: number;
  targetQty: number;
  shippedQty: number;
  status: WOStatus;
  requestedDate: string;
  deadline?: string;
  leadTime?: number;
  createdAt: string;
  createdBy: string;
  updatedAt?: string;
}

export interface ShipmentRecord {
  shipmentId: string;
  woIds: string[];
  qtyByWoId: Record<string, number>;
  actor: string;
  shippedAt: string;
  meta?: Record<string, any>;
}

export interface BulkDeleteResult {
  deletedCount: number;
  rejectedCount: number;
  rejected: { id: string; reason: string }[];
}

/**
 * Helper: Recalculate chain deadlines (handled automatically by PostgreSQL triggers)
 */
export async function recalculateChainDeadlines(poId: string, sku?: string): Promise<void> {
  // PostgreSQL triggers trg_po_requested_date_update and trg_wo_lead_time_update handle this automatically
}

/**
 * Helper function to compute equivalent finished goods from stock
 */
export function computeEquivalentFinishedQty(
  sku: string,
  routing: string[],
  stockByCode: Record<string, StockState>,
  customScrapRates?: Record<string, number>
): number {
  const productionWcs = (routing || []).filter((w) => w.toUpperCase() !== "KTP");
  if (productionWcs.length === 0) return 0;

  let totalEquivalent = 0;

  for (let i = 0; i < productionWcs.length; i++) {
    const wcCode = productionWcs[i];
    const stock = stockByCode[wcCode];
    if (!stock) continue;

    const tonPhoi = Number(stock.tonPhoi || 0);
    const tonThanhPham = Number(stock.tonThanhPham || 0);

    if (tonPhoi <= 0 && tonThanhPham <= 0) continue;

    // Yield factor for tonPhoi from step i to KTP
    let yieldFactorPhoi = 1.0;
    for (let j = i; j < productionWcs.length; j++) {
      const stepWc = productionWcs[j];
      const scrapPct =
        customScrapRates && typeof customScrapRates[stepWc] === "number"
          ? customScrapRates[stepWc]
          : 0;
      yieldFactorPhoi *= 1.0 - scrapPct;
    }

    // Yield factor for tonThanhPham from step i+1 to KTP
    let yieldFactorTP = 1.0;
    for (let j = i + 1; j < productionWcs.length; j++) {
      const stepWc = productionWcs[j];
      const scrapPct =
        customScrapRates && typeof customScrapRates[stepWc] === "number"
          ? customScrapRates[stepWc]
          : 0;
      yieldFactorTP *= 1.0 - scrapPct;
    }

    totalEquivalent += tonPhoi * yieldFactorPhoi + tonThanhPham * yieldFactorTP;
  }

  return totalEquivalent;
}
