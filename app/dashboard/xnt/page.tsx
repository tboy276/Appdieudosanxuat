"use client";

import { useState, useMemo } from "react";
import useSWR from "swr";
import {
  CalendarDays,
  Search,
  RefreshCw,
  AlertTriangle,
  Layers,
  ArrowUpRight,
  SlidersHorizontal,
  Plus,
  ArrowRight,
  ArrowLeftRight,
  X,
  CheckCircle2,
  ArrowUpDown,
} from "lucide-react";

import { WO } from "@/lib/po-wo-engine";
import { Product } from "@/lib/types";
import DataTable, { ColumnDef, ColumnGroupDef } from "@/components/DataTable";
import { getTodayVN, formatDateDisplay, createExcelDateCell } from "@/lib/date-utils";

interface StockBreakdown {
  tonPhoi: number;
  tonThanhPham: number;
}

interface XNTItem {
  wcCode: string;
  sku: string;
  opening: StockBreakdown;
  nhap: StockBreakdown;
  xuat: StockBreakdown;
  closing: StockBreakdown;
}

const fetcher = (url: string) => fetch(url).then((res) => res.json());

const MASTER_WC_ORDER = [
  "CUAPHOI",
  "D1",
  "D2",
  "R1",
  "R2",
  "CK1",
  "CK2",
  "CK3",
  "MNL",
  "LR",
  "KTP",
];

export default function XNTDashboardPage() {
  const [selectedDate, setSelectedDate] = useState<string>(getTodayVN());
  const [filterSku, setFilterSku] = useState("");
  const [lowStockThreshold, setLowStockThreshold] = useState<number>(50);

  // Row Selection State (Problem 3)
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

  // Manual Sort State (Problem 2)
  const [sortConfig, setSortConfig] = useState<{
    key: string;
    direction: "asc" | "desc";
  } | null>(null);

  // Input Modal state
  const [inputModalItem, setInputModalItem] = useState<XNTItem | null>(null);
  const [inputQty, setInputQty] = useState("");
  const [inputNgQty, setInputNgQty] = useState("0");
  const [inputWoId, setInputWoId] = useState("");
  const [inputIsSubmitting, setInputIsSubmitting] = useState(false);
  const [inputError, setInputError] = useState("");

  // Transfer Modal state
  const [transferModalItem, setTransferModalItem] = useState<XNTItem | null>(null);
  const [transferToWc, setTransferToWc] = useState("");
  const [transferQty, setTransferQty] = useState("");
  const [transferWoId, setTransferWoId] = useState("");
  const [transferIsSubmitting, setTransferIsSubmitting] = useState(false);
  const [transferError, setTransferError] = useState("");

  const [toastMessage, setToastMessage] = useState("");

  const swrKey = `/api/xnt?date=${selectedDate}${
    filterSku ? `&sku=${encodeURIComponent(filterSku)}` : ""
  }`;

  const { data: report, error, isValidating, mutate } = useSWR<XNTItem[]>(
    swrKey,
    fetcher,
    {
      revalidateOnFocus: true,
    }
  );

  const { data: wosData } = useSWR<WO[]>("/api/wo", fetcher);
  const { data: productsData } = useSWR<Product[]>("/api/products", fetcher);

  const wos = useMemo(() => (Array.isArray(wosData) ? wosData : []), [wosData]);
  const products = useMemo(() => (Array.isArray(productsData) ? productsData : []), [productsData]);
  const rawReportItems = useMemo(() => (Array.isArray(report) ? report : []), [report]);

  // PHẦN 2: Build Map<sku, WO[]> index once when wos array changes (O(M) complexity)
  const wosBySkuMap = useMemo(() => {
    const map = new Map<string, WO[]>();
    for (const w of wos) {
      if (!w.sku) continue;
      const list = map.get(w.sku);
      if (list) {
        list.push(w);
      } else {
        map.set(w.sku, [w]);
      }
    }
    return map;
  }, [wos]);

  // PROBLEM 2: Deterministic & Stable Sorting (re-applies on 5s SWR auto-refresh)
  const reportItems = useMemo(() => {
    const sorted = [...rawReportItems];

    if (!sortConfig) {
      // Baseline STABLE order based on Routing Order + SKU
      return sorted.sort((a, b) => {
        const indexA = MASTER_WC_ORDER.indexOf(a.wcCode);
        const indexB = MASTER_WC_ORDER.indexOf(b.wcCode);
        const orderA = indexA !== -1 ? indexA : 999;
        const orderB = indexB !== -1 ? indexB : 999;

        if (orderA !== orderB) return orderA - orderB;
        return a.sku.localeCompare(b.sku);
      });
    }

    // Manual Sort
    const { key, direction } = sortConfig;
    const mult = direction === "asc" ? 1 : -1;

    return sorted.sort((a, b) => {
      let valA: any = 0;
      let valB: any = 0;

      switch (key) {
        case "wcCode":
          return mult * a.wcCode.localeCompare(b.wcCode);
        case "sku":
          return mult * a.sku.localeCompare(b.sku);
        case "openingPhoi":
          valA = a.opening.tonPhoi;
          valB = b.opening.tonPhoi;
          break;
        case "nhapPhoi":
          valA = a.nhap.tonPhoi;
          valB = b.nhap.tonPhoi;
          break;
        case "xuatPhoi":
          valA = a.xuat.tonPhoi;
          valB = b.xuat.tonPhoi;
          break;
        case "closingPhoi":
          valA = a.closing.tonPhoi;
          valB = b.closing.tonPhoi;
          break;
        case "openingTP":
          valA = a.opening.tonThanhPham;
          valB = b.opening.tonThanhPham;
          break;
        case "nhapTP":
          valA = a.nhap.tonThanhPham;
          valB = b.nhap.tonThanhPham;
          break;
        case "xuatTP":
          valA = a.xuat.tonThanhPham;
          valB = b.xuat.tonThanhPham;
          break;
        case "closingTP":
          valA = a.closing.tonThanhPham;
          valB = b.closing.tonThanhPham;
          break;
        default:
          return 0;
      }

      if (valA < valB) return -1 * mult;
      if (valA > valB) return 1 * mult;
      return 0;
    });
  }, [rawReportItems, sortConfig]);

  // PHẦN 3: Pagination State (Default 50 rows per page)
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  const totalItems = reportItems.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = Math.min(currentPage, totalPages);

  const paginatedItems = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return reportItems.slice(start, start + pageSize);
  }, [reportItems, safePage, pageSize]);

  // Sort Toggle Handler
  const handleSort = (key: string) => {
    setCurrentPage(1);
    if (sortConfig && sortConfig.key === key) {
      if (sortConfig.direction === "asc") {
        setSortConfig({ key, direction: "desc" });
      } else {
        setSortConfig(null);
      }
    } else {
      setSortConfig({ key, direction: "asc" });
    }
  };

  // Row Selection Handlers
  const getItemKey = (item: XNTItem) => `${item.wcCode}:${item.sku}`;

  const handleToggleSelectRow = (key: string) => {
    const next = new Set(selectedKeys);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    setSelectedKeys(next);
  };

  const handleToggleSelectAll = () => {
    const displayedKeys = paginatedItems.map(getItemKey);
    const allSelected = displayedKeys.every((k) => selectedKeys.has(k));

    const next = new Set(selectedKeys);
    if (allSelected) {
      displayedKeys.forEach((k) => next.delete(k));
    } else {
      displayedKeys.forEach((k) => next.add(k));
    }
    setSelectedKeys(next);
  };

  // Open Input Modal
  const openInputModal = (item: XNTItem) => {
    setInputModalItem(item);
    setInputQty("");
    setInputNgQty("0");
    setInputWoId("");
    setInputError("");
    setInputIsSubmitting(false);
  };

  // Open Transfer Modal
  const openTransferModal = (item: XNTItem) => {
    setTransferModalItem(item);
    setTransferQty("");
    setTransferWoId("");
    setTransferError("");
    setTransferIsSubmitting(false);

    const prod = products.find((p) => p.sku === item.sku);
    if (prod && prod.routing) {
      const idx = prod.routing.indexOf(item.wcCode);
      if (idx !== -1 && idx < prod.routing.length - 1) {
        setTransferToWc(prod.routing[idx + 1]);
      } else {
        setTransferToWc("");
      }
    } else {
      setTransferToWc("");
    }
  };

  // Top Bar Action Click Handlers (Problem 3)
  const handleTopInputClick = () => {
    if (selectedKeys.size === 0) return;
    if (selectedKeys.size > 1) {
      setToastMessage("Vui lòng chỉ chọn 1 dòng để thực hiện thao tác này.");
      return;
    }
    const key = Array.from(selectedKeys)[0];
    const item = reportItems.find((i) => getItemKey(i) === key);
    if (item) {
      openInputModal(item);
    }
  };

  const handleTopTransferClick = () => {
    if (selectedKeys.size === 0) return;
    if (selectedKeys.size > 1) {
      setToastMessage("Vui lòng chỉ chọn 1 dòng để thực hiện thao tác này.");
      return;
    }
    const key = Array.from(selectedKeys)[0];
    const item = reportItems.find((i) => getItemKey(i) === key);
    if (item) {
      openTransferModal(item);
    }
  };

  // Submit Input
  const handleInputSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputModalItem) return;

    const qtyNum = Number(inputQty);
    const ngNum = Math.max(0, Number(inputNgQty || 0));
    if ((!qtyNum || qtyNum <= 0) && ngNum <= 0) {
      setInputError("Sản lượng báo cáo (TP đạt hoặc NG phế phẩm) phải lớn hơn 0.");
      return;
    }

    setInputIsSubmitting(true);
    setInputError("");

    try {
      const res = await fetch("/api/production/input", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wcCode: inputModalItem.wcCode,
          sku: inputModalItem.sku,
          actualQty: qtyNum,
          ngQty: ngNum,
          woId: inputWoId || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setInputError(data.error || "Báo cáo sản lượng thất bại.");
        setInputIsSubmitting(false);
        return;
      }

      setToastMessage(
        data.message || `Đã ghi nhận +${qtyNum.toLocaleString()} pcs TP cho xưởng ${inputModalItem.wcCode} (SKU: ${inputModalItem.sku}).`
      );
      setInputModalItem(null);
      setSelectedKeys(new Set()); // Reset selection after successful action
      mutate();
    } catch {
      setInputError("Không thể kết nối đến máy chủ.");
    } finally {
      setInputIsSubmitting(false);
    }
  };

  // Submit Transfer
  const handleTransferSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!transferModalItem) return;

    if (!transferToWc) {
      setTransferError("Vui lòng chọn xưởng đích nhận hàng.");
      return;
    }

    const qtyNum = Number(transferQty);
    if (!qtyNum || qtyNum <= 0) {
      setTransferError("Số lượng xuất chuyển phải lớn hơn 0.");
      return;
    }

    setTransferIsSubmitting(true);
    setTransferError("");

    try {
      const res = await fetch("/api/production/transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fromCode: transferModalItem.wcCode,
          toCode: transferToWc,
          sku: transferModalItem.sku,
          qty: qtyNum,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setTransferError(data.error || "Xuất chuyển sản phẩm thất bại.");
        setTransferIsSubmitting(false);
        return;
      }

      setToastMessage(
        `Chuyển thành công ${qtyNum.toLocaleString()} pcs từ xưởng ${transferModalItem.wcCode} ➔ ${transferToWc} (SKU: ${transferModalItem.sku}).`
      );
      setTransferModalItem(null);
      setSelectedKeys(new Set()); // Reset selection after successful action
      mutate();
    } catch {
      setTransferError("Không thể kết nối đến máy chủ.");
    } finally {
      setTransferIsSubmitting(false);
    }
  };

  // Summary Metrics
  const totalPairs = reportItems.length;
  const totalOutputTP = reportItems.reduce(
    (sum, item) => sum + (item.nhap.tonThanhPham || 0),
    0
  );
  const lowStockCount = reportItems.filter(
    (item) => item.closing.tonPhoi < lowStockThreshold
  ).length;

  const isAllSelected =
    reportItems.length > 0 &&
    reportItems.every((item) => selectedKeys.has(getItemKey(item)));

  // Column Definitions for Shared DataTable
  const xntGroupHeaders: ColumnGroupDef[] = useMemo(
    () => [
      { title: "Thực Thể", colSpan: 2 },
      { title: "1. KHU VỰC PHÔI", colSpan: 4, headerClassName: "bg-blue-50/70 text-blue-900 font-bold" },
      { title: "2. KHU VỰC THÀNH PHẨM", colSpan: 4, headerClassName: "bg-emerald-50/70 text-emerald-900 font-bold" },
      { title: "3. NHU CẦU WO TẠI XƯỞNG", colSpan: 2, headerClassName: "text-amber-900 bg-amber-50/70 font-bold" },
    ],
    []
  );

  const xntColumns: ColumnDef<XNTItem>[] = useMemo(
    () => [
      {
        key: "wcCode",
        header: "Xưởng",
        sortable: true,
        render: (item) => {
          // Low-stock warning only meaningful for non-KTP (KTP Tồn Phôi = N/A)
          const isKTP = item.wcCode === "KTP";
          const isLowStock = !isKTP && item.closing.tonPhoi < lowStockThreshold;
          return (
            <div className="flex items-center gap-1.5 font-semibold text-txt-primary">
              {isLowStock && (
                <span title={`Cảnh báo: Tồn phôi (${item.closing.tonPhoi} pcs) thấp hơn ngưỡng ${lowStockThreshold} pcs`}>
                  <AlertTriangle className="w-3.5 h-3.5 text-warning shrink-0" />
                </span>
              )}
              <span>{item.wcCode}</span>
            </div>
          );
        },
      },
      {
        key: "sku",
        header: "SKU",
        sortable: true,
        render: (item) => <span className="font-mono text-txt-secondary">{item.sku}</span>,
      },
      // 1. PHÔI (not applicable for KTP)
      {
        key: "openingPhoi",
        header: "Tồn Đầu",
        sortable: true,
        align: "right",
        sortValue: (item) => item.opening.tonPhoi,
        render: (item) => item.wcCode === "KTP"
          ? <span className="text-txt-secondary/40 font-mono">—</span>
          : <span className="font-mono text-txt-secondary">{item.opening.tonPhoi}</span>,
      },
      {
        key: "nhapPhoi",
        header: "Nhập",
        sortable: true,
        align: "right",
        headerClassName: "text-emerald-700",
        sortValue: (item) => item.nhap.tonPhoi,
        render: (item) => item.wcCode === "KTP"
          ? <span className="text-txt-secondary/40 font-mono">—</span>
          : (
            <span className="font-mono font-medium text-emerald-600">
              {item.nhap.tonPhoi > 0 ? `+${item.nhap.tonPhoi}` : 0}
            </span>
          ),
      },
      {
        key: "xuatPhoi",
        header: "Xuất",
        sortable: true,
        align: "right",
        headerClassName: "text-amber-700",
        sortValue: (item) => item.xuat.tonPhoi,
        render: (item) => item.wcCode === "KTP"
          ? <span className="text-txt-secondary/40 font-mono">—</span>
          : (
            <span className="font-mono font-medium text-amber-600">
              {item.xuat.tonPhoi > 0 ? `-${item.xuat.tonPhoi}` : 0}
            </span>
          ),
      },
      {
        key: "closingPhoi",
        header: "Tồn Cuối",
        sortable: true,
        align: "right",
        headerClassName: "font-bold text-txt-primary",
        sortValue: (item) => item.closing.tonPhoi,
        render: (item) => {
          if (item.wcCode === "KTP") return <span className="text-txt-secondary/40 font-mono">—</span>;
          const isLowStock = item.closing.tonPhoi < lowStockThreshold;
          return (
            <span className={`font-mono font-bold ${isLowStock ? "text-amber-700" : "text-txt-primary"}`}>
              {item.closing.tonPhoi}
            </span>
          );
        },
      },
      // 2. THÀNH PHẨM
      {
        key: "openingTP",
        header: "Tồn Đầu",
        sortable: true,
        align: "right",
        sortValue: (item) => item.opening.tonThanhPham,
        render: (item) => <span className="font-mono text-txt-secondary">{item.opening.tonThanhPham}</span>,
      },
      {
        key: "nhapTP",
        header: "Nhập",
        sortable: true,
        align: "right",
        headerClassName: "text-emerald-700",
        sortValue: (item) => item.nhap.tonThanhPham,
        render: (item) => (
          <span className="font-mono font-medium text-emerald-600">
            {item.nhap.tonThanhPham > 0 ? `+${item.nhap.tonThanhPham}` : 0}
          </span>
        ),
      },
      {
        key: "xuatTP",
        header: "Xuất",
        sortable: true,
        align: "right",
        headerClassName: "text-amber-700",
        sortValue: (item) => item.xuat.tonThanhPham,
        render: (item) => (
          <span className="font-mono font-medium text-amber-600">
            {item.xuat.tonThanhPham > 0 ? `-${item.xuat.tonThanhPham}` : 0}
          </span>
        ),
      },
      {
        key: "closingTP",
        header: "Tồn Cuối",
        sortable: true,
        align: "right",
        headerClassName: "font-bold text-txt-primary",
        sortValue: (item) => item.closing.tonThanhPham,
        render: (item) => <span className="font-mono font-bold text-txt-primary">{item.closing.tonThanhPham}</span>,
      },
      // 3. WO REQUIREMENT
      {
        key: "woActive",
        header: "WO Active",
        align: "center",
        headerClassName: "font-bold text-amber-800",
        render: (item) => {
          const skuWos = wosBySkuMap.get(item.sku) || [];
          const activeWos = skuWos.filter((w) => w.status !== "SHIPPED" && w.wcCode === item.wcCode);
          return (
            <span className="font-mono font-bold text-blue-700">
              {activeWos.length > 0 ? `${activeWos.length} WO` : "0"}
            </span>
          );
        },
      },
      {
        key: "woRequirement",
        header: "Tồn / Nhu Cầu WO",
        align: "center",
        headerClassName: "font-bold text-amber-800",
        render: (item) => {
          const skuWos = wosBySkuMap.get(item.sku) || [];
          const activeWos = skuWos.filter((w) => w.status !== "SHIPPED" && w.wcCode === item.wcCode);
          const woRequiredQty = activeWos.reduce((sum, w) => sum + (w.targetQty || 0), 0);

          const isFinalStep = item.wcCode === "LR";
          const availableStock = isFinalStep ? item.closing.tonThanhPham : item.closing.tonPhoi;
          const isStockShortage = woRequiredQty > 0 && availableStock < woRequiredQty;

          if (woRequiredQty <= 0) return <span className="text-txt-secondary text-[11px]">—</span>;

          return (
            <div className="flex flex-col items-center gap-0.5 font-mono text-xs">
              <span className="font-bold text-txt-primary">
                {availableStock.toLocaleString()} / {woRequiredQty.toLocaleString()} pcs
              </span>
              {isStockShortage ? (
                <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-red-500/10 text-red-600 border border-red-500/30">
                  🔴 Thiếu {woRequiredQty - availableStock} pcs
                </span>
              ) : (
                <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/10 text-emerald-600 border border-emerald-500/30">
                  🟢 Đủ phôi cấp WO
                </span>
              )}
            </div>
          );
        },
      },
    ],
    [lowStockThreshold, wosBySkuMap]
  );

  return (
    <div className="space-y-6">
      {/* Top Summary Metrics Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-4 rounded bg-canvas border border-border flex items-center justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-txt-secondary">
              Tổng Số Cặp Xưởng - SKU
            </p>
            <p className="text-2xl font-extrabold text-txt-primary tabular-nums font-mono mt-1">
              {totalPairs}
            </p>
          </div>
          <div className="flex items-center justify-center w-9 h-9 rounded bg-subtle text-txt-primary">
            <Layers className="w-4 h-4" />
          </div>
        </div>

        <div className="p-4 rounded bg-canvas border border-border flex items-center justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-txt-secondary">
              Sản Lượng Thành Phẩm Tạo Trong Kỳ
            </p>
            <p className="text-2xl font-extrabold text-emerald-600 tabular-nums font-mono mt-1">
              +{totalOutputTP.toLocaleString()} <span className="text-xs font-normal">pcs</span>
            </p>
          </div>
          <div className="flex items-center justify-center w-9 h-9 rounded bg-emerald-50 text-emerald-600">
            <ArrowUpRight className="w-4 h-4" />
          </div>
        </div>

        <div className="p-4 rounded bg-canvas border border-border flex items-center justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-txt-secondary">
              Xưởng Cảnh Báo Thiếu Phôi
            </p>
            <p className="text-2xl font-extrabold text-amber-600 tabular-nums font-mono mt-1">
              {lowStockCount} <span className="text-xs font-normal">cảnh báo</span>
            </p>
          </div>
          <div className="flex items-center justify-center w-9 h-9 rounded bg-amber-50 text-amber-600">
            <AlertTriangle className="w-4 h-4" />
          </div>
        </div>
      </div>

      {/* Action Header & Filters */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-4 rounded bg-canvas border border-border">
        <div className="flex flex-wrap items-center gap-3">
          {/* Date Picker Filter */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded bg-subtle border border-border text-xs text-txt-secondary">
            <CalendarDays className="w-4 h-4" />
            <span className="font-medium text-txt-primary">Kỳ ngày:</span>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="bg-transparent font-medium text-txt-primary focus:outline-none cursor-pointer"
            />
          </div>

          {/* SKU Combobox Search Filter */}
          <div className="relative flex items-center">
            <Search className="w-4 h-4 absolute left-2.5 text-txt-secondary" />
            <input
              type="text"
              placeholder="Tìm kiếm theo mã SKU..."
              value={filterSku}
              onChange={(e) => setFilterSku(e.target.value)}
              className="pl-8 pr-3 py-1.5 text-xs bg-subtle border border-border rounded text-txt-primary focus:outline-none focus:border-accent w-44 sm:w-56"
            />
          </div>

          {/* Threshold Config */}
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-subtle border border-border text-xs text-txt-secondary">
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span>Ngưỡng:</span>
            <input
              type="number"
              min="0"
              value={lowStockThreshold}
              onChange={(e) => setLowStockThreshold(Number(e.target.value) || 0)}
              className="w-14 bg-canvas border border-border rounded px-1.5 py-0.5 text-xs text-txt-primary text-center focus:outline-none"
            />
            <span>pcs</span>
          </div>

          {/* Manual Refresh */}
          <button
            onClick={() => mutate()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-subtle border border-border text-xs font-medium text-txt-primary hover:bg-border transition-colors"
            title="Làm mới dữ liệu (Tự động cập nhật khi quay lại trang)"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isValidating ? "animate-spin text-accent" : ""}`} />
            <span>Làm mới</span>
          </button>
        </div>

        {/* Right-aligned Actions & Indicator */}
        <div className="flex items-center gap-3 shrink-0">
          {selectedKeys.size > 0 && (
            <span className="text-xs font-semibold text-accent font-mono bg-accent/10 px-2.5 py-1 rounded border border-accent/20">
              Đã chọn {selectedKeys.size} dòng
            </span>
          )}

          {/* Minimalist Icon Action Buttons (Right-Aligned) */}
          <div className="flex items-center gap-1.5 border-l border-border pl-3">
            <button
              onClick={handleTopInputClick}
              disabled={selectedKeys.size === 0}
              className="w-8 h-8 inline-flex items-center justify-center rounded bg-emerald-600 hover:bg-emerald-700 text-white font-bold transition-all disabled:opacity-30 disabled:cursor-not-allowed shadow-sm"
              title="Nhập sản lượng"
            >
              <Plus className="w-4 h-4" />
            </button>

            <button
              onClick={handleTopTransferClick}
              disabled={selectedKeys.size === 0}
              className="w-8 h-8 inline-flex items-center justify-center rounded bg-accent hover:opacity-90 text-white font-bold transition-all disabled:opacity-30 disabled:cursor-not-allowed shadow-sm"
              title="Chuyển xưởng"
            >
              <ArrowLeftRight className="w-4 h-4" />
            </button>
          </div>

          <div className="flex items-center gap-2 text-xs text-txt-secondary border-l border-border pl-3">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            <span>Tự động cập nhật (5s)</span>
          </div>
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="p-3 rounded bg-amber-50 border border-amber-200 text-amber-800 text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
          <span>{error.message || "Đã xảy ra lỗi khi tải dữ liệu Xuất-Nhập-Tồn."}</span>
        </div>
      )}



      {/* Shared Excel-Style DataTable Component */}
      <DataTable<XNTItem>
        data={reportItems}
        columns={xntColumns}
        groupHeaders={xntGroupHeaders}
        getItemKey={(item) => `${item.wcCode}:${item.sku}`}
        selectable={true}
        selectedKeys={selectedKeys}
        onSelectionChange={setSelectedKeys}
        sortConfig={sortConfig}
        onSortChange={setSortConfig}
        enablePagination={true}
        defaultPageSize={50}
        isLoading={!report && !error}
        loadingMessage="Đang tải dữ liệu Xuất-Nhập-Tồn..."
        emptyMessage="Không có dòng nào khớp với điều kiện lọc hoặc chưa khởi tạo tồn kho cho ngày này."
        getRowClassName={(item) => {
          const isLowStock = item.closing.tonPhoi < lowStockThreshold;
          const skuWos = wosBySkuMap.get(item.sku) || [];
          const activeWos = skuWos.filter(
            (w) => w.status !== "SHIPPED" && w.wcCode === item.wcCode
          );
          const woRequiredQty = activeWos.reduce((sum, w) => sum + (w.targetQty || 0), 0);

          const isFinalStep = item.wcCode === "LR";
          const availableStock = isFinalStep ? item.closing.tonThanhPham : item.closing.tonPhoi;
          const isStockShortage = woRequiredQty > 0 && availableStock < woRequiredQty;

          if (isLowStock || isStockShortage) return "bg-amber-50/40 hover:bg-amber-50/70";
          return "";
        }}
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

      {/* Quick Input Modal */}
      {inputModalItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-canvas border border-border rounded shadow-lg max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="text-sm font-bold text-txt-primary flex items-center gap-2">
                <Plus className="w-4 h-4 text-emerald-600" />
                <span>Báo Cáo Sản Lượng — Xưởng {inputModalItem.wcCode}</span>
              </h3>
              <button onClick={() => setInputModalItem(null)} className="text-txt-secondary hover:text-txt-primary">
                <X className="w-4 h-4" />
              </button>
            </div>

            {inputError && (
              <div className="p-3 rounded bg-amber-50 border border-amber-200 text-warning text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{inputError}</span>
              </div>
            )}

            <form onSubmit={handleInputSubmit} className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3 p-3 rounded bg-subtle border border-border">
                <div>
                  <span className="text-txt-secondary block">Mã Xưởng:</span>
                  <span className="font-bold text-txt-primary font-mono">{inputModalItem.wcCode}</span>
                </div>
                <div>
                  <span className="text-txt-secondary block">SKU Sản Phẩm:</span>
                  <span className="font-bold text-txt-primary font-mono">{inputModalItem.sku}</span>
                </div>
              </div>

              <div className="space-y-1">
                <label className="font-medium text-txt-primary">Số Lượng Thành Phẩm Đạt (Pcs): *</label>
                <input
                  type="number"
                  min="1"
                  required
                  placeholder="Ví dụ: 500"
                  value={inputQty}
                  onChange={(e) => setInputQty(e.target.value)}
                  className="w-full px-3 py-2 bg-subtle border border-border rounded text-txt-primary font-mono focus:outline-none focus:border-accent"
                />
              </div>

              <div className="space-y-1">
                <label className="font-medium text-txt-primary flex items-center justify-between">
                  <span>Số Lượng NG / Phế Phẩm (Pcs):</span>
                  <span className="text-[10px] text-txt-secondary font-normal">Mặc định 0 nếu không có</span>
                </label>
                <input
                  type="number"
                  min="0"
                  placeholder="0"
                  value={inputNgQty}
                  onChange={(e) => setInputNgQty(e.target.value)}
                  className="w-full px-3 py-2 bg-subtle border border-border rounded text-txt-primary font-mono focus:outline-none focus:border-accent"
                />
                <p className="text-[10px] text-txt-secondary">
                  💡 Phôi tiêu hao từ xưởng = Thành Phẩm ({(Number(inputQty) || 0).toLocaleString()} pcs) + NG ({(Number(inputNgQty) || 0).toLocaleString()} pcs) = <b>{( (Number(inputQty) || 0) + (Number(inputNgQty) || 0) ).toLocaleString()} pcs</b> phôi.
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="font-medium text-txt-secondary flex items-center justify-between">
                  <span>Phân Bổ Lệnh Sản Xuất WO:</span>
                  <span className="text-[10px] text-accent font-semibold">⚡ Tự động theo hạn giao</span>
                </label>
                {(() => {
                  const pairWos = wos.filter(
                    (w) =>
                      w.sku === inputModalItem.sku &&
                      w.wcCode === inputModalItem.wcCode &&
                      w.status !== "SHIPPED" &&
                      w.status !== "READY_TO_SHIP"
                  );
                  if (pairWos.length === 0) {
                    return (
                      <p className="p-2 rounded bg-subtle border border-border text-[11px] text-txt-secondary italic">
                        Không có WO nào đang mở tại xưởng này. Sản lượng sẽ vào tồn kho dôi dư.
                      </p>
                    );
                  }
                  return (
                    <div className="space-y-1.5">
                      <select
                        value={inputWoId}
                        onChange={(e) => setInputWoId(e.target.value)}
                        className="w-full px-3 py-2 bg-subtle border border-border rounded text-txt-primary font-mono focus:outline-none focus:border-accent"
                      >
                        <option value="">⚡ Tự động phân bổ theo hạn giao (Mặc định)</option>
                        {pairWos.map((w) => (
                          <option key={w.woId} value={w.woId}>
                            Chỉ định: {w.woId} (Mục tiêu: {w.targetQty} pcs, Hạn: {w.deadline || "—"})
                          </option>
                        ))}
                      </select>
                    </div>
                  );
                })()}
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-border">
                <button
                  type="button"
                  onClick={() => setInputModalItem(null)}
                  className="px-4 py-2 rounded border border-border text-txt-secondary hover:bg-subtle"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={inputIsSubmitting}
                  className="px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-medium disabled:opacity-50"
                >
                  {inputIsSubmitting ? "Đang xử lý..." : "Xác Nhận Nhập"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Quick Transfer Modal (Physical Movement - Decoupled from WO) */}
      {transferModalItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-canvas border border-border rounded shadow-lg max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="text-sm font-bold text-txt-primary flex items-center gap-2">
                <ArrowRight className="w-4 h-4 text-accent" />
                <span>Xuất Chuyển Xưởng (Vật Lý) — Từ {transferModalItem.wcCode}</span>
              </h3>
              <button onClick={() => setTransferModalItem(null)} className="text-txt-secondary hover:text-txt-primary">
                <X className="w-4 h-4" />
              </button>
            </div>

            {transferError && (
              <div className="p-3 rounded bg-amber-50 border border-amber-200 text-warning text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{transferError}</span>
              </div>
            )}

            <form onSubmit={handleTransferSubmit} className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3 p-3 rounded bg-subtle border border-border">
                <div>
                  <span className="text-txt-secondary block">Xưởng Nguồn:</span>
                  <span className="font-bold text-txt-primary font-mono">{transferModalItem.wcCode}</span>
                </div>
                <div>
                  <span className="text-txt-secondary block">SKU Sản Phẩm:</span>
                  <span className="font-bold text-txt-primary font-mono">{transferModalItem.sku}</span>
                </div>
              </div>

              <div className="space-y-1">
                <label className="font-medium text-txt-primary">Xưởng Đích Nhận Hàng: *</label>
                <input
                  type="text"
                  required
                  placeholder="Ví dụ: D1, CK1..."
                  value={transferToWc}
                  onChange={(e) => setTransferToWc(e.target.value.toUpperCase())}
                  className="w-full px-3 py-2 bg-subtle border border-border rounded text-txt-primary font-mono focus:outline-none focus:border-accent"
                />
              </div>

              <div className="space-y-1">
                <label className="font-medium text-txt-primary">Số Lượng Xuất Chuyển (Pcs): *</label>
                <input
                  type="number"
                  min="1"
                  required
                  placeholder="Ví dụ: 300"
                  value={transferQty}
                  onChange={(e) => setTransferQty(e.target.value)}
                  className="w-full px-3 py-2 bg-subtle border border-border rounded text-txt-primary font-mono focus:outline-none focus:border-accent"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-border">
                <button
                  type="button"
                  onClick={() => setTransferModalItem(null)}
                  className="px-4 py-2 rounded border border-border text-txt-secondary hover:bg-subtle"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={transferIsSubmitting}
                  className="px-4 py-2 rounded bg-accent hover:opacity-90 text-white font-medium disabled:opacity-50"
                >
                  {transferIsSubmitting ? "Đang xử lý..." : "Xác Nhận Chuyển"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
