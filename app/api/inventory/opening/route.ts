import { NextRequest, NextResponse } from "next/server";
import { declareOpeningStock } from "@/lib/inventory";
import { authorize, handleApiError } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const { user, response } = authorize(req, ["ADMIN", "DISPATCHER"]);
  if (response) return response;

  try {
    const body = await req.json();
    const { wcCode, sku, state, customDate } = body;

    if (!wcCode || !sku || !state) {
      return NextResponse.json(
        { error: "Dữ liệu không đầy đủ: wcCode, sku và state là bắt buộc." },
        { status: 400 }
      );
    }

    await declareOpeningStock(wcCode, sku, state, user!.username, customDate);
    return NextResponse.json({ success: true, message: "Khai báo tồn kho đầu kỳ thành công." });
  } catch (err) {
    return handleApiError(err, "Khai báo tồn kho đầu kỳ thất bại.");
  }
}
