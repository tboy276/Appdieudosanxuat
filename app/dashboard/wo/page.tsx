"use client";

import React, { useState, useMemo } from "react";
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
  Trash2,
  ChevronDown,
  ChevronUp,
  RefreshCw,
} from "lucide-react";
import { WO, PO } from "@/lib/po-wo-engine";
import { Product } from "@/lib/types";

const fetcher = (url: string) => fetch(url).then((res) => res.json());

function formatDate(dateStr?: string): string {
  if (!dateStr) return "-";
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const day = String(d.getDate()).padStart(2, "0");
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
  } catch {
    return dateStr;
  }
}

export default function WOPage() {
  const { data: wosData, isValidating, mutate: mutateWOs } = useSWR<WO[]>("/api/wo", fetcher, {
    refreshInterval: 5000,
    revalidateOnFocus: true,
  });
  const { data: posData, mutate: mutatePOs } = useSWR<PO[]>("/api/po", fetcher);
  const { data: productsData } = useSWR<Product[]>("/api/products", fetcher);

  const wos = useMemo(() => (Array.isArray(wosData) ? wosData : []), [wosData]);
  const pos = useMemo(() => (Array.isArray(posData) ? posData : []), [posData]);
  const products = useMemo(() => (Array.isArray(productsData) ? productsData : []), [productsData]);

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedStatus, setSelectedStatus] = useState<string>("ALL");
  const [expandedRowIds, setExpandedRowIds] = useState<Record<string, boolean>>({});

  // Create WO Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedPoId, setSelectedPoId] = useState("");
  const [customPlannedQtys, setCustomPlannedQtys] = useState<Record<string, number>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [modalError, setModalError] = useState("");
  const [routingMissingError, setRoutingMissingError] = useState(false);
  const [toastMessage, setToastMessage] = useState("");

  // Map of PO ID to customer name
  const poCustomerMap = useMemo(() => {
    const map: Record<string, string> = {};
    pos.forEach((p) => {
      map[p.poId] = p.customerName || p.poNumber;
    });
    return map;
  }, [pos]);

  // Map of SKU to Product Name
  const skuNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    products.forEach((prod) => {
      map[prod.sku] = prod.nameVi;
    });
    return map;
  }, [products]);

  // 1-to-1 PO-WO Filter: Available POs to generate WO from (NEW or IN_PRODUCTION) AND NO existing WO
  const availablePOs = useMemo(() => {
    const existingWoPoIds = new Set(wos.map((w) => w.poId));
    return pos.filter(
      (po) =>
        (po.status === "NEW" || po.status === "IN_PRODUCTION") &&
        !existingWoPoIds.has(po.poId)
    );
  }, [pos, wos]);

  // Selected PO details for Modal
  const selectedPO = useMemo(() => {
    return pos.find((p) => p.poId === selectedPoId) || null;
  }, [pos, selectedPoId]);

  // Selected Product Routing for Modal
  const selectedProduct = useMemo(() => {
    if (!selectedPO) return null;
    return products.find((p) => p.sku === selectedPO.sku) || null;
  }, [selectedPO, products]);

  // Handle PO selection in Modal & set default planned quantities
  const handleSelectPO = (poId: string) => {
    setSelectedPoId(poId);
    setModalError("");
    setRoutingMissingError(false);

    const po = pos.find((p) => p.poId === poId);
    if (!po) {
      setCustomPlannedQtys({});
      return;
    }

    const prod = products.find((p) => p.sku === po.sku);
    if (!prod || !prod.routing || prod.routing.length === 0) {
      setCustomPlannedQtys({});
      return;
    }

    // Default planned quantity pre-filled as PO target qty
    const defaults: Record<string, number> = {};
    prod.routing.forEach((code) => {
      defaults[code] = po.qty;
    });
    setCustomPlannedQtys(defaults);
  };

  // Filter WOs
  const filteredWOs = useMemo(() => {
    return wos.filter((wo) => {
      const q = searchQuery.toLowerCase().trim();
      const custName = (poCustomerMap[wo.poId] || "").toLowerCase();
      const matchQuery =
        !q ||
        wo.woId.toLowerCase().includes(q) ||
        wo.poId.toLowerCase().includes(q) ||
        wo.sku.toLowerCase().includes(q) ||
        custName.includes(q);

      const matchStatus = selectedStatus === "ALL" || wo.status === selectedStatus;
      return matchQuery && matchStatus;
    });
  }, [wos, searchQuery, selectedStatus, poCustomerMap]);

  const toggleRow = (woId: string) => {
    setExpandedRowIds((prev) => ({
      ...prev,
      [woId]: !prev[woId],
    }));
  };

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
        body: JSON.stringify({
          poId: selectedPoId,
          customPlannedQtys,
        }),
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
      setCustomPlannedQtys({});
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

  const handleDeleteWO = async (woId: string) => {
    if (!window.confirm(`Bạn có chắc chắn muốn xóa Lệnh sản xuất WO: ${woId}?`)) return;

    try {
      const res = await fetch(`/api/wo?woId=${encodeURIComponent(woId)}`, {
        method: "DELETE",
      });
      const data = await res.json();

      if (!res.ok) {
        alert(data.error || "Xóa Lệnh sản xuất WO thất bại.");
        return;
      }

      setToastMessage(`Đã xóa thành công Lệnh sản xuất WO ${woId}.`);
      mutateWOs();
      mutatePOs();
    } catch {
      alert("Không thể kết nối đến máy chủ.");
    }
  };

  // Metrics Bar
  const countOpen = filteredWOs.filter((w) => w.status === "OPEN").length;
  const countInProgress = filteredWOs.filter((w) => w.status === "IN_PROGRESS").length;
  const countReadyToShip = filteredWOs.filter((w) => w.status === "READY_TO_SHIP").length;

  return (
    <div className="space-y-6">
      {/* Top Metrics Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className="p-4 rounded bg-canvas border border-border flex items-center justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-txt-secondary">
              Tổng Lệnh WO Active
            </p>
            <p className="text-2xl font-extrabold text-txt-primary tabular-nums font-mono mt-1">
              {filteredWOs.length}
            </p>
          </div>
          <div className="flex items-center justify-center w-9 h-9 rounded bg-subtle text-txt-primary">
            <Layers className="w-4 h-4" />
          </div>
        </div>

        <div className="p-4 rounded bg-canvas border border-border flex items-center justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-txt-secondary">
              WO Mới Lập (OPEN)
            </p>
            <p className="text-2xl font-extrabold text-blue-600 tabular-nums font-mono mt-1">
              {countOpen} <span className="text-xs font-normal">WO</span>
            </p>
          </div>
          <div className="flex items-center justify-center w-9 h-9 rounded bg-blue-50 text-blue-600">
            <Layers className="w-4 h-4" />
          </div>
        </div>

        <div className="p-4 rounded bg-canvas border border-border flex items-center justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-txt-secondary">
              Đang Gia Công (IN_PROGRESS)
            </p>
            <p className="text-2xl font-extrabold text-amber-600 tabular-nums font-mono mt-1">
              {countInProgress} <span className="text-xs font-normal">WO</span>
            </p>
          </div>
          <div className="flex items-center justify-center w-9 h-9 rounded bg-amber-50 text-amber-600">
            <AlertTriangle className="w-4 h-4" />
          </div>
        </div>

        <div className="p-4 rounded bg-canvas border border-border flex items-center justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-txt-secondary">
              Sẵn Sàng Xuất (READY_TO_SHIP)
            </p>
            <p className="text-2xl font-extrabold text-emerald-600 tabular-nums font-mono mt-1">
              {countReadyToShip} <span className="text-xs font-normal">WO</span>
            </p>
          </div>
          <div className="flex items-center justify-center w-9 h-9 rounded bg-emerald-50 text-emerald-600">
            <CheckCircle2 className="w-4 h-4" />
          </div>
        </div>
      </div>

      {/* Top Header & Search/Filter Actions */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-4 rounded bg-canvas border border-border">
        <div className="flex flex-wrap items-center gap-3">
          {/* Search Input */}
          <div className="relative flex items-center">
            <Search className="w-4 h-4 absolute left-2.5 text-txt-secondary" />
            <input
              type="text"
              placeholder="Tìm kiếm WO, PO, Khách hàng, SKU..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 pr-3 py-1.5 text-xs bg-subtle border border-border rounded text-txt-primary focus:outline-none focus:border-accent w-64 sm:w-80"
            />
          </div>

          {/* Status Filter */}
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-subtle border border-border text-xs text-txt-secondary">
            <Filter className="w-3.5 h-3.5" />
            <span>Trạng thái WO:</span>
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="bg-transparent font-medium text-txt-primary focus:outline-none cursor-pointer"
            >
              <option value="ALL">Tất cả trạng thái</option>
              <option value="OPEN">Mới lập (OPEN)</option>
              <option value="IN_PROGRESS">Đang sản xuất (IN_PROGRESS)</option>
              <option value="READY_TO_SHIP">Sẵn sàng xuất (READY_TO_SHIP)</option>
              <option value="SHIPPED">Đã xuất hàng (SHIPPED)</option>
            </select>
          </div>

          <button
            onClick={() => mutateWOs()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-subtle border border-border text-xs font-medium text-txt-primary hover:bg-border transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isValidating ? "animate-spin text-accent" : ""}`} />
            <span>Làm mới</span>
          </button>
        </div>

        {/* Create WO Button */}
        <button
          onClick={() => {
            setModalError("");
            setRoutingMissingError(false);
            setSelectedPoId("");
            setCustomPlannedQtys({});
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

      {/* Main Flat WO Matrix Table */}
      {!wosData ? (
        <div className="p-12 border border-border rounded bg-canvas text-center text-txt-secondary text-xs">
          <div className="flex flex-col items-center justify-center gap-2">
            <RefreshCw className="w-5 h-5 animate-spin text-txt-secondary" />
            <span>Đang tải ma trận Lệnh sản xuất WO...</span>
          </div>
        </div>
      ) : filteredWOs.length === 0 ? (
        <div className="p-12 border border-border rounded bg-canvas text-center text-txt-secondary text-xs">
          Không tìm thấy Lệnh sản xuất WO nào phù hợp với bộ lọc.
        </div>
      ) : (
        <div className="border border-border rounded bg-canvas overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs tabular-nums border-collapse">
              <thead>
                <tr className="bg-subtle border-b border-border text-txt-secondary uppercase tracking-wider text-[10px] font-semibold">
                  <th className="py-3 px-3 border-r border-border">Mã WO & Ngày Lập</th>
                  <th className="py-3 px-3 border-r border-border">Mã PO Kết Nối</th>
                  <th className="py-3 px-3 border-r border-border">Khách Hàng</th>
                  <th className="py-3 px-3 border-r border-border">Sản Phẩm (SKU)</th>
                  <th className="py-3 px-3 text-right border-r border-border">SL Mục Tiêu PO</th>
                  <th className="py-3 px-3 text-center border-r border-border bg-amber-50/40 text-amber-900 font-bold">
                    Công Đoạn Đang Làm
                  </th>
                  <th className="py-3 px-3 text-right border-r border-border font-bold">Đã Xuất Hàng</th>
                  <th className="py-3 px-3 text-center border-r border-border">Trạng Thái WO</th>
                  <th className="py-3 px-3 text-center">Thao Tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredWOs.map((wo) => {
                  const isExpanded = Boolean(expandedRowIds[wo.woId]);
                  const activeStep = wo.steps?.find((s) => s.status === "PENDING") || wo.steps?.[wo.steps.length - 1];
                  const lastStep = wo.steps?.[wo.steps.length - 1];
                  const isLastStepDone = lastStep?.status === "DONE";
                  const canClose = isLastStepDone && wo.status !== "READY_TO_SHIP" && wo.status !== "SHIPPED";

                  return (
                    <React.Fragment key={wo.woId}>
                      <tr
                        onClick={() => toggleRow(wo.woId)}
                        className={`transition-colors cursor-pointer hover:bg-subtle/60 ${
                          isExpanded ? "bg-subtle/40" : ""
                        }`}
                      >
                        {/* 1. Mã WO & Ngày Lập */}
                        <td className="py-3 px-3 border-r border-border">
                          <div className="space-y-0.5">
                            <span className="font-mono font-bold text-txt-primary block">
                              {wo.woId}
                            </span>
                            <span className="text-[11px] text-txt-secondary font-mono block">
                              {formatDate(wo.createdAt)}
                            </span>
                          </div>
                        </td>

                        {/* 2. Mã PO Kết Nối */}
                        <td className="py-3 px-3 border-r border-border font-mono font-semibold text-txt-primary">
                          {wo.poId}
                        </td>

                        {/* 3. Khách Hàng */}
                        <td className="py-3 px-3 border-r border-border font-medium text-txt-primary">
                          {poCustomerMap[wo.poId] || "-"}
                        </td>

                        {/* 4. Sản Phẩm (SKU) */}
                        <td className="py-3 px-3 border-r border-border">
                          <div className="space-y-0.5">
                            <span className="font-mono font-bold text-xs text-txt-primary block">
                              {wo.sku}
                            </span>
                            <span className="text-[11px] text-txt-secondary block truncate max-w-[180px]">
                              {skuNameMap[wo.sku] || wo.sku}
                            </span>
                          </div>
                        </td>

                        {/* 5. SL Mục Tiêu PO */}
                        <td className="py-3 px-3 text-right border-r border-border font-bold font-mono text-txt-primary">
                          {wo.targetQty.toLocaleString()} pcs
                        </td>

                        {/* 6. Công Đoạn Đang Làm */}
                        <td className="py-3 px-3 text-center border-r border-border bg-amber-50/20 font-mono font-bold text-amber-800">
                          {activeStep ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-100/80 border border-amber-200">
                              <span>{activeStep.code}</span>
                              <span className="text-[10px] text-amber-700 font-normal">
                                ({activeStep.actualQty}/{activeStep.plannedQty})
                              </span>
                            </span>
                          ) : (
                            "-"
                          )}
                        </td>

                        {/* 7. Đã Xuất Hàng */}
                        <td className="py-3 px-3 text-right border-r border-border font-mono font-semibold text-emerald-600">
                          {wo.shippedQty.toLocaleString()} pcs
                        </td>

                        {/* 8. Trạng Thái WO */}
                        <td className="py-3 px-3 text-center border-r border-border">
                          <span
                            className={`px-2.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${
                              wo.status === "READY_TO_SHIP" || wo.status === "SHIPPED"
                                ? "bg-emerald-50 border border-emerald-200 text-emerald-800"
                                : wo.status === "IN_PROGRESS"
                                ? "bg-amber-50 border border-amber-200 text-amber-800"
                                : "bg-subtle border border-border text-txt-primary"
                            }`}
                          >
                            {wo.status}
                          </span>
                        </td>

                        {/* 9. Thao Tác */}
                        <td className="py-3 px-2 text-center" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-center gap-1.5">
                            {canClose && (
                              <button
                                onClick={() => handleCloseWO(wo.woId)}
                                className="px-2 py-1 rounded bg-accent text-white text-[11px] font-medium hover:opacity-90 transition-opacity"
                                title="Đóng WO"
                              >
                                Đóng WO
                              </button>
                            )}

                            <button
                              onClick={() => handleDeleteWO(wo.woId)}
                              className="p-1 rounded hover:bg-rose-50 text-rose-600 transition-colors"
                              title="Xóa WO"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>

                            <button
                              onClick={() => toggleRow(wo.woId)}
                              className="p-1 rounded hover:bg-subtle text-txt-secondary"
                            >
                              {isExpanded ? (
                                <ChevronUp className="w-4 h-4 text-accent" />
                              ) : (
                                <ChevronDown className="w-4 h-4" />
                              )}
                            </button>
                          </div>
                        </td>
                      </tr>

                      {/* Expandable Sub-Row */}
                      {isExpanded && (
                        <tr className="bg-subtle/50 border-b border-border">
                          <td colSpan={9} className="p-4">
                            <div className="space-y-3">
                              <div className="flex items-center justify-between text-xs">
                                <span className="font-semibold text-txt-primary flex items-center gap-1.5">
                                  <Layers className="w-3.5 h-3.5 text-accent" />
                                  <span>Chi Tiết Tiến Độ Các Xưởng Lệnh WO {wo.woId}:</span>
                                </span>
                                <span className="text-txt-secondary font-mono text-[11px]">
                                  Quy trình: {wo.routing?.join(" → ")}
                                </span>
                              </div>

                              <div className="border border-border rounded bg-canvas overflow-hidden">
                                <table className="w-full text-left text-xs tabular-nums border-collapse">
                                  <thead>
                                    <tr className="bg-subtle border-b border-border text-txt-secondary text-[10px] font-semibold uppercase">
                                      <th className="py-2 px-3 border-r border-border w-14 text-center">STT</th>
                                      <th className="py-2 px-3 border-r border-border">Mã Xưởng</th>
                                      <th className="py-2 px-3 border-r border-border text-right">Kế Hoạch (Planned)</th>
                                      <th className="py-2 px-3 border-r border-border text-right">Đã Làm (Actual)</th>
                                      <th className="py-2 px-3 border-r border-border text-right">Tỉ Lệ Hoàn Thành</th>
                                      <th className="py-2 px-3 text-center">Trạng Thái Xưởng</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-border">
                                    {wo.steps?.map((st, idx) => {
                                      const pct = st.plannedQty > 0 ? Math.min(100, Math.round((st.actualQty / st.plannedQty) * 100)) : 0;
                                      const isDone = st.status === "DONE";

                                      return (
                                        <tr key={st.code} className="hover:bg-subtle/40">
                                          <td className="py-2 px-3 text-center border-r border-border font-mono text-txt-secondary">
                                            #{idx + 1}
                                          </td>
                                          <td className="py-2 px-3 border-r border-border font-semibold text-txt-primary">
                                            {st.code}
                                          </td>
                                          <td className="py-2 px-3 border-r border-border text-right font-mono font-medium text-txt-primary">
                                            {st.plannedQty.toLocaleString()} pcs
                                          </td>
                                          <td className="py-2 px-3 border-r border-border text-right font-mono font-bold text-emerald-700">
                                            {st.actualQty.toLocaleString()} pcs
                                          </td>
                                          <td className="py-2 px-3 border-r border-border text-right font-mono font-medium">
                                            {pct}%
                                          </td>
                                          <td className="py-2 px-3 text-center">
                                            <span
                                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold ${
                                                isDone
                                                  ? "bg-emerald-50 border border-emerald-200 text-emerald-800"
                                                  : "bg-subtle border border-border text-txt-secondary"
                                              }`}
                                            >
                                              {isDone && <Check className="w-3 h-3 text-emerald-600" />}
                                              <span>{st.status}</span>
                                            </span>
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Create WO Modal (Supports Custom Planned Quantities & 1-PO-to-1-WO Filter) */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-canvas border border-border rounded shadow-lg max-w-lg w-full max-h-[90vh] overflow-y-auto p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="text-sm font-bold text-txt-primary">Lập Lệnh Sản Xuất WO Mới Từ PO</h3>
              <button onClick={() => setIsModalOpen(false)} className="text-txt-secondary hover:text-txt-primary">
                <X className="w-4 h-4" />
              </button>
            </div>

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
                <label className="font-medium text-txt-secondary">Chọn Đơn Hàng PO chưa có WO (*):</label>
                {availablePOs.length === 0 ? (
                  <div className="p-3 rounded bg-subtle border border-border text-txt-secondary italic text-xs">
                    Tất cả các đơn hàng PO active đều đã được lập WO (Mỗi PO chỉ được tạo 1 WO duy nhất).
                  </div>
                ) : (
                  <select
                    value={selectedPoId}
                    onChange={(e) => handleSelectPO(e.target.value)}
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

              {/* Custom Planned Quantities Table per Workshop */}
              {selectedPO && selectedProduct && selectedProduct.routing && (
                <div className="space-y-2 pt-2 border-t border-border">
                  <div className="flex items-center justify-between">
                    <label className="font-semibold text-txt-primary">
                      Tùy Chỉnh Số Lượng Kế Hoạch Theo Từng Xưởng (Routing: {selectedProduct.routing.join(" → ")}):
                    </label>
                  </div>

                  <div className="border border-border rounded bg-canvas overflow-hidden">
                    <table className="w-full text-left text-xs tabular-nums border-collapse">
                      <thead>
                        <tr className="bg-subtle border-b border-border text-txt-secondary uppercase tracking-wider text-[10px] font-semibold">
                          <th className="py-2 px-3 border-r border-border">Mã Xưởng</th>
                          <th className="py-2 px-3 text-right">Số Lượng Kế Hoạch (pcs)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {selectedProduct.routing.map((wcCode) => (
                          <tr key={wcCode} className="hover:bg-subtle/50">
                            <td className="py-2 px-3 border-r border-border font-mono font-bold text-txt-primary">
                              {wcCode}
                            </td>
                            <td className="py-1.5 px-3 text-right">
                              <input
                                type="number"
                                min="1"
                                required
                                value={customPlannedQtys[wcCode] || ""}
                                onChange={(e) => {
                                  const val = Number(e.target.value);
                                  setCustomPlannedQtys((prev) => ({
                                    ...prev,
                                    [wcCode]: val,
                                  }));
                                }}
                                className="w-32 px-2 py-1 text-right bg-subtle border border-border rounded font-mono font-bold text-txt-primary focus:outline-none focus:border-accent"
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

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
