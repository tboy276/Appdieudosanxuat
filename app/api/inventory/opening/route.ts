import { NextRequest, NextResponse } from "next/server";
import { declareOpeningStock, getTodayDateString, getOpeningStockForSku } from "@/lib/inventory";
import { authorize, handleApiError } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const { response } = authorize(req);
  if (response) return response;

  try {
    const { searchParams } = new URL(req.url);
    const sku = searchParams.get("sku");

    if (!sku) {
      return NextResponse.json(
        { error: "Tham số sku là bắt buộc." },
        { status: 400 }
      );
    }

    const data = await getOpeningStockForSku(sku.trim());
    return NextResponse.json(data);
  } catch (err) {
    return handleApiError(err, "Không thể tải tồn kho đầu kỳ của sản phẩm.");
  }
}

export async function POST(req: NextRequest) {
  const { user, response } = authorize(req);
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

    const cleanSku = String(sku).trim();
    const cleanWcCode = String(wcCode).trim();
    const todayStr = getTodayDateString();

    // Validate customDate format if provided
    if (customDate) {
      const dateStr = String(customDate).trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        return NextResponse.json(
          { error: "Định dạng ngày customDate không hợp lệ (phải là YYYY-MM-DD)." },
          { status: 400 }
        );
      }
      if (dateStr > todayStr) {
        return NextResponse.json(
          { error: "Ngày khai báo tồn kho đầu kỳ không được là ngày trong tương lai." },
          { status: 400 }
        );
      }
    }

    // Call declareOpeningStock which enforces technical constraint (no tx after customDate)
    await declareOpeningStock(cleanWcCode, cleanSku, state, user!.username, customDate);

    return NextResponse.json({
      success: true,
      message: "Khai báo / điều chỉnh tồn kho đầu kỳ thành công.",
    });
  } catch (err) {
    return handleApiError(err, "Khai báo / điều chỉnh tồn kho đầu kỳ thất bại.");
  }
}
