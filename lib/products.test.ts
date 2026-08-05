import { describe, it, expect, beforeEach } from "vitest";
import {
  normalizeProductRouting,
  validateProductRouting,
  upsertProduct,
  listProducts,
  getProduct,
  deleteProduct,
} from "./products";
import { Product } from "./types";
import { seedWorkshops } from "../scripts/seed-workshops-supabase";

describe("lib/products.ts - Product Catalog Management (Supabase PostgreSQL)", () => {
  beforeEach(async () => {
    // Ensure workshops seed table is populated
    await seedWorkshops();
  });

  it("should automatically append 'KTP' as the last step of routing when normalizing product routing", () => {
    const routing = ["CUAPHOI", "CK1", "MNL"];
    const normalized = normalizeProductRouting(routing);
    expect(normalized).toEqual(["CUAPHOI", "CK1", "MNL", "KTP"]);
  });

  it("should reject upsertProduct if customerName / customerNames is missing", async () => {
    const missingCustomerProduct: any = {
      sku: "SKU-TEST-ERR1",
      nameVi: "Trục Vít Nâng",
      routing: ["CUAPHOI", "CK1", "MNL"],
      unit: "Cái",
    };

    await expect(upsertProduct(missingCustomerProduct)).rejects.toThrow(
      "Khách hàng không được để rỗng"
    );
  });

  it("should reject upsertProduct if routing is empty and needsRouting is false or undefined", async () => {
    const invalidProduct: Product = {
      sku: "SKU-TEST-ERR2",
      nameVi: "Bánh Răng Nón",
      customerName: "Khách Hàng Test",
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

  it("should upsert a valid product into Supabase and fetch it back", async () => {
    const testSku = "SKU-SUPA-001";
    const validProduct: Product = {
      sku: testSku,
      nameVi: "Vỏ Hộp Số Supabase Test",
      customerName: "Khách Hàng Test A",
      routing: ["D1", "CK2", "MNL", "LR"],
      routingScrapRates: { D1: 10, CK2: 2, MNL: 3, LR: 0 },
      routingLeadTimes: { D1: 2, CK2: 1, MNL: 1, LR: 1 },
      unit: "Bộ",
      createdAt: "",
      updatedAt: "",
    };

    const saved = await upsertProduct(validProduct);
    expect(saved.sku).toBe(testSku);
    expect(saved.routing).toEqual(["D1", "CK2", "MNL", "LR", "KTP"]);
    expect(saved.customerNames).toContain("Khách Hàng Test A");

    const fetched = await getProduct(testSku);
    expect(fetched).not.toBeNull();
    expect(fetched?.nameVi).toBe("Vỏ Hộp Số Supabase Test");
    expect(fetched?.routingScrapRates?.D1).toBe(10);
  });

  it("should allow adding multiple customer names for the same SKU", async () => {
    const testSku = "SKU-SUPA-MULTI";
    const p1: Product = {
      sku: testSku,
      nameVi: "SP Test Multi Customer",
      customerNames: ["Công ty Alpha"],
      routing: ["D1", "KTP"],
      unit: "Cái",
      createdAt: "",
      updatedAt: "",
    };
    await upsertProduct(p1);

    const p1Multi: Product = {
      sku: testSku,
      nameVi: "SP Test Multi Customer",
      customerNames: ["Công ty Alpha", "Công ty Beta"],
      routing: ["D1", "KTP"],
      unit: "Cái",
      createdAt: "",
      updatedAt: "",
    };

    const updated = await upsertProduct(p1Multi);
    expect(updated.customerNames).toEqual(expect.arrayContaining(["Công ty Alpha", "Công ty Beta"]));
    expect(updated.customerNames.length).toBe(2);
  });

  it("should delete product by SKU", async () => {
    const testSku = "SKU-SUPA-DEL";
    const productToDelete: Product = {
      sku: testSku,
      nameVi: "SP Xóa Test",
      customerName: "Khách Hàng Temp",
      routing: ["CK1", "KTP"],
      unit: "Cái",
      createdAt: "",
      updatedAt: "",
    };

    await upsertProduct(productToDelete);
    const beforeDel = await getProduct(testSku);
    expect(beforeDel).not.toBeNull();

    await deleteProduct(testSku);

    const afterDel = await getProduct(testSku);
    expect(afterDel).toBeNull();
  });
});
