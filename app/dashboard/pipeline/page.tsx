"use client";

import React, { useState, useMemo } from "react";
import useSWR from "swr";
import {
  Workflow,
  Search,
  Filter,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  CheckCircle2,
  AlertTriangle,
  Layers,
  Building2,
} from "lucide-react";

interface PipelineStep {
  code: string;
  tonPhoi: number;
  tonThanhPham: number;
  woPlanned?: number;
  woActual?: number;
  woStatus?: string;
}

interface POPipelineItem {
  poId: string;
  poNumber: string;
  customerName: string;
  sku: string;
  productNameVi: string;
  targetQty: number;
  shippedQty: number;
  remainingQty: number;
  finishWsCode: string;
  lrReadyQty: number;
  totalPhoiWIP: number;
  totalThanhPhamWIP: number;
  totalStock: number;
  coverageStatus: "SUFFICIENT" | "WIP_COVERED" | "SHORTAGE";
  poStatus: string;
  createdAt: string;
  requestedDate: string;
  routing: string[];
  steps: PipelineStep[];
  linkedWos: { woId: string; status: string }[];
}

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

export default function POPipelineViewPage() {
  const { data: rawPoItems, error, isValidating, mutate } = useSWR<POPipelineItem[]>(
    "/api/reports/po-pipeline",
    fetcher,
    {
      refreshInterval: 5000,
      revalidateOnFocus: true,
    }
  );

  const [searchTerm, setSearchTerm] = useState("");
  const [coverageFilter, setCoverageFilter] = useState<string>("ALL");
  const [poStatusFilter, setPoStatusFilter] = useState<string>("ALL");
  const [customerFilter, setCustomerFilter] = useState<string>("ALL");
  const [expandedRowIds, setExpandedRowIds] = useState<Record<string, boolean>>({});

  const poItems = useMemo(() => (Array.isArray(rawPoItems) ? rawPoItems : []), [rawPoItems]);

  // Distinct customer list for dropdown filter
  const customerList = useMemo(() => {
    const set = new Set<string>();
    poItems.forEach((item) => {
      if (item.customerName) set.add(item.customerName);
    });
    return Array.from(set).sort();
  }, [poItems]);

  // Toggle row expansion
  const toggleRow = (poId: string) => {
    setExpandedRowIds((prev) => ({
      ...prev,
      [poId]: !prev[poId],
    }));
  };

  // Filtered dataset
  const filteredItems = useMemo(() => {
    return poItems.filter((item) => {
      // Risk filter
      if (coverageFilter !== "ALL" && item.coverageStatus !== coverageFilter) {
        return false;
      }

      // PO status filter
      if (poStatusFilter !== "ALL" && item.poStatus !== poStatusFilter) {
        return false;
      }

      // Customer filter
      if (customerFilter !== "ALL" && item.customerName !== customerFilter) {
        return false;
      }

      // Search term
      if (searchTerm.trim()) {
        const term = searchTerm.toLowerCase();
        const matchPo = item.poNumber.toLowerCase().includes(term);
        const matchCust = item.customerName.toLowerCase().includes(term);
        const matchSku = item.sku.toLowerCase().includes(term);
        const matchProd = item.productNameVi.toLowerCase().includes(term);
        if (!matchPo && !matchCust && !matchSku && !matchProd) {
          return false;
        }
      }

      return true;
    });
  }, [poItems, coverageFilter, poStatusFilter, customerFilter, searchTerm]);

  // Metrics Bar
  const countSufficient = filteredItems.filter((i) => i.coverageStatus === "SUFFICIENT").length;
  const countWipCovered = filteredItems.filter((i) => i.coverageStatus === "WIP_COVERED").length;
  const countShortage = filteredItems.filter((i) => i.coverageStatus === "SHORTAGE").length;

  return (
    <div className="space-y-6">
      {/* Top Metrics Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className="p-4 rounded bg-canvas border border-border flex items-center justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-txt-secondary">
              Đơn Hàng Active (PO)
            </p>
            <p className="text-2xl font-extrabold text-txt-primary tabular-nums font-mono mt-1">
              {filteredItems.length}
            </p>
          </div>
          <div className="flex items-center justify-center w-9 h-9 rounded bg-subtle text-txt-primary">
            <Workflow className="w-4 h-4" />
          </div>
        </div>

        <div className="p-4 rounded bg-canvas border border-border flex items-center justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-txt-secondary">
              Đủ Hàng Giao Ngay
            </p>
            <p className="text-2xl font-extrabold text-emerald-600 tabular-nums font-mono mt-1">
              {countSufficient} <span className="text-xs font-normal">PO</span>
            </p>
          </div>
          <div className="flex items-center justify-center w-9 h-9 rounded bg-emerald-50 text-emerald-600">
            <CheckCircle2 className="w-4 h-4" />
          </div>
        </div>

        <div className="p-4 rounded bg-canvas border border-border flex items-center justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-txt-secondary">
              Đủ WIP (Gia Công Tiếp)
            </p>
            <p className="text-2xl font-extrabold text-amber-600 tabular-nums font-mono mt-1">
              {countWipCovered} <span className="text-xs font-normal">PO</span>
            </p>
          </div>
          <div className="flex items-center justify-center w-9 h-9 rounded bg-amber-50 text-amber-600">
            <AlertTriangle className="w-4 h-4" />
          </div>
        </div>

        <div className="p-4 rounded bg-canvas border border-border flex items-center justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-txt-secondary">
              Thiếu Phôi (Rủi Ro)
            </p>
            <p className="text-2xl font-extrabold text-rose-600 tabular-nums font-mono mt-1">
              {countShortage} <span className="text-xs font-normal">PO</span>
            </p>
          </div>
          <div className="flex items-center justify-center w-9 h-9 rounded bg-rose-50 text-rose-600">
            <AlertCircle className="w-4 h-4" />
          </div>
        </div>
      </div>

      {/* Top Filter & Search Bar */}
      <div className="p-4 rounded bg-canvas border border-border space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          {/* Large Search Input */}
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 text-txt-secondary" />
            <input
              type="text"
              placeholder="Tìm theo Mã PO, Tên khách hàng, Tên sản phẩm, SKU..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-xs bg-subtle border border-border rounded text-txt-primary focus:outline-none focus:border-accent"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Filter Rủi ro */}
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-subtle border border-border text-xs text-txt-secondary">
              <Filter className="w-3.5 h-3.5" />
              <span>Rủi ro:</span>
              <select
                value={coverageFilter}
                onChange={(e) => setCoverageFilter(e.target.value)}
                className="bg-transparent font-medium text-txt-primary focus:outline-none cursor-pointer"
              >
                <option value="ALL">Tất cả mức độ</option>
                <option value="SUFFICIENT">🟢 Đủ hàng giao ngay</option>
                <option value="WIP_COVERED">🟡 Cần gia công tiếp (Đủ WIP)</option>
                <option value="SHORTAGE">🔴 Thiếu phôi (Rủi ro)</option>
              </select>
            </div>

            {/* Filter PO Status */}
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-subtle border border-border text-xs text-txt-secondary">
              <Layers className="w-3.5 h-3.5" />
              <span>Trạng thái PO:</span>
              <select
                value={poStatusFilter}
                onChange={(e) => setPoStatusFilter(e.target.value)}
                className="bg-transparent font-medium text-txt-primary focus:outline-none cursor-pointer"
              >
                <option value="ALL">Tất cả trạng thái</option>
                <option value="NEW">Mới (NEW)</option>
                <option value="IN_PRODUCTION">Đang sản xuất (IN_PRODUCTION)</option>
                <option value="PARTIALLY_SHIPPED">Đã xuất 1 phần (PARTIALLY_SHIPPED)</option>
              </select>
            </div>

            {/* Filter Customer */}
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-subtle border border-border text-xs text-txt-secondary">
              <Building2 className="w-3.5 h-3.5" />
              <span>Khách hàng:</span>
              <select
                value={customerFilter}
                onChange={(e) => setCustomerFilter(e.target.value)}
                className="bg-transparent font-medium text-txt-primary focus:outline-none cursor-pointer max-w-[160px] truncate"
              >
                <option value="ALL">Tất cả Khách hàng</option>
                {customerList.map((cust) => (
                  <option key={cust} value={cust}>
                    {cust}
                  </option>
                ))}
              </select>
            </div>

            {/* Refresh Button */}
            <button
              onClick={() => mutate()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-subtle border border-border text-xs font-medium text-txt-primary hover:bg-border transition-colors"
              title="Làm mới dữ liệu"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isValidating ? "animate-spin text-accent" : ""}`} />
              <span>Làm mới</span>
            </button>
          </div>
        </div>
      </div>

      {/* Main Flat PO Matrix Table */}
      {error ? (
        <div className="p-4 rounded bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
          <span>{error.message || "Đã xảy ra lỗi khi tải dữ liệu PO Pipeline."}</span>
        </div>
      ) : !rawPoItems ? (
        <div className="p-12 border border-border rounded bg-canvas text-center text-txt-secondary text-xs">
          <div className="flex flex-col items-center justify-center gap-2">
            <RefreshCw className="w-5 h-5 animate-spin text-txt-secondary" />
            <span>Đang tải ma trận dòng chảy tồn kho PO...</span>
          </div>
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="p-12 border border-border rounded bg-canvas text-center text-txt-secondary text-xs">
          Không tìm thấy đơn hàng PO nào khớp với bộ lọc hiện tại.
        </div>
      ) : (
        <div className="border border-border rounded bg-canvas overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs tabular-nums border-collapse">
              <thead>
                <tr className="bg-subtle border-b border-border text-txt-secondary uppercase tracking-wider text-[10px] font-semibold">
                  <th className="py-3 px-3 border-r border-border">Mã PO & Ngày Ký</th>
                  <th className="py-3 px-3 border-r border-border">Khách Hàng</th>
                  <th className="py-3 px-3 border-r border-border">Sản Phẩm Đặt Hàng</th>
                  <th className="py-3 px-3 text-right border-r border-border">SL Đặt PO</th>
                  <th className="py-3 px-3 text-right border-r border-border">Đã Xuất</th>
                  <th className="py-3 px-3 text-right border-r border-border">Còn Thiếu</th>
                  <th className="py-3 px-3 text-center border-r border-border bg-amber-50/50 text-amber-900 font-bold">
                    Xưởng Cuối (Finish WS)
                  </th>
                  <th className="py-3 px-3 text-right border-r border-border bg-emerald-50/50 text-emerald-900 font-bold">
                    Tồn Xưởng Cuối
                  </th>
                  <th className="py-3 px-3 text-center border-r border-border">Đánh Giá Mức Độ Rủi Ro</th>
                  <th className="py-3 px-3 text-center border-r border-border">Hạn Giao Hàng</th>
                  <th className="py-3 px-2 text-center w-12">Thao Tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredItems.map((item) => {
                  const isExpanded = Boolean(expandedRowIds[item.poId]);

                  return (
                    <React.Fragment key={item.poId}>
                      <tr
                        onClick={() => toggleRow(item.poId)}
                        className={`transition-colors cursor-pointer hover:bg-subtle/60 ${
                          isExpanded ? "bg-subtle/40" : ""
                        }`}
                      >
                        {/* 1. Mã PO & Ngày Ký */}
                        <td className="py-3 px-3 border-r border-border">
                          <div className="space-y-0.5">
                            <span className="font-mono font-bold text-txt-primary block">
                              {item.poNumber}
                            </span>
                            <span className="text-[11px] text-txt-secondary font-mono block">
                              {formatDate(item.createdAt)}
                            </span>
                          </div>
                        </td>

                        {/* 2. Khách Hàng */}
                        <td className="py-3 px-3 border-r border-border font-medium text-txt-primary">
                          {item.customerName}
                        </td>

                        {/* 3. Sản Phẩm Đặt Hàng */}
                        <td className="py-3 px-3 border-r border-border">
                          <div className="space-y-0.5">
                            <span className="font-mono font-bold text-xs text-txt-primary block">
                              {item.sku}
                            </span>
                            <span className="text-[11px] text-txt-secondary block truncate max-w-[180px]">
                              {item.productNameVi}
                            </span>
                          </div>
                        </td>

                        {/* 4. SL Đặt PO */}
                        <td className="py-3 px-3 text-right border-r border-border font-bold font-mono text-txt-primary">
                          {item.targetQty.toLocaleString()}
                        </td>

                        {/* 5. Đã Xuất */}
                        <td className="py-3 px-3 text-right border-r border-border font-mono text-emerald-600 font-semibold">
                          {item.shippedQty.toLocaleString()}
                        </td>

                        {/* 6. Còn Thiếu */}
                        <td className="py-3 px-3 text-right border-r border-border font-mono font-semibold text-txt-primary">
                          {item.remainingQty.toLocaleString()}
                        </td>

                        {/* 7. Xưởng Cuối (Finish WS) - Highlighted */}
                        <td className="py-3 px-3 text-center border-r border-border bg-amber-50/30 font-bold text-amber-800 font-mono">
                          {item.finishWsCode}
                        </td>

                        {/* 8. Tồn Xưởng Cuối - Highlighted */}
                        <td className="py-3 px-3 text-right border-r border-border bg-emerald-50/30 font-bold text-emerald-700 font-mono">
                          {item.lrReadyQty.toLocaleString()} pcs
                        </td>

                        {/* 9. Đánh Giá Mức Độ Rủi Ro */}
                        <td className="py-3 px-3 text-center border-r border-border">
                          {item.coverageStatus === "SUFFICIENT" && (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                              <CheckCircle2 className="w-3 h-3" />
                              <span>Đủ hàng xuất</span>
                            </span>
                          )}

                          {item.coverageStatus === "WIP_COVERED" && (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                              <AlertTriangle className="w-3 h-3" />
                              <span>Đủ WIP/Phôi</span>
                            </span>
                          )}

                          {item.coverageStatus === "SHORTAGE" && (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-rose-50 text-rose-700 border border-rose-200">
                              <AlertCircle className="w-3 h-3" />
                              <span>Thiếu phôi</span>
                            </span>
                          )}
                        </td>

                        {/* 10. Hạn Giao Hàng */}
                        <td className="py-3 px-3 text-center border-r border-border font-mono text-txt-secondary">
                          {formatDate(item.requestedDate)}
                        </td>

                        {/* 11. Thao Tác */}
                        <td className="py-3 px-2 text-center text-txt-secondary">
                          {isExpanded ? (
                            <ChevronUp className="w-4 h-4 text-accent mx-auto" />
                          ) : (
                            <ChevronDown className="w-4 h-4 text-txt-secondary mx-auto" />
                          )}
                        </td>
                      </tr>

                      {/* Expandable Sub-Row (Rendered in --bg-subtle) */}
                      {isExpanded && (
                        <tr className="bg-subtle/50 border-b border-border">
                          <td colSpan={11} className="p-4">
                            <div className="space-y-2">
                              <div className="flex items-center justify-between text-xs">
                                <span className="font-semibold text-txt-primary flex items-center gap-1.5">
                                  <Workflow className="w-3.5 h-3.5 text-accent" />
                                  <span>Chi Tiết Dòng Chảy Routing Sản Xuất Của SKU {item.sku}:</span>
                                </span>
                                <span className="text-txt-secondary font-mono text-[11px]">
                                  Quy trình: {item.routing.join(" → ")}
                                </span>
                              </div>

                              <div className="border border-border rounded bg-canvas overflow-hidden">
                                <table className="w-full text-left text-xs tabular-nums border-collapse">
                                  <thead>
                                    <tr className="bg-subtle border-b border-border text-txt-secondary text-[10px] font-semibold uppercase">
                                      <th className="py-2 px-3 border-r border-border w-14 text-center">STT</th>
                                      <th className="py-2 px-3 border-r border-border">Mã Xưởng</th>
                                      <th className="py-2 px-3 border-r border-border text-right">Tồn Phôi (WIP)</th>
                                      <th className="py-2 px-3 border-r border-border text-right">Tồn Thành Phẩm (WIP)</th>
                                      <th className="py-2 px-3 text-right">Tiến Độ WO Thực Tế / Kế Hoạch</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-border">
                                    {item.steps.map((st, idx) => (
                                      <tr key={st.code} className="hover:bg-subtle/40">
                                        <td className="py-2 px-3 text-center border-r border-border font-mono text-txt-secondary">
                                          #{idx + 1}
                                        </td>
                                        <td className="py-2 px-3 border-r border-border font-semibold text-txt-primary">
                                          {st.code}
                                        </td>
                                        <td className="py-2 px-3 border-r border-border text-right font-mono font-medium">
                                          {st.tonPhoi > 0 ? (
                                            <span className="text-amber-700">{st.tonPhoi.toLocaleString()} pcs</span>
                                          ) : (
                                            "0"
                                          )}
                                        </td>
                                        <td className="py-2 px-3 border-r border-border text-right font-mono font-medium">
                                          {st.tonThanhPham > 0 ? (
                                            <span className="text-emerald-700">{st.tonThanhPham.toLocaleString()} pcs</span>
                                          ) : (
                                            "0"
                                          )}
                                        </td>
                                        <td className="py-2 px-3 text-right font-mono">
                                          {st.woPlanned ? (
                                            <span className="inline-flex items-center gap-1.5">
                                              <span>
                                                {st.woActual?.toLocaleString()} / {st.woPlanned?.toLocaleString()} pcs
                                              </span>
                                              <span
                                                className={`px-1.5 py-0.5 text-[10px] font-semibold rounded ${
                                                  st.woStatus === "DONE"
                                                    ? "bg-emerald-100 text-emerald-800"
                                                    : "bg-amber-100 text-amber-800"
                                                }`}
                                              >
                                                {st.woStatus}
                                              </span>
                                            </span>
                                          ) : (
                                            <span className="text-txt-secondary italic text-[11px]">Chưa tạo WO</span>
                                          )}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                  <tfoot>
                                    <tr className="bg-subtle/80 font-bold border-t border-border">
                                      <td colSpan={2} className="py-2 px-3 border-r border-border text-txt-primary">
                                        Tổng Dở Dang Chuỗi (Phôi + TP)
                                      </td>
                                      <td className="py-2 px-3 border-r border-border text-right font-mono text-amber-700">
                                        {item.totalPhoiWIP.toLocaleString()} pcs
                                      </td>
                                      <td className="py-2 px-3 border-r border-border text-right font-mono text-emerald-700">
                                        {item.totalThanhPhamWIP.toLocaleString()} pcs
                                      </td>
                                      <td className="py-2 px-3 text-right font-mono text-txt-primary">
                                        Tổng WIP: {item.totalStock.toLocaleString()} pcs
                                      </td>
                                    </tr>
                                  </tfoot>
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
    </div>
  );
}
