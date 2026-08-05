import { NextRequest, NextResponse } from "next/server";
import { listWOsGantt } from "@/lib/wo-postgres";
import { authorize, handleApiError } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const { response } = authorize(req, ["ADMIN", "DISPATCHER", "VIEWER"]);
  if (response) return response;

  try {
    const { searchParams } = new URL(req.url);
    const customerName = searchParams.get("customerName") || undefined;
    const wcCode = searchParams.get("wcCode") || undefined;
    const search = searchParams.get("search") || undefined;
    const poId = searchParams.get("poId") || undefined;
    const sku = searchParams.get("sku") || undefined;
    const fromDate = searchParams.get("fromDate") || undefined;
    const toDate = searchParams.get("toDate") || undefined;

    const result = await listWOsGantt({
      customerName,
      wcCode,
      search,
      poId,
      sku,
      fromDate,
      toDate,
    });

    return NextResponse.json({
      success: true,
      data: result.data,
      count: result.data.length,
      totalCount: result.totalCount,
      requiresFilter: result.requiresFilter,
    });
  } catch (err) {
    return handleApiError(err, "Lấy dữ liệu Biểu đồ Gantt Lệnh sản xuất thất bại.");
  }
}
