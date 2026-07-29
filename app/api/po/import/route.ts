import { NextRequest, NextResponse } from "next/server";
import { createPO } from "@/lib/po-wo-engine";
import { getProduct, upsertProduct } from "@/lib/products";
import { authorize, handleApiError } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const { user, response } = authorize(req, ["ADMIN", "DISPATCHER"]);
  if (response) return response;

  try {
    const body = await req.json();
    const rows = Array.isArray(body) ? body : body.rows;

    if (!rows || !Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json(
        { error: "Danh sách đơn hàng import không được để rỗng." },
        { status: 400 }
      );
    }

    const createdPOs = [];
    const now = new Date().toISOString();

    for (const row of rows) {
      const sku = (row.sku || row.productSymbol || "").trim();
      const customerName = (row.customerName || "").trim();
      const qty = Number(row.qty || row.quantity || 0);

      if (!sku || !customerName || qty <= 0) continue;

      // Check if product exists in catalog
      const existingProduct = await getProduct(sku);
      if (!existingProduct) {
        // Create draft product record needing routing later
        await upsertProduct({
          sku,
          nameVi: row.productNameVi || row.productSymbol || sku,
          nameEn: row.productNameEn || undefined,
          legacySymbols: row.legacySymbols ? [row.legacySymbols] : [],
          routing: [],
          unit: "Cái",
          needsRouting: true,
          createdAt: now,
          updatedAt: now,
        });
      }

      const po = await createPO({
        poNumber: row.poNumber || `PO-${Date.now()}`,
        accountId: row.accountId || "",
        customerName,
        sku,
        productNameVi: row.productNameVi || existingProduct?.nameVi || sku,
        productNameEn: row.productNameEn || existingProduct?.nameEn || "",
        qty,
        requestedDate: row.requestedDate || row.expectedDeliveryDate || now.split("T")[0],
        tolerance: row.tolerance ? Number(row.tolerance) : undefined,
        currency: row.currency || "VND",
        techRequirement: row.techRequirement || "",
        specialRequirement: row.specialRequirement || "",
        createdBy: user!.username,
      });

      createdPOs.push(po);
    }

    return NextResponse.json({
      success: true,
      count: createdPOs.length,
      pos: createdPOs,
    });
  } catch (err) {
    return handleApiError(err, "Import danh sách PO thất bại.");
  }
}
