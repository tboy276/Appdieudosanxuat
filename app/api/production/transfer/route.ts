import { NextRequest, NextResponse } from "next/server";
import { transferPhoi } from "@/lib/xnt-engine";
import { getProduct } from "@/lib/products";
import { authorize, handleApiError } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const { user, response } = authorize(req, ["ADMIN", "DISPATCHER"]);
  if (response) return response;

  try {
    const body = await req.json();
    const { fromCode, toCode, sku, qty, woId, customDate } = body;

    if (!fromCode || !toCode || !sku || !qty || Number(qty) <= 0) {
      return NextResponse.json(
        { error: "Xưởng nguồn, xưởng đích, SKU và số lượng chuyển phôi (> 0) là bắt buộc." },
        { status: 400 }
      );
    }

    const qtyNum = Number(qty);

    // Validate routing: toCode MUST be immediate next step after fromCode in Product.routing
    const product = await getProduct(sku);
    if (!product || !product.routing || product.routing.length === 0) {
      return NextResponse.json(
        { error: `SKU ${sku} chưa khai báo routing sản phẩm.` },
        { status: 400 }
      );
    }

    const fromIndex = product.routing.indexOf(fromCode);
    if (fromIndex === -1) {
      return NextResponse.json(
        { error: `Xưởng nguồn ${fromCode} không nằm trong routing của SKU ${sku}.` },
        { status: 400 }
      );
    }

    const expectedNextCode = product.routing[fromIndex + 1];
    if (expectedNextCode !== toCode) {
      return NextResponse.json(
        { error: `Xưởng ${toCode} không phải là công đoạn kế tiếp của ${fromCode} trong routing của SKU ${sku}.` },
        { status: 400 }
      );
    }

    // Call physical inventory transfer
    await transferPhoi(fromCode, toCode, sku, qtyNum, user!.username, woId, customDate);

    return NextResponse.json({
      success: true,
      message: `Đã xuất chuyển ${qtyNum} pcs phôi từ xưởng ${fromCode} sang xưởng ${toCode}.`,
    });
  } catch (err) {
    return handleApiError(err, "Xuất chuyển phôi thất bại.");
  }
}
