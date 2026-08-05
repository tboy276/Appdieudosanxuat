import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { authorize, handleApiError } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const { response } = authorize(req, ["ADMIN"]);
  if (response) return response;

  try {
    const { data, error } = await supabaseAdmin
      .from("opening_stocks")
      .select(`
        id,
        snapshot_date,
        ton_phoi,
        ton_thanh_pham,
        created_at,
        created_by,
        workshops ( code, name ),
        products ( part_no, name_vi ),
        users ( username )
      `)
      .order("created_at", { ascending: false });

    if (error) {
      throw new Error(`Lỗi PostgreSQL khi tải lịch sử khai báo tồn đầu kỳ: ${error.message}`);
    }

    const mapped = (data || []).map((row: any) => ({
      id: row.id,
      timestamp: row.created_at,
      actor: row.users?.username || "admin",
      wcCode: row.workshops?.code || "",
      wcName: row.workshops?.name || "",
      sku: row.products?.part_no || "",
      productNameVi: row.products?.name_vi || "",
      tonPhoi: row.ton_phoi || 0,
      tonThanhPham: row.ton_thanh_pham || 0,
      snapshotDate: row.snapshot_date,
      note: `Khai báo tồn đầu kỳ ngày ${row.snapshot_date}: Phôi=${row.ton_phoi || 0}, TP=${row.ton_thanh_pham || 0}`,
    }));

    return NextResponse.json(mapped);
  } catch (err) {
    return handleApiError(err, "Không thể tải nhật ký ghi đè tồn kho đầu kỳ.");
  }
}
