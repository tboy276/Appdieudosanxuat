import { NextRequest, NextResponse } from "next/server";
import { resetSystemDataPostgres } from "@/lib/system-postgres";
import { authorize, handleApiError } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const { response } = authorize(req, ["ADMIN"]);
  if (response) return response;

  try {
    await resetSystemDataPostgres();
    return NextResponse.json({
      success: true,
      message: "Đã reset toàn bộ dữ liệu hệ thống (PO, WO, SKU, Tồn kho, Shipments) trong PostgreSQL thành công!",
    });
  } catch (err) {
    return handleApiError(err, "Reset dữ liệu hệ thống thất bại.");
  }
}
