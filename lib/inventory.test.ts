import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Upstash Redis
vi.mock("./redis", () => {
  const kvStore = new Map<string, any>();
  return {
    redis: {
      set: vi.fn(async (key: string, value: any) => {
        kvStore.set(key, value);
        return "OK";
      }),
      get: vi.fn(async (key: string) => {
        return kvStore.get(key) || null;
      }),
      __reset: () => kvStore.clear(),
      __store: kvStore,
    },
  };
});

import { declareOpeningStock, getStockState, getTodayDateString } from "./inventory";
import { StockState } from "./types";
import { redis } from "./redis";

describe("lib/inventory.ts - Opening Inventory & Stock State", () => {
  beforeEach(() => {
    (redis as any).__reset();
    vi.clearAllMocks();
  });

  it("should return default zero stock when stock state key does not exist", async () => {
    const state = await getStockState("CUAPHOI", "SKU-999");
    expect(state).toEqual({
      tonPhoi: 0,
      tonPhoiDauVao: 0,
      tonBanThanhPham: 0,
    });
  });

  it("should write both state key and opening snapshot key with the exact same values on declareOpeningStock", async () => {
    const openingData: StockState = {
      tonPhoi: 500,
      tonPhoiDauVao: 0,
      tonBanThanhPham: 0,
    };

    const today = getTodayDateString();
    await declareOpeningStock("CUAPHOI", "SKU-101", openingData, "admin");

    const stateKey = "wc:CUAPHOI:sku:SKU-101:state";
    const snapshotKey = `wc:CUAPHOI:sku:SKU-101:opening:${today}`;

    // Verify current state
    const currentStock = await getStockState("CUAPHOI", "SKU-101");
    expect(currentStock.tonPhoi).toBe(500);
    expect(currentStock.tonPhoiDauVao).toBe(0);
    expect(currentStock.tonBanThanhPham).toBe(0);

    // Verify opening snapshot was written to Redis
    const store = (redis as any).__store;
    const snapshot = store.get(snapshotKey);

    expect(snapshot).toBeDefined();
    expect(snapshot.tonPhoi).toBe(500);
    expect(snapshot.tonPhoiDauVao).toBe(0);
    expect(snapshot.tonBanThanhPham).toBe(0);
    expect(snapshot.declaredBy).toBe("admin");
    expect(snapshot.declaredAt).toBeDefined();
  });
});
