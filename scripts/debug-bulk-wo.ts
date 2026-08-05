import { createPO, createBulkWOsForPOs, listWOs } from "../lib/po-wo-engine";
import { upsertProduct } from "../lib/products";

async function test() {
  const ts = Date.now();
  await upsertProduct({
    sku: `DBG-A-${ts}`,
    nameVi: "A",
    customerName: `C${ts}`,
    routing: ["D1", "CK1", "KTP"],
    unit: "Cái",
    createdAt: "",
    updatedAt: "",
  });

  const po = await createPO({
    poNumber: `PO-DBG-${ts}`,
    customerName: `C${ts}`,
    sku: `DBG-A-${ts}`,
    productNameVi: "A",
    qty: 100,
    requestedDate: "2026-09-01",
  });

  console.log("Created PO:", po.poId, po.poLineId);
  const res1 = await createBulkWOsForPOs([po.poId], "admin");
  console.log("Run 1:", res1);
  const res2 = await createBulkWOsForPOs([po.poId], "admin");
  console.log("Run 2:", res2);
}

test().catch(console.error);
