"use client";

import { useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import * as XLSX from "xlsx";
import {
  Truck,
  History,
  CheckCircle2,
  AlertTriangle,
  CalendarDays,
  Search,
  RefreshCw,
  X,
  Package,
  Layers,
  ArrowRight,
  Printer,
  Download,
  FileSpreadsheet,
  Building2,
} from "lucide-react";
import AccordionList from "@/components/AccordionList";
import { WO, PO, ShipmentRecord } from "@/lib/po-wo-engine";
import { Product } from "@/lib/types";

import { LABELS } from "@/lib/labels";

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export default function ShipmentPage() {
  const { mutate } = useSWRConfig();
  const [activeTab, setActiveTab] = useState<"create" | "history">("create");

  // Fetch Data
  const { data: wosData, mutate: mutateWOs } = useSWR<WO[]>("/api/wo", fetcher);
  const { data: posData, mutate: mutatePOs } = useSWR<PO[]>("/api/po", fetcher);
  const { data: shipmentsData, mutate: mutateShipments } = useSWR<ShipmentRecord[]>("/api/shipment", fetcher);
  const { data: productsData } = useSWR<Product[]>("/api/products", fetcher);
  const { data: xntData } = useSWR<any[]>("/api/xnt", fetcher);

  const wos = Array.isArray(wosData) ? wosData : [];
  const pos = Array.isArray(posData) ? posData : [];
  const shipments = Array.isArray(shipmentsData) ? shipmentsData : [];
  const products = Array.isArray(productsData) ? productsData : [];
  const xnt = Array.isArray(xntData) ? xntData : [];

  // Identify SKUs that have stock at KTP (either Phôi or Thành Phẩm > 0)
  const skusWithKtpStock = new Set<string>(
    xnt
      .filter(
        (item) =>
          item.wcCode === "KTP" &&
          ((item.closing?.tonPhoi || 0) > 0 || (item.closing?.tonThanhPham || 0) > 0)
      )
      .map((item) => item.sku)
  );

  // Print Modal State
  const [printModalShipment, setPrintModalShipment] = useState<ShipmentRecord | null>(null);

  // Create Shipment Form State
  const [selectedWoIds, setSelectedWoIds] = useState<string[]>([]);
  const [qtyMap, setQtyMap] = useState<Record<string, number>>({});
  const [shippedAtDate, setShippedAtDate] = useState<string>(
    new Date().toISOString().split("T")[0]
  );
  const [vehicleNo, setVehicleNo] = useState("");
  const [shipmentNotes, setShipmentNotes] = useState("");

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [successToast, setSuccessToast] = useState("");

  // Export Excel Delivery Note Function
  const handleExportExcelShipment = (singleShipment?: ShipmentRecord) => {
    const listToExport = singleShipment ? [singleShipment] : shipments;

    if (listToExport.length === 0) {
      alert("Không có dữ liệu phiếu xuất hàng nào để xuất Excel.");
      return;
    }

    const exportRows: any[] = [];

    listToExport.forEach((shipment) => {
      if (!shipment.woIds || shipment.woIds.length === 0) return;

      shipment.woIds.forEach((woId, idx) => {
        const wo = wos.find((w) => w.woId === woId);
        const po = pos.find((p) => p.poId === wo?.poId);
        const prod = products.find((p) => p.sku === wo?.sku);
        const currentQty = shipment.qtyByWoId?.[woId] || 0;
        const totalShipped = wo?.shippedQty || currentQty;
        const targetQty = po?.qty || wo?.targetQty || 0;

        exportRows.push({
          "Số Phiếu Xuất": shipment.shipmentId,
          "Ngày Xuất": shipment.shippedAt?.split("T")[0] || "-",
          "Khách Hàng": po?.customerName || "-",
          "Số PO": po?.poNumber || wo?.poId || "-",
          "Số Xe / Mã Vận Đơn": shipment.meta?.vehicleNo || "-",
          STT: idx + 1,
          [LABELS.skuCode]: wo?.sku || "-",
          "Tên Sản Phẩm": prod?.nameVi || po?.productNameVi || wo?.sku || "-",
          "Mã WO": woId,
          "Đơn Vị": "Cái",
          "Số Lượng Đặt (PO)": targetQty,
          "Số Lượng Giao Đợt Này": currentQty,
          "Số Lượng Tích Lũy Đã Giao": totalShipped,
          "Số Lượng Còn Nợ Lại": Math.max(0, targetQty - totalShipped),
          "Ghi Chú": shipment.meta?.notes || "-",
          "Người Lập": shipment.actor || "-",
        });
      });
    });

    const ws = XLSX.utils.json_to_sheet(exportRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Phieu_Giao_Hang");

    const fileName = singleShipment
      ? `Phieu_Giao_Hang_${singleShipment.shipmentId}.xlsx`
      : `Bao_Cao_Xuat_Hang_${new Date().toISOString().split("T")[0]}.xlsx`;

    XLSX.writeFile(wb, fileName);
  };

  // WOs ready to ship: status === READY_TO_SHIP OR has stock at KTP
  const readyWOs = wos.filter(
    (wo) =>
      wo.status !== "SHIPPED" &&
      (wo.status === "READY_TO_SHIP" || skusWithKtpStock.has(wo.sku))
  );

  // Group WOs by PO
  const groupedWOsByPO = readyWOs.reduce((acc, wo) => {
    const po = pos.find((p) => p.poId === wo.poId);
    const key = po ? `${po.poNumber} - ${po.customerName}` : wo.poId;
    if (!acc[key]) acc[key] = [];
    acc[key].push(wo);
    return acc;
  }, {} as Record<string, WO[]>);

  const handleCheckboxToggle = (wo: WO) => {
    const woId = wo.woId;
    const remaining = Math.max(0, wo.targetQty - wo.shippedQty);

    if (selectedWoIds.includes(woId)) {
      setSelectedWoIds(selectedWoIds.filter((id) => id !== woId));
      const nextMap = { ...qtyMap };
      delete nextMap[woId];
      setQtyMap(nextMap);
    } else {
      setSelectedWoIds([...selectedWoIds, woId]);
      setQtyMap({
        ...qtyMap,
        [woId]: remaining,
      });
    }
  };

  const handleQtyChange = (woId: string, val: string) => {
    const num = Math.max(0, Number(val) || 0);
    setQtyMap({
      ...qtyMap,
      [woId]: num,
    });
  };

  const handleSubmitShipment = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");
    setSuccessToast("");

    if (selectedWoIds.length === 0) {
      setErrorMsg("Vui lòng chọn ít nhất 1 Lệnh sản xuất (WO) để xuất hàng.");
      return;
    }

    // Validate quantities > 0
    for (const id of selectedWoIds) {
      if (!qtyMap[id] || qtyMap[id] <= 0) {
        setErrorMsg(`Số lượng xuất hàng cho WO ${id} phải lớn hơn 0.`);
        return;
      }
    }

    setIsSubmitting(true);

    try {
      const res = await fetch("/api/shipment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          woIds: selectedWoIds,
          qtyByWoId: qtyMap,
          shipmentMeta: {
            shippedAt: shippedAtDate,
            vehicleNo: vehicleNo.trim(),
            notes: shipmentNotes.trim(),
          },
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || "Ghi nhận xuất hàng thất bại.");
        setIsSubmitting(false);
        return;
      }

      setSuccessToast(`Đã xuất hàng thành công chuyến ${data.shipmentId}!`);
      setSelectedWoIds([]);
      setQtyMap({});
      setVehicleNo("");
      setShipmentNotes("");

      // Mutate SWR global cache keys across WO, PO, Shipment, and XNT
      await Promise.all([
        mutate("/api/shipment"),
        mutate("/api/wo"),
        mutate("/api/po"),
        mutate("/api/xnt"),
        mutateWOs(),
        mutatePOs(),
        mutateShipments(),
      ]);
    } catch {
      setErrorMsg("Không thể kết nối tới máy chủ.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Segmented Control Header */}
      <div className="flex items-center justify-between p-2 rounded bg-canvas border border-border">
        <div className="flex items-center gap-1 p-1 bg-subtle rounded border border-border w-full sm:w-auto">
          <button
            onClick={() => setActiveTab("create")}
            className={`flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-1.5 rounded text-xs font-medium transition-all ${
              activeTab === "create"
                ? "bg-canvas text-txt-primary shadow-sm border border-border"
                : "text-txt-secondary hover:text-txt-primary"
            }`}
          >
            <Truck className="w-3.5 h-3.5" />
            <span>1. Lập Chuyến Xuất Hàng ({readyWOs.length} WO sẵn sàng)</span>
          </button>

          <button
            onClick={() => setActiveTab("history")}
            className={`flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-1.5 rounded text-xs font-medium transition-all ${
              activeTab === "history"
                ? "bg-canvas text-txt-primary shadow-sm border border-border"
                : "text-txt-secondary hover:text-txt-primary"
            }`}
          >
            <History className="w-3.5 h-3.5" />
            <span>2. Lịch Sử Xuất Hàng ({shipments.length})</span>
          </button>
        </div>
      </div>

      {/* Success Toast */}
      {successToast && (
        <div className="p-3 rounded bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{successToast}</span>
          </div>
          <button onClick={() => setSuccessToast("")} className="text-emerald-700 hover:text-emerald-900">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* TAB 1: CREATE SHIPMENT */}
      {activeTab === "create" && (
        <div className="space-y-6">
          {errorMsg && (
            <div className="p-3 rounded bg-amber-50 border border-amber-200 text-warning text-xs flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          <form onSubmit={handleSubmitShipment} className="space-y-6">
            {/* Shipment Metadata Card */}
            <div className="p-4 bg-canvas border border-border rounded space-y-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-txt-secondary">
                Thông Tin Chuyến Xuất Hàng
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <div className="space-y-1">
                  <label className="font-medium text-txt-secondary flex items-center gap-1">
                    <CalendarDays className="w-3.5 h-3.5" />
                    <span>Ngày Xuất Hàng (*):</span>
                  </label>
                  <input
                    type="date"
                    required
                    value={shippedAtDate}
                    onChange={(e) => setShippedAtDate(e.target.value)}
                    className="w-full px-3 py-1.5 bg-canvas border border-border rounded text-txt-primary focus:outline-none focus:border-accent cursor-pointer"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-medium text-txt-secondary">Số Xe / Mã Vận Đơn:</label>
                  <input
                    type="text"
                    placeholder="VD: 29C-123.45 / VĐ-0098"
                    value={vehicleNo}
                    onChange={(e) => setVehicleNo(e.target.value)}
                    className="w-full px-3 py-1.5 bg-canvas border border-border rounded text-txt-primary font-mono focus:outline-none focus:border-accent"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-medium text-txt-secondary">Ghi Chú Chuyến Hàng:</label>
                  <input
                    type="text"
                    placeholder="VD: Giao chuyến sáng đợt 1..."
                    value={shipmentNotes}
                    onChange={(e) => setShipmentNotes(e.target.value)}
                    className="w-full px-3 py-1.5 bg-canvas border border-border rounded text-txt-primary focus:outline-none focus:border-accent"
                  />
                </div>
              </div>
            </div>

            {/* List of READY_TO_SHIP WOs grouped by PO */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-txt-secondary">
                  Chọn Lệnh Sản Xuất Sẵn Sàng Xuất Hàng (READY_TO_SHIP)
                </h3>
                <span className="text-xs text-txt-secondary">
                  Đã chọn: <strong className="text-txt-primary">{selectedWoIds.length}</strong> WO
                </span>
              </div>

              {readyWOs.length === 0 ? (
                <div className="p-8 text-center text-xs text-txt-secondary border border-border rounded bg-canvas">
                  Hiện chưa có Lệnh sản xuất nào ở trạng thái READY_TO_SHIP.
                </div>
              ) : (
                Object.entries(groupedWOsByPO).map(([poGroupTitle, woList]) => (
                  <div key={poGroupTitle} className="border border-border rounded bg-canvas overflow-hidden">
                    {/* Section Header */}
                    <div className="px-4 py-2 bg-subtle border-b border-border text-xs font-semibold text-txt-primary flex items-center justify-between">
                      <span>Đơn hàng: {poGroupTitle}</span>
                      <span className="text-[11px] text-txt-secondary">{woList.length} WO</span>
                    </div>

                    {/* WO Rows */}
                    <div className="divide-y divide-border">
                      {woList.map((wo) => {
                        const isChecked = selectedWoIds.includes(wo.woId);
                        const remainingQty = Math.max(0, wo.targetQty - wo.shippedQty);

                        return (
                          <div
                            key={wo.woId}
                            className={`p-4 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
                              isChecked ? "bg-subtle border-l-2 border-l-accent" : "hover:bg-subtle"
                            }`}
                          >
                            <div className="flex items-start gap-3">
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => handleCheckboxToggle(wo)}
                                className="mt-1 rounded border-border cursor-pointer"
                              />
                              <div className="space-y-1 text-xs">
                                <div className="flex items-center gap-2">
                                  <span className="font-mono font-bold text-txt-primary">{wo.woId}</span>
                                  <span className="font-mono text-txt-secondary">SKU: {wo.sku}</span>
                                </div>
                                <p className="text-txt-secondary text-[11px]">
                                  Mục tiêu: {wo.targetQty} pcs | Đã xuất lũy kế:{" "}
                                  <strong className="text-txt-primary">{wo.shippedQty} pcs</strong> | Còn lại:{" "}
                                  <strong className="text-emerald-600">{remainingQty} pcs</strong>
                                </p>
                              </div>
                            </div>

                            {/* Quantity Input for Checked WO */}
                            {isChecked && (
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-medium text-txt-secondary">Số lượng xuất đợt này:</span>
                                <input
                                  type="number"
                                  min="1"
                                  max={remainingQty}
                                  required
                                  value={qtyMap[wo.woId] || ""}
                                  onChange={(e) => handleQtyChange(wo.woId, e.target.value)}
                                  className="w-24 px-2.5 py-1 text-xs font-mono font-bold bg-canvas border border-border rounded text-txt-primary focus:outline-none focus:border-accent text-right"
                                />
                                <span className="text-xs text-txt-secondary">pcs</span>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Action Footer */}
            <div className="flex items-center justify-end">
              <button
                type="submit"
                disabled={isSubmitting || selectedWoIds.length === 0}
                className="inline-flex items-center gap-2 py-2.5 px-6 rounded bg-accent text-white text-xs font-medium hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
              >
                {isSubmitting ? (
                  "Đang xử lý..."
                ) : (
                  <>
                    <span>Xác Nhận Xuất Hàng ({selectedWoIds.length} WO)</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* TAB 2: SHIPMENT HISTORY */}
      {activeTab === "history" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between p-3 rounded bg-canvas border border-border">
            <span className="text-xs font-semibold text-txt-primary">
              Tổng số chuyến xuất hàng: <strong>{shipments.length}</strong> chuyến
            </span>

            <button
              onClick={() => handleExportExcelShipment()}
              className="p-2 rounded bg-subtle border border-border hover:bg-border text-txt-primary transition-colors shrink-0"
              title="Xuất Excel báo cáo toàn bộ xuất hàng"
            >
              <Download className="w-4 h-4 text-blue-600" />
            </button>
          </div>

          <AccordionList<ShipmentRecord>
            items={shipments}
            getItemKey={(s) => s.shipmentId}
            emptyMessage="Chưa có lịch sử chuyến xuất hàng nào."
            renderHeader={(shipment) => (
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-3">
                  <span className="font-mono font-bold text-txt-primary">{shipment.shipmentId}</span>
                  <span className="text-txt-secondary">
                    Ngày xuất: <strong className="text-txt-primary">{shipment.shippedAt?.split("T")[0]}</strong>
                  </span>
                  <span className="text-txt-secondary">Người xuất: {shipment.actor}</span>
                </div>

                <div className="flex items-center gap-3">
                  <span className="text-txt-secondary font-mono">{shipment.woIds?.length || 0} Lệnh WO</span>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleExportExcelShipment(shipment);
                    }}
                    className="p-1 rounded hover:bg-subtle text-blue-600"
                    title="Xuất Excel Phiếu Giao Hàng này"
                  >
                    <FileSpreadsheet className="w-4 h-4" />
                  </button>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setPrintModalShipment(shipment);
                    }}
                    className="p-1 rounded hover:bg-subtle text-accent"
                    title="In PDF / Xem Phiếu Giao Hàng (Mẫu A4 3 chữ ký)"
                  >
                    <Printer className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
            renderDetail={(shipment) => (
              <div className="space-y-4 text-xs">
                {shipment.meta && (
                  <div className="grid grid-cols-2 gap-4 p-3 rounded bg-subtle border border-border">
                    <div>
                      <p className="text-txt-secondary">Số Xe / Mã Vận Đơn:</p>
                      <p className="font-mono font-semibold text-txt-primary">{shipment.meta.vehicleNo || "N/A"}</p>
                    </div>
                    <div>
                      <p className="text-txt-secondary">Ghi Chú:</p>
                      <p className="text-txt-primary">{shipment.meta.notes || "N/A"}</p>
                    </div>
                  </div>
                )}

                <div className="flex justify-end gap-1.5">
                  <button
                    onClick={() => handleExportExcelShipment(shipment)}
                    className="p-2 rounded bg-subtle border border-border hover:bg-border text-txt-primary transition-colors shrink-0"
                    title="Xuất Excel phiếu giao hàng này"
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5 text-blue-600" />
                  </button>

                  <button
                    onClick={() => setPrintModalShipment(shipment)}
                    className="p-2 rounded bg-accent text-white hover:opacity-90 transition-opacity shrink-0"
                    title="In PDF / Xem phiếu giao hàng (Mẫu A4 3 chữ ký)"
                  >
                    <Printer className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="border border-border rounded bg-canvas overflow-x-auto">
                  <table className="w-full text-left text-xs tabular-nums border-collapse">
                    <thead>
                      <tr className="bg-subtle border-b border-border text-txt-secondary text-[11px] font-semibold uppercase">
                        <th className="py-2.5 px-4">Mã WO</th>
                        <th className="py-2.5 px-4 text-right">Số Lượng Xuất</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {shipment.woIds?.map((woId) => (
                        <tr key={woId} className="hover:bg-subtle">
                          <td className="py-2 px-4 font-mono font-bold text-txt-primary">{woId}</td>
                          <td className="py-2 px-4 text-right font-mono font-bold text-emerald-600">
                            +{shipment.qtyByWoId?.[woId] || 0} pcs
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          />
        </div>
      )}

      {/* Printable Delivery Note Modal Overlay */}
      {printModalShipment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto print:p-0 print:bg-white print:static">
          <div className="bg-white border border-border rounded-lg shadow-2xl max-w-3xl w-full p-8 space-y-6 text-black print:border-none print:shadow-none print:max-w-none print:p-0">
            {/* Modal Actions (Hidden when printing) */}
            <div className="flex items-center justify-between border-b border-gray-200 pb-3 print:hidden">
              <span className="font-bold text-sm text-gray-800 flex items-center gap-2">
                <Printer className="w-4 h-4 text-accent" />
                <span>Xem Trước Phiếu Giao Hàng A4 ({printModalShipment.shipmentId})</span>
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => window.print()}
                  className="p-2 rounded bg-accent text-white hover:opacity-90 transition-opacity shrink-0"
                  title="In phiếu giao hàng (Print)"
                >
                  <Printer className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setPrintModalShipment(null)}
                  className="p-1.5 text-gray-500 hover:text-gray-900 rounded"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Printable Form Content (Optimized for A4) */}
            <div className="space-y-6 text-xs text-gray-900 leading-relaxed font-sans">
              {/* Header */}
              <div className="flex justify-between items-start border-b-2 border-gray-800 pb-4">
                <div>
                  <h1 className="text-base font-extrabold uppercase text-gray-900 tracking-wider">
                    CÔNG TY CỔ PHẦN CƠ KHÍ & GIA CÔNG CHÍNH XÁC MES
                  </h1>
                  <p className="text-[11px] text-gray-600">Địa chỉ: KCN Cơ Khí Chế Tạo - TP. Hà Nội</p>
                  <p className="text-[11px] text-gray-600">Điện thoại / Hotline điều độ: 0988-XXX-XXX</p>
                </div>
                <div className="text-right">
                  <h2 className="text-xl font-black uppercase tracking-widest text-accent">PHIẾU GIAO HÀNG</h2>
                  <p className="font-mono text-xs font-bold text-gray-800 mt-1">Số: {printModalShipment.shipmentId}</p>
                  <p className="text-[11px] text-gray-600">Ngày xuất: {printModalShipment.shippedAt?.split("T")[0]}</p>
                </div>
              </div>

              {/* Customer & Shipment Details */}
              <div className="grid grid-cols-2 gap-4 p-3 rounded border border-gray-300 bg-gray-50">
                <div>
                  <p>
                    <strong>Tên Khách Hàng:</strong>{" "}
                    {pos.find((p) => p.poId === wos.find((w) => w.woId === printModalShipment.woIds?.[0])?.poId)
                      ?.customerName || "Khách Hàng Cơ Khí"}
                  </p>
                  <p className="mt-1">
                    <strong>Số Xe / Vận Đơn:</strong> {printModalShipment.meta?.vehicleNo || "—"}
                  </p>
                </div>
                <div>
                  <p>
                    <strong>Số PO Liên Kết:</strong>{" "}
                    {pos.find((p) => p.poId === wos.find((w) => w.woId === printModalShipment.woIds?.[0])?.poId)
                      ?.poNumber || "—"}
                  </p>
                  <p className="mt-1">
                    <strong>Ghi Chú Giao Hàng:</strong> {printModalShipment.meta?.notes || "—"}
                  </p>
                </div>
              </div>

              {/* Delivery Products Table */}
              <div className="border border-gray-400 rounded overflow-hidden">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-gray-200 border-b border-gray-400 text-gray-900 font-bold uppercase text-[10px]">
                      <th className="py-2 px-3 border-r border-gray-400 text-center">STT</th>
                      <th className="py-2 px-3 border-r border-gray-400">Mã SKU</th>
                      <th className="py-2 px-3 border-r border-gray-400">Tên Sản Phẩm</th>
                      <th className="py-2 px-3 border-r border-gray-400 text-center">ĐVT</th>
                      <th className="py-2 px-3 border-r border-gray-400 text-right">SL PO</th>
                      <th className="py-2 px-3 border-r border-gray-400 text-right font-bold text-emerald-800">
                        SL Giao Đợt Này
                      </th>
                      <th className="py-2 px-3 border-r border-gray-400 text-right">Tích Lũy Giao</th>
                      <th className="py-2 px-3 text-right">Còn Nợ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-300 font-mono">
                    {printModalShipment.woIds?.map((woId, idx) => {
                      const wo = wos.find((w) => w.woId === woId);
                      const po = pos.find((p) => p.poId === wo?.poId);
                      const currentQty = printModalShipment.qtyByWoId?.[woId] || 0;
                      const totalShipped = wo?.shippedQty || currentQty;
                      const targetQty = po?.qty || wo?.targetQty || 0;

                      return (
                        <tr key={woId}>
                          <td className="py-2 px-3 text-center border-r border-gray-300 font-sans">{idx + 1}</td>
                          <td className="py-2 px-3 border-r border-gray-300 font-bold">{wo?.sku}</td>
                          <td className="py-2 px-3 border-r border-gray-300 font-sans">
                            {products.find((p) => p.sku === wo?.sku)?.nameVi || po?.productNameVi || wo?.sku}
                          </td>
                          <td className="py-2 px-3 text-center border-r border-gray-300 font-sans">Cái</td>
                          <td className="py-2 px-3 text-right border-r border-gray-300 font-semibold">
                            {targetQty.toLocaleString()}
                          </td>
                          <td className="py-2 px-3 text-right border-r border-gray-300 font-bold text-emerald-800">
                            {currentQty.toLocaleString()}
                          </td>
                          <td className="py-2 px-3 text-right border-r border-gray-300 font-medium">
                            {totalShipped.toLocaleString()}
                          </td>
                          <td className="py-2 px-3 text-right font-bold text-red-700">
                            {Math.max(0, targetQty - totalShipped).toLocaleString()}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* 3-Party Signature Block */}
              <div className="grid grid-cols-3 gap-4 pt-10 text-center text-xs">
                <div className="space-y-16">
                  <div>
                    <p className="font-bold uppercase text-gray-900">NGƯỜI LẬP PHIẾU</p>
                    <p className="text-[10px] text-gray-500 italic">(Ký và ghi rõ họ tên)</p>
                  </div>
                  <p className="font-semibold text-gray-800">{printModalShipment.actor}</p>
                </div>

                <div className="space-y-16">
                  <div>
                    <p className="font-bold uppercase text-gray-900">THỦ KHO XUẤT HÀNG</p>
                    <p className="text-[10px] text-gray-500 italic">(Ký và ghi rõ họ tên)</p>
                  </div>
                  <p className="font-semibold text-gray-800">.................................</p>
                </div>

                <div className="space-y-16">
                  <div>
                    <p className="font-bold uppercase text-gray-900">ĐẠI DIỆN KHÁCH HÀNG</p>
                    <p className="text-[10px] text-gray-500 italic">(Ký nhận & ghi rõ họ tên)</p>
                  </div>
                  <p className="font-semibold text-gray-800">.................................</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
