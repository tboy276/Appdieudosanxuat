import { NextRequest, NextResponse } from "next/server";
import { authorize, handleApiError } from "@/lib/auth";
import { reverseTransaction } from "@/lib/inventory-postgres";

export async function POST(req: NextRequest) {
  // Enforce ADMIN role check at API layer
  const { user, response } = authorize(req, ["ADMIN"]);
  if (response) return response;

  try {
    const body = await req.json();
    const { originalTxId, qtyOk, qtyNg, reason } = body;

    if (!originalTxId) {
      return NextResponse.json(
        { error: "ID giao dịch gốc (originalTxId) là bắt buộc." },
        { status: 400 }
      );
    }

    if (!reason || !String(reason).trim()) {
      return NextResponse.json(
        { error: "Lý do đảo bút toán (reason) là bắt buộc." },
        { status: 400 }
      );
    }

    const result = await reverseTransaction(
      originalTxId,
      Number(qtyOk || 0),
      Number(qtyNg || 0),
      String(reason).trim(),
      user!.username,
      user!.role
    );

    return NextResponse.json(result);
  } catch (err) {
    return handleApiError(err, "Đảo bút toán thất bại.");
  }
}
