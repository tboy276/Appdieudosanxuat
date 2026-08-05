import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { listPOs, evaluatePODeliveryStatus } from "@/lib/po-postgres";
import { authorize, handleApiError } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const { response } = authorize(req);
  if (response) return response;

  try {
    const { searchParams } = new URL(req.url);
    const customerName = searchParams.get("customerName") || undefined;
    const status = searchParams.get("status") || undefined;
    const search = searchParams.get("search") || undefined;

    const pos = await listPOs({ customerName, status, search });

    const exportRows = pos.map((po, index) => {
      const deliveryAssessment = evaluatePODeliveryStatus(po.requestedDate, po.status);
      return {
        "STT": index + 1,
        "Mã PO": po.poNumber || po.poId,
        "Khách Hàng": po.customerName,
        "Part No (SKU)": po.sku,
        "Tên Sản Phẩm": po.productNameVi,
        "Số Lượng Đặt": po.qty,
        "Hạn Giao Yêu Cầu": po.requestedDate,
        "Đánh Giá Hạn Giao": deliveryAssessment,
        "Trạng Thái PO": po.status,
        "Ngày Tạo": po.createdAt ? po.createdAt.split("T")[0] : "",
      };
    });

    const worksheet = XLSX.utils.json_to_sheet(exportRows);

    // Set column widths
    worksheet["!cols"] = [
      { wch: 6 },  // STT
      { wch: 22 }, // Mã PO
      { wch: 25 }, // Khách Hàng
      { wch: 20 }, // Part No (SKU)
      { wch: 30 }, // Tên Sản Phẩm
      { wch: 15 }, // Số Lượng Đặt
      { wch: 18 }, // Hạn Giao Yêu Cầu
      { wch: 22 }, // Đánh Giá Hạn Giao
      { wch: 18 }, // Trạng Thái PO
      { wch: 15 }, // Ngày Tạo
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Danh Sách PO");

    const excelBuffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

    return new NextResponse(excelBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="Danh_sach_don_hang_PO_${new Date().toISOString().split("T")[0]}.xlsx"`,
      },
    });
  } catch (err) {
    return handleApiError(err, "Xuất Excel danh sách đơn hàng PO thất bại.");
  }
}
