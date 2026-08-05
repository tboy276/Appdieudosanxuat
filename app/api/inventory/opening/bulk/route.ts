import { NextRequest, NextResponse } from "next/server";
import { declareOpeningStock } from "@/lib/inventory-postgres";
import { authorize, handleApiError } from "@/lib/auth";
import { StockState } from "@/lib/types";

export interface BulkOpeningItem {
  wcCode: string;
  sku: string;
  state: StockState;
}

export async function POST(req: NextRequest) {
  const { user, response } = authorize(req, ["ADMIN", "DISPATCHER"]);
  if (response) return response;

  try {
    const body = await req.json();
    const { items, cutoverDate } = body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { error: "Danh sách tồn kho đầu kỳ import không được để rỗng." },
        { status: 400 }
      );
    }

    const todayStr = new Date().toISOString().slice(0, 10);
    const effectiveDate = cutoverDate ? String(cutoverDate).trim() : todayStr;

    if (cutoverDate) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) {
        return NextResponse.json(
          { error: "Định dạng ngày cutoverDate không hợp lệ (phải là YYYY-MM-DD)." },
          { status: 400 }
        );
      }
      if (effectiveDate > todayStr) {
        return NextResponse.json(
          { error: "Ngày khai báo tồn kho đầu kỳ không được là ngày trong tương lai." },
          { status: 400 }
        );
      }
      if (user?.role !== "ADMIN" && effectiveDate !== todayStr) {
        return NextResponse.json(
          { error: "Chỉ tài khoản Admin mới có quyền khai báo lùi ngày (cutoverDate)." },
          { status: 403 }
        );
      }
    }

    const errors: { row: number; sku: string; wcCode: string; error: string }[] = [];

    // Pre-validate all items
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const rowNum = i + 2;
      const cleanSku = String(item.sku || "").trim();
      const cleanWcCode = String(item.wcCode || "").trim();

      if (!cleanSku || !cleanWcCode) {
        errors.push({
          row: rowNum,
          sku: cleanSku,
          wcCode: cleanWcCode,
          error: "Mã SKU và Mã Xưởng không được để rỗng.",
        });
      }
    }

    if (errors.length > 0) {
      return NextResponse.json(
        { error: `Phát hiện ${errors.length} dòng tồn đầu kỳ lỗi. Vui lòng kiểm tra lại.`, errors },
        { status: 400 }
      );
    }

    let updatedCount = 0;

    // Process all valid items directly in PostgreSQL
    for (const item of items) {
      const cleanSku = String(item.sku).trim();
      const cleanWcCode = String(item.wcCode).trim();
      const cleanState: StockState = {
        tonPhoi: Math.max(0, Number(item.state?.tonPhoi || 0)),
        tonThanhPham: Math.max(0, Number(item.state?.tonThanhPham || 0)),
      };

      await declareOpeningStock(cleanWcCode, cleanSku, cleanState, user!.username, effectiveDate);
      updatedCount++;
    }

    return NextResponse.json({
      success: true,
      count: updatedCount,
    });
  } catch (err) {
    return handleApiError(err, "Khai báo tồn kho đầu kỳ bulk thất bại.");
  }
}
