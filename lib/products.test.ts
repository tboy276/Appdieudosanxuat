import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Upstash Redis
vi.mock("./redis", () => {
  const store = new Map<string, any>();
  return {
    redis: {
      hset: vi.fn(async (key: string, data: Record<string, any>) => {
        let fieldMap = store.get(key) || {};
        fieldMap = { ...fieldMap, ...data };
        store.set(key, fieldMap);
        return Object.keys(data).length;
      }),
      hget: vi.fn(async (key: string, field: string) => {
        const fieldMap = store.get(key);
        return fieldMap ? fieldMap[field] : null;
      }),
      hgetall: vi.fn(async (key: string) => {
        return store.get(key) || null;
      }),
      __reset: () => store.clear(),
    },
  };
});

import { upsertProduct, listProducts, getProduct } from "./products";
import { Product } from "./types";
import { redis } from "./redis";

describe("lib/products.ts - Product Catalog Management", () => {
  beforeEach(() => {
    (redis as any).__reset();
    vi.clearAllMocks();
  });

  it("should reject upsertProduct if routing is non-empty but the last step is not 'LR'", async () => {
    const invalidProduct: Product = {
      sku: "SKU-001",
      nameVi: "Trục Vít Nâng",
      routing: ["CUAPHOI", "CK1", "MNL"], // Missing "LR" at the end!
      unit: "Cái",
      createdAt: "",
      updatedAt: "",
    };

    await expect(upsertProduct(invalidProduct)).rejects.toThrow(
      "Routing không hợp lệ: bước cuối cùng của routing bắt buộc phải là 'LR'"
    );
  });

  it("should reject upsertProduct if routing is empty and needsRouting is false or undefined", async () => {
    const invalidProduct: Product = {
      sku: "SKU-002",
      nameVi: "Bánh Răng Nón",
      routing: [],
      unit: "Cái",
      needsRouting: false,
      createdAt: "",
      updatedAt: "",
    };

    await expect(upsertProduct(invalidProduct)).rejects.toThrow(
      "Routing không được để rỗng"
    );
  });

  it("should accept upsertProduct when routing ends with 'LR'", async () => {
    const validProduct: Product = {
      sku: "SKU-003",
      nameVi: "Vỏ Hộp Số",
      routing: ["D1", "CK2", "MNL", "LR"],
      unit: "Bộ",
      createdAt: "",
      updatedAt: "",
    };

    const saved = await upsertProduct(validProduct);
    expect(saved.sku).toBe("SKU-003");
    expect(saved.routing).toEqual(["D1", "CK2", "MNL", "LR"]);

    const fetched = await getProduct("SKU-003");
    expect(fetched).not.toBeNull();
    expect(fetched?.nameVi).toBe("Vỏ Hộp Số");
  });

  it("should allow empty routing temporarily if needsRouting is true", async () => {
    const productNeedsRouting: Product = {
      sku: "SKU-004",
      nameVi: "Chi Tiết Mới Import",
      routing: [],
      unit: "Cái",
      needsRouting: true,
      createdAt: "",
      updatedAt: "",
    };

    const saved = await upsertProduct(productNeedsRouting);
    expect(saved.sku).toBe("SKU-004");
    expect(saved.needsRouting).toBe(true);

    const list = await listProducts();
    expect(list).toHaveLength(1);
    expect(list[0].sku).toBe("SKU-004");
  });
});
