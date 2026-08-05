import { NextRequest, NextResponse } from "next/server";
import { listPOs, createPO, updatePO, deletePO, bulkDeletePOs } from "@/lib/po-wo-engine";
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
  const { response } = authorize(req, ["ADMIN", "DISPATCHER"]);
  if (response) return response;

  try {
    // Support both bulk (body: { poIds: string[] }) and single (query: ?poId=xxx)
    const { searchParams } = new URL(req.url);
    const singlePoId = searchParams.get("poId");

    if (singlePoId) {
      // Legacy single-delete (used from row-level delete buttons)
      await deletePO(singlePoId);
      return NextResponse.json({ success: true, message: `Đã xóa đơn hàng PO ${singlePoId} thành công.` });
    }

    // Bulk delete via JSON body
    const body = await req.json().catch(() => ({}));
    const poIds: string[] = Array.isArray(body?.poIds) ? body.poIds : [];

    if (poIds.length === 0) {
      return NextResponse.json(
        { error: "Vui lòng cung cấp poId (query) hoặc poIds[] (body) để xóa đơn hàng PO." },
        { status: 400 }
      );
    }

    const result = await bulkDeletePOs(poIds);

    const message =
      result.rejectedCount === 0
        ? `Đã xóa thành công ${result.deletedCount}/${poIds.length} đơn hàng PO.`
        : `Đã xóa thành công ${result.deletedCount}/${poIds.length} đơn hàng PO. ${result.rejectedCount} mục bị từ chối.`;

    return NextResponse.json({ success: true, message, ...result });
  } catch (err) {
    return handleApiError(err, "Xóa đơn hàng PO thất bại.");
  }
}
