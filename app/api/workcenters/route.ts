import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { authorize, handleApiError } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const { response } = authorize(req);
  if (response) return response;

  try {
    const { data: workshops, error } = await supabaseAdmin
      .from("workshops")
      .select("id, code, name, is_ktp, created_at")
      .order("code");

    if (error) {
      throw new Error(`Lỗi tải danh sách xưởng từ PostgreSQL: ${error.message}`);
    }

    // Map DB fields to UI WorkCenter interface
    const mapped = (workshops || []).map((w) => ({
      code: w.code,
      name: w.name,
      isKtp: w.is_ktp,
      isFinalStep: w.is_ktp,
    }));

    return NextResponse.json(mapped);
  } catch (err) {
    return handleApiError(err, "Không thể tải danh sách xưởng sản xuất.");
  }
}
