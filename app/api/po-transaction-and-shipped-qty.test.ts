import { describe, it, expect } from "vitest";
import { supabaseAdmin } from "../../lib/supabase";
import { upsertProduct } from "../../lib/products";
import { createPO, updatePO, listPOs, getPO } from "../../lib/po-postgres";
import { createWOsForPO, recordWOProgress, recordShipment } from "../../lib/po-wo-engine";

describe("PO Transaction Safety & WO po_id UUID Matching Verification", () => {
  it("Task 1: Should Rollback PO Customer Update when new Customer is not registered for SKU, preserving original po_lines intact", async () => {
    const ts = Date.now();
    const custOrig = `Khách Gốc ${ts}`;
    const custNew = `Khách Chưa Đăng Ký ${ts}`;
    const sku = `SKU-TRANS-${ts}`;
    const poNum = `PO-TRANS-${ts}`;

    // 1. Create Product registered ONLY to custOrig
    await upsertProduct({
      sku,
      nameVi: "SP Test Transaction",
      customerName: custOrig,
      routing: ["D1", "KTP"],
      unit: "Cái",
      createdAt: "",
      updatedAt: "",
    });

    // 2. Create PO for custOrig
    const po = await createPO({
      poNumber: poNum,
      customerName: custOrig,
      sku,
      productNameVi: "SP Test Transaction",
      qty: 150,
      requestedDate: "2026-09-20",
    });

    // 3. Verify original po_lines exists in DB
    const { data: initialLines } = await supabaseAdmin
      .from("po_lines")
      .select("*")
      .eq("po_id", po.poId);

    expect(initialLines).not.toBeNull();
    expect(initialLines!.length).toBe(1);
    expect(initialLines![0].order_qty).toBe(150);

    // 4. Attempt to update customerName to custNew (unregistered for SKU)
    await expect(
      updatePO(po.poId, { customerName: custNew })
    ).rejects.toThrow(/chưa được đăng ký/i);

    // 5. Verify original po_lines were NOT lost (100% intact after rollback)
    const { data: afterLines } = await supabaseAdmin
      .from("po_lines")
      .select("*")
      .eq("po_id", po.poId);

    expect(afterLines).not.toBeNull();
    expect(afterLines!.length).toBe(1);
    expect(afterLines![0].order_qty).toBe(150);

    // 6. Verify purchase_orders customer_id remains original customer
    const fetchedPo = await getPO(po.poId);
    expect(fetchedPo?.customerName).toBe(custOrig);
  });

  it("Task 2: Should match WO po_id UUID accurately with purchase_orders.id and display true shippedQty on PO list", async () => {
    const ts = Date.now();
    const custName = `Khách Hàng Ship ${ts}`;
    const sku = `SKU-WO-UUID-${ts}`;
    const poNum = `PO-WO-UUID-${ts}`;

    // 1. Register Product and Create PO
    await upsertProduct({
      sku,
      nameVi: "SP Test WO UUID Matching",
      customerName: custName,
      routing: ["D1", "KTP"],
      unit: "Cái",
      createdAt: "",
      updatedAt: "",
    });

    const po = await createPO({
      poNumber: poNum,
      customerName: custName,
      sku,
      productNameVi: "SP Test WO UUID Matching",
      qty: 200,
      requestedDate: "2026-09-25",
    });

    // Verify PO poId is valid UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    expect(po.poId).toMatch(uuidRegex);

    // 2. Generate Work Order (WO) for PO
    const { createdWos } = await createWOsForPO(po.poId, "admin");
    expect(createdWos.length).toBeGreaterThan(0);
    const d1Wo = createdWos[0];

    // 3. Verify WO po_id field in Redis matches exact Postgres UUID
    expect(d1Wo.poId).toBe(po.poId);
    expect(d1Wo.poNumber).toBe(po.poNumber);

    // 4. Record shipment of 80 pcs
    await recordShipment([d1Wo.woId], { [d1Wo.woId]: 80 }, "dispatcher1");

    // 5. Verify shippedQty on single PO lookup
    const singlePo = await getPO(po.poId);
    expect(singlePo?.shippedQty).toBe(80);
    expect(singlePo?.status).toBe("IN_PRODUCTION");

    // 6. Verify shippedQty on PO list (UI & API list rendering)
    const poList = await listPOs();
    const matchedPo = poList.find((p) => p.poId === po.poId);
    expect(matchedPo).toBeDefined();
    expect(matchedPo?.shippedQty).toBe(80);
  }, 30000);
});
