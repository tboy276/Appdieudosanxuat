import { NextRequest, NextResponse } from "next/server";
import { listPOs, createPO } from "@/lib/po-wo-engine";
import { authorize, handleApiError } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const { response } = authorize(req);
  if (response) return response;

  try {
    const pos = await listPOs();
    return NextResponse.json(pos);
  } catch (err) {
    return handleApiError(err, "Không thể tải danh sách đơn hàng PO.");
  }
}

export async function POST(req: NextRequest) {
  const { user, response } = authorize(req, ["ADMIN", "DISPATCHER"]);
  if (response) return response;

  try {
    const body = await req.json();
    const po = await createPO({
      ...body,
      createdBy: user!.username,
    });
    return NextResponse.json(po);
  } catch (err) {
    return handleApiError(err, "Tạo đơn hàng PO thất bại.");
  }
}
