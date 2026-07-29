"use client";

import { useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import {
  Layers,
  Plus,
  Search,
  Filter,
  CheckCircle2,
  AlertTriangle,
  Check,
  X,
  Lock,
  ArrowRight,
  Package,
} from "lucide-react";
import AccordionList from "@/components/AccordionList";
import { WO, PO } from "@/lib/po-wo-engine";

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export default function WOPage() {
  const { data: wosData, mutate: mutateWOs } = useSWR<WO[]>("/api/wo", fetcher);
  const { data: posData, mutate: mutatePOs } = useSWR<PO[]>("/api/po", fetcher);

  const wos = Array.isArray(wosData) ? wosData : [];
  const pos = Array.isArray(posData) ? posData : [];

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedStatus, setSelectedStatus] = useState<string>("ALL");

  // Create WO Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedPoId, setSelectedPoId] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [modalError, setModalError] = useState("");
  const [routingMissingError, setRoutingMissingError] = useState(false);
  const [toastMessage, setToastMessage] = useState("");

  // Available POs to generate WO from (NEW or IN_PRODUCTION)
  const availablePOs = pos.filter((po) => po.status === "NEW" || po.status === "IN_PRODUCTION");

  // Filter WOs
  const filteredWOs = wos.filter((wo) => {
    const q = searchQuery.toLowerCase().trim();
    const matchQuery =
      !q ||
      wo.woId.toLowerCase().includes(q) ||
      wo.poId.toLowerCase().includes(q) ||
      wo.sku.toLowerCase().includes(q);

    const matchStatus = selectedStatus === "ALL" || wo.status === selectedStatus;
    return matchQuery && matchStatus;
  });

  const handleCreateWO = async (e: React.FormEvent) => {
    e.preventDefault();
    setModalError("");
    setRoutingMissingError(false);

    if (!selectedPoId) {
      setModalError("Vui lòng chọn 1 đơn hàng PO.");
      return;
    }

    setIsSubmitting(true);

    try {
      const res = await fetch("/api/wo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ poId: selectedPoId }),
      });

      const data = await res.json();

      if (!res.ok) {
        setModalError(data.error || "Tạo Lệnh sản xuất WO thất bại.");
        if (data.error && data.error.includes("chưa khai báo routing")) {
          setRoutingMissingError(true);
        }
        setIsSubmitting(false);
        return;
      }

      setToastMessage(`Đã tạo thành công Lệnh sản xuất ${data.woId} cho PO ${selectedPoId}!`);
      setIsModalOpen(false);
      setSelectedPoId("");
      mutateWOs();
      mutatePOs();
    } catch {
      setModalError("Không thể kết nối đến máy chủ.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCloseWO = async (woId: string) => {
    try {
      const res = await fetch(`/api/wo/${woId}/close`, {
        method: "POST",
      });

      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Đóng WO thất bại.");
        return;
      }

      setToastMessage(`Đã đóng thành công WO ${woId}. Trạng thái chuyển sang READY_TO_SHIP.`);
      mutateWOs();
      mutatePOs();
    } catch {
      alert("Đã xảy ra lỗi khi kết nối máy chủ.");
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header & Actions */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-4 rounded bg-canvas border border-border">
        <div className="flex flex-wrap items-center gap-3">
          {/* Search Input */}
          <div className="relative flex items-center">
            <Search className="w-4 h-4 absolute left-2.5 text-txt-secondary" />
            <input
              type="text"
              placeholder="Tìm kiếm WO, PO, SKU..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 pr-3 py-1.5 text-xs bg-subtle border border-border rounded text-txt-primary focus:outline-none focus:border-accent w-60 sm:w-72"
            />
          </div>

          {/* Status Filter */}
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-subtle border border-border text-xs text-txt-secondary">
            <Filter className="w-3.5 h-3.5" />
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="bg-transparent font-medium text-txt-primary focus:outline-none cursor-pointer"
            >
              <option value="ALL">Tất cả trạng thái</option>
              <option value="OPEN">OPEN (Mới lập)</option>
              <option value="IN_PROGRESS">IN_PROGRESS (Đang sản xuất)</option>
              <option value="READY_TO_SHIP">READY_TO_SHIP (Sẵn sàng xuất)</option>
              <option value="SHIPPED">SHIPPED (Đã xuất hàng)</option>
            </select>
          </div>
        </div>

        {/* Create WO Button */}
        <button
          onClick={() => {
            setModalError("");
            setRoutingMissingError(false);
            setIsModalOpen(true);
          }}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-accent text-white text-xs font-medium hover:opacity-90 transition-opacity"
        >
          <Plus className="w-4 h-4" />
          <span>Lập WO Mới Từ PO</span>
        </button>
      </div>

      {/* Success Toast */}
      {toastMessage && (
        <div className="p-3 rounded bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{toastMessage}</span>
          </div>
          <button onClick={() => setToastMessage("")} className="text-emerald-700 hover:text-emerald-900">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Accordion WO List */}
      <AccordionList<WO>
        items={filteredWOs}
        getItemKey={(wo) => wo.woId}
        emptyMessage="Chưa có Lệnh sản xuất WO nào."
        renderHeader={(wo) => {
          const isReadyToShip = wo.status === "READY_TO_SHIP";
          const isShipped = wo.status === "SHIPPED";

          return (
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-mono font-bold text-txt-primary text-sm">{wo.woId}</span>
                <span className="font-mono text-xs text-txt-secondary">PO: {wo.poId}</span>
                <span className="font-mono font-semibold text-txt-primary text-xs">SKU: {wo.sku}</span>
                <span className="text-xs text-txt-secondary">
                  Mục tiêu: <strong className="text-txt-primary">{wo.targetQty}</strong> pcs
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                {/* Routing Steps Chips Sequence */}
                <div className="flex items-center gap-1 overflow-x-auto py-0.5">
                  {wo.steps?.map((step, idx) => {
                    const isDone = step.status === "DONE";
                    return (
                      <div key={step.code} className="flex items-center">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-semibold transition-colors ${
                            isDone
                              ? "bg-emerald-50 border border-emerald-200 text-emerald-800"
                              : "bg-subtle border border-border text-txt-secondary"
                          }`}
                        >
                          {isDone && <Check className="w-3 h-3 text-emerald-600" />}
                          <span>{step.code}</span>
                        </span>
                        {idx < wo.steps.length - 1 && <span className="text-[10px] text-txt-secondary mx-0.5">→</span>}
                      </div>
                    );
                  })}
                </div>

                {/* Minimalist Status Badge */}
                <span
                  className={`px-2.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${
                    isReadyToShip || isShipped
                      ? "bg-emerald-50 border border-emerald-200 text-emerald-800"
                      : "bg-subtle border border-border text-txt-primary"
                  }`}
                >
                  {wo.status}
                </span>
              </div>
            </div>
          );
        }}
        renderDetail={(wo) => {
          const lastStep = wo.steps?.[wo.steps.length - 1];
          const isLastStepDone = lastStep?.status === "DONE";
          const canClose = isLastStepDone && wo.status !== "READY_TO_SHIP" && wo.status !== "SHIPPED";

          return (
            <div className="space-y-4 text-xs">
              <div className="border border-border rounded bg-canvas overflow-x-auto">
                <table className="w-full text-left text-xs tabular-nums border-collapse">
                  <thead>
                    <tr className="bg-subtle border-b border-border text-txt-secondary text-[11px] font-semibold uppercase">
                      <th className="py-2.5 px-4">Bước Xưởng</th>
                      <th className="py-2.5 px-4 text-right">Kế Hoạch (Planned)</th>
                      <th className="py-2.5 px-4 text-right">Đã Làm (Actual)</th>
                      <th className="py-2.5 px-4 text-center">Trạng Thái</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {wo.steps?.map((step) => {
                      const isDone = step.status === "DONE";
                      return (
                        <tr key={step.code} className="hover:bg-subtle">
                          <td className="py-2 px-4 font-bold font-mono text-txt-primary">{step.code}</td>
                          <td className="py-2 px-4 text-right font-mono text-txt-primary">{step.plannedQty} pcs</td>
                          <td className="py-2 px-4 text-right font-mono font-semibold text-emerald-600">
                            {step.actualQty} pcs
                          </td>
                          <td className="py-2 px-4 text-center">
                            <span
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold ${
                                isDone
                                  ? "bg-emerald-50 border border-emerald-200 text-emerald-800"
                                  : "bg-subtle border border-border text-txt-secondary"
                              }`}
                            >
                              {isDone && <Check className="w-3 h-3 text-emerald-600" />}
                              <span>{step.status}</span>
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Close WO Action Footer */}
              <div className="flex items-center justify-between pt-2 border-t border-border">
                <div className="flex items-center gap-1.5 text-xs text-txt-secondary">
                  {!isLastStepDone ? (
                    <span className="flex items-center gap-1 text-warning">
                      <Lock className="w-3.5 h-3.5" />
                      <span>Bước lắp ráp cuối cùng ({lastStep?.code || "LR"}) chưa hoàn thành. Chưa thể đóng WO.</span>
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-emerald-600 font-medium">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Bước lắp ráp cuối ({lastStep?.code}) đã hoàn thành! WO đủ điều kiện đóng.</span>
                    </span>
                  )}
                </div>

                <button
                  onClick={() => handleCloseWO(wo.woId)}
                  disabled={!canClose}
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded bg-accent text-white text-xs font-medium hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed transition-opacity"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Đóng WO (READY_TO_SHIP)</span>
                </button>
              </div>
            </div>
          );
        }}
      />

      {/* Create WO Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-canvas border border-border rounded shadow-lg max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="text-sm font-bold text-txt-primary">Lập Lệnh Sản Xuất WO Mới Từ PO</h3>
              <button onClick={() => setIsModalOpen(false)} className="text-txt-secondary hover:text-txt-primary">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Error Banner with Direct Redirect Button if Routing Missing */}
            {modalError && (
              <div className="p-3 rounded bg-amber-50 border border-amber-200 text-warning text-xs space-y-2">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{modalError}</span>
                </div>
                {routingMissingError && (
                  <Link
                    href="/dashboard/products"
                    className="inline-flex items-center gap-1 px-3 py-1 rounded bg-warning text-white text-xs font-medium hover:opacity-90 transition-opacity"
                  >
                    <Package className="w-3.5 h-3.5" />
                    <span>Đi đến Tab Sản Phẩm để Khai Báo Routing</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                )}
              </div>
            )}

            <form onSubmit={handleCreateWO} className="space-y-4 text-xs">
              <div className="space-y-1.5">
                <label className="font-medium text-txt-secondary">Chọn Đơn Hàng PO (*):</label>
                {availablePOs.length === 0 ? (
                  <p className="text-xs text-txt-secondary py-2 italic">
                    Không có đơn hàng PO nào ở trạng thái NEW hoặc IN_PRODUCTION.
                  </p>
                ) : (
                  <select
                    value={selectedPoId}
                    onChange={(e) => setSelectedPoId(e.target.value)}
                    className="w-full px-3 py-2 bg-canvas border border-border rounded text-txt-primary font-mono focus:outline-none focus:border-accent"
                  >
                    <option value="">-- Chọn Đơn Hàng PO --</option>
                    {availablePOs.map((po) => (
                      <option key={po.poId} value={po.poId}>
                        {po.poNumber} | KH: {po.customerName} | SKU: {po.sku} | Qty: {po.qty} pcs
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-border">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-1.5 rounded bg-subtle border border-border text-txt-primary hover:bg-border"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || !selectedPoId}
                  className="px-4 py-1.5 rounded bg-accent text-white font-medium hover:opacity-90 disabled:opacity-40"
                >
                  {isSubmitting ? "Đang tạo..." : "Xác Nhận Tạo WO"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
