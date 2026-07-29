import { NextRequest, NextResponse } from "next/server";
import { listWOs, createWO, updateWO, deleteWO } from "@/lib/po-wo-engine";
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

export async function PUT(req: NextRequest) {
  const { user, response } = authorize(req, ["ADMIN", "DISPATCHER"]);
  if (response) return response;

  try {
    const body = await req.json();
    const { woId, ...updates } = body;

    if (!woId) {
      return NextResponse.json(
        { error: "Tham số woId là bắt buộc để cập nhật Lệnh sản xuất WO." },
        { status: 400 }
      );
    }

    const updated = await updateWO(woId, updates);
    return NextResponse.json(updated);
  } catch (err) {
    return handleApiError(err, "Cập nhật Lệnh sản xuất WO thất bại.");
  }
}

export async function DELETE(req: NextRequest) {
  const { user, response } = authorize(req, ["ADMIN", "DISPATCHER"]);
  if (response) return response;

  try {
    const { searchParams } = new URL(req.url);
    const woId = searchParams.get("woId");

    if (!woId) {
      return NextResponse.json(
        { error: "Tham số woId là bắt buộc để xóa Lệnh sản xuất WO." },
        { status: 400 }
      );
    }

    await deleteWO(woId);
    return NextResponse.json({ success: true, message: `Đã xóa Lệnh sản xuất WO ${woId} thành công.` });
  } catch (err) {
    return handleApiError(err, "Xóa Lệnh sản xuất WO thất bại.");
  }
}
