import { NextRequest, NextResponse } from "next/server";
import { authorize, handleApiError } from "@/lib/auth";
import { getTransactionHistory } from "@/lib/inventory-postgres";

export async function GET(req: NextRequest) {
  const { response } = authorize(req);
  if (response) return response;

  try {
    const { searchParams } = new URL(req.url);
    const sku = searchParams.get("sku") || undefined;
    const search = searchParams.get("search") || undefined;

    const data = await getTransactionHistory({ sku, search });
    return NextResponse.json(data);
  } catch (err) {
    return handleApiError(err, "Không thể tải lịch sử giao dịch.");
  }
}
