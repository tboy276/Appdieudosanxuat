import { NextRequest, NextResponse } from "next/server";
import { resetSystemData } from "@/lib/redis";
import { authorize, handleApiError } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const { user, response } = authorize(req, ["ADMIN"]);
  if (response) return response;

  try {
    await resetSystemData();
    return NextResponse.json({
      success: true,
      message: "Đã reset toàn bộ dữ liệu hệ thống (PO, WO, SKU, Tồn kho) về trạng thái mặc định thành công!",
    });
  } catch (err) {
    return handleApiError(err, "Reset dữ liệu hệ thống thất bại.");
  }
}
