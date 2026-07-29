import { redis } from "./redis";
import { StockState } from "./types";
import { getStockState, getTodayDateString, getStockStateKey, getOpeningSnapshotKey } from "./inventory";

export type TxType = "PRODUCE_PHOI" | "TRANSFER_OUT" | "TRANSFER_IN" | "CONSUME_PHOI" | "OUTPUT_BTP";

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

export interface StockBreakdown {
  tonPhoi: number;
  tonPhoiDauVao: number;
  tonBanThanhPham: number;
}

export interface XNTReportItem {
  wcCode: string;
  sku: string;
  opening: StockBreakdown;
  nhap: StockBreakdown;
  xuat: StockBreakdown;
  closing: StockBreakdown;
}

const ACTIVE_PAIRS_KEY = "active_inventory_pairs";

export function getTxLogKey(wcCode: string, sku: string, dateStr: string): string {
  return `wc:${wcCode}:sku:${sku}:tx:${dateStr}`;
}

/**
 * LUA SCRIPT for transferPhoi:
 * Atomic check tonPhoi >= qty, lazy snapshot creation for both workshops, state mutation, and log writing.
 */
const TRANSFER_PHOI_LUA = `
local qty = tonumber(ARGV[1])
local actor = ARGV[2]
local woId = ARGV[3]
local ts = ARGV[4]
local fromCode = ARGV[5]
local toCode = ARGV[6]
local sku = ARGV[7]
local today = ARGV[8]

-- 1. Read stateFrom
local rawFrom = redis.call('GET', KEYS[1])
local tonPhoiFrom = 0
local tonDauVaoFrom = 0
local tonBTPFrom = 0
if rawFrom then
    local obj = cjson.decode(rawFrom)
    tonPhoiFrom = tonumber(obj.tonPhoi or 0)
    tonDauVaoFrom = tonumber(obj.tonPhoiDauVao or 0)
    tonBTPFrom = tonumber(obj.tonBanThanhPham or 0)
end

-- 2. Check stock condition
if tonPhoiFrom < qty then
    return "INSUFFICIENT_PHOI|" .. tostring(tonPhoiFrom)
end

-- 3. Read stateTo
local rawTo = redis.call('GET', KEYS[2])
local tonPhoiTo = 0
local tonDauVaoTo = 0
local tonBTPTo = 0
if rawTo then
    local obj = cjson.decode(rawTo)
    tonPhoiTo = tonumber(obj.tonPhoi or 0)
    tonDauVaoTo = tonumber(obj.tonPhoiDauVao or 0)
    tonBTPTo = tonumber(obj.tonBanThanhPham or 0)
end

-- 4. Lazy Opening Snapshot for From
if redis.call('EXISTS', KEYS[3]) == 0 then
    local openObj = {
        tonPhoi = tonPhoiFrom,
        tonPhoiDauVao = tonDauVaoFrom,
        tonBanThanhPham = tonBTPFrom,
        declaredBy = "system_lazy",
        declaredAt = ts
    }
    redis.call('SET', KEYS[3], cjson.encode(openObj))
end

-- 5. Lazy Opening Snapshot for To
if redis.call('EXISTS', KEYS[4]) == 0 then
    local openObj = {
        tonPhoi = tonPhoiTo,
        tonPhoiDauVao = tonDauVaoTo,
        tonBanThanhPham = tonBTPTo,
        declaredBy = "system_lazy",
        declaredAt = ts
    }
    redis.call('SET', KEYS[4], cjson.encode(openObj))
end

-- 6. Mutate States
tonPhoiFrom = tonPhoiFrom - qty
tonDauVaoTo = tonDauVaoTo + qty

local newFromObj = { tonPhoi = tonPhoiFrom, tonPhoiDauVao = tonDauVaoFrom, tonBanThanhPham = tonBTPFrom }
local newToObj = { tonPhoi = tonPhoiTo, tonPhoiDauVao = tonDauVaoTo, tonBanThanhPham = tonBTPTo }

redis.call('SET', KEYS[1], cjson.encode(newFromObj))
redis.call('SET', KEYS[2], cjson.encode(newToObj))

-- 7. Write TX Logs
local txFromLog = {
    ts = ts,
    type = "TRANSFER_OUT",
    qty = qty,
    fromCode = fromCode,
    toCode = toCode,
    sku = sku,
    woId = woId,
    actor = actor
}
local txToLog = {
    ts = ts,
    type = "TRANSFER_IN",
    qty = qty,
    fromCode = fromCode,
    toCode = toCode,
    sku = sku,
    woId = woId,
    actor = actor
}

redis.call('RPUSH', KEYS[5], cjson.encode(txFromLog))
redis.call('RPUSH', KEYS[6], cjson.encode(txToLog))

-- 8. Track pairs
redis.call('SADD', KEYS[7], fromCode .. ":" .. sku)
redis.call('SADD', KEYS[7], toCode .. ":" .. sku)

return "OK"
`;

/**
 * LUA SCRIPT for inputProduction:
 * Atomic check tonPhoiDauVao >= actualQty (if not isFirstStep), lazy snapshot creation, state mutation, and log writing.
 */
const INPUT_PRODUCTION_LUA = `
local actualQty = tonumber(ARGV[1])
local actor = ARGV[2]
local woId = ARGV[3]
local ts = ARGV[4]
local isFirstStep = (ARGV[5] == "1" or ARGV[5] == "true")
local code = ARGV[6]
local sku = ARGV[7]
local today = ARGV[8]

-- 1. Read state
local rawState = redis.call('GET', KEYS[1])
local tonPhoi = 0
local tonDauVao = 0
local tonBTP = 0
if rawState then
    local obj = cjson.decode(rawState)
    tonPhoi = tonumber(obj.tonPhoi or 0)
    tonDauVao = tonumber(obj.tonPhoiDauVao or 0)
    tonBTP = tonumber(obj.tonBanThanhPham or 0)
end

-- 2. Check input constraint if not first step
if not isFirstStep then
    if actualQty > tonDauVao then
        return "INSUFFICIENT_INPUT|" .. tostring(tonDauVao)
    end
end

-- 3. Lazy Opening Snapshot
if redis.call('EXISTS', KEYS[2]) == 0 then
    local openObj = {
        tonPhoi = tonPhoi,
        tonPhoiDauVao = tonDauVao,
        tonBanThanhPham = tonBTP,
        declaredBy = "system_lazy",
        declaredAt = ts
    }
    redis.call('SET', KEYS[2], cjson.encode(openObj))
end

-- 4. Mutate State & Log
if isFirstStep then
    tonPhoi = tonPhoi + actualQty
    local txLog = {
        ts = ts,
        type = "PRODUCE_PHOI",
        qty = actualQty,
        sku = sku,
        woId = woId,
        actor = actor
    }
    redis.call('RPUSH', KEYS[3], cjson.encode(txLog))
else
    tonDauVao = tonDauVao - actualQty
    tonBTP = tonBTP + actualQty

    local txConsume = {
        ts = ts,
        type = "CONSUME_PHOI",
        qty = actualQty,
        sku = sku,
        woId = woId,
        actor = actor
    }
    local txOutput = {
        ts = ts,
        type = "OUTPUT_BTP",
        qty = actualQty,
        sku = sku,
        woId = woId,
        actor = actor
    }
    redis.call('RPUSH', KEYS[3], cjson.encode(txConsume))
    redis.call('RPUSH', KEYS[3], cjson.encode(txOutput))
end

local newStateObj = { tonPhoi = tonPhoi, tonPhoiDauVao = tonDauVao, tonBanThanhPham = tonBTP }
redis.call('SET', KEYS[1], cjson.encode(newStateObj))
redis.call('SADD', KEYS[4], code .. ":" .. sku)

return "OK"
`;

/**
 * 1. transferPhoi: Chuyển phôi từ xưởng nguồn sang xưởng đích
 */
export async function transferPhoi(
  fromCode: string,
  toCode: string,
  sku: string,
  qty: number,
  actor: string,
  woId?: string,
  customDate?: string
): Promise<void> {
  if (qty <= 0) {
    throw new Error("Sản lượng chuyển phôi phải lớn hơn 0.");
  }

  const today = customDate || getTodayDateString();
  const ts = new Date().toISOString();

  const keys = [
    getStockStateKey(fromCode, sku),
    getStockStateKey(toCode, sku),
    getOpeningSnapshotKey(fromCode, sku, today),
    getOpeningSnapshotKey(toCode, sku, today),
    getTxLogKey(fromCode, sku, today),
    getTxLogKey(toCode, sku, today),
    ACTIVE_PAIRS_KEY,
  ];

  const args = [
    qty,
    actor,
    woId || "",
    ts,
    fromCode,
    toCode,
    sku,
    today,
  ];

  const result = (await redis.eval(TRANSFER_PHOI_LUA, keys, args)) as string;

  if (typeof result === "string" && result.startsWith("INSUFFICIENT_PHOI")) {
    const available = result.split("|")[1] || "0";
    throw new Error(`Không đủ phôi để xuất chuyển! Xưởng ${fromCode} chỉ có sẵn ${available} pcs phôi.`);
  }

  if (result !== "OK") {
    throw new Error(`Lỗi giao dịch chuyển phôi: ${result}`);
  }
}

/**
 * 2. inputProduction: Nhập sản lượng thực tế tại xưởng
 */
export async function inputProduction(
  code: string,
  sku: string,
  actualQty: number,
  actor: string,
  isFirstStep: boolean,
  woId?: string,
  customDate?: string
): Promise<void> {
  if (actualQty <= 0) {
    throw new Error("Sản lượng báo cáo phải lớn hơn 0.");
  }

  const today = customDate || getTodayDateString();
  const ts = new Date().toISOString();

  const keys = [
    getStockStateKey(code, sku),
    getOpeningSnapshotKey(code, sku, today),
    getTxLogKey(code, sku, today),
    ACTIVE_PAIRS_KEY,
  ];

  const args = [
    actualQty,
    actor,
    woId || "",
    ts,
    isFirstStep ? "1" : "0",
    code,
    sku,
    today,
  ];

  const result = (await redis.eval(INPUT_PRODUCTION_LUA, keys, args)) as string;

  if (typeof result === "string" && result.startsWith("INSUFFICIENT_INPUT")) {
    const available = result.split("|")[1] || "0";
    throw new Error(`Không đủ phôi! Xưởng ${code} chỉ có sẵn ${available} pcs phôi đầu vào.`);
  }

  if (result !== "OK") {
    throw new Error(`Lỗi nhập sản lượng: ${result}`);
  }
}

/**
 * 3. getXNTReport: Bảng XNT real-time cho ngày bất kỳ
 */
export async function getXNTReport(dateStr: string, filterSku?: string): Promise<XNTReportItem[]> {
  const activePairs = await redis.smembers(ACTIVE_PAIRS_KEY);
  if (!activePairs || activePairs.length === 0) {
    return [];
  }

  const reportItems: XNTReportItem[] = [];

  for (const pair of activePairs) {
    const [wcCode, sku] = pair.split(":");
    if (!wcCode || !sku) continue;
    if (filterSku && sku !== filterSku) continue;

    // 1. Fetch current state
    const currentState = await getStockState(wcCode, sku);

    // 2. Fetch opening snapshot for dateStr
    const snapshotKey = getOpeningSnapshotKey(wcCode, sku, dateStr);
    const rawSnapshot = await redis.get<StockState | string>(snapshotKey);

    let opening: StockBreakdown;
    if (rawSnapshot) {
      const parsed = typeof rawSnapshot === "string" ? JSON.parse(rawSnapshot) : rawSnapshot;
      opening = {
        tonPhoi: Number(parsed.tonPhoi || 0),
        tonPhoiDauVao: Number(parsed.tonPhoiDauVao || 0),
        tonBanThanhPham: Number(parsed.tonBanThanhPham || 0),
      };
    } else {
      // If snapshot is missing for dateStr, opening equals current state
      opening = { ...currentState };
    }

    // 3. Fetch transaction logs for dateStr
    const txKey = getTxLogKey(wcCode, sku, dateStr);
    const rawLogs = await redis.lrange<TxLogEntry | string>(txKey, 0, -1);

    const nhap: StockBreakdown = { tonPhoi: 0, tonPhoiDauVao: 0, tonBanThanhPham: 0 };
    const xuat: StockBreakdown = { tonPhoi: 0, tonPhoiDauVao: 0, tonBanThanhPham: 0 };

    if (rawLogs && rawLogs.length > 0) {
      for (const logItem of rawLogs) {
        const entry: TxLogEntry = typeof logItem === "string" ? JSON.parse(logItem) : logItem;
        const qty = Number(entry.qty || 0);

        switch (entry.type) {
          case "PRODUCE_PHOI":
            nhap.tonPhoi += qty;
            break;
          case "TRANSFER_OUT":
            xuat.tonPhoi += qty;
            break;
          case "TRANSFER_IN":
            nhap.tonPhoiDauVao += qty;
            break;
          case "CONSUME_PHOI":
            xuat.tonPhoiDauVao += qty;
            break;
          case "OUTPUT_BTP":
            nhap.tonBanThanhPham += qty;
            break;
        }
      }
    }

    // 4. Calculate closing = opening + nhap - xuat
    const closing: StockBreakdown = {
      tonPhoi: opening.tonPhoi + nhap.tonPhoi - xuat.tonPhoi,
      tonPhoiDauVao: opening.tonPhoiDauVao + nhap.tonPhoiDauVao - xuat.tonPhoiDauVao,
      tonBanThanhPham: opening.tonBanThanhPham + nhap.tonBanThanhPham - xuat.tonBanThanhPham,
    };

    reportItems.push({
      wcCode,
      sku,
      opening,
      nhap,
      xuat,
      closing,
    });
  }

  return reportItems;
}
