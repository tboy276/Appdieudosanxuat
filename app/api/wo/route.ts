import { NextRequest, NextResponse } from "next/server";
import { listWOs, createWO } from "@/lib/po-wo-engine";
import { authorize, handleApiError } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const { response } = authorize(req);
  if (response) return response;

  try {
    const wos = await listWOs();
    return NextResponse.json(wos);
  } catch (err) {
    return handleApiError(err, "Không thể tải danh sách Lệnh sản xuất WO.");
  }
}

export async function POST(req: NextRequest) {
  const { user, response } = authorize(req, ["ADMIN", "DISPATCHER"]);
  if (response) return response;

  try {
    const body = await req.json();
    const { poId } = body;

    if (!poId) {
      return NextResponse.json(
        { error: "Mã đơn hàng poId là bắt buộc để lập WO." },
        { status: 400 }
      );
    }

    const wo = await createWO(poId, user!.username);
    return NextResponse.json(wo);
  } catch (err) {
    return handleApiError(err, "Tạo Lệnh sản xuất WO thất bại.");
  }
}
