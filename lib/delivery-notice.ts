import * as XLSX from "xlsx";
import { formatDateDisplay, getTodayVN } from "@/lib/date-utils";

export interface DeliveryNoticeItem {
  stt?: number;
  poNumber: string;
  sku: string;
  productNameVi?: string;
  orderQty: number;
  shippedQty: number;
  remainingQty: number;
  notes?: string;
}

export interface DeliveryNoticeData {
  shipmentCode: string;
  shipDate: string;
  customerName: string;
  vehicleNo?: string;
  notes?: string;
  createdBy?: string;
  items: DeliveryNoticeItem[];
}

/**
 * Xuất file Excel Thông Báo Giao Hàng (Mẫu chuẩn tạm thời, dễ dàng cập nhật/thay thế sau)
 */
export function exportDeliveryNoticeExcel(notice: DeliveryNoticeData) {
  const wsData: any[][] = [];

  // Header metadata
  wsData.push(["CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM"]);
  wsData.push(["Độc lập - Tự do - Hạnh phúc"]);
  wsData.push([]);
  wsData.push(["THÔNG BÁO GIAO HÀNG / PHIẾU XUẤT KHO"]);
  wsData.push([`Mã phiếu: ${notice.shipmentCode}`, "", `Ngày giao hàng: ${formatDateDisplay(notice.shipDate)}`]);
  wsData.push([`Khách hàng: ${notice.customerName}`, "", `Phương tiện/Biển số: ${notice.vehicleNo || "—"}`]);
  wsData.push([`Người lập: ${notice.createdBy || "—"}`, "", `Ghi chú: ${notice.notes || "—"}`]);
  wsData.push([]);

  // Table header
  wsData.push([
    "STT",
    "Số PO",
    "Mã SKU (Part No)",
    "Tên Sản Phẩm",
    "Số Lượng PO",
    "SL Giao Đợt Này",
    "SL Còn Lại",
    "Ghi Chú",
  ]);

  // Items
  notice.items.forEach((it, idx) => {
    wsData.push([
      idx + 1,
      it.poNumber,
      it.sku,
      it.productNameVi || "",
      it.orderQty,
      it.shippedQty,
      it.remainingQty,
      it.notes || "",
    ]);
  });

  // Summary Row
  const totalShipped = notice.items.reduce((sum, i) => sum + (i.shippedQty || 0), 0);
  const totalOrder = notice.items.reduce((sum, i) => sum + (i.orderQty || 0), 0);
  wsData.push([]);
  wsData.push(["TỔNG CỘNG", "", "", "", totalOrder, totalShipped, "", ""]);
  wsData.push([]);
  wsData.push(["Người Lập Phiếu", "", "Thủ Kho Xuất", "", "Người Nhận Hàng"]);
  wsData.push(["(Ký, ghi rõ họ tên)", "", "(Ký, ghi rõ họ tên)", "", "(Ký, ghi rõ họ tên)"]);

  const worksheet = XLSX.utils.aoa_to_sheet(wsData);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "ThongBaoGiaoHang");
  XLSX.writeFile(workbook, `TB_Giao_Hang_${notice.shipmentCode}.xlsx`);
}

/**
 * Xuất danh mục tổng hợp Lịch Sử Xuất Hàng ra file Excel
 */
export function exportShipmentHistoryExcel(shipments: any[], filenamePrefix: string = "Lich_Su_Xuat_Hang") {
  if (!shipments || shipments.length === 0) return;

  const rows: any[] = [];
  let stt = 1;

  for (const s of shipments) {
    if (s.items && s.items.length > 0) {
      for (const item of s.items) {
        rows.push({
          "STT": stt++,
          "Mã Phiếu": s.shipmentNumber || s.shipmentCode || s.id,
          "Ngày Xuất": formatDateDisplay(s.shipDate),
          "Khách Hàng": s.customerName || "—",
          "Số PO": item.poNumber || "—",
          "Mã SKU": item.sku || "—",
          "Tên Sản Phẩm": item.productNameVi || "—",
          "Số Lượng Xuất": item.shippedQty,
          "Số Lượng PO": item.orderQty || "—",
          "Người Lập": s.createdByName || s.createdBy || "—",
          "Ghi Chú": s.notes || item.notes || "",
        });
      }
    } else {
      rows.push({
        "STT": stt++,
        "Mã Phiếu": s.shipmentNumber || s.shipmentCode || s.id,
        "Ngày Xuất": formatDateDisplay(s.shipDate),
        "Khách Hàng": s.customerName || "—",
        "Số PO": s.poNumber || "—",
        "Mã SKU": s.sku || "—",
        "Tên Sản Phẩm": s.productNameVi || "—",
        "Số Lượng Xuất": s.totalQty || s.shippedQty || 0,
        "Số Lượng PO": s.orderQty || "—",
        "Người Lập": s.createdByName || s.createdBy || "—",
        "Ghi Chú": s.notes || "",
      });
    }
  }

  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "LichSuXuatHang");
  XLSX.writeFile(workbook, `${filenamePrefix}_${getTodayVN()}.xlsx`);
}
