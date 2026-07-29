import { redis } from "./redis";
import { StockState } from "./types";

export function getTodayDateString(date: Date = new Date()): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function getStockStateKey(wcCode: string, sku: string): string {
  return `wc:${wcCode}:sku:${sku}:state`;
}

export function getOpeningSnapshotKey(wcCode: string, sku: string, dateStr: string): string {
  return `wc:${wcCode}:sku:${sku}:opening:${dateStr}`;
}

/**
 * Get current stock state for a (workCenter, SKU) pair.
 * Returns default zero values if state does not exist in Redis.
 */
export async function getStockState(wcCode: string, sku: string): Promise<StockState> {
  const key = getStockStateKey(wcCode, sku);
  const data = await redis.get<StockState | string>(key);

  if (!data) {
    return { tonPhoi: 0, tonPhoiDauVao: 0, tonBanThanhPham: 0 };
  }

  if (typeof data === "string") {
    const parsed = JSON.parse(data) as Partial<StockState>;
    return {
      tonPhoi: Number(parsed.tonPhoi || 0),
      tonPhoiDauVao: Number(parsed.tonPhoiDauVao || 0),
      tonBanThanhPham: Number(parsed.tonBanThanhPham || 0),
    };
  }

  return {
    tonPhoi: Number(data.tonPhoi || 0),
    tonPhoiDauVao: Number(data.tonPhoiDauVao || 0),
    tonBanThanhPham: Number(data.tonBanThanhPham || 0),
  };
}

/**
 * Declare opening stock for a (workCenter, SKU) pair.
 * Writes directly to state key AND creates an opening snapshot with the exact same values.
 */
export async function declareOpeningStock(
  wcCode: string,
  sku: string,
  state: StockState,
  actor: string,
  customDate?: string
): Promise<void> {
  if (!wcCode || !sku) {
    throw new Error("Mã xưởng và SKU là bắt buộc khi khai báo tồn đầu kỳ.");
  }

  const cleanState: StockState = {
    tonPhoi: Math.max(0, Number(state.tonPhoi || 0)),
    tonPhoiDauVao: Math.max(0, Number(state.tonPhoiDauVao || 0)),
    tonBanThanhPham: Math.max(0, Number(state.tonBanThanhPham || 0)),
  };

  const today = customDate || getTodayDateString();
  const stateKey = getStockStateKey(wcCode, sku);
  const snapshotKey = getOpeningSnapshotKey(wcCode, sku, today);

  const snapshotPayload = {
    ...cleanState,
    declaredBy: actor,
    declaredAt: new Date().toISOString(),
  };

  // Write state and opening snapshot
  await Promise.all([
    redis.set(stateKey, cleanState),
    redis.set(snapshotKey, snapshotPayload),
  ]);
}
