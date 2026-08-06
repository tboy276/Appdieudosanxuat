import {
  recordProductionInput,
  recordTransfer,
  reverseTransaction,
  getXNTReport,
  getTransactionHistory,
  XNTReportItem,
  StockBreakdown,
  TransactionHistoryItem,
  ProductionAllocationSummary,
  ProductionAllocationItem,
} from "./inventory-postgres";

export { getXNTReport, getTransactionHistory };
export type {
  XNTReportItem,
  StockBreakdown,
  TransactionHistoryItem,
  ProductionAllocationSummary,
  ProductionAllocationItem,
};

export type TxType =
  | "PRODUCE_PHOI"
  | "TRANSFER_OUT_PHOI"
  | "TRANSFER_OUT_TP"
  | "TRANSFER_IN_PHOI"
  | "PRODUCE_TP"
  | "SHIPMENT_OUT_TP"
  | "REVERSAL";

export interface TxLogEntry {
  ts: string;
  type: TxType;
  qty: number;
  sku: string;
  fromCode?: string;
  toCode?: string;
  woId?: string;
  actor: string;
}

export async function transferPhoi(
  fromCode: string,
  toCode: string,
  sku: string,
  qty: number,
  actor: string,
  isFirstStepFrom: boolean = false,
  woId?: string,
  customDate?: string
): Promise<void> {
  await recordTransfer(fromCode, toCode, sku, qty, actor, isFirstStepFrom, woId, customDate);
}

export async function inputProduction(
  code: string,
  sku: string,
  actualQty: number,
  actor: string,
  isFirstStep: boolean,
  woId?: string,
  customDate?: string,
  ngQty: number = 0
): Promise<ProductionAllocationSummary> {
  return await recordProductionInput(
    code,
    sku,
    actualQty,
    actor,
    isFirstStep,
    woId,
    customDate,
    ngQty
  );
}

export async function correctTransactionDelta(
  txId: string,
  newQty: number,
  adminUsername: string
): Promise<{ success: boolean; message: string }> {
  return await reverseTransaction(txId, newQty, 0, "Đảo bút toán từ giao diện cũ", adminUsername, "ADMIN");
}
