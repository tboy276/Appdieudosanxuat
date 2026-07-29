import { describe, it, expect, vi, beforeEach } from "vitest";

// In-memory Redis Store simulating Redis & Lua atomicity
const kvStore = new Map<string, any>();
const listStore = new Map<string, any[]>();
const setStore = new Map<string, Set<string>>();

vi.mock("./redis", () => {
  return {
    redis: {
      get: vi.fn(async (key: string) => kvStore.get(key) || null),
      set: vi.fn(async (key: string, val: any) => {
        kvStore.set(key, val);
        return "OK";
      }),
      exists: vi.fn(async (key: string) => (kvStore.has(key) ? 1 : 0)),
      rpush: vi.fn(async (key: string, val: any) => {
        const list = listStore.get(key) || [];
        list.push(val);
        listStore.set(key, list);
        return list.length;
      }),
      lrange: vi.fn(async (key: string, start: number, end: number) => {
        const list = listStore.get(key) || [];
        if (end === -1) return list.slice(start);
        return list.slice(start, end + 1);
      }),
      sadd: vi.fn(async (key: string, member: string) => {
        const set = setStore.get(key) || new Set<string>();
        set.add(member);
        setStore.set(key, set);
        return 1;
      }),
      smembers: vi.fn(async (key: string) => {
        const set = setStore.get(key);
        return set ? Array.from(set) : [];
      }),
      eval: vi.fn(async (script: string, keys: string[], args: any[]) => {
        // Handle transferPhoi Lua
        if (script.includes("TRANSFER_OUT") || keys.length === 7) {
          const [stateFromKey, stateToKey, openFromKey, openToKey, txFromKey, txToKey, activePairsKey] = keys;
          const [qtyStr, actor, woId, ts, fromCode, toCode, sku, today] = args;
          const qty = Number(qtyStr);

          // 1. Read stateFrom
          const rawFrom = kvStore.get(stateFromKey);
          let tonPhoiFrom = 0, tonDauVaoFrom = 0, tonBTPFrom = 0;
          if (rawFrom) {
            const obj = typeof rawFrom === "string" ? JSON.parse(rawFrom) : rawFrom;
            tonPhoiFrom = Number(obj.tonPhoi || 0);
            tonDauVaoFrom = Number(obj.tonPhoiDauVao || 0);
            tonBTPFrom = Number(obj.tonBanThanhPham || 0);
          }

          if (tonPhoiFrom < qty) {
            return `INSUFFICIENT_PHOI|${tonPhoiFrom}`;
          }

          // Read stateTo
          const rawTo = kvStore.get(stateToKey);
          let tonPhoiTo = 0, tonDauVaoTo = 0, tonBTPTo = 0;
          if (rawTo) {
            const obj = typeof rawTo === "string" ? JSON.parse(rawTo) : rawTo;
            tonPhoiTo = Number(obj.tonPhoi || 0);
            tonDauVaoTo = Number(obj.tonPhoiDauVao || 0);
            tonBTPTo = Number(obj.tonBanThanhPham || 0);
          }

          // Lazy Snapshot From
          if (!kvStore.has(openFromKey)) {
            kvStore.set(openFromKey, {
              tonPhoi: tonPhoiFrom,
              tonPhoiDauVao: tonDauVaoFrom,
              tonBanThanhPham: tonBTPFrom,
              declaredBy: "system_lazy",
              declaredAt: ts,
            });
          }

          // Lazy Snapshot To
          if (!kvStore.has(openToKey)) {
            kvStore.set(openToKey, {
              tonPhoi: tonPhoiTo,
              tonPhoiDauVao: tonDauVaoTo,
              tonBanThanhPham: tonBTPTo,
              declaredBy: "system_lazy",
              declaredAt: ts,
            });
          }

          // Mutate states
          tonPhoiFrom -= qty;
          tonDauVaoTo += qty;

          kvStore.set(stateFromKey, { tonPhoi: tonPhoiFrom, tonPhoiDauVao: tonDauVaoFrom, tonBanThanhPham: tonBTPFrom });
          kvStore.set(stateToKey, { tonPhoi: tonPhoiTo, tonPhoiDauVao: tonDauVaoTo, tonBanThanhPham: tonBTPTo });

          // Logs
          const txFromList = listStore.get(txFromKey) || [];
          txFromList.push({ ts, type: "TRANSFER_OUT", qty, fromCode, toCode, sku, woId, actor });
          listStore.set(txFromKey, txFromList);

          const txToList = listStore.get(txToKey) || [];
          txToList.push({ ts, type: "TRANSFER_IN", qty, fromCode, toCode, sku, woId, actor });
          listStore.set(txToKey, txToList);

          // Track active pairs
          const set = setStore.get(activePairsKey) || new Set<string>();
          set.add(`${fromCode}:${sku}`);
          set.add(`${toCode}:${sku}`);
          setStore.set(activePairsKey, set);

          return "OK";
        }

        // Handle inputProduction Lua
        if (script.includes("PRODUCE_PHOI") || keys.length === 4) {
          const [stateKey, openKey, txKey, activePairsKey] = keys;
          const [actualQtyStr, actor, woId, ts, isFirstStepStr, code, sku, today] = args;
          const actualQty = Number(actualQtyStr);
          const isFirstStep = isFirstStepStr === "1" || isFirstStepStr === "true";

          // Read state
          const rawState = kvStore.get(stateKey);
          let tonPhoi = 0, tonDauVao = 0, tonBTP = 0;
          if (rawState) {
            const obj = typeof rawState === "string" ? JSON.parse(rawState) : rawState;
            tonPhoi = Number(obj.tonPhoi || 0);
            tonDauVao = Number(obj.tonPhoiDauVao || 0);
            tonBTP = Number(obj.tonBanThanhPham || 0);
          }

          if (!isFirstStep && actualQty > tonDauVao) {
            return `INSUFFICIENT_INPUT|${tonDauVao}`;
          }

          // Lazy Snapshot
          if (!kvStore.has(openKey)) {
            kvStore.set(openKey, {
              tonPhoi,
              tonPhoiDauVao: tonDauVao,
              tonBanThanhPham: tonBTP,
              declaredBy: "system_lazy",
              declaredAt: ts,
            });
          }

          // Mutate & log
          const txList = listStore.get(txKey) || [];
          if (isFirstStep) {
            tonPhoi += actualQty;
            txList.push({ ts, type: "PRODUCE_PHOI", qty: actualQty, sku, woId, actor });
          } else {
            tonDauVao -= actualQty;
            tonBTP += actualQty;
            txList.push({ ts, type: "CONSUME_PHOI", qty: actualQty, sku, woId, actor });
            txList.push({ ts, type: "OUTPUT_BTP", qty: actualQty, sku, woId, actor });
          }
          listStore.set(txKey, txList);

          kvStore.set(stateKey, { tonPhoi, tonPhoiDauVao: tonDauVao, tonBanThanhPham: tonBTP });

          const set = setStore.get(activePairsKey) || new Set<string>();
          set.add(`${code}:${sku}`);
          setStore.set(activePairsKey, set);

          return "OK";
        }

        return "OK";
      }),
      __reset: () => {
        kvStore.clear();
        listStore.clear();
        setStore.clear();
      },
    },
  };
});

import { transferPhoi, inputProduction, getXNTReport } from "./xnt-engine";
import { declareOpeningStock, getStockState, getTodayDateString } from "./inventory";
import { redis } from "./redis";

describe("lib/xnt-engine.ts - Material Balance Engine", () => {
  beforeEach(() => {
    (redis as any).__reset();
    vi.clearAllMocks();
  });

  it("Case 1: Transfer phoi exceeding available stock should reject and leave state unchanged", async () => {
    const today = getTodayDateString();
    // Initialize CUAPHOI with 50 pcs phoi
    await declareOpeningStock("CUAPHOI", "SKU-001", { tonPhoi: 50, tonPhoiDauVao: 0, tonBanThanhPham: 0 }, "admin", today);

    // Attempt to transfer 100 pcs phoi
    await expect(
      transferPhoi("CUAPHOI", "CK1", "SKU-001", 100, "dispatcher1", "WO-001", today)
    ).rejects.toThrow("Không đủ phôi để xuất chuyển! Xưởng CUAPHOI chỉ có sẵn 50 pcs phôi.");

    // Verify stock state remained 50
    const stockCUAPHOI = await getStockState("CUAPHOI", "SKU-001");
    expect(stockCUAPHOI.tonPhoi).toBe(50);

    const stockCK1 = await getStockState("CK1", "SKU-001");
    expect(stockCK1.tonPhoiDauVao).toBe(0);
  });

  it("Case 2: Input production for non-first step exceeding input phoi should reject with exact spec message format", async () => {
    const today = getTodayDateString();
    // Initialize CK1 with 30 pcs input phoi
    await declareOpeningStock("CK1", "SKU-002", { tonPhoi: 0, tonPhoiDauVao: 30, tonBanThanhPham: 0 }, "admin", today);

    // Attempt actualQty = 50 pcs
    await expect(
      inputProduction("CK1", "SKU-002", 50, "worker1", false, "WO-002", today)
    ).rejects.toThrow("Không đủ phôi! Xưởng CK1 chỉ có sẵn 30 pcs phôi đầu vào.");

    // Verify state remained unchanged
    const stock = await getStockState("CK1", "SKU-002");
    expect(stock.tonPhoiDauVao).toBe(30);
    expect(stock.tonBanThanhPham).toBe(0);
  });

  it("Case 3: Interleaved daily transactions sequence should calculate getXNTReport adhering to Opening + In - Out = Closing", async () => {
    const today = getTodayDateString();
    const sku = "SKU-003";

    // 1. Initial first step CUAPHOI produces 200 pcs phoi
    await inputProduction("CUAPHOI", sku, 200, "worker1", true, "WO-101", today);

    // 2. Transfer 120 pcs phoi from CUAPHOI -> CK1
    await transferPhoi("CUAPHOI", "CK1", sku, 120, "dispatcher1", "WO-101", today);

    // 3. CK1 inputs 100 pcs production
    await inputProduction("CK1", sku, 100, "worker2", false, "WO-101", today);

    // Fetch report
    const report = await getXNTReport(today, sku);
    expect(report.length).toBeGreaterThanOrEqual(2);

    const reportCUAPHOI = report.find((r) => r.wcCode === "CUAPHOI" && r.sku === sku);
    expect(reportCUAPHOI).toBeDefined();
    if (reportCUAPHOI) {
      // Opening = 0
      // Produce +200, Transfer Out -120 -> Closing = 80
      expect(reportCUAPHOI.nhap.tonPhoi).toBe(200);
      expect(reportCUAPHOI.xuat.tonPhoi).toBe(120);
      expect(reportCUAPHOI.closing.tonPhoi).toBe(80);

      const currentState = await getStockState("CUAPHOI", sku);
      expect(reportCUAPHOI.closing.tonPhoi).toBe(currentState.tonPhoi);
    }

    const reportCK1 = report.find((r) => r.wcCode === "CK1" && r.sku === sku);
    expect(reportCK1).toBeDefined();
    if (reportCK1) {
      // Transfer In +120, Consume -100 -> Closing input phoi = 20
      // Output BTP +100 -> Closing BTP = 100
      expect(reportCK1.nhap.tonPhoiDauVao).toBe(120);
      expect(reportCK1.xuat.tonPhoiDauVao).toBe(100);
      expect(reportCK1.closing.tonPhoiDauVao).toBe(20);
      expect(reportCK1.closing.tonBanThanhPham).toBe(100);

      const currentState = await getStockState("CK1", sku);
      expect(reportCK1.closing.tonPhoiDauVao).toBe(currentState.tonPhoiDauVao);
      expect(reportCK1.closing.tonBanThanhPham).toBe(currentState.tonBanThanhPham);
    }
  });

  it("Case 4: Concurrent inputProduction requests via Promise.all should safely allow only 1 request to succeed and avoid negative state", async () => {
    const today = getTodayDateString();
    const sku = "SKU-004";
    // Initialize CK2 with 40 pcs input phoi
    await declareOpeningStock("CK2", sku, { tonPhoi: 0, tonPhoiDauVao: 40, tonBanThanhPham: 0 }, "admin", today);

    // Fire 2 concurrent input production requests of 30 pcs each (Total 60 > 40)
    const results = await Promise.allSettled([
      inputProduction("CK2", sku, 30, "userA", false, "WO-201", today),
      inputProduction("CK2", sku, 30, "userB", false, "WO-202", today),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    // Exactly 1 request succeeds and 1 fails
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    // Verify stock state was deducted by 30 once, remaining 10 pcs
    const stock = await getStockState("CK2", sku);
    expect(stock.tonPhoiDauVao).toBe(10);
    expect(stock.tonBanThanhPham).toBe(30);
  });
});
