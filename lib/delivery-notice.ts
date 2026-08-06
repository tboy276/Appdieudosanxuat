import * as XLSX from "xlsx";
import { formatDateDisplay, getTodayVN } from "@/lib/date-utils";

export interface DeliveryNoticeItem {
  stt?: number;
  poNumber: string;
  sku: string;
  productNameVi?: string;
  unit?: string;
  orderQty?: number;
  shippedQty: number;
  remainingQty?: number;
  location?: string;
  notes?: string;
}

export interface DeliveryNoticeData {
  shipmentCode?: string;
  shipDate: string; // YYYY-MM-DD or date string
  customerName: string;
  customerAddress?: string;
  customerPhone?: string;
  deliveryTime?: string;
  poNumbers?: string[];
  vehicleNo?: string;
  notes?: string;
  creatorName?: string;
  creatorTitle?: string;
  createdBy?: string;
  items: DeliveryNoticeItem[];
}

/**
 * Format Vietnamese date string: "Ngày DD tháng MM năm YYYY"
 */
export function formatFullVNDate(dateStr?: string): { day: string; month: string; year: string; fullText: string } {
  if (!dateStr) {
    const today = new Date();
    const d = String(today.getDate()).padStart(2, "0");
    const m = String(today.getMonth() + 1).padStart(2, "0");
    const y = String(today.getFullYear());
    return { day: d, month: m, year: y, fullText: `Ngày ${d} tháng ${m} năm ${y}` };
  }

  try {
    const dObj = new Date(dateStr);
    if (isNaN(dObj.getTime())) {
      return { day: "......", month: "......", year: "2026", fullText: "Ngày ...... tháng ...... năm 2026" };
    }
    const d = String(dObj.getDate()).padStart(2, "0");
    const m = String(dObj.getMonth() + 1).padStart(2, "0");
    const y = String(dObj.getFullYear());
    return { day: d, month: m, year: y, fullText: `Ngày ${d} tháng ${m} năm ${y}` };
  } catch {
    return { day: "......", month: "......", year: "2026", fullText: "Ngày ...... tháng ...... năm 2026" };
  }
}

/**
 * Xuất file Excel Thông Báo Giao Hàng theo đúng chuẩn biểu mẫu DISOCO BM/05-000-005
 */
export function exportDeliveryNoticeExcel(notice: DeliveryNoticeData) {
  const wsData: any[][] = [];
  const dateInfo = formatFullVNDate(notice.shipDate);
  const poListStr = (notice.poNumbers && notice.poNumbers.length > 0)
    ? notice.poNumbers.join(", ")
    : Array.from(new Set(notice.items.map((i) => i.poNumber).filter(Boolean))).join(", ");

  // 1. Header
  wsData.push(["DISOCO", "", "", "", "", "", ""]);
  wsData.push(["", "", "THÔNG BÁO GIAO HÀNG", "", "", "", ""]);
  wsData.push(["", "", "", "", "", `${dateInfo.fullText}`, ""]);
  wsData.push(["Số:....../.......", "", "", "", "", "", ""]);
  wsData.push([]);

  // 2. Kính gửi & Thông tin chung
  wsData.push(["Kính gửi: Phòng Thị trường & Bán hàng", "", "", "", "", "", ""]);
  wsData.push([`- Căn cứ hợp đồng kinh tế/PO số: ${poListStr || "........................................................"}`, "", "", "", "", "", ""]);
  wsData.push([`- Tên khách hàng: ${notice.customerName || "........................................................"}`, "", "", "", "", "", ""]);
  wsData.push([`- Địa chỉ: ${notice.customerAddress || "................................................................................"}`, "", "", "", "", "", ""]);
  wsData.push([`- Điện thoại: ${notice.customerPhone || "........................................................"}`, "", "", "", "", "", ""]);
  wsData.push(["- Phòng SX đề nghị giao hàng theo danh mục, số lượng sau:", "", "", "", "", "", ""]);
  wsData.push(["1. Danh mục hàng hoá, số lượng giao hàng:", "", "", "", "", "", ""]);

  // 3. Table Header
  wsData.push([
    "STT",
    "Tên gọi và ký hiệu",
    "Số PO",
    "Đơn vị tính",
    "Số lượng",
    "Nơi lấy hàng",
    "Ghi chú",
  ]);

  // 4. Data Rows
  const items = notice.items || [];
  items.forEach((it, idx) => {
    const prodDisplay = it.productNameVi
      ? (it.sku ? `${it.productNameVi} (${it.sku})` : it.productNameVi)
      : it.sku;

    wsData.push([
      idx + 1,
      prodDisplay,
      it.poNumber || "",
      it.unit || "Cái",
      it.shippedQty || 0,
      it.location || "Kho TP",
      it.notes || "",
    ]);
  });

  // Pad to at least 4 rows if needed
  const minRows = 4;
  for (let i = items.length; i < minRows; i++) {
    wsData.push([i + 1, "", "", "", "", "", ""]);
  }

  // 5. Section 2 & Delivery time
  wsData.push([]);
  wsData.push([`2. Thời gian giao hàng: ${notice.deliveryTime || "......................................................................."}`, "", "", "", "", "", ""]);
  wsData.push([]);

  // 6. Signatures
  wsData.push(["PHÒNG SẢN XUẤT", "", "", "", "ĐƠN VỊ NHẬN THÔNG BÁO", "", ""]);
  wsData.push([]);
  wsData.push([]);
  wsData.push([`Họ tên: ${notice.creatorName || "Đỗ Như Ba"}`, "", "", "", "Họ tên:.................................", "", ""]);
  wsData.push([`Chức danh : ${notice.creatorTitle || "P.PSX"}`, "", "", "", "Chức danh:……………….", "", ""]);
  wsData.push([]);

  // 7. Footer Quality Management Standard
  wsData.push(["BM/05-000-005", "Ban hành ngày 01/7/2024", "", "", "Trang số: 1/1", "", ""]);
  wsData.push(["Ban hành lần: 1", "", "", "", "", "", ""]);

  const worksheet = XLSX.utils.aoa_to_sheet(wsData);

  // Set column widths
  worksheet["!cols"] = [
    { wch: 6 },  // STT
    { wch: 36 }, // Tên gọi
    { wch: 16 }, // Số PO
    { wch: 12 }, // ĐVT
    { wch: 12 }, // SL
    { wch: 14 }, // Nơi lấy hàng
    { wch: 20 }, // Ghi chú
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "ThongBaoGiaoHang");
  const fileName = `TB_Giao_Hang_${notice.shipmentCode || Date.now()}.xlsx`;
  XLSX.writeFile(workbook, fileName);
}

/**
 * Xuất danh mục tổng hợp Lịch Sử Xuất Hàng ra file Excel (Bảng thô phẳng phục vụ đối soát)
 */
export function exportShipmentHistoryExcel(shipments: any[], filenamePrefix: string = "Danh_Muc_PO_Da_Xuat") {
  if (!shipments || shipments.length === 0) return;

  const rows: any[] = [];
  let stt = 1;

  for (const s of shipments) {
    const rawNotes = s.notes || s.note || "";
    let extraMeta: any = {};
    try {
      if (typeof rawNotes === "string" && rawNotes.startsWith("{")) {
        extraMeta = JSON.parse(rawNotes);
      }
    } catch {
      // ignore
    }

    const creator = extraMeta.creatorName || s.createdByName || s.createdBy || "—";
    const creatorTitle = extraMeta.creatorTitle || "—";
    const deliveryTime = extraMeta.deliveryTime || "—";
    const generalNote = extraMeta.generalNote || (typeof rawNotes === "string" && !rawNotes.startsWith("{") ? rawNotes : "");

    if (s.items && s.items.length > 0) {
      for (const item of s.items) {
        const itemNote = item.notes || extraMeta.itemNotes?.[item.poLineId] || generalNote || "";
        rows.push({
          "STT": stt++,
          "Mã Phiếu": s.shipmentNumber || s.shipmentCode || s.id,
          "Ngày Tạo Phiếu": formatDateDisplay(s.shippedAt || s.shipDate),
          "Khách Hàng": s.customerName || "—",
          "Số PO": item.poNumber || s.poNumber || "—",
          "Mã SKU": item.sku || s.sku || "—",
          "Tên Sản Phẩm": item.productNameVi || s.productNameVi || "—",
          "Đơn Vị Tính": item.unit || "Cái",
          "Số Lượng Xuất (pcs)": item.shippedQty || 0,
          "Nơi Lấy Hàng": "Kho TP",
          "Người Lập Phiếu": creator,
          "Chức Danh": creatorTitle,
          "Thời Gian Giao Hàng": deliveryTime,
          "Ghi Chú": itemNote,
        });
      }
    } else {
      rows.push({
        "STT": stt++,
        "Mã Phiếu": s.shipmentNumber || s.shipmentCode || s.id,
        "Ngày Tạo Phiếu": formatDateDisplay(s.shippedAt || s.shipDate),
        "Khách Hàng": s.customerName || "—",
        "Số PO": s.poNumber || "—",
        "Mã SKU": s.sku || "—",
        "Tên Sản Phẩm": s.productNameVi || "—",
        "Đơn Vị Tính": "Cái",
        "Số Lượng Xuất (pcs)": s.totalQty || s.shippedQty || 0,
        "Nơi Lấy Hàng": "Kho TP",
        "Người Lập Phiếu": creator,
        "Chức Danh": creatorTitle,
        "Thời Gian Giao Hàng": deliveryTime,
        "Ghi Chú": generalNote,
      });
    }
  }

  const worksheet = XLSX.utils.json_to_sheet(rows);
  worksheet["!cols"] = [
    { wch: 6 },
    { wch: 22 },
    { wch: 14 },
    { wch: 24 },
    { wch: 16 },
    { wch: 22 },
    { wch: 30 },
    { wch: 10 },
    { wch: 18 },
    { wch: 14 },
    { wch: 18 },
    { wch: 14 },
    { wch: 20 },
    { wch: 25 },
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "DanhSachPOXuat");
  XLSX.writeFile(workbook, `${filenamePrefix}_${getTodayVN()}.xlsx`);
}
