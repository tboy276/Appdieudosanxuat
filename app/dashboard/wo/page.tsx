"use client";

import React, { useState, useMemo } from "react";
import useSWR from "swr";
import Link from "next/link";
import * as XLSX from "xlsx";
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
  Download,
  FileSpreadsheet,
  User,
  Factory,
  Pencil,
  SlidersHorizontal,
} from "lucide-react";
import DataTable, { ColumnDef } from "@/components/DataTable";
import { WO, PO, computeBackwardWOPlannedQtys, computeBackwardWODeadlines } from "@/lib/po-wo-engine";
import { GanttWOItem } from "@/lib/wo-postgres";
import GanttChartView from "./components/GanttChartView";
import { Product } from "@/lib/types";
import { LABELS } from "@/lib/labels";
import {
  getTodayVN,
  formatDateDisplay,
  formatTimestampDisplay,
  createExcelDateCell,
  daysBetween,
  subtractDays,
} from "@/lib/date-utils";

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
];

function formatDate(dateStr?: string): string {
  return formatTimestampDisplay(dateStr);
}

export default function WOPage() {
  const { data: wosData, isValidating, mutate: mutateWOs } = useSWR<WO[]>("/api/wo", fetcher, {
    revalidateOnFocus: true,
  });
  const { data: posData, mutate: mutatePOs } = useSWR<PO[]>("/api/po", fetcher);
  const { data: productsData } = useSWR<Product[]>("/api/products", fetcher);

  const wos = useMemo(() => (Array.isArray(wosData) ? wosData : []), [wosData]);
  const pos = useMemo(() => (Array.isArray(posData) ? posData : []), [posData]);
  const products = useMemo(() => (Array.isArray(productsData) ? productsData : []), [productsData]);

  const [viewMode, setViewMode] = useState<"table" | "gantt">("table");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedStatus, setSelectedStatus] = useState<string>("ALL");
  const [selectedCustomer, setSelectedCustomer] = useState<string>("ALL");
  const [selectedWorkcenter, setSelectedWorkcenter] = useState<string>("ALL");
  const [selectedWoKeys, setSelectedWoKeys] = useState<Set<string>>(new Set());
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: "asc" | "desc" } | null>(null);
  const [isColPickerOpen, setIsColPickerOpen] = useState(false);

  // Fetch Gantt data when in Gantt view mode
  const ganttQueryString = useMemo(() => {
    const params = new URLSearchParams();
    if (selectedCustomer !== "ALL") params.set("customerName", selectedCustomer);
    if (selectedWorkcenter !== "ALL") params.set("wcCode", selectedWorkcenter);
    if (searchQuery) params.set("search", searchQuery);
    return params.toString() ? `/api/wo/gantt?${params.toString()}` : "/api/wo/gantt";
  }, [selectedCustomer, selectedWorkcenter, searchQuery]);

  const { data: ganttRes, isValidating: isGanttLoading } = useSWR<{
    data: GanttWOItem[];
    totalCount: number;
    requiresFilter: boolean;
  }>(viewMode === "gantt" ? ganttQueryString : null, fetcher);

  const ganttItems = useMemo(() => ganttRes?.data || [], [ganttRes]);
  const ganttRequiresFilter = useMemo(() => !!ganttRes?.requiresFilter, [ganttRes]);
  const ganttTotalCount = useMemo(() => ganttRes?.totalCount || 0, [ganttRes]);

  // Column visibility — persisted in localStorage
  const WO_COL_STORAGE_KEY = "wo-hidden-cols-v1";
  const DEFAULT_HIDDEN_COLS = new Set([
    "createdAt", "requestedDate", "productNameVi", "status", "leadTime", "daysRemaining",
  ]);
  const [hiddenWoCols, setHiddenWoCols] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return DEFAULT_HIDDEN_COLS;
    try {
      const raw = window.localStorage.getItem(WO_COL_STORAGE_KEY);
      if (raw) return new Set(JSON.parse(raw) as string[]);
    } catch {}
    return DEFAULT_HIDDEN_COLS;
  });

  const toggleWoCol = (key: string) => {
    setHiddenWoCols((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      try { window.localStorage.setItem(WO_COL_STORAGE_KEY, JSON.stringify(Array.from(next))); } catch {}
      return next;
    });
  };

  // Create WO Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedPoId, setSelectedPoId] = useState("");
  const [customPlannedQtys, setCustomPlannedQtys] = useState<Record<string, number>>({});
  const [customDeadlines, setCustomDeadlines] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [modalError, setModalError] = useState("");
  const [routingMissingError, setRoutingMissingError] = useState(false);
  const [toastMessage, setToastMessage] = useState("");

  // Bulk Create WO Modal State
  const [isBulkModalOpen, setIsBulkModalOpen] = useState(false);
  const [selectedPoKeysForBulk, setSelectedPoKeysForBulk] = useState<Set<string>>(new Set());
  const [bulkSearchQuery, setBulkSearchQuery] = useState("");
  const [isSubmittingBulkWos, setIsSubmittingBulkWos] = useState(false);
  const [bulkSortConfig, setBulkSortConfig] = useState<{ key: string; direction: "asc" | "desc" } | null>(null);

  // Bulk Delete WO Modal State
  const [isBulkDeleteModalOpen, setIsBulkDeleteModalOpen] = useState(false);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [bulkDeleteResult, setBulkDeleteResult] = useState<{ message: string; rejected: { id: string; reason: string }[] } | null>(null);

  // Edit WO Modal State
  const [isEditWoModalOpen, setIsEditWoModalOpen] = useState(false);
  const [editingWo, setEditingWo] = useState<WO | null>(null);
  const [editLeadTime, setEditLeadTime] = useState("");
  const [editTargetQty, setEditTargetQty] = useState("");
  const [isSubmittingEditWo, setIsSubmittingEditWo] = useState(false);
  const [editWoError, setEditWoError] = useState("");

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

  // =============================================================
  // Deadline Status Helper — 5-state logic (time + progress axes)
  // =============================================================
  const computeWODeadlineStatus = (
    wo: WO,
    today: string
  ): { label: string; colorClass: string; icon: string } => {
    const targetDate = wo.deadline || wo.requestedDate;
    const done = wo.shippedQty ?? 0;
    const plan = wo.targetQty ?? 0;
    const diffDays = daysBetween(today, targetDate); // positive = future, negative = past
    const leadTime = wo.leadTime ?? 3;

    // 1. Hoàn thành
    if (done >= plan && plan > 0) {
      return { label: "Hoàn thành", colorClass: "bg-blue-50 text-blue-700 border-blue-200", icon: "✅" };
    }
    // 2. Đã trễ hạn
    if (diffDays < 0) {
      return { label: "Đã trễ hạn", colorClass: "bg-rose-50 text-rose-700 border-rose-200", icon: "🔴" };
    }
    // 3. Chưa bắt đầu — còn nhiều thời gian (> 30% lead time)
    if (done === 0) {
      const threshold = Math.ceil(leadTime * 0.3);
      if (diffDays > threshold) {
        return { label: "Chưa bắt đầu", colorClass: "bg-neutral-100 text-neutral-500 border-neutral-200", icon: "⚪" };
      }
      // 4. Cần bắt đầu sớm (còn ≤ 30% lead time nhưng SL = 0)
      return { label: "Cần bắt đầu sớm", colorClass: "bg-amber-50 text-amber-700 border-amber-200", icon: "🟡" };
    }
    return { label: "Đang sản xuất", colorClass: "bg-emerald-50 text-emerald-700 border-emerald-200", icon: "🟢" };
  };

  // Column Definitions for WO DataTable — 16 flat columns, grouped by domain
  const woColumns: ColumnDef<WO>[] = useMemo(
    () => [
      // ── GROUP 1: WO Identity ────────────────────────────────────────
      {
        key: "woId",
        header: "Mã WO",
        sortable: true,
        headerClassName: "font-bold text-txt-primary",
        render: (wo) => <span className="font-mono font-bold text-accent text-xs">{wo.woId}</span>,
      },
      {
        key: "createdAt",
        header: "Ngày Lập WO",
        sortable: true,
        align: "center",
        sortValue: (wo) => wo.createdAt || "",
        render: (wo) => <span className="font-mono text-[11px] text-txt-secondary">{formatDateDisplay(wo.createdAt) || "—"}</span>,
        defaultHidden: true,
      },
      // ── GROUP 2: PO Info ──────────────────────────────────────────────
      {
        key: "poNumber",
        header: "Mã PO",
        sortable: true,
        sortValue: (wo) => wo.poNumber || wo.poId,
        render: (wo) => <span className="font-mono font-semibold text-txt-primary text-xs">{wo.poNumber || wo.poId}</span>,
      },
      {
        key: "customerName",
        header: "Khách Hàng",
        sortable: true,
        sortValue: (wo) => wo.customerName || poCustomerMap[wo.poId] || "",
        render: (wo) => <span className="font-medium text-txt-primary text-xs">{wo.customerName || poCustomerMap[wo.poId] || "—"}</span>,
      },
      {
        key: "requestedDate",
        header: "Hạn Giao PO Gốc",
        sortable: true,
        align: "center",
        sortValue: (wo) => wo.requestedDate || "",
        render: (wo) => <span className="font-mono text-[11px] text-txt-secondary">{formatDateDisplay(wo.requestedDate) || "—"}</span>,
        defaultHidden: true,
      },
      // ── GROUP 3: Product Info ─────────────────────────────────────────
      {
        key: "sku",
        header: "Part No.",
        sortable: true,
        render: (wo) => <span className="font-mono font-bold text-xs text-txt-primary">{wo.sku}</span>,
      },
      {
        key: "productNameVi",
        header: "Tên Sản Phẩm",
        sortable: true,
        sortValue: (wo) => wo.productNameVi || skuNameMap[wo.sku] || wo.sku,
        render: (wo) => (
          <span className="text-[11px] text-txt-secondary truncate max-w-[180px] block">
            {wo.productNameVi || skuNameMap[wo.sku] || "—"}
          </span>
        ),
        defaultHidden: true,
      },
      // ── GROUP 4: Production Stage ──────────────────────────────────────
      {
        key: "wcCode",
        header: "Xưởng",
        sortable: true,
        align: "center",
        headerClassName: "bg-amber-50/40 text-amber-900 font-bold",
        render: (wo) => <span className="font-mono font-bold text-amber-800 text-xs">{wo.wcCode}</span>,
      },
      {
        key: "stepOrder",
        header: "Bước",
        sortable: true,
        align: "center",
        sortValue: (wo) => wo.stepOrder ?? 0,
        render: (wo) => (
          <span className="px-1.5 py-0.5 rounded bg-subtle text-txt-secondary text-[10px] border border-border font-mono">
            {wo.stepOrder}/{wo.totalStepsInRouting || 1}
          </span>
        ),
      },
      // ── GROUP 5: Quantity & Progress ───────────────────────────────────
      {
        key: "targetQty",
        header: "SL Kế Hoạch",
        sortable: true,
        align: "right",
        sortValue: (wo) => wo.targetQty || 0,
        render: (wo) => <span className="font-bold font-mono text-txt-primary text-xs">{wo.targetQty?.toLocaleString()}</span>,
      },
      {
        key: "shippedQty",
        header: "SL Hoàn Thành",
        sortable: true,
        align: "right",
        sortValue: (wo) => wo.shippedQty || 0,
        render: (wo) => <span className="font-mono text-emerald-600 font-bold text-xs">{wo.shippedQty?.toLocaleString() ?? 0}</span>,
      },
      {
        key: "status",
        header: "Trạng Thái WO",
        sortable: true,
        align: "center",
        render: (wo) => (
          <span
            className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider border ${
              wo.status === "READY_TO_SHIP"
                ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                : wo.status === "IN_PROGRESS"
                ? "bg-amber-50 text-amber-800 border-amber-200"
                : "bg-subtle text-txt-primary border-border"
            }`}
          >
            {wo.status}
          </span>
        ),
        defaultHidden: true,
      },
      // ── GROUP 6: Time & Deadline ───────────────────────────────────────
      {
        key: "leadTime",
        header: "Lead Time",
        sortable: true,
        align: "center",
        sortValue: (wo) => wo.leadTime ?? 3,
        render: (wo) => <span className="font-mono text-xs text-txt-secondary">{wo.leadTime ?? 3}d</span>,
        defaultHidden: true,
      },
      {
        key: "deadline",
        header: "Deadline",
        sortable: true,
        align: "center",
        sortValue: (wo) => wo.deadline || wo.requestedDate || "",
        render: (wo) => {
          const targetDate = wo.deadline || wo.requestedDate;
          return (
            <span className="font-mono font-bold text-xs text-txt-primary">
              {formatDateDisplay(targetDate) || "—"}
            </span>
          );
        },
      },
      {
        key: "deadlineStatus",
        header: "Trạng Thái Deadline",
        sortable: true,
        align: "center",
        sortValue: (wo) => computeWODeadlineStatus(wo, getTodayVN()).label,
        render: (wo) => {
          const s = computeWODeadlineStatus(wo, getTodayVN());
          return (
            <span className={`px-2 py-0.5 rounded text-[10px] font-semibold border whitespace-nowrap ${s.colorClass}`}>
              {s.icon} {s.label}
            </span>
          );
        },
      },
      {
        key: "daysRemaining",
        header: "Ngày Còn Lại",
        sortable: true,
        align: "center",
        sortValue: (wo) => daysBetween(getTodayVN(), wo.deadline || wo.requestedDate || ""),
        render: (wo) => {
          const targetDate = wo.deadline || wo.requestedDate;
          if (!targetDate) return <span className="text-txt-secondary font-mono text-xs">—</span>;
          const diff = daysBetween(getTodayVN(), targetDate);
          if ((wo.shippedQty ?? 0) >= (wo.targetQty ?? 1) && (wo.targetQty ?? 0) > 0) {
            return <span className="font-mono text-xs text-blue-600">✔ Xong</span>;
          }
          if (diff < 0) return <span className="font-mono text-xs text-rose-600 font-bold">{Math.abs(diff)}d trễ</span>;
          if (diff === 0) return <span className="font-mono text-xs text-amber-600 font-bold">Hôm nay</span>;
          return <span className="font-mono text-xs text-txt-primary">còn {diff}d</span>;
        },
        defaultHidden: true,
      },
    ],
    [poCustomerMap, skuNameMap] // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Human-readable labels for column picker
  const WO_COL_LABELS: Record<string, string> = {
    woId: "Mã WO",
    createdAt: "Ngày Lập WO",
    poNumber: "Mã PO",
    customerName: "Khách Hàng",
    requestedDate: "Hạn Giao PO Gốc",
    sku: "Part No.",
    productNameVi: "Tên Sản Phẩm",
    wcCode: "Xưởng",
    stepOrder: "Bước",
    targetQty: "SL Kế Hoạch",
    shippedQty: "SL Hoàn Thành",
    status: "Trạng Thái WO",
    leadTime: "Lead Time",
    deadline: "Deadline",
    deadlineStatus: "Trạng Thái Deadline",
    daysRemaining: "Ngày Còn Lại",
  };


  // 1-to-1 PO-WO Filter: Available POs to generate WO from (NEW or IN_PRODUCTION) AND NO existing WO
  const availablePOs = useMemo(() => {
    const existingWoPoLineIds = new Set(wos.map((w) => w.poLineId || w.poId));
    return pos.filter(
      (po) =>
        (po.status === "NEW" || po.status === "IN_PRODUCTION") &&
        !existingWoPoLineIds.has(po.poLineId || po.poId)
    );
  }, [pos, wos]);

  // Eligible POs for Bulk WO Creation
  const availablePOsForBulk = useMemo(() => {
    const woCountByPoLineId: Record<string, number> = {};
    wos.forEach((w) => {
      const key = w.poLineId || w.poId;
      woCountByPoLineId[key] = (woCountByPoLineId[key] || 0) + 1;
    });

    const productMap = new Map(products.map((p) => [p.sku, p]));

    return pos
      .filter((po) => po.status !== "COMPLETED")
      .map((po) => {
        const prod = productMap.get(po.sku);
        const routing = prod?.routing?.filter((w) => w.toUpperCase() !== "KTP") || ["D1"];
        const key = po.poLineId || po.poId;
        const existingCount = woCountByPoLineId[key] || 0;
        const totalSteps = routing.length;
        const isComplete = existingCount >= totalSteps;
        return {
          ...po,
          existingCount,
          totalSteps,
          isComplete,
        };
      })
      .filter((p) => !p.isComplete);
  }, [pos, wos, products]);

  // Filtered dataset for Bulk Modal
  const filteredBulkPOs = useMemo(() => {
    const q = bulkSearchQuery.toLowerCase().trim();
    if (!q) return availablePOsForBulk;
    return availablePOsForBulk.filter((po) => {
      const poNum = (po.poNumber || po.poId).toLowerCase();
      const cust = (po.customerName || "").toLowerCase();
      const sku = (po.sku || "").toLowerCase();
      const prod = (po.productNameVi || "").toLowerCase();
      return poNum.includes(q) || cust.includes(q) || sku.includes(q) || prod.includes(q);
    });
  }, [availablePOsForBulk, bulkSearchQuery]);

  // Handle Bulk WO Creation Request
  const handleBulkCreateWO = async () => {
    if (selectedPoKeysForBulk.size === 0) return;
    const poIds = Array.from(selectedPoKeysForBulk);

    setIsSubmittingBulkWos(true);
    try {
      const res = await fetch("/api/wo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ poIds, isBulk: true }),
      });

      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Tạo WO hàng loạt thất bại.");
        return;
      }

      setToastMessage(data.message || `Đã tạo WO thành công cho ${poIds.length} PO.`);
      setSelectedPoKeysForBulk(new Set());
      setIsBulkModalOpen(false);
      mutateWOs();
      mutatePOs();
    } catch {
      alert("Không thể kết nối tới máy chủ.");
    } finally {
      setIsSubmittingBulkWos(false);
    }
  };

  // Bulk PO Table Columns
  const bulkPoColumns: ColumnDef<any>[] = useMemo(
    () => [
      {
        key: "stt",
        header: "STT",
        align: "center",
        width: "50px",
        render: (_item, idx) => <span className="font-mono text-txt-secondary text-xs">{idx + 1}</span>,
      },
      {
        key: "poNumber",
        header: "Mã PO",
        sortable: true,
        sortValue: (p) => p.poNumber || p.poId,
        render: (p) => <span className="font-mono font-bold text-accent">{p.poNumber || p.poId}</span>,
      },
      {
        key: "customerName",
        header: "Khách Hàng",
        sortable: true,
        render: (p) => <span className="font-medium text-txt-primary">{p.customerName || "-"}</span>,
      },
      {
        key: "sku",
        header: "Part No. (SKU)",
        sortable: true,
        render: (p) => (
          <div className="space-y-0.5">
            <span className="font-mono font-bold text-xs text-txt-primary block">{p.sku}</span>
            <span className="text-[11px] text-txt-secondary block truncate max-w-[160px]">
              {p.productNameVi || p.sku}
            </span>
          </div>
        ),
      },
      {
        key: "qty",
        header: "SL Yêu Cầu",
        sortable: true,
        align: "right",
        sortValue: (p) => p.qty || 0,
        render: (p) => <span className="font-bold font-mono text-txt-primary">{p.qty?.toLocaleString()}</span>,
      },
      {
        key: "requestedDate",
        header: "Hạn Giao PO",
        sortable: true,
        align: "center",
        render: (p) => (
          <span className="font-mono text-xs text-txt-primary">
            {formatDateDisplay(p.requestedDate) || "-"}
          </span>
        ),
      },
      {
        key: "statusWO",
        header: "Tiến Độ WO",
        align: "center",
        render: (p) => (
          <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
            {p.existingCount === 0 ? "Chưa có WO" : `Đã có ${p.existingCount}/${p.totalSteps} WO`}
          </span>
        ),
      },
    ],
    []
  );

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
      setCustomDeadlines({});
      return;
    }

    const prod = products.find((p) => p.sku === po.sku);
    if (!prod || !prod.routing || prod.routing.length === 0) {
      setCustomPlannedQtys({});
      setCustomDeadlines({});
      return;
    }

    // Calculate default planned quantities & deadlines using backward propagation formulas
    const defaults = computeBackwardWOPlannedQtys(prod.routing, po.qty, prod.routingScrapRates);
    const defaultDeadlines = computeBackwardWODeadlines(prod.routing, po.requestedDate, prod.routingLeadTimes);
    setCustomPlannedQtys(defaults);
    setCustomDeadlines(defaultDeadlines);
  };

  // Customer Options List
  const customerOptions = useMemo(() => {
    const set = new Set<string>();
    pos.forEach((p) => {
      if (p.customerName) set.add(p.customerName.trim());
    });
    return Array.from(set).sort();
  }, [pos]);

  // Filter WOs by Search, Status, Customer, and Workcenter
  const filteredWOs = useMemo(() => {
    return wos.filter((wo) => {
      const q = searchQuery.toLowerCase().trim();
      const custName = (wo.customerName || poCustomerMap[wo.poId] || "").trim();
      const poNum = (wo.poNumber || wo.poId).toLowerCase();
      const matchQuery =
        !q ||
        wo.woId.toLowerCase().includes(q) ||
        poNum.includes(q) ||
        wo.sku.toLowerCase().includes(q) ||
        (wo.productNameVi || "").toLowerCase().includes(q) ||
        custName.toLowerCase().includes(q);

      const matchStatus = selectedStatus === "ALL" || wo.status === selectedStatus;
      const matchCustomer = selectedCustomer === "ALL" || custName === selectedCustomer;
      const matchWc = selectedWorkcenter === "ALL" || wo.wcCode === selectedWorkcenter;

      return matchQuery && matchStatus && matchCustomer && matchWc;
    });
  }, [wos, searchQuery, selectedStatus, selectedCustomer, selectedWorkcenter, poCustomerMap]);

  // Totals for summary footer
  const totalTargetQty = useMemo(() => {
    return filteredWOs.reduce((acc, wo) => acc + (wo.targetQty || 0), 0);
  }, [filteredWOs]);

  const totalShippedQty = useMemo(() => {
    return filteredWOs.reduce((acc, wo) => acc + (wo.shippedQty || 0), 0);
  }, [filteredWOs]);

  // Export Excel Production Traveler / List Function
  const handleExportExcelWO = (singleWoId?: string) => {
    const listToExport = singleWoId
      ? filteredWOs.filter((w) => w.woId === singleWoId)
      : filteredWOs;

    if (listToExport.length === 0) {
      alert("Không có Lệnh sản xuất WO nào phù hợp để xuất Excel.");
      return;
    }

    const today = getTodayVN();
    const exportRows = listToExport.map((wo) => {
      const customer = wo.customerName || poCustomerMap[wo.poId] || "-";
      const productNameVi = wo.productNameVi || skuNameMap[wo.sku] || wo.sku;
      const deadlineStatus = computeWODeadlineStatus(wo, today);
      const targetDate = wo.deadline || wo.requestedDate;
      const daysRem = targetDate ? daysBetween(today, targetDate) : null;

      return {
        // Group 1: WO Identity
        "Mã WO": wo.woId,
        "Ngày Lập WO": createExcelDateCell(wo.createdAt),
        // Group 2: PO Info
        "Mã PO": wo.poNumber || wo.poId,
        "Khách Hàng": customer,
        "Hạn Giao PO Gốc": createExcelDateCell(wo.requestedDate),
        // Group 3: Product
        "Part No. (SKU)": wo.sku,
        "Tên Sản Phẩm": productNameVi,
        // Group 4: Production Stage
        "Xưởng": wo.wcCode,
        "Bước": `${wo.stepOrder}/${wo.totalStepsInRouting}`,
        // Group 5: Quantity & Progress
        "SL Kế Hoạch (Pcs)": wo.targetQty,
        "SL Hoàn Thành (Pcs)": wo.shippedQty,
        "Trạng Thái WO": wo.status,
        // Group 6: Time & Deadline
        "Lead Time (ngày)": wo.leadTime ?? 3,
        "Deadline Công Đoạn": createExcelDateCell(targetDate),
        "Trạng Thái Deadline": `${deadlineStatus.icon} ${deadlineStatus.label}`,
        "Ngày Còn Lại / Trễ": daysRem !== null ? (daysRem < 0 ? `${Math.abs(daysRem)} ngày trễ` : `còn ${daysRem} ngày`) : "-",
      };
    });

    const ws = XLSX.utils.json_to_sheet(exportRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Phieu_Lenh_WO");

    const fileName = singleWoId
      ? `Phieu_Lenh_WO_${singleWoId}.xlsx`
      : `Danh_Sach_WO_${new Date().toISOString().split("T")[0]}.xlsx`;

    XLSX.writeFile(wb, fileName);
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
          customDeadlines,
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

      setToastMessage(`Đã tạo thành công Lệnh sản xuất cho PO ${selectedPoId}!`);
      setIsModalOpen(false);
      setSelectedPoId("");
      setCustomPlannedQtys({});
      setCustomDeadlines({});
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

  const openEditWoModal = (woId: string) => {
    const wo = wos.find((w) => w.woId === woId);
    if (!wo) return;
    setEditingWo(wo);
    setEditLeadTime(String(wo.leadTime ?? 3));
    setEditTargetQty(String(wo.targetQty || 0));
    setEditWoError("");
    setIsEditWoModalOpen(true);
  };

  const handleSaveEditWo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingWo) return;

    const leadTimeNum = parseInt(editLeadTime, 10);
    if (isNaN(leadTimeNum) || leadTimeNum < 0) {
      setEditWoError("Lead time phải là số nguyên không âm (≥ 0).");
      return;
    }

    const targetQtyNum = parseInt(editTargetQty, 10);
    if (isNaN(targetQtyNum) || targetQtyNum <= 0) {
      setEditWoError("SL kế hoạch phải là số nguyên dương (> 0).");
      return;
    }

    setIsSubmittingEditWo(true);
    setEditWoError("");

    try {
      const res = await fetch("/api/wo", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          woId: editingWo.woId,
          leadTime: leadTimeNum,
          targetQty: targetQtyNum,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setEditWoError(data.error || "Cập nhật Lệnh sản xuất WO thất bại.");
        return;
      }

      setToastMessage(`Đã cập nhật Lệnh WO ${editingWo.woId} thành công. Deadline cả chuỗi đã được tính lại tự động!`);
      setSelectedWoKeys(new Set());
      setIsEditWoModalOpen(false);
      mutateWOs();
      mutatePOs();
    } catch {
      setEditWoError("Không thể kết nối đến máy chủ.");
    } finally {
      setIsSubmittingEditWo(false);
    }
  };

  const handleBulkDeleteWO = async () => {
    if (selectedWoKeys.size === 0) return;
    setIsBulkDeleting(true);
    setBulkDeleteResult(null);
    const woIds = Array.from(selectedWoKeys);
    try {
      const res = await fetch("/api/wo", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ woIds }),
      });
      const data = await res.json();
      if (!res.ok) {
        setBulkDeleteResult({ message: data.error || "Xóa Lệnh sản xuất WO thất bại.", rejected: [] });
        return;
      }
      setBulkDeleteResult({
        message: data.message || `Đã xóa thành công ${data.deletedCount}/${woIds.length} Lệnh sản xuất WO.`,
        rejected: data.rejected || [],
      });
      setSelectedWoKeys(new Set());
      mutateWOs();
      mutatePOs();
      // Auto-close modal if no rejections
      if (!data.rejected || data.rejected.length === 0) {
        setToastMessage(data.message || `Đã xóa thành công ${data.deletedCount} Lệnh sản xuất WO.`);
        setIsBulkDeleteModalOpen(false);
      }
    } catch {
      setBulkDeleteResult({ message: "Không thể kết nối đến máy chủ.", rejected: [] });
    } finally {
      setIsBulkDeleting(false);
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
          {/* View Mode Toggle */}
          <div className="flex items-center space-x-1 p-1 bg-subtle border border-border rounded">
            <button
              onClick={() => setViewMode("table")}
              className={`px-2.5 py-1 text-xs font-semibold rounded flex items-center space-x-1.5 transition-all ${
                viewMode === "table"
                  ? "bg-canvas text-txt-primary shadow-sm border border-border"
                  : "text-txt-secondary hover:text-txt-primary"
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Xem Bảng</span>
            </button>
            <button
              onClick={() => setViewMode("gantt")}
              className={`px-2.5 py-1 text-xs font-semibold rounded flex items-center space-x-1.5 transition-all ${
                viewMode === "gantt"
                  ? "bg-emerald-500/20 text-emerald-400 shadow-sm border border-emerald-500/40"
                  : "text-txt-secondary hover:text-txt-primary"
              }`}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>Xem Gantt</span>
            </button>
          </div>

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

          {/* Customer Filter */}
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-subtle border border-border text-xs text-txt-secondary">
            <User className="w-3.5 h-3.5 text-txt-secondary" />
            <span>Khách hàng:</span>
            <select
              value={selectedCustomer}
              onChange={(e) => setSelectedCustomer(e.target.value)}
              className="bg-transparent font-medium text-txt-primary focus:outline-none cursor-pointer"
            >
              <option value="ALL">Tất cả khách hàng</option>
              {customerOptions.map((cust) => (
                <option key={cust} value={cust}>
                  {cust}
                </option>
              ))}
            </select>
          </div>

          {/* Workcenter Filter */}
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-subtle border border-border text-xs text-txt-secondary">
            <Factory className="w-3.5 h-3.5 text-txt-secondary" />
            <span>Xưởng:</span>
            <select
              value={selectedWorkcenter}
              onChange={(e) => setSelectedWorkcenter(e.target.value)}
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
            onClick={() => mutateWOs()}
            className="p-2 rounded bg-subtle border border-border text-txt-primary hover:bg-border transition-colors shrink-0"
            title="Làm mới dữ liệu"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isValidating ? "animate-spin text-accent" : ""}`} />
          </button>
        </div>

        {/* Action Buttons Toolbar - Minimalist Icon-only Buttons (Single Line) */}
        <div className="flex items-center gap-1.5 shrink-0 flex-nowrap">
          {selectedWoKeys.size > 0 && (
            <span className="text-[11px] font-semibold text-accent font-mono bg-accent/10 px-2 py-1 rounded border border-accent/20 shrink-0">
              Đã chọn {selectedWoKeys.size}
            </span>
          )}

          {/* 1. Sửa WO */}
          <button
            type="button"
            onClick={() => {
              if (selectedWoKeys.size !== 1) return;
              const singleWoId = Array.from(selectedWoKeys)[0];
              openEditWoModal(singleWoId);
            }}
            disabled={selectedWoKeys.size !== 1}
            className="p-2 rounded bg-amber-50 border border-amber-200 text-amber-800 hover:bg-amber-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
            title="Sửa Lệnh sản xuất WO đã chọn (Chỉ chọn 1 WO)"
          >
            <Pencil className="w-4 h-4 text-amber-600" />
          </button>

          {/* 2. In Phiếu WO */}
          <button
            type="button"
            onClick={() => {
              if (selectedWoKeys.size !== 1) return;
              const singleWoId = Array.from(selectedWoKeys)[0];
              handleExportExcelWO(singleWoId);
            }}
            disabled={selectedWoKeys.size !== 1}
            className="p-2 rounded bg-blue-50 border border-blue-200 text-blue-700 hover:bg-blue-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
            title="In Giấy Chuyển Xưởng Excel (Chỉ chọn 1 WO)"
          >
            <FileSpreadsheet className="w-4 h-4 text-blue-600" />
          </button>

          {/* 3. Xóa WO */}
          <button
            type="button"
            onClick={() => {
              if (selectedWoKeys.size === 0) return;
              setBulkDeleteResult(null);
              setIsBulkDeleteModalOpen(true);
            }}
            disabled={selectedWoKeys.size === 0}
            className="p-2 rounded bg-rose-50 border border-rose-200 text-rose-700 hover:bg-rose-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
            title={selectedWoKeys.size > 0 ? `Xóa ${selectedWoKeys.size} WO đã chọn` : "Xóa WO đã chọn"}
          >
            <Trash2 className="w-4 h-4 text-rose-600" />
          </button>

          <div className="h-4 w-px bg-border mx-0.5 shrink-0" />

          {/* 4. Tùy chỉnh cột hiển thị */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setIsColPickerOpen((v) => !v)}
              className={`p-2 rounded border transition-colors shrink-0 ${
                isColPickerOpen
                  ? "bg-accent/10 border-accent/30 text-accent"
                  : "bg-subtle border-border text-txt-secondary hover:bg-border"
              }`}
              title="Tùy chỉnh cột hiển thị"
            >
              <SlidersHorizontal className="w-4 h-4" />
            </button>

            {/* Column picker dropdown */}
            {isColPickerOpen && (
              <div
                className="absolute right-0 top-full mt-1 z-50 bg-canvas border border-border rounded-lg shadow-xl p-3 min-w-[200px]"
                onMouseLeave={() => setIsColPickerOpen(false)}
              >
                <p className="text-[11px] font-semibold text-txt-secondary uppercase tracking-wider mb-2">Cột hiển thị</p>
                <div className="space-y-1">
                  {woColumns.map((col) => (
                    <label key={col.key} className="flex items-center gap-2 cursor-pointer group">
                      <input
                        type="checkbox"
                        checked={!hiddenWoCols.has(col.key)}
                        onChange={() => toggleWoCol(col.key)}
                        className="rounded border-border accent-accent cursor-pointer"
                      />
                      <span className="text-xs text-txt-primary group-hover:text-accent transition-colors">
                        {WO_COL_LABELS[col.key] || col.key}
                      </span>
                    </label>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setHiddenWoCols(new Set(DEFAULT_HIDDEN_COLS));
                    try { window.localStorage.removeItem(WO_COL_STORAGE_KEY); } catch {}
                  }}
                  className="mt-2 w-full text-[11px] text-txt-secondary hover:text-accent transition-colors text-center py-1 border-t border-border"
                >
                  ↺ Đặt lại mặc định
                </button>
              </div>
            )}
          </div>

          {/* 4. Xuất Excel WO */}
          <button
            type="button"
            onClick={() => handleExportExcelWO()}
            className="p-2 rounded bg-subtle border border-border hover:bg-border text-txt-primary transition-colors shrink-0"
            title="Xuất mảng WO đang hiển thị ra file Excel (Mẫu Giấy Chuyển Xưởng)"
          >
            <Download className="w-4 h-4 text-blue-600" />
          </button>

          {/* 5. Tạo WO Hàng Loạt Từ PO */}
          <button
            type="button"
            onClick={() => {
              setSelectedPoKeysForBulk(new Set());
              setBulkSearchQuery("");
              setIsBulkModalOpen(true);
            }}
            className="p-2 rounded bg-emerald-600 hover:bg-emerald-700 text-white transition-colors shadow-sm shrink-0"
            title="Tạo Lệnh sản xuất (WO) hàng loạt từ nhiều PO cùng lúc"
          >
            <Layers className="w-4 h-4" />
          </button>

          {/* 6. Lập WO Mới Từ PO */}
          <button
            type="button"
            onClick={() => {
              setModalError("");
              setRoutingMissingError(false);
              setSelectedPoId("");
              setCustomPlannedQtys({});
              setIsModalOpen(true);
            }}
            className="p-2 rounded bg-accent text-white hover:opacity-90 transition-opacity shadow-sm shrink-0"
            title="Lập Lệnh sản xuất (WO) mới từ PO"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
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
      {/* Main View: Gantt Chart or DataTable */}
      {viewMode === "gantt" ? (
        <GanttChartView
          items={ganttItems}
          isLoading={isGanttLoading}
          requiresFilter={ganttRequiresFilter}
          totalCount={ganttTotalCount}
          onSwitchToTable={() => setViewMode("table")}
        />
      ) : (
        <DataTable<WO>
          data={filteredWOs}
          columns={woColumns}
          getItemKey={(wo) => wo.woId}
          hiddenColumns={hiddenWoCols}
          selectable={true}
          selectedKeys={selectedWoKeys}
          onSelectionChange={setSelectedWoKeys}
          sortConfig={sortConfig}
          onSortChange={setSortConfig}
          enablePagination={true}
          defaultPageSize={50}
          isLoading={!wosData}
          loadingMessage="Đang tải ma trận Lệnh sản xuất WO..."
          emptyMessage="Không tìm thấy Lệnh sản xuất WO nào phù hợp với bộ lọc."
        />
      )}
      {/* Edit WO Modal */}
      {isEditWoModalOpen && editingWo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="bg-canvas border border-border rounded-lg shadow-xl max-w-lg w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div className="flex items-center gap-2">
                <Pencil className="w-4 h-4 text-amber-600" />
                <h3 className="text-sm font-bold text-txt-primary">Sửa Lệnh Sản Xuất WO: {editingWo.woId}</h3>
              </div>
              <button
                onClick={() => setIsEditWoModalOpen(false)}
                className="text-txt-secondary hover:text-txt-primary p-1 rounded"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {editWoError && (
              <div className="p-3 rounded border border-rose-200 bg-rose-50 text-rose-800 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{editWoError}</span>
              </div>
            )}

            <form onSubmit={handleSaveEditWo} className="space-y-4">
              <div className="p-3 rounded bg-subtle border border-border space-y-2 text-xs">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <span className="text-txt-secondary block">Xưởng công đoạn:</span>
                    <span className="font-mono font-bold text-txt-primary">{editingWo.wcCode} (Bước {editingWo.stepOrder}/{editingWo.totalStepsInRouting})</span>
                  </div>
                  <div>
                    <span className="text-txt-secondary block">Mã PO:</span>
                    <span className="font-mono font-bold text-accent">{editingWo.poNumber || editingWo.poId}</span>
                  </div>
                  <div>
                    <span className="text-txt-secondary block">SKU / Sản phẩm:</span>
                    <span className="font-mono font-bold text-txt-primary">{editingWo.sku}</span>
                  </div>
                  <div>
                    <span className="text-txt-secondary block">Khách hàng:</span>
                    <span className="font-semibold text-txt-primary">{editingWo.customerName || "-"}</span>
                  </div>
                </div>
              </div>

              {/* Deadline read-only field & Notice */}
              <div className="p-3 rounded bg-amber-50/70 border border-amber-200 space-y-1.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-amber-900">Deadline Công Đoạn Hiện Tại:</span>
                  <span className="font-mono font-bold text-sm text-amber-900 bg-amber-100 px-2 py-0.5 rounded border border-amber-300">
                    {formatDateDisplay(editingWo.deadline || editingWo.requestedDate)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[11px] text-amber-800">
                  <span>Hạn giao PO gốc: <strong>{formatDateDisplay(editingWo.requestedDate)}</strong></span>
                </div>
                <p className="text-[11px] text-amber-800 italic pt-1 border-t border-amber-200/60">
                  💡 Deadline được tính tự động từ Hạn giao PO và Lead time — sửa Lead time để điều chỉnh.
                </p>
              </div>

              {/* Editable Fields: Lead time & Target Qty */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-txt-primary mb-1">
                    Lead time Công Đoạn (ngày) <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="number"
                    min="0"
                    required
                    value={editLeadTime}
                    onChange={(e) => setEditLeadTime(e.target.value)}
                    className="w-full px-3 py-1.5 bg-subtle border border-border rounded text-txt-primary font-mono text-xs focus:outline-none focus:border-accent"
                    placeholder="VD: 3"
                  />
                  <span className="text-[10px] text-txt-secondary mt-0.5 block">
                    Sửa Lead time sẽ tự động tính lại Deadline cho cả chuỗi.
                  </span>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-txt-primary mb-1">
                    SL Kế Hoạch WO (pcs) <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={editTargetQty}
                    onChange={(e) => setEditTargetQty(e.target.value)}
                    className="w-full px-3 py-1.5 bg-subtle border border-border rounded text-txt-primary font-mono text-xs focus:outline-none focus:border-accent font-bold"
                    placeholder="VD: 1000"
                  />
                  <span className="text-[10px] text-txt-secondary mt-0.5 block">
                    Độc lập, không cascade sang các bước khác.
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-border">
                <button
                  type="button"
                  onClick={() => setIsEditWoModalOpen(false)}
                  disabled={isSubmittingEditWo}
                  className="px-4 py-1.5 rounded bg-subtle border border-border text-txt-primary hover:bg-border text-xs font-medium"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingEditWo}
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded bg-accent text-white font-semibold hover:opacity-90 text-xs disabled:opacity-50"
                >
                  {isSubmittingEditWo ? "Đang lưu..." : "Lưu Thay Đổi"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Bulk Delete WO Confirmation Modal */}
      {isBulkDeleteModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-canvas border border-border rounded-lg shadow-xl max-w-lg w-full p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-10 h-10 rounded-full bg-rose-100 text-rose-600 shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-txt-primary">Xác Nhận Xóa Lệnh Sản Xuất WO</h3>
                <p className="text-xs text-txt-secondary mt-0.5">Hành động này sẽ xóa dữ liệu vĩnh viễn.</p>
              </div>
            </div>

            {!bulkDeleteResult ? (
              <div className="p-3 rounded bg-subtle border border-border space-y-2 text-xs">
                <p className="font-semibold text-txt-primary">
                  Bạn có chắc chắn muốn xóa {selectedWoKeys.size} Lệnh sản xuất WO đã chọn?
                </p>
                <p className="text-txt-secondary italic">⚠️ WO đã có sản lượng báo cáo/xuất đi (không phải OPEN) sẽ bị từ chối. Các WO còn lại sẽ được xóa thành công.</p>
              </div>
            ) : (
              <div className={`p-3 rounded border text-xs space-y-2 ${bulkDeleteResult.rejected.length > 0 ? "bg-amber-50 border-amber-200" : "bg-emerald-50 border-emerald-200"}`}>
                <p className={`font-semibold ${bulkDeleteResult.rejected.length > 0 ? "text-warning" : "text-emerald-800"}`}>
                  {bulkDeleteResult.message}
                </p>
                {bulkDeleteResult.rejected.length > 0 && (
                  <div className="space-y-1 max-h-36 overflow-y-auto pt-1">
                    {bulkDeleteResult.rejected.map((r) => (
                      <div key={r.id} className="flex gap-2">
                        <span className="font-mono font-bold text-rose-700 shrink-0">{r.id}:</span>
                        <span className="text-txt-secondary">{r.reason}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
              <button
                type="button"
                onClick={() => { setIsBulkDeleteModalOpen(false); setBulkDeleteResult(null); }}
                disabled={isBulkDeleting}
                className="px-4 py-1.5 rounded bg-subtle border border-border text-txt-primary hover:bg-border text-xs font-medium"
              >
                {bulkDeleteResult ? "Đóng" : "Hủy"}
              </button>
              {!bulkDeleteResult && (
                <button
                  type="button"
                  onClick={handleBulkDeleteWO}
                  disabled={isBulkDeleting}
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded bg-rose-600 text-white font-semibold hover:bg-rose-700 text-xs disabled:opacity-50"
                >
                  {isBulkDeleting ? "Đang xóa..." : `Xác Nhận Xóa ${selectedWoKeys.size} WO`}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Create WO Modal (Supports Custom Planned Quantities & 1-PO-to-1-WO Filter) */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="bg-canvas border border-border rounded-lg shadow-xl max-w-3xl w-full max-h-[92vh] overflow-y-auto p-6 space-y-4">
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
                    {availablePOs.map((po) => {
                      const key = po.poLineId || po.poId;
                      return (
                        <option key={key} value={key}>
                          {po.poNumber} | KH: {po.customerName} | SKU: {po.sku} | Qty: {po.qty} pcs
                        </option>
                      );
                    })}
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
                          <th className="py-2 px-3 text-right border-r border-border">SL Kế Hoạch (pcs)</th>
                          <th className="py-2 px-3 text-center">Deadline Công Đoạn</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {selectedProduct.routing
                          .filter((wc) => wc.toUpperCase() !== "KTP")
                          .map((wcCode) => (
                            <tr key={wcCode} className="hover:bg-subtle/50">
                              <td className="py-2 px-3 border-r border-border font-mono font-bold text-txt-primary">
                                {wcCode}
                              </td>
                              <td className="py-1.5 px-3 border-r border-border text-right">
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
                                  className="w-24 px-2 py-1 text-right bg-subtle border border-border rounded font-mono font-bold text-txt-primary focus:outline-none focus:border-accent"
                                />
                              </td>
                              <td className="py-1.5 px-3 text-center">
                                <input
                                  type="date"
                                  required
                                  value={customDeadlines[wcCode] || ""}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    setCustomDeadlines((prev) => ({
                                      ...prev,
                                      [wcCode]: val,
                                    }));
                                  }}
                                  className="w-32 px-2 py-1 text-center bg-subtle border border-border rounded font-mono font-bold text-txt-primary focus:outline-none focus:border-accent"
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

      {/* Modal Bulk Create WO */}
      {isBulkModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="bg-canvas border border-border rounded-lg shadow-xl max-w-5xl w-full max-h-[92vh] overflow-hidden flex flex-col p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-3 shrink-0">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded bg-emerald-50 text-emerald-600 border border-emerald-200">
                  <Layers className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-txt-primary">Tạo Lệnh Sản Xuất WO Hàng Loạt Từ PO</h3>
                  <p className="text-xs text-txt-secondary">
                    Chọn các PO chưa lập đủ WO. Hệ thống sẽ tự động dùng PostgreSQL Batch Transactions sinh WO cho từng xưởng trong routing.
                  </p>
                </div>
              </div>
              <button onClick={() => setIsBulkModalOpen(false)} className="text-txt-secondary hover:text-txt-primary">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Filter Search */}
            <div className="flex items-center justify-between gap-3 shrink-0">
              <div className="relative flex-1">
                <Search className="w-4 h-4 absolute left-3 text-txt-secondary" />
                <input
                  type="text"
                  placeholder="Tìm theo Mã PO, Khách hàng, SKU, Tên SP..."
                  value={bulkSearchQuery}
                  onChange={(e) => setBulkSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3 py-1.5 text-xs bg-subtle border border-border rounded text-txt-primary focus:outline-none focus:border-accent"
                />
              </div>

              {selectedPoKeysForBulk.size > 0 && (
                <span className="text-xs font-semibold text-emerald-700 font-mono bg-emerald-50 px-3 py-1.5 rounded border border-emerald-200 shrink-0">
                  Đã chọn {selectedPoKeysForBulk.size} / {filteredBulkPOs.length} PO
                </span>
              )}
            </div>

            {/* DataTable for PO Selection */}
            <div className="flex-1 overflow-y-auto min-h-[300px]">
              <DataTable<any>
                data={filteredBulkPOs}
                columns={bulkPoColumns}
                getItemKey={(p) => p.poId}
                selectable={true}
                selectedKeys={selectedPoKeysForBulk}
                onSelectionChange={setSelectedPoKeysForBulk}
                sortConfig={bulkSortConfig}
                onSortChange={setBulkSortConfig}
                enablePagination={true}
                defaultPageSize={20}
                emptyMessage="Không có đơn hàng PO nào chưa lập WO."
              />
            </div>

            {/* Footer Action */}
            <div className="flex items-center justify-between pt-3 border-t border-border shrink-0 text-xs">
              <span className="text-txt-secondary">
                {selectedPoKeysForBulk.size === 0
                  ? "Vui lòng tích chọn ít nhất 1 PO trong bảng trên."
                  : `Đã sẵn sàng tạo WO cho ${selectedPoKeysForBulk.size} đơn hàng PO.`}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsBulkModalOpen(false)}
                  className="px-4 py-2 rounded bg-subtle border border-border hover:bg-border font-medium text-txt-primary transition-colors"
                >
                  Hủy
                </button>

                <button
                  type="button"
                  onClick={handleBulkCreateWO}
                  disabled={selectedPoKeysForBulk.size === 0 || isSubmittingBulkWos}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
                >
                  <Layers className="w-4 h-4" />
                  <span>
                    {isSubmittingBulkWos
                      ? "Đang xử lý Pipeline..."
                      : `Xác Nhận Tạo WO (${selectedPoKeysForBulk.size} PO)`}
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
