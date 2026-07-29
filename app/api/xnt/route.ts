import { NextRequest, NextResponse } from "next/server";
import { getXNTReport } from "@/lib/xnt-engine";
import { getTodayDateString } from "@/lib/inventory";
import { authorize, handleApiError } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const { response } = authorize(req);
  if (response) return response;

  try {
    const { searchParams } = new URL(req.url);
    const date = searchParams.get("date") || getTodayDateString();
    const sku = searchParams.get("sku") || undefined;

    const report = await getXNTReport(date, sku);
    return NextResponse.json(report);
  } catch (err) {
    return handleApiError(err, "Không thể xuất báo cáo Xuất-Nhập-Tồn.");
  }
}
