import { describe, it, expect, beforeAll } from "vitest";
import { NextRequest } from "next/server";
import { listWOsGantt } from "@/lib/wo-postgres";
import { createPO } from "@/lib/po-postgres";
import { createWOsForPO } from "@/lib/wo-postgres";
import { recordProductionInput, reverseTransaction } from "@/lib/inventory-postgres";
import { upsertProduct } from "@/lib/products";
import { supabaseAdmin } from "@/lib/supabase";
import { getTodayVN } from "@/lib/date-utils";
import { GET as ganttHandler } from "./wo/gantt/route";
import { signToken, AUTH_COOKIE_NAME } from "@/lib/auth";

describe("WO Gantt Chart & Progress Engine Tests", () => {
  let testPoId: string;
  let testSku: string;
  let adminToken: string;

  beforeAll(async () => {
    adminToken = signToken({ id: "admin-gantt", username: "admin", role: "ADMIN" });

    // 1. Create a 3-step routing product
    testSku = `SKU-GANTT-${Date.now()}`;
    await upsertProduct({
      sku: testSku,
      nameVi: "Sản phẩm Test Gantt Chart",
      customerName: "Khách Hàng Gantt Test",
      routing: ["D1", "CK1", "LR"],
      unit: "Cái",
    });

    // 2. Create PO
    const reqDate = getTodayVN(10);
    const po = await createPO({
      poNumber: `PO-GANTT-${Date.now()}`,
      customerName: "Khách Hàng Gantt Test",
      sku: testSku,
      qty: 100,
      requestedDate: reqDate,
    });
    testPoId = po.poId;

    // 3. Create 3 WOs for PO
    await createWOsForPO(testPoId, "admin");
  }, 30000);

  function createMockRequest(url: string, roleToken?: string): NextRequest {
    const headers = new Headers();
    if (roleToken) {
      headers.set("cookie", `${AUTH_COOKIE_NAME}=${roleToken}`);
    }
    return new NextRequest(new URL(url, "http://localhost:3000"), {
      method: "GET",
      headers,
    });
  }

  it("1. Step D.1 & D.2: Should correctly compute plannedStart, actualStart, actualEnd and progressPercent for 3-step routing WOs", async () => {
    const result = await listWOsGantt({ poId: testPoId });
    expect(result.data.length).toBe(3);

    const step1WO = result.data.find((w) => w.stepOrder === 1)!;
    expect(step1WO.plannedStart).toBeDefined();
    expect(step1WO.deadline).toBeDefined();
    expect(step1WO.progressPercent).toBe(0);
    expect(step1WO.actualStart).toBeNull();
    expect(step1WO.actualEnd).toBeNull();

    // Report production input for Step 1 WO
    await recordProductionInput(step1WO.workshopCode, step1WO.sku, 100, "admin", true, step1WO.id);

    const resultAfterInput = await listWOsGantt({ poId: testPoId });
    const step1Updated = resultAfterInput.data.find((w) => w.stepOrder === 1)!;
    expect(step1Updated.progressPercent).toBe(100);
    expect(step1Updated.actualStart).toBe(getTodayVN());
    expect(step1Updated.actualEnd).toBe(getTodayVN());
    expect(step1Updated.isDelayed).toBe(false);
  });

  it("2. Step D.5 Item 2: REVERSAL transaction reduces progressPercent and clears actualEnd if incomplete", async () => {
    const ganttDataBefore = await listWOsGantt({ poId: testPoId });
    const step1WO = ganttDataBefore.data.find((w) => w.stepOrder === 1)!;

    // Fetch the production input transaction ID
    const { data: txs } = await supabaseAdmin
      .from("inventory_transactions")
      .select("id")
      .eq("work_order_id", step1WO.id)
      .eq("transaction_type", "PRODUCTION_INPUT")
      .limit(1);

    expect(txs && txs.length > 0).toBe(true);
    const origTxId = txs![0].id;

    // Admin reverses 40 items
    await reverseTransaction(origTxId, 40, 0, "ADMIN sửa nhầm sản lượng", "admin", "ADMIN");

    const ganttDataAfterRev = await listWOsGantt({ poId: testPoId });
    const step1AfterRev = ganttDataAfterRev.data.find((w) => w.stepOrder === 1)!;

    // Completed qty should decrease to 60/100 = 60%
    expect(step1AfterRev.completedQty).toBe(60);
    expect(step1AfterRev.progressPercent).toBe(60);
    expect(step1AfterRev.actualEnd).toBeNull(); // No longer completed
  });

  it("3. Step D.5 Item 3: Should flag isDelayed = true for overdue WOs", async () => {
    const ganttDataBefore = await listWOsGantt({ poId: testPoId });
    const sampleWo = ganttDataBefore.data[0];

    // Update sample WO deadline to a past date
    const pastDate = getTodayVN(-5);
    await supabaseAdmin
      .from("work_orders")
      .update({ deadline: pastDate })
      .eq("id", sampleWo.id);

    const ganttDataAfter = await listWOsGantt({ poId: testPoId });
    const updatedWo = ganttDataAfter.data.find((w) => w.id === sampleWo.id)!;
    expect(updatedWo.isDelayed).toBe(true);

    // Restore deadline
    await supabaseAdmin
      .from("work_orders")
      .update({ deadline: sampleWo.deadline })
      .eq("id", sampleWo.id);
  });

  it("4. Step D.3: API GET /api/wo/gantt returns structured Gantt payload", async () => {
    const req = createMockRequest(`http://localhost:3000/api/wo/gantt?poId=${testPoId}`, adminToken);
    const res = await ganttHandler(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toBeDefined();
    expect(body.data.length).toBe(3);
    expect(body.data[0].poNumber).toBeDefined();
    expect(body.data[0].plannedStart).toBeDefined();
  });
});
