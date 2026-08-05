import { StockState } from "./types";
import { getTodayVN } from "./date-utils";
export * from "./inventory-postgres";

export function getTodayDateString(): string {
  return getTodayVN();
}

export function getStockStateKey(wcCode: string, sku: string): string {
  return `wc:${wcCode}:sku:${sku}:state`;
}

export function getOpeningSnapshotKey(wcCode: string, sku: string, dateStr: string): string {
  return `wc:${wcCode}:sku:${sku}:opening:${dateStr}`;
}

export async function checkHasTxAfterDate(wcCode: string, sku: string, targetDateStr: string): Promise<boolean> {
  return false;
}
