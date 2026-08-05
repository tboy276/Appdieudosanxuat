"use client";

import React, { useState, useMemo } from "react";
import useSWR from "swr";
import * as XLSX from "xlsx";
import DataTable, { ColumnDef } from "@/components/DataTable";
import {
  History,
  Search,
  Filter,
  RefreshCw,
  Download,
  Calendar,
  User,
  Factory,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  ShieldCheck,
  RotateCcw,
  X,
  Info,
} from "lucide-react";
import { TransactionHistoryItem } from "@/lib/inventory-postgres";
import { formatTimestampDisplay } from "@/lib/date-utils";

const fetcher = (url: string) => fetch(url).then((res) => res.json());

const MASTER_WORK_CENTERS = [
  { code: "CUAPHOI", name: "Tổ cưa phôi PSX" },
  { code: "D1", name: "Xưởng Đúc 1" },
  { code: "D2", name: "Xưởng Đúc 2" },
  { code: "R1", name: "Xưởng Rèn 1" },
  { code: "R2", name: "Xưởng Rèn 2" },
  { code: "CK1", name: "Xưởng Cơ Khí 1" },
  { code: "CK2", name: "Xưởng Cơ Khí 2" },
  { code: "CK3", name: "Xưởng Cơ Khí 3" },
  { code: "MNL", name: "Xưởng Mạ Nhiệt Luyện" },
  { code: "LR", name: "Xưởng Lắp Ráp" },
  { code: "KTP", name: "Kho Thành phẩm" },
];

function getTxTypeLabel(type: string): { label: string; badgeClass: string } {
  switch (type) {
    case "PRODUCTION_INPUT":
      return { label: "Báo Cáo Sản Lượng", badgeClass: "bg-emerald-50 text-emerald-700 border border-emerald-200" };
    case "TRANSFER":
      return { label: "Xuất Chuyển Xưởng", badgeClass: "bg-amber-50 text-amber-700 border border-amber-200" };
    case "SHIPMENT":
      return { label: "Xuất Hàng Khách", badgeClass: "bg-rose-50 text-rose-700 border border-rose-200" };
    case "ADJUST_OPENING_STOCK":
      return { label: "Điều Chỉnh Tồn Đầu Kỳ", badgeClass: "bg-teal-50 text-teal-700 border border-teal-200" };
    case "REVERSAL":
      return { label: "↩ Đảo Bút Toán", badgeClass: "bg-purple-50 text-purple-700 border border-purple-300 font-bold" };
    default:
      return { label: type, badgeClass: "bg-subtle text-txt-secondary border border-border" };
  }
}

export default function HistoryPage() {
  const { data: meData } = useSWR("/api/auth/me", fetcher);
  const userRole = meData?.user?.role || "DISPATCHER";
  const isAdmin = userRole === "ADMIN";

  const [selectedType, setSelectedType] = useState<string>("ALL");
  const [selectedWc, setSelectedWc] = useState<string>("ALL");
  const [searchSku, setSearchSku] = useState<string>("");
  const [filterDate, setFilterDate] = useState<string>("");
  const [selectedTxKeys, setSelectedTxKeys] = useState<Set<string>>(new Set());
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: "asc" | "desc" } | null>(null);

  // Reversal Modal State (ADMIN Only)
  const [reversalTx, setReversalTx] = useState<TransactionHistoryItem | null>(null);
  const [reversalQtyOk, setReversalQtyOk] = useState<string>("");
  const [reversalQtyNg, setReversalQtyNg] = useState<string>("");
  const [reversalReason, setReversalReason] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [modalError, setModalError] = useState("");
  const [toastMessage, setToastMessage] = useState("");

  const swrKey = `/api/production/history?type=${selectedType}&wcCode=${selectedWc}&sku=${encodeURIComponent(
    searchSku
  )}`;

  const { data: rawLogs, isValidating, mutate } = useSWR<TransactionHistoryItem[]>(swrKey, fetcher, {
    revalidateOnFocus: true,
  });

  const logs = useMemo(() => (Array.isArray(rawLogs) ? rawLogs : []), [rawLogs]);

  const openReversalModal = (tx: TransactionHistoryItem) => {
    setReversalTx(tx);
    setReversalQtyOk(String(tx.remainingQtyOk || 0));
    setReversalQtyNg(String(tx.remainingQtyNg || 0));
    setReversalReason("");
    setModalError("");
    setIsSubmitting(false);
  };

  const handleReversalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reversalTx) return;

    const qtyOkNum = Number(reversalQtyOk || 0);
    const qtyNgNum = Number(reversalQtyNg || 0);

    if (qtyOkNum <= 0 && qtyNgNum <= 0) {
      setModalError("Số lượng đảo (OK hoặc NG) phải lớn hơn 0.");
      return;
    }

    if (!reversalReason.trim()) {
      setModalError("Vui lòng nhập lý do đảo bút toán.");
      return;
    }

    setIsSubmitting(true);
    setModalError("");

    try {
      const res = await fetch("/api/inventory/reverse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          originalTxId: reversalTx.id,
          qtyOk: qtyOkNum,
          qtyNg: qtyNgNum,
          reason: reversalReason.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setModalError(data.error || "Đảo bút toán thất bại.");
        setIsSubmitting(false);
        return;
      }

      setToastMessage(data.message || `Đã đảo bút toán thành công cho giao dịch ${reversalTx.id}.`);
      setReversalTx(null);
      mutate();
    } catch {
      setModalError("Không thể kết nối đến máy chủ.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Column Definitions for History DataTable
  const historyColumns: ColumnDef<TransactionHistoryItem>[] = useMemo(
    () => [
      {
        key: "id",
        header: "Mã GD & Thời Gian",
        sortable: true,
        headerClassName: "font-bold text-txt-primary",
        sortValue: (log) => log.loggedAt || "",
        render: (log) => (
          <div className="space-y-0.5">
            <span className="font-mono text-[11px] text-txt-secondary block truncate max-w-[120px]" title={log.id}>
              {log.id.slice(0, 8)}...
            </span>
            <span className="font-mono font-medium text-txt-primary block text-[11px]">{formatTimestampDisplay(log.loggedAt)}</span>
          </div>
        ),
      },
      {
        key: "transactionType",
        header: "Loại Giao Dịch",
        sortable: true,
        render: (log) => {
          const typeInfo = getTxTypeLabel(log.transactionType);
          return (
            <div className="space-y-1">
              <span className={`px-2 py-0.5 rounded text-[10px] ${typeInfo.badgeClass}`}>
                {typeInfo.label}
              </span>
              {log.reversedTransactionId && (
                <div className="text-[10px] text-purple-700 font-mono">
                  Tham chiếu: <span className="underline">{log.reversedTransactionId.slice(0, 8)}...</span>
                </div>
              )}
            </div>
          );
        },
      },
      {
        key: "createdBy",
        header: "Người Thực Hiện",
        sortable: true,
        render: (log) => (
          <div className="flex items-center gap-1.5 font-medium text-txt-primary text-xs">
            <User className="w-3 h-3 text-txt-secondary" />
            <span>{log.createdByName || log.createdBy}</span>
          </div>
        ),
      },
      {
        key: "fromWorkshopCode",
        header: "Xưởng Nguồn",
        sortable: true,
        align: "center",
        render: (log) => (
          <span className="font-mono font-bold text-txt-primary text-xs">{log.fromWorkshopCode || "-"}</span>
        ),
      },
      {
        key: "toWorkshopCode",
        header: "Xưởng Đích",
        sortable: true,
        align: "center",
        render: (log) => (
          <span className="font-mono font-bold text-txt-primary text-xs">
            {log.toWorkshopCode ? (
              <span className="inline-flex items-center gap-1 text-emerald-700">
                <ArrowRight className="w-3 h-3" />
                <span>{log.toWorkshopCode}</span>
              </span>
            ) : (
              "-"
            )}
          </span>
        ),
      },
      {
        key: "sku",
        header: "SKU",
        sortable: true,
        render: (log) => <span className="font-mono font-semibold text-txt-primary text-xs">{log.sku}</span>,
      },
      {
        key: "qtyTpOk",
        header: "Số Lượng (Pcs)",
        sortable: true,
        align: "right",
        sortValue: (log) => log.qtyTpOk || 0,
        render: (log) => (
          <div className="flex flex-col items-end space-y-0.5">
            <span className="font-mono font-bold text-txt-primary text-xs">
              {log.qtyTpOk?.toLocaleString()} pcs OK
            </span>
            {log.qtyNg && log.qtyNg > 0 ? (
              <span className="px-1.5 py-0.5 rounded bg-rose-50 text-rose-600 border border-rose-200 text-[10px] font-semibold">
                🔴 NG: +{log.qtyNg.toLocaleString()} pcs
              </span>
            ) : null}
            {(log.reversedQtyOk || 0) > 0 ? (
              <span className="text-[10px] text-purple-700 font-medium">
                ↩ Đã đảo {log.reversedQtyOk} OK
              </span>
            ) : null}
          </div>
        ),
      },
      {
        key: "note",
        header: "Ghi Chú / Lý Do",
        render: (log) => <span className="text-xs text-txt-secondary line-clamp-1">{log.note || "-"}</span>,
      },
      {
        key: "actions",
        header: "Thao Tác",
        align: "center",
        render: (log) => {
          if (!isAdmin) return <span className="text-txt-secondary text-[11px]">-</span>;
          if (!log.isReversable) {
            return (
              <span className="text-[10px] text-txt-secondary italic">
                {log.transactionType === "REVERSAL" ? "Bản ghi đảo" : "Đã đảo hết"}
              </span>
            );
          }
          return (
            <button
              type="button"
              onClick={() => openReversalModal(log)}
              className="px-2 py-1 rounded bg-purple-50 hover:bg-purple-100 border border-purple-300 text-purple-800 text-[11px] font-semibold flex items-center gap-1 transition-colors mx-auto"
              title="Thực hiện đảo bút toán cho giao dịch này (ADMIN Only)"
            >
              <RotateCcw className="w-3 h-3 text-purple-600" />
              <span>Đảo bút toán</span>
            </button>
          );
        },
      },
    ],
    [isAdmin]
  );

  // Export Excel
  const handleExportExcel = () => {
    if (logs.length === 0) {
      alert("Không có lịch sử giao dịch nào để xuất Excel.");
      return;
    }

    const exportRows = logs.map((log) => ({
      "Mã GD": log.id,
      "Thời Gian": formatTimestampDisplay(log.loggedAt),
      "Loại Giao Dịch": getTxTypeLabel(log.transactionType).label,
      "Người Thực Hiện": log.createdByName || log.createdBy,
      "Xưởng Nguồn": log.fromWorkshopCode || "-",
      "Xưởng Đích": log.toWorkshopCode || "-",
      "SKU": log.sku,
      "SL OK (Pcs)": log.qtyTpOk,
      "SL NG (Pcs)": log.qtyNg,
      "SL Đã Đảo OK": log.reversedQtyOk || 0,
      "Ghi Chú": log.note || "-",
    }));

    const ws = XLSX.utils.json_to_sheet(exportRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Lich_Su_Giao_Dich");
    XLSX.writeFile(wb, `Lich_Su_Giao_Dich_${new Date().toISOString().split("T")[0]}.xlsx`);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-4 rounded bg-canvas border border-border">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded bg-subtle border border-border text-accent">
            <History className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-base font-bold text-txt-primary">Lịch Sử Giao Dịch Sản Xuất & Chuyển Kho (Schema v4)</h1>
            <p className="text-xs text-txt-secondary">
              Nhật ký bất biến ghi nhận báo cáo sản lượng, xuất chuyển xưởng và các bút toán đảo (REVERSAL).
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0 flex-nowrap">
          <button
            type="button"
            onClick={handleExportExcel}
            className="p-2 rounded bg-subtle border border-border hover:bg-border text-txt-primary transition-colors shrink-0 flex items-center gap-1 text-xs"
            title="Xuất lịch sử giao dịch ra file Excel"
          >
            <Download className="w-4 h-4 text-blue-600" />
            <span>Xuất Excel</span>
          </button>
        </div>
      </div>

      {/* DISPATCHER Notice */}
      {!isAdmin && (
        <div className="p-3 rounded bg-blue-50/60 border border-blue-200 text-blue-800 text-xs flex items-center gap-2">
          <Info className="w-4 h-4 text-blue-600 shrink-0" />
          <span>
            <strong>Ghi chú tài khoản Dispatcher:</strong> Phát hiện sai sót số liệu? Vui lòng liên hệ Admin để được thực hiện bút toán đảo (REVERSAL).
          </span>
        </div>
      )}

      {/* Filters Bar */}
      <div className="flex flex-wrap items-center gap-3 p-4 rounded bg-canvas border border-border text-xs">
        {/* Search SKU */}
        <div className="relative flex items-center">
          <Search className="w-4 h-4 absolute left-2.5 text-txt-secondary" />
          <input
            type="text"
            placeholder="Tìm theo SKU..."
            value={searchSku}
            onChange={(e) => setSearchSku(e.target.value)}
            className="pl-8 pr-3 py-1.5 bg-subtle border border-border rounded text-txt-primary focus:outline-none focus:border-accent w-44"
          />
        </div>

        {/* Type Filter */}
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-subtle border border-border text-txt-secondary">
          <Filter className="w-3.5 h-3.5" />
          <span>Loại GD:</span>
          <select
            value={selectedType}
            onChange={(e) => setSelectedType(e.target.value)}
            className="bg-transparent font-medium text-txt-primary focus:outline-none cursor-pointer"
          >
            <option value="ALL">Tất cả loại giao dịch</option>
            <option value="PRODUCTION_INPUT">Báo Cáo Sản Lượng</option>
            <option value="TRANSFER">Xuất Chuyển Xưởng</option>
            <option value="SHIPMENT">Xuất Hàng Khách</option>
            <option value="REVERSAL">↩ Đảo Bút Toán</option>
          </select>
        </div>

        {/* Workcenter Filter */}
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-subtle border border-border text-txt-secondary">
          <Factory className="w-3.5 h-3.5" />
          <span>Xưởng:</span>
          <select
            value={selectedWc}
            onChange={(e) => setSelectedWc(e.target.value)}
            className="bg-transparent font-medium text-txt-primary focus:outline-none cursor-pointer"
          >
            <option value="ALL">Tất cả xưởng</option>
            {MASTER_WORK_CENTERS.map((wc) => (
              <option key={wc.code} value={wc.code}>
                {wc.code} ({wc.name})
              </option>
            ))}
          </select>
        </div>

        <button
          onClick={() => mutate()}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-subtle border border-border text-xs font-medium text-txt-primary hover:bg-border transition-colors ml-auto"
          title="Làm mới dữ liệu"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isValidating ? "animate-spin text-accent" : ""}`} />
          <span>Làm mới</span>
        </button>
      </div>

      {/* Main Shared DataTable for Transaction History */}
      <DataTable<TransactionHistoryItem>
        data={logs}
        columns={historyColumns}
        getItemKey={(log) => log.id}
        selectable={true}
        selectedKeys={selectedTxKeys}
        onSelectionChange={setSelectedTxKeys}
        sortConfig={sortConfig}
        onSortChange={setSortConfig}
        enablePagination={true}
        defaultPageSize={50}
        isLoading={!rawLogs}
        loadingMessage="Đang tải nhật ký lịch sử giao dịch từ PostgreSQL..."
        emptyMessage="Chưa có nhật ký giao dịch nào khớp với bộ lọc."
      />

      {/* Toast Alert */}
      {toastMessage && (
        <div className="fixed bottom-4 right-4 z-50 p-3 rounded bg-emerald-900 text-white text-xs shadow-lg flex items-center justify-between gap-3 max-w-md animate-in fade-in slide-in-from-bottom-4">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{toastMessage}</span>
          </div>
          <button onClick={() => setToastMessage("")} className="text-emerald-300 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ADMIN Reversal Modal */}
      {reversalTx && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-canvas border border-border rounded shadow-lg max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="text-sm font-bold text-txt-primary flex items-center gap-2">
                <RotateCcw className="w-4 h-4 text-purple-600" />
                <span>Thực Hiện Đảo Bút Toán (REVERSAL)</span>
              </h3>
              <button onClick={() => setReversalTx(null)} className="text-txt-secondary hover:text-txt-primary">
                <X className="w-4 h-4" />
              </button>
            </div>

            {modalError && (
              <div className="p-3 rounded bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{modalError}</span>
              </div>
            )}

            <form onSubmit={handleReversalSubmit} className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3 p-3 rounded bg-subtle border border-border font-mono text-[11px]">
                <div>
                  <span className="text-txt-secondary block">Mã Giao Dịch Gốc:</span>
                  <span className="font-bold text-txt-primary">{reversalTx.id.slice(0, 13)}...</span>
                </div>
                <div>
                  <span className="text-txt-secondary block">SKU:</span>
                  <span className="font-bold text-txt-primary">{reversalTx.sku}</span>
                </div>
                <div>
                  <span className="text-txt-secondary block">SL Gốc (OK / NG):</span>
                  <span className="font-bold text-txt-primary">{reversalTx.qtyTpOk} OK / {reversalTx.qtyNg} NG</span>
                </div>
                <div>
                  <span className="text-txt-secondary block">Đã Đảo Trước Đây:</span>
                  <span className="font-bold text-purple-700">{reversalTx.reversedQtyOk || 0} OK / {reversalTx.reversedQtyNg || 0} NG</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-medium text-txt-primary">SL Đảo OK (Pcs): *</label>
                  <input
                    type="number"
                    min="0"
                    max={reversalTx.remainingQtyOk}
                    required
                    value={reversalQtyOk}
                    onChange={(e) => setReversalQtyOk(e.target.value)}
                    className="w-full px-3 py-2 bg-subtle border border-border rounded text-txt-primary font-mono focus:outline-none focus:border-accent"
                  />
                  <span className="text-[10px] text-txt-secondary block">Tối đa còn lại: {reversalTx.remainingQtyOk} pcs</span>
                </div>

                <div className="space-y-1">
                  <label className="font-medium text-txt-primary">SL Đảo NG (Pcs):</label>
                  <input
                    type="number"
                    min="0"
                    max={reversalTx.remainingQtyNg}
                    value={reversalQtyNg}
                    onChange={(e) => setReversalQtyNg(e.target.value)}
                    className="w-full px-3 py-2 bg-subtle border border-border rounded text-txt-primary font-mono focus:outline-none focus:border-accent"
                  />
                  <span className="text-[10px] text-txt-secondary block">Tối đa còn lại: {reversalTx.remainingQtyNg} pcs</span>
                </div>
              </div>

              <div className="space-y-1">
                <label className="font-medium text-txt-primary">Lý Do Đảo Bút Toán: *</label>
                <textarea
                  rows={2}
                  required
                  placeholder="Ghi rõ lý do đảo (VD: Báo cáo nhầm sản lượng...)"
                  value={reversalReason}
                  onChange={(e) => setReversalReason(e.target.value)}
                  className="w-full px-3 py-2 bg-subtle border border-border rounded text-txt-primary focus:outline-none focus:border-accent"
                />
              </div>

              <div className="p-3 rounded bg-purple-50/70 border border-purple-200 text-purple-900 text-[11px]">
                🛡️ <strong>Cơ chế Bảo vệ ADMIN:</strong> Lịch sử giao dịch là bất biến. Lệnh Đảo bút toán này sẽ tạo thêm 1 bản ghi mới `REVERSAL` tham chiếu giao dịch gốc và tự động trừ sản lượng hoàn thành của Work Order tương ứng.
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-border">
                <button
                  type="button"
                  onClick={() => setReversalTx(null)}
                  className="px-4 py-2 rounded border border-border text-txt-secondary hover:bg-subtle"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 rounded bg-purple-700 hover:bg-purple-800 text-white font-medium disabled:opacity-50"
                >
                  {isSubmitting ? "Đang tạo bút toán đảo..." : "Xác Nhận Đảo Bút Toán"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
