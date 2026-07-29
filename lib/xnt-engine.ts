import { redis } from "./redis";
import { StockState } from "./types";
import { getStockState, getTodayDateString, getStockStateKey, getOpeningSnapshotKey } from "./inventory";

export type TxType =
  | "PRODUCE_PHOI"
  | "TRANSFER_OUT_PHOI"
  | "TRANSFER_OUT_TP"
  | "TRANSFER_IN_PHOI"
  | "PRODUCE_TP"
  | "SHIPMENT_OUT_TP";

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
  tonThanhPham: number;
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
 * Transfers Phoi (if from first-step) or Thành Phẩm (if from processing) to recipient's Phoi.
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
local isFirstStepFrom = (ARGV[9] == "1" or ARGV[9] == "true")

-- 1. Read stateFrom
local rawFrom = redis.call('GET', KEYS[1])
local tonPhoiFrom = 0
local tonTPFrom = 0
if rawFrom then
    local obj = cjson.decode(rawFrom)
    tonPhoiFrom = tonumber(obj.tonPhoi or 0)
    tonTPFrom = tonumber(obj.tonThanhPham or obj.tonBanThanhPham or 0)
end

-- 2. Check stock condition & Mutate From State
local txFromType = ""
if isFirstStepFrom then
    if tonPhoiFrom < qty then
        return "INSUFFICIENT_STOCK|PHOI|" .. tostring(tonPhoiFrom)
    end
    tonPhoiFrom = tonPhoiFrom - qty
    txFromType = "TRANSFER_OUT_PHOI"
else
    if tonTPFrom < qty then
        return "INSUFFICIENT_STOCK|TP|" .. tostring(tonTPFrom)
    end
    tonTPFrom = tonTPFrom - qty
    txFromType = "TRANSFER_OUT_TP"
end

-- 3. Read stateTo
local rawTo = redis.call('GET', KEYS[2])
local tonPhoiTo = 0
local tonTPTo = 0
if rawTo then
    local obj = cjson.decode(rawTo)
    tonPhoiTo = tonumber(obj.tonPhoi or 0)
    tonTPTo = tonumber(obj.tonThanhPham or obj.tonBanThanhPham or 0)
end

-- 4. Lazy Opening Snapshot for From
if redis.call('EXISTS', KEYS[3]) == 0 then
    local openObj = {
        tonPhoi = tonPhoiFrom + (isFirstStepFrom and qty or 0),
        tonThanhPham = tonTPFrom + (not isFirstStepFrom and qty or 0),
        declaredBy = "system_lazy",
        declaredAt = ts
    }
    redis.call('SET', KEYS[3], cjson.encode(openObj))
end

-- 5. Lazy Opening Snapshot for To
if redis.call('EXISTS', KEYS[4]) == 0 then
    local openObj = {
        tonPhoi = tonPhoiTo,
        tonThanhPham = tonTPTo,
        declaredBy = "system_lazy",
        declaredAt = ts
    }
    redis.call('SET', KEYS[4], cjson.encode(openObj))
end

-- 6. Mutate Recipient State (Always increases Phoi at recipient)
tonPhoiTo = tonPhoiTo + qty

local newFromObj = { tonPhoi = tonPhoiFrom, tonThanhPham = tonTPFrom }
local newToObj = { tonPhoi = tonPhoiTo, tonThanhPham = tonTPTo }

redis.call('SET', KEYS[1], cjson.encode(newFromObj))
redis.call('SET', KEYS[2], cjson.encode(newToObj))

-- 7. Write TX Logs
local txFromLog = {
    ts = ts,
    type = txFromType,
    qty = qty,
    fromCode = fromCode,
    toCode = toCode,
    sku = sku,
    woId = woId,
    actor = actor
}
local txToLog = {
    ts = ts,
    type = "TRANSFER_IN_PHOI",
    qty = qty,
    fromCode = fromCode,
    toCode = toCode,
    sku = sku,
    woId = woId,
    actor = actor
}

redis.call('RPUSH', KEYS[5], cjson.encode(txFromLog))
redis.call('RPUSH', KEYS[6], cjson.encode(txToLog))

-- 8. Track active pairs
redis.call('SADD', KEYS[7], fromCode .. ":" .. sku)
redis.call('SADD', KEYS[7], toCode .. ":" .. sku)

return "OK"
`;

/**
 * LUA SCRIPT for inputProduction:
 * - First Step: tonPhoi += actualQty
 * - Processing Step: tonPhoi -= actualQty, tonThanhPham += actualQty (requires tonPhoi >= actualQty)
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
local tonTP = 0
if rawState then
    local obj = cjson.decode(rawState)
    tonPhoi = tonumber(obj.tonPhoi or 0)
    tonTP = tonumber(obj.tonThanhPham or obj.tonBanThanhPham or 0)
end

-- 2. Check input constraint if not first step
if not isFirstStep then
    if actualQty > tonPhoi then
        return "INSUFFICIENT_INPUT|" .. tostring(tonPhoi)
    end
end

-- 3. Lazy Opening Snapshot
if redis.call('EXISTS', KEYS[2]) == 0 then
    local openObj = {
        tonPhoi = tonPhoi,
        tonThanhPham = tonTP,
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
    tonPhoi = tonPhoi - actualQty
    tonTP = tonTP + actualQty

    local txProduceTP = {
        ts = ts,
        type = "PRODUCE_TP",
        qty = actualQty,
        sku = sku,
        woId = woId,
        actor = actor
    }
    redis.call('RPUSH', KEYS[3], cjson.encode(txProduceTP))
end

local newStateObj = { tonPhoi = tonPhoi, tonThanhPham = tonTP }
redis.call('SET', KEYS[1], cjson.encode(newStateObj))
redis.call('SADD', KEYS[4], code .. ":" .. sku)

return "OK"
`;

/**
 * 1. transferPhoi: Chuyển phôi/thành phẩm từ xưởng nguồn sang xưởng đích
 */
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
  if (qty <= 0) {
    throw new Error("Sản lượng xuất chuyển phải lớn hơn 0.");
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
    isFirstStepFrom ? "1" : "0",
  ];

  const result = (await redis.eval(TRANSFER_PHOI_LUA, keys, args)) as string;

  if (typeof result === "string" && result.startsWith("INSUFFICIENT_STOCK")) {
    const parts = result.split("|");
    const stockType = parts[1] === "TP" ? "thành phẩm" : "phôi";
    const available = parts[2] || "0";
    throw new Error(`Không đủ ${stockType} để xuất chuyển! Xưởng ${fromCode} chỉ có sẵn ${available} pcs ${stockType}.`);
  }

  if (result !== "OK") {
    throw new Error(`Lỗi giao dịch xuất chuyển: ${result}`);
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
 * 3. recordShipmentXNT: Deducts tonThanhPham at final workshop LR upon shipment
 */
export async function recordShipmentXNT(
  wcCode: string,
  sku: string,
  qty: number,
  actor: string,
  woId?: string,
  customDate?: string
): Promise<void> {
  const today = customDate || getTodayDateString();
  const ts = new Date().toISOString();

  const stateKey = getStockStateKey(wcCode, sku);
  const snapshotKey = getOpeningSnapshotKey(wcCode, sku, today);
  const txKey = getTxLogKey(wcCode, sku, today);

  // Lazy snapshot
  const existsSnapshot = await redis.exists(snapshotKey);
  const rawState = await redis.get<StockState | string>(stateKey);

  let tonPhoi = 0;
  let tonTP = 0;
  if (rawState) {
    const obj = typeof rawState === "string" ? JSON.parse(rawState) : rawState;
    tonPhoi = Number(obj.tonPhoi || 0);
    tonTP = Number(obj.tonThanhPham || obj.tonBanThanhPham || 0);
  }

  if (existsSnapshot === 0) {
    await redis.set(snapshotKey, {
      tonPhoi,
      tonThanhPham: tonTP,
      declaredBy: "system_lazy",
      declaredAt: ts,
    });
  }

  tonTP = Math.max(0, tonTP - qty);

  const txLog: TxLogEntry = {
    ts,
    type: "SHIPMENT_OUT_TP",
    qty,
    sku,
    woId,
    actor,
  };

  await Promise.all([
    redis.set(stateKey, { tonPhoi, tonThanhPham: tonTP }),
    redis.rpush(txKey, txLog),
    redis.sadd(ACTIVE_PAIRS_KEY, `${wcCode}:${sku}`),
  ]);
}

/**
 * 4. getXNTReport: Bảng XNT real-time cho ngày bất kỳ
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
        tonThanhPham: Number(parsed.tonThanhPham || parsed.tonBanThanhPham || 0),
      };
    } else {
      opening = { ...currentState };
    }

    // 3. Fetch transaction logs for dateStr
    const txKey = getTxLogKey(wcCode, sku, dateStr);
    const rawLogs = await redis.lrange<TxLogEntry | string>(txKey, 0, -1);

    const nhap: StockBreakdown = { tonPhoi: 0, tonThanhPham: 0 };
    const xuat: StockBreakdown = { tonPhoi: 0, tonThanhPham: 0 };

    if (rawLogs && rawLogs.length > 0) {
      for (const logItem of rawLogs) {
        const entry: TxLogEntry = typeof logItem === "string" ? JSON.parse(logItem) : logItem;
        const qty = Number(entry.qty || 0);

        switch (entry.type) {
          case "PRODUCE_PHOI":
            nhap.tonPhoi += qty;
            break;
          case "TRANSFER_OUT_PHOI":
            xuat.tonPhoi += qty;
            break;
          case "TRANSFER_OUT_TP":
            xuat.tonThanhPham += qty;
            break;
          case "TRANSFER_IN_PHOI":
            nhap.tonPhoi += qty;
            break;
          case "PRODUCE_TP":
            xuat.tonPhoi += qty; // Consumes phoi
            nhap.tonThanhPham += qty; // Produces TP
            break;
          case "SHIPMENT_OUT_TP":
            xuat.tonThanhPham += qty;
            break;
        }
      }
    }

    // 4. Calculate closing = opening + nhap - xuat
    const closing: StockBreakdown = {
      tonPhoi: opening.tonPhoi + nhap.tonPhoi - xuat.tonPhoi,
      tonThanhPham: opening.tonThanhPham + nhap.tonThanhPham - xuat.tonThanhPham,
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
