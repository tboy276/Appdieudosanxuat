import { NextRequest, NextResponse } from "next/server";
import { closeWO } from "@/lib/po-wo-engine";
import { authorize, handleApiError } from "@/lib/auth";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { user, response } = authorize(req, ["ADMIN", "DISPATCHER"]);
  if (response) return response;

  try {
    const woId = params.id;
    if (!woId) {
      return NextResponse.json({ error: "Mã WO là bắt buộc." }, { status: 400 });
    }

    const wo = await closeWO(woId, user!.username);
    return NextResponse.json(wo);
  } catch (err) {
    return handleApiError(err, "Đóng WO thất bại.");
  }
}
