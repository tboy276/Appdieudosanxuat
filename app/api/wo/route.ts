import { NextRequest, NextResponse } from "next/server";
import { listWOs, createWOsForPO, createBulkWOsForPOs, updateWO, deleteWO, bulkDeleteWOs } from "@/lib/po-wo-engine";
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
    const { poId, poIds, isBulk, customPlannedQtys, customDeadlines } = body;

    if (isBulk || Array.isArray(poIds)) {
      const targetPoIds = Array.isArray(poIds) ? poIds : poId ? [poId] : [];
      if (targetPoIds.length === 0) {
        return NextResponse.json(
          { error: "Vui lòng chọn ít nhất 1 PO để tạo WO hàng loạt." },
          { status: 400 }
        );
      }

      const result = await createBulkWOsForPOs(targetPoIds, user!.username);
      return NextResponse.json({
        success: true,
        message: `Đã tạo ${result.createdCount} WO mới từ ${result.totalPoCount} PO đã chọn (${result.skippedCount} WO bị bỏ qua do đã tồn tại từ trước).`,
        ...result,
      });
    }

    if (!poId) {
      return NextResponse.json(
        { error: "Mã đơn hàng poId là bắt buộc để lập WO." },
        { status: 400 }
      );
    }

    const { createdWos, skippedCount } = await createWOsForPO(poId, user!.username, customPlannedQtys, customDeadlines);
    return NextResponse.json({
      success: true,
      message: createdWos.length > 0
        ? `Đã khởi tạo ${createdWos.length} Lệnh sản xuất (WO) thành công.`
        : `Tất cả xưởng cho PO này đã có WO (${skippedCount} WO bị bỏ qua).`,
      createdWos,
      skippedCount,
    });
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
  const { response } = authorize(req, ["ADMIN", "DISPATCHER"]);
  if (response) return response;

  try {
    // Support both bulk (body: { woIds: string[] }) and single (query: ?woId=xxx)
    const { searchParams } = new URL(req.url);
    const singleWoId = searchParams.get("woId");

    if (singleWoId) {
      // Legacy single-delete (used from row-level delete buttons)
      await deleteWO(singleWoId);
      return NextResponse.json({ success: true, message: `Đã xóa Lệnh sản xuất WO ${singleWoId} thành công.` });
    }

    // Bulk delete via JSON body
    const body = await req.json().catch(() => ({}));
    const woIds: string[] = Array.isArray(body?.woIds) ? body.woIds : [];

    if (woIds.length === 0) {
      return NextResponse.json(
        { error: "Vui lòng cung cấp woId (query) hoặc woIds[] (body) để xóa Lệnh sản xuất WO." },
        { status: 400 }
      );
    }

    const result = await bulkDeleteWOs(woIds);

    const message =
      result.rejectedCount === 0
        ? `Đã xóa thành công ${result.deletedCount}/${woIds.length} Lệnh sản xuất WO.`
        : `Đã xóa thành công ${result.deletedCount}/${woIds.length} Lệnh sản xuất WO. ${result.rejectedCount} mục bị từ chối.`;

    return NextResponse.json({ success: true, message, ...result });
  } catch (err) {
    return handleApiError(err, "Xóa Lệnh sản xuất WO thất bại.");
  }
}
