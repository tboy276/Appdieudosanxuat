import { supabaseAdmin } from "../lib/supabase";
import { createPO, listPOs } from "../lib/po-postgres";
import { createShipment } from "../lib/shipment";
import { upsertProduct } from "../lib/products";

async function debugShipment() {
  const custName = `DebugCust-${Date.now()}`;
  const { data: cust } = await supabaseAdmin.from("customers").upsert({ customer_code: `CUST-DBG-${Date.now()}`, name: custName }).select().single();
  const sku = `SKU-DBG-${Date.now()}`;
  await upsertProduct({ sku, nameVi: "Debug Product", customerName: custName, routing: ["D1", "KTP"], unit: "Cái" } as any);

  const { data: prod } = await supabaseAdmin.from("products").select("id").eq("part_no", sku).single();

  const po = await createPO({ poNumber: `PO-DBG-${Date.now()}`, customerName: custName, sku, productNameVi: "Debug", qty: 100, requestedDate: "2026-12-01", createdBy: "admin" } as any);

  const { data: line } = await supabaseAdmin.from("po_lines").select("id").eq("po_id", po.poId).single();

  console.log("Created PO:", po.poId, "PO Line:", line.id);

  const shipRes = await createShipment(cust.id, [{ poLineId: line.id, productId: prod.id, shippedQty: 60 }], "admin", "Debug shipment");
  console.log("Shipment created:", shipRes);

  const { data: itemsInDb } = await supabaseAdmin.from("shipment_items").select("*").eq("po_line_id", line.id);
  console.log("Shipment items in DB:", itemsInDb);

  const allPos = await listPOs();
  const foundPo = allPos.find((p) => p.poId === po.poId);
  console.log("Found PO in listPOs:", foundPo);
}

debugShipment();
