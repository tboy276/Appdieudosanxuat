import { NextRequest, NextResponse } from "next/server";
import { authorize, handleApiError } from "@/lib/auth";
import { getTransactionHistory, reverseTransaction } from "@/lib/inventory-postgres";

export async function GET(req: NextRequest) {
  const { response } = authorize(req);
  if (response) return response;

  try {
    const { searchParams } = new URL(req.url);
    const filterType = searchParams.get("type");
    const filterWc = searchParams.get("wcCode");
    const filterSku = searchParams.get("sku");

    let logs = await getTransactionHistory({ sku: filterSku || undefined });

    if (filterType && filterType !== "ALL") {
      logs = logs.filter((l) => l.transactionType === filterType);
    }
    if (filterWc && filterWc !== "ALL") {
      logs = logs.filter((l) => l.fromWorkshopCode === filterWc || l.toWorkshopCode === filterWc);
    }

    return NextResponse.json(logs);
  } catch (err) {
    return handleApiError(err, "Không thể tải lịch sử giao dịch.");
  }
}

export async function PUT(req: NextRequest) {
  const { user, response } = authorize(req, ["ADMIN"]);
  if (response) return response;

  try {
    const body = await req.json();
    const { txId, newQty, reason } = body;

    if (!txId || !newQty || Number(newQty) <= 0) {
      return NextResponse.json(
        { error: "Mã giao dịch (txId) và số lượng đảo là bắt buộc." },
        { status: 400 }
      );
    }

    const res = await reverseTransaction(
      txId,
      Number(newQty),
      0,
      reason || "Đảo bút toán từ giao diện Lịch sử",
      user!.username,
      user!.role
    );

    return NextResponse.json({
      success: true,
      message: res.message,
    });
  } catch (err) {
    return handleApiError(err, "Đảo bút toán thất bại.");
  }
}
