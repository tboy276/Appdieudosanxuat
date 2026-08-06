import { NextRequest, NextResponse } from "next/server";
import { getShippableItems } from "@/lib/shipment";
import { authorize, handleApiError } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const { response } = authorize(req);
  if (response) return response;

  try {
    const { searchParams } = new URL(req.url);
    const customerId = searchParams.get("customerId") || undefined;
    const sku = searchParams.get("sku") || undefined;
    const search = searchParams.get("search") || undefined;

    const items = await getShippableItems({ customerId, sku, search });
    return NextResponse.json(items);
  } catch (err) {
    return handleApiError(err, "Không thể tải danh sách PO có thể xuất hàng.");
  }
}
