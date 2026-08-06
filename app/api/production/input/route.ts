import { NextRequest, NextResponse } from "next/server";
import { inputProduction } from "@/lib/xnt-engine";
import { recordWOProgress } from "@/lib/po-wo-engine";
import { getProduct } from "@/lib/products";
import { authorize, handleApiError } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const { user, response } = authorize(req, ["ADMIN", "DISPATCHER"]);
  if (response) return response;

  try {
    const body = await req.json();
    const { wcCode, sku, actualQty, ngQty, woId, customDate } = body;

    if (!wcCode || !sku || !actualQty || Number(actualQty) <= 0) {
      return NextResponse.json(
        { error: "Mã xưởng (wcCode), SKU và sản lượng báo cáo (actualQty > 0) là bắt buộc." },
        { status: 400 }
      );
    }

    const qtyNum = Number(actualQty);
    const parsedNgQty = Math.max(0, Number(ngQty || 0));

    // Determine if wcCode is first step in product routing
    const product = await getProduct(sku);
    let isFirstStep = false;
    if (product && product.routing && product.routing.length > 0) {
      isFirstStep = product.routing[0] === wcCode;
    }

    // Step 1: Physical Inventory Input & Auto-allocation (Throws if insufficient stock)
    const summary = await inputProduction(wcCode, sku, qtyNum, user!.username, isFirstStep, woId, customDate, parsedNgQty);

    return NextResponse.json({
      success: true,
      message: summary.message || "Báo cáo sản lượng thành công.",
      summary,
    });
  } catch (err) {
    return handleApiError(err, "Nhập báo cáo sản lượng thất bại.");
  }
}
