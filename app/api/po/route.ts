import { NextRequest, NextResponse } from "next/server";
import { listPOs, createPO, updatePO, deletePO } from "@/lib/po-wo-engine";
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

export async function PUT(req: NextRequest) {
  const { user, response } = authorize(req, ["ADMIN", "DISPATCHER"]);
  if (response) return response;

  try {
    const body = await req.json();
    const { poId, ...updates } = body;

    if (!poId) {
      return NextResponse.json(
        { error: "Tham số poId là bắt buộc để cập nhật đơn hàng PO." },
        { status: 400 }
      );
    }

    const updated = await updatePO(poId, updates);
    return NextResponse.json(updated);
  } catch (err) {
    return handleApiError(err, "Cập nhật đơn hàng PO thất bại.");
  }
}

export async function DELETE(req: NextRequest) {
  const { user, response } = authorize(req, ["ADMIN", "DISPATCHER"]);
  if (response) return response;

  try {
    const { searchParams } = new URL(req.url);
    const poId = searchParams.get("poId");

    if (!poId) {
      return NextResponse.json(
        { error: "Tham số poId là bắt buộc để xóa đơn hàng PO." },
        { status: 400 }
      );
    }

    await deletePO(poId);
    return NextResponse.json({ success: true, message: `Đã xóa đơn hàng PO ${poId} thành công.` });
  } catch (err) {
    return handleApiError(err, "Xóa đơn hàng PO thất bại.");
  }
}
