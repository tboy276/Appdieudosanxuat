import { supabaseAdmin } from "./supabase";
import { Product } from "./types";
import { listPOs, listWOs } from "./po-wo-engine";

export interface BulkDeleteSkusResult {
  deletedCount: number;
  rejectedCount: number;
  rejected: { id: string; reason: string }[];
}

/**
 * Helper to normalize routing array and automatically ensure KTP is the final step
 */
export function normalizeProductRouting(routing?: string[]): string[] {
  if (!routing || !Array.isArray(routing) || routing.length === 0) {
    return ["KTP"];
  }

  const cleaned = routing.map((s) => s.trim().toUpperCase()).filter(Boolean);
  if (cleaned.length === 0) {
    return ["KTP"];
  }

  if (cleaned[cleaned.length - 1] !== "KTP") {
    cleaned.push("KTP");
  }

  return cleaned;
}

/**
 * Validates product routing rules:
 * - If needsRouting is true and routing is empty, it is allowed (pending routing declaration).
 * - Otherwise, routing must not be empty. Automatically appends KTP if missing.
 */
export function validateProductRouting(product: Partial<Product>): void {
  const { routing, needsRouting } = product;

  if (needsRouting && (!routing || routing.length === 0)) {
    return;
  }

  if (!routing || !Array.isArray(routing) || routing.length === 0) {
    throw new Error("Routing không được để rỗng trừ khi sản phẩm đang ở trạng thái cần cập nhật routing (needsRouting=true).");
  }
}

/**
 * Helper to map PostgreSQL query result row to Product domain shape
 */
function mapDbRecordToProduct(prod: any): Product {
  const customerNames: string[] = (prod.product_customers || [])
    .map((pc: any) => pc.customers?.name)
    .filter(Boolean);

  const rawRoutings = (prod.product_routings || []).sort(
    (a: any, b: any) => a.step_order - b.step_order
  );

  const routingCodes: string[] = rawRoutings
    .map((r: any) => r.workshops?.code)
    .filter(Boolean);

  const normalizedRouting = normalizeProductRouting(routingCodes);

  const routingScrapRates: Record<string, number> = {};
  const routingLeadTimes: Record<string, number> = {};

  for (const r of rawRoutings) {
    const code = r.workshops?.code;
    if (code) {
      routingScrapRates[code] = Number(r.ng_rate || 0);
      routingLeadTimes[code] = Number(r.lead_time_days || 1);
    }
  }

  const needsRouting = rawRoutings.length === 0;

  return {
    sku: prod.part_no,
    nameVi: prod.name_vi,
    customerNames,
    customerName: customerNames[0] || "",
    rawWeight: prod.raw_weight !== null && prod.raw_weight !== undefined ? Number(prod.raw_weight) : undefined,
    material: prod.material || undefined,
    routing: normalizedRouting,
    routingScrapRates,
    routingLeadTimes,
    unit: prod.unit || "Cái",
    needsRouting,
    createdAt: prod.created_at || new Date().toISOString(),
    updatedAt: prod.updated_at || new Date().toISOString(),
  };
}

/**
 * Ensure customer exists in database, returns customer_id
 */
async function ensureCustomerByName(customerName: string): Promise<string> {
  const trimmed = customerName.trim();
  if (!trimmed) {
    throw new Error("Tên Khách hàng không được để rỗng.");
  }

  let existing: any[] | null = null;
  let selectErr: any = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await supabaseAdmin
        .from("customers")
        .select("id, name")
        .ilike("name", trimmed)
        .limit(1);
      existing = res.data;
      selectErr = res.error;
      if (!selectErr && existing) break;
    } catch (err: any) {
      selectErr = err;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }


  if (selectErr && (!existing || existing.length === 0)) {
    try {
      const codePrefix = "KH-" + Math.random().toString(36).substring(2, 7).toUpperCase();
      const { data: inserted } = await supabaseAdmin
        .from("customers")
        .insert({ customer_code: codePrefix, name: trimmed })
        .select("id")
        .single();
      if (inserted?.id) return inserted.id;
    } catch (e) {
      // Ignore
    }
  }



  if (existing && existing.length > 0) {
    return existing[0].id;
  }

  // Generate a customer_code
  const codePrefix = "KH-" + Math.random().toString(36).substring(2, 7).toUpperCase();

  const { data: inserted, error: insertErr } = await supabaseAdmin
    .from("customers")
    .insert({
      customer_code: codePrefix,
      name: trimmed,
    })
    .select("id")
    .single();

  if (insertErr) {
    throw new Error(`Lỗi tạo mới khách hàng '${trimmed}': ${insertErr.message}`);
  }

  return inserted.id;
}

/**
 * Fetch all products from Supabase PostgreSQL
 */
export async function listProducts(): Promise<Product[]> {
  const { data, error } = await supabaseAdmin
    .from("products")
    .select(`
      id,
      part_no,
      name_vi,
      raw_weight,
      material,
      unit,
      created_at,
      updated_at,
      product_customers (
        customers (
          name
        )
      ),
      product_routings (
        step_order,
        ng_rate,
        lead_time_days,
        workshops (
          code
        )
      )
    `)
    .order("part_no", { ascending: true })
    .range(0, 9999);

  if (error) {
    throw new Error(`Lỗi lấy danh mục sản phẩm từ Supabase: ${error.message}`);
  }

  return (data || []).map(mapDbRecordToProduct);
}

/**
 * Fetch single product by SKU
 */
export async function getProduct(sku: string): Promise<Product | null> {
  if (!sku || !sku.trim()) return null;

  const { data, error } = await supabaseAdmin
    .from("products")
    .select(`
      id,
      part_no,
      name_vi,
      raw_weight,
      material,
      unit,
      created_at,
      updated_at,
      product_customers (
        customers (
          name
        )
      ),
      product_routings (
        step_order,
        ng_rate,
        lead_time_days,
        workshops (
          code
        )
      )
    `)
    .eq("part_no", sku.trim())
    .maybeSingle();

  if (error) {
    throw new Error(`Lỗi tra cứu sản phẩm '${sku}': ${error.message}`);
  }

  if (!data) return null;

  return mapDbRecordToProduct(data);
}

/**
 * Upsert a product into Supabase PostgreSQL
 */
export async function upsertProduct(product: Product): Promise<Product> {
  if (!product.sku || !product.sku.trim()) {
    throw new Error("Mã SKU không được để rỗng.");
  }
  if (!product.nameVi || !product.nameVi.trim()) {
    throw new Error("Tên tiếng Việt không được để rỗng.");
  }

  let rawCustList: string[] = [];
  if (Array.isArray(product.customerNames) && product.customerNames.length > 0) {
    rawCustList = product.customerNames;
  } else if (product.customerName && product.customerName.trim()) {
    rawCustList = [product.customerName];
  }

  const cleanedCustList: string[] = [];
  const seenLower = new Set<string>();
  for (const c of rawCustList) {
    const trimmed = String(c || "").trim();
    if (trimmed && !seenLower.has(trimmed.toLowerCase())) {
      seenLower.add(trimmed.toLowerCase());
      cleanedCustList.push(trimmed);
    }
  }

  if (cleanedCustList.length === 0) {
    throw new Error("Khách hàng không được để rỗng khi khai báo Part No.");
  }

  validateProductRouting(product);

  const sku = product.sku.trim();
  const nameVi = product.nameVi.trim();
  const rawWeight = typeof product.rawWeight === "number" && !isNaN(product.rawWeight) ? product.rawWeight : null;
  const material = product.material?.trim() || null;
  const unit = product.unit || "Cái";

  // 1. Ensure all customer IDs
  const customerIds: string[] = [];
  for (const custName of cleanedCustList) {
    const custId = await ensureCustomerByName(custName);
    customerIds.push(custId);
  }

  // 2. Upsert into products table
  const { data: prodData, error: prodErr } = await supabaseAdmin
    .from("products")
    .upsert(
      {
        part_no: sku,
        name_vi: nameVi,
        raw_weight: rawWeight,
        material: material,
        unit: unit,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "part_no" }
    )
    .select("id")
    .single();

  if (prodErr || !prodData) {
    throw new Error(`Lỗi lưu thông tin sản phẩm '${sku}': ${prodErr?.message}`);
  }

  const productId = prodData.id;

  // 3. Sync product_customers
  // Delete old links
  await supabaseAdmin.from("product_customers").delete().eq("product_id", productId);

  // Insert new links (deduplicated)
  const uniqueCids = Array.from(new Set(customerIds));
  const custLinks = uniqueCids.map((cid) => ({
    product_id: productId,
    customer_id: cid,
  }));
  const { error: custLinkErr } = await supabaseAdmin
    .from("product_customers")
    .upsert(custLinks, { onConflict: "product_id,customer_id" });
  if (custLinkErr) {
    throw new Error(`Lỗi liên kết Khách hàng cho sản phẩm '${sku}': ${custLinkErr.message}`);
  }

  // 4. Sync product_routings
  // Delete old routing steps
  await supabaseAdmin.from("product_routings").delete().eq("product_id", productId);

  if (!product.needsRouting && product.routing && product.routing.length > 0) {
    const normalizedRouting = normalizeProductRouting(product.routing);

    // Filter out KTP as KTP is implicit in DB schema v4 design (enforced by DB trigger)
    const activeSteps = normalizedRouting.filter((code) => code.toUpperCase() !== "KTP");

    if (activeSteps.length > 0) {
      // Lookup workshop IDs for codes
      const { data: workshopsData, error: wsErr } = await supabaseAdmin
        .from("workshops")
        .select("id, code")
        .in("code", activeSteps);

      if (wsErr) {
        throw new Error(`Lỗi tra cứu xưởng cho routing sản phẩm '${sku}': ${wsErr.message}`);
      }

      const codeToWsIdMap = new Map<string, string>();
      for (const ws of workshopsData || []) {
        codeToWsIdMap.set(ws.code.toUpperCase(), ws.id);
      }

      const routingInserts = activeSteps.map((code, index) => {
        const wsId = codeToWsIdMap.get(code.toUpperCase());
        if (!wsId) {
          throw new Error(`Mã xưởng '${code}' không tồn tại trong danh mục xưởng.`);
        }

        const ngRate = product.routingScrapRates?.[code] ?? 0;
        const leadTime = product.routingLeadTimes?.[code] ?? 1;

        return {
          product_id: productId,
          workshop_id: wsId,
          step_order: index + 1,
          ng_rate: ngRate,
          lead_time_days: leadTime,
        };
      });

      const { error: routingInsErr } = await supabaseAdmin
        .from("product_routings")
        .insert(routingInserts);

      if (routingInsErr) {
        throw new Error(`Lỗi lưu chuỗi Routing cho sản phẩm '${sku}': ${routingInsErr.message}`);
      }
    }
  }

  // Return re-fetched full product object
  const fullProduct = await getProduct(sku);
  if (!fullProduct) {
    throw new Error(`Không tìm thấy sản phẩm '${sku}' sau khi lưu.`);
  }

  return fullProduct;
}

/**
 * Bulk upsert products into Supabase PostgreSQL in batched queries for maximum performance
 */
export async function bulkUpsertProducts(products: Product[]): Promise<Product[]> {
  if (!products || products.length === 0) return [];

  const now = new Date().toISOString();

  // 1. Gather all unique customer names
  const allCustNamesSet = new Set<string>();
  for (const p of products) {
    const custs = p.customerNames && p.customerNames.length > 0
      ? p.customerNames
      : p.customerName ? [p.customerName] : [];
    for (const c of custs) {
      if (c && c.trim()) allCustNamesSet.add(c.trim());
    }
  }

  const uniqueCustNames = Array.from(allCustNamesSet);

  // 2. Fetch existing customers from DB
  const { data: existingCusts, error: custSelectErr } = await supabaseAdmin
    .from("customers")
    .select("id, name");

  if (custSelectErr) {
    throw new Error(`Lỗi tra cứu khách hàng khi bulk upsert: ${custSelectErr.message}`);
  }

  const custNameToIdMap = new Map<string, string>();
  for (const c of existingCusts || []) {
    custNameToIdMap.set(c.name.toLowerCase(), c.id);
  }

  const missingCustNames = uniqueCustNames.filter((name) => !custNameToIdMap.has(name.toLowerCase()));

  if (missingCustNames.length > 0) {
    const custInserts = missingCustNames.map((name) => ({
      customer_code: "KH-" + Math.random().toString(36).substring(2, 7).toUpperCase(),
      name: name,
    }));

    const { data: newCusts, error: custInsErr } = await supabaseAdmin
      .from("customers")
      .insert(custInserts)
      .select("id, name");

    if (custInsErr) {
      throw new Error(`Lỗi tạo khách hàng mới khi bulk upsert: ${custInsErr.message}`);
    }

    for (const c of newCusts || []) {
      custNameToIdMap.set(c.name.toLowerCase(), c.id);
    }
  }

  // 3. Prepare product rows for bulk upsert into `products`
  const productRows = products.map((p) => {
    const sku = p.sku.trim();
    const nameVi = p.nameVi ? p.nameVi.trim() : sku;
    const rawWeight = typeof p.rawWeight === "number" && !isNaN(p.rawWeight) ? p.rawWeight : null;
    const material = p.material?.trim() || null;
    const unit = p.unit || "Cái";
    return {
      part_no: sku,
      name_vi: nameVi,
      raw_weight: rawWeight,
      material: material,
      unit: unit,
      updated_at: now,
    };
  });

  for (let i = 0; i < productRows.length; i += 50) {
    const chunk = productRows.slice(i, i + 50);
    const { error: prodUpsertErr } = await supabaseAdmin
      .from("products")
      .upsert(chunk, { onConflict: "part_no" });

    if (prodUpsertErr) {
      throw new Error(`Lỗi bulk upsert sản phẩm: ${prodUpsertErr.message}`);
    }
  }

  const allSkus = products.map((p) => p.sku.trim());
  const partNoToIdMap = new Map<string, string>();

  for (let i = 0; i < allSkus.length; i += 50) {
    const chunk = allSkus.slice(i, i + 50);
    const { data: chunkProds, error: fetchIdsErr } = await supabaseAdmin
      .from("products")
      .select("id, part_no")
      .in("part_no", chunk);

    if (fetchIdsErr) {
      throw new Error(`Lỗi tra cứu ID sản phẩm sau bulk upsert: ${fetchIdsErr.message}`);
    }

    for (const p of chunkProds || []) {
      partNoToIdMap.set(p.part_no, p.id);
    }
  }

  // 4. Sync product_customers
  const productIds = Array.from(partNoToIdMap.values());
  for (let i = 0; i < productIds.length; i += 50) {
    const chunk = productIds.slice(i, i + 50);
    await supabaseAdmin.from("product_customers").delete().in("product_id", chunk);
  }

  const pcInserts: { product_id: string; customer_id: string }[] = [];
  for (const p of products) {
    const productId = partNoToIdMap.get(p.sku.trim());
    if (!productId) continue;

    const custs = p.customerNames && p.customerNames.length > 0
      ? p.customerNames
      : p.customerName ? [p.customerName] : [];

    const seenCids = new Set<string>();
    for (const c of custs) {
      const cid = custNameToIdMap.get(c.trim().toLowerCase());
      if (cid && !seenCids.has(cid)) {
        seenCids.add(cid);
        pcInserts.push({ product_id: productId, customer_id: cid });
      }
    }
  }

  if (pcInserts.length > 0) {
    for (let i = 0; i < pcInserts.length; i += 100) {
      const chunk = pcInserts.slice(i, i + 100);
      const { error: pcErr } = await supabaseAdmin.from("product_customers").insert(chunk);
      if (pcErr) {
        throw new Error(`Lỗi liên kết Khách hàng cho bulk upsert SKU: ${pcErr.message}`);
      }
    }
  }

  // 5. Fetch updated products
  const fullProds: any[] = [];
  for (let i = 0; i < productIds.length; i += 50) {
    const chunk = productIds.slice(i, i + 50);
    const { data: chunkProds, error: fetchErr } = await supabaseAdmin
      .from("products")
      .select(`
        id,
        part_no,
        name_vi,
        raw_weight,
        material,
        unit,
        created_at,
        updated_at,
        product_customers (
          customers (
            name
          )
        ),
        product_routings (
          step_order,
          ng_rate,
          lead_time_days,
          workshops (
            code
          )
        )
      `)
      .in("id", chunk);

    if (fetchErr) {
      throw new Error(`Lỗi lấy sản phẩm cập nhật: ${fetchErr.message}`);
    }

    if (chunkProds) {
      fullProds.push(...chunkProds);
    }
  }

  return fullProds.map(mapDbRecordToProduct);
}

/**
 * Delete a product by SKU with FK constraint checking (and transition Redis check)
 */
export async function deleteProduct(sku: string): Promise<void> {
  if (!sku || !sku.trim()) {
    throw new Error("Mã SKU là bắt buộc để xóa.");
  }

  const cleanSku = sku.trim();

  // Check active POs & WOs in PostgreSQL using optimized COUNT queries
  const { data: productData } = await supabaseAdmin.from("products").select("id").eq("part_no", cleanSku).single();
  if (productData) {
    const { count: poCount } = await supabaseAdmin
      .from("po_lines")
      .select("*", { count: "exact", head: true })
      .eq("product_id", productData.id);

    if (poCount && poCount > 0) {
      throw new Error(`Không thể xóa SKU ${cleanSku} do đang có Đơn hàng PO liên quan.`);
    }

    const { count: woCount } = await supabaseAdmin
      .from("work_orders")
      .select("*", { count: "exact", head: true })
      .eq("product_id", productData.id);

    if (woCount && woCount > 0) {
      throw new Error(`Không thể xóa SKU ${cleanSku} do đang có Lệnh sản xuất WO liên quan.`);
    }
  }

  // 1. Fetch product ID
  const { data: prodData } = await supabaseAdmin
    .from("products")
    .select("id")
    .eq("part_no", cleanSku)
    .maybeSingle();

  if (!prodData) return;

  const productId = prodData.id;

  // 2. Check if referenced in Supabase tables
  const { count: poCount } = await supabaseAdmin
    .from("po_lines")
    .select("*", { count: "exact", head: true })
    .eq("product_id", productId);

  if (poCount && poCount > 0) {
    throw new Error(`Không thể xóa SKU ${cleanSku} do đang có Đơn hàng PO liên quan.`);
  }

  const { count: woCount } = await supabaseAdmin
    .from("work_orders")
    .select("*", { count: "exact", head: true })
    .eq("product_id", productId);

  if (woCount && woCount > 0) {
    throw new Error(`Không thể xóa SKU ${cleanSku} do đang có Lệnh sản xuất WO liên quan.`);
  }

  const { count: txCount } = await supabaseAdmin
    .from("inventory_transactions")
    .select("*", { count: "exact", head: true })
    .eq("product_id", productId);

  if (txCount && txCount > 0) {
    throw new Error(`Không thể xóa SKU ${cleanSku} do đang có Lịch sử Giao dịch liên quan.`);
  }

  // 3. Clean up child records in product_customers and product_routings
  await supabaseAdmin.from("product_customers").delete().eq("product_id", productId);
  await supabaseAdmin.from("product_routings").delete().eq("product_id", productId);

  // 4. Delete product
  const { error } = await supabaseAdmin.from("products").delete().eq("id", productId);
  if (error) {
    throw new Error(`Xóa sản phẩm '${cleanSku}' thất bại: ${error.message}`);
  }
}

/**
 * Bulk delete products (SKUs) with constraint checks.
 */
export async function bulkDeleteProducts(skus: string[]): Promise<BulkDeleteSkusResult> {
  if (!skus || skus.length === 0) {
    return { deletedCount: 0, rejectedCount: 0, rejected: [] };
  }

  let deletedCount = 0;
  const rejected: { id: string; reason: string }[] = [];

  for (const sku of skus) {
    try {
      await deleteProduct(sku);
      deletedCount++;
    } catch (err: any) {
      rejected.push({
        id: sku,
        reason: err.message || "Xóa sản phẩm thất bại.",
      });
    }
  }

  return {
    deletedCount,
    rejectedCount: rejected.length,
    rejected,
  };
}
