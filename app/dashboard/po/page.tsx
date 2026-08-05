"use client";

import { useState, useMemo, useRef } from "react";
import useSWR from "swr";
import * as XLSX from "xlsx";
import {
  FileText,
  Plus,
  FileSpreadsheet,
  Search,
  CheckCircle2,
  AlertTriangle,
  Clock,
  X,
  UploadCloud,
  ChevronRight,
  Filter,
  Edit2,
  Trash2,
  Download,
  Layers,
} from "lucide-react";
import { useRouter } from "next/navigation";
import AccordionList from "@/components/AccordionList";
import DataTable, { ColumnDef } from "@/components/DataTable";
import { PO, POStatus } from "@/lib/po-wo-engine";
import { Product } from "@/lib/types";
import { LABELS } from "@/lib/labels";

import {
  getTodayVN,
  formatDateDisplay,
  formatTimestampDisplay,
  daysBetween,
  parseExcelDate,
  createExcelDateCell,
} from "@/lib/date-utils";

const fetcher = (url: string) => fetch(url).then((res) => res.json());

function getDeliveryScheduleStatus(po: PO): {
  label: string;
  badgeClass: string;
  excelText: string;
} | null {
  const remaining = Math.max(0, po.qty - po.shippedQty);
  if (remaining === 0 || po.status === "COMPLETED") {
    return null;
  }

  if (!po.requestedDate) {
    return {
      label: "Chưa có hạn",
      badgeClass: "bg-subtle border border-border text-txt-secondary",
      excelText: "Chưa có hạn",
    };
  }

  const todayStr = getTodayVN();
  const diffDays = daysBetween(todayStr, po.requestedDate);

  if (diffDays < 0) {
    return {
      label: `Đã trễ (${Math.abs(diffDays)}d)`,
      badgeClass: "bg-red-500/10 border border-red-500/30 text-red-600 font-bold",
      excelText: `Đã trễ (${Math.abs(diffDays)} ngày)`,
    };
  } else if (diffDays <= 7) {
    return {
      label: `Sắp trễ (${diffDays}d)`,
      badgeClass: "bg-amber-500/10 border border-amber-500/30 text-amber-600 font-semibold",
      excelText: `Sắp trễ (còn ${diffDays} ngày)`,
    };
  } else {
    return {
      label: `Đúng hạn (${diffDays}d)`,
      badgeClass: "bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 font-medium",
      excelText: `Đúng hạn (còn ${diffDays} ngày)`,
    };
  }
}

interface ParsedPORow {
  index?: string;
  poNumber: string;
  accountId?: string;
  customerName: string;
  productSymbol: string;
  sku: string;
  productNameVi?: string;
  productNameEn?: string;
  legacySymbols?: string;
  qty: number;
  expectedDeliveryDate: string;
  tolerance?: number;
  currency?: string;
  techRequirement?: string;
  specialRequirement?: string;
  isNewSku: boolean;
}

export default function POPage() {
  const router = useRouter();
  const { data: posData, mutate: mutatePOs } = useSWR<PO[]>("/api/po", fetcher);
  const { data: productsData, mutate: mutateProducts } = useSWR<Product[]>("/api/products", fetcher);

  const pos = Array.isArray(posData) ? posData : [];
  const products = Array.isArray(productsData) ? productsData : [];

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedStatus, setSelectedStatus] = useState<string>("ALL");
  const [selectedPoKeys, setSelectedPoKeys] = useState<Set<string>>(new Set());
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: "asc" | "desc" } | null>(null);

  // Column Definitions for PO DataTable
  const poColumns: ColumnDef<PO>[] = useMemo(
    () => [
      {
        key: "stt",
        header: "STT",
        align: "center",
        width: "3rem",
        render: (_, index) => <span className="text-txt-secondary font-mono font-medium">{index + 1}</span>,
      },
      {
        key: "poNumber",
        header: "Số PO",
        sortable: true,
        headerClassName: "font-bold text-txt-primary",
        render: (po) => <span className="font-mono font-bold text-txt-primary">{po.poNumber}</span>,
      },
      {
        key: "customerName",
        header: "Khách Hàng",
        sortable: true,
        render: (po) => <span className="font-semibold text-txt-primary">{po.customerName}</span>,
      },
      {
        key: "sku",
        header: "SKU / Tên SP",
        sortable: true,
        render: (po) => (
          <div className="flex flex-col">
            <span className="font-mono font-bold text-txt-primary">{po.sku}</span>
            <span className="text-[11px] text-txt-secondary">{po.productNameVi}</span>
          </div>
        ),
      },
      {
        key: "qty",
        header: "SL Đặt (pcs)",
        sortable: true,
        align: "right",
        sortValue: (po) => po.qty,
        render: (po) => <span className="font-mono font-bold text-txt-primary">{po.qty.toLocaleString()}</span>,
      },
      {
        key: "shippedQty",
        header: "Đã Giao (pcs)",
        sortable: true,
        align: "right",
        sortValue: (po) => po.shippedQty,
        render: (po) => (
          <span className="font-mono font-medium text-emerald-600">
            {po.shippedQty > 0 ? po.shippedQty.toLocaleString() : 0}
          </span>
        ),
      },
      {
        key: "remainingQty",
        header: "Còn Lại (pcs)",
        sortable: true,
        align: "right",
        sortValue: (po) => Math.max(0, po.qty - po.shippedQty),
        render: (po) => {
          const rem = Math.max(0, po.qty - po.shippedQty);
          return (
            <span className={`font-mono font-semibold ${rem > 0 ? "text-amber-600" : "text-txt-secondary"}`}>
              {rem.toLocaleString()}
            </span>
          );
        },
      },
      {
        key: "requestedDate",
        header: "Hạn Giao Hàng",
        sortable: true,
        align: "center",
        render: (po) => <span className="font-mono text-txt-primary">{formatDateDisplay(po.requestedDate)}</span>,
      },
      {
        key: "scheduleStatus",
        header: "Cảnh Báo Hạn",
        align: "center",
        render: (po) => {
          const scheduleStatus = getDeliveryScheduleStatus(po);
          if (!scheduleStatus) return <span className="text-txt-secondary text-[11px]">Đã xong</span>;
          return (
            <span className={`px-2 py-0.5 rounded text-[10px] font-semibold tracking-wide ${scheduleStatus.badgeClass}`}>
              {scheduleStatus.label}
            </span>
          );
        },
      },
      {
        key: "status",
        header: "Trạng Thái",
        sortable: true,
        align: "center",
        render: (po) => {
          const isCompleted = po.status === "COMPLETED";
          return (
            <span
              className={`px-2.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${
                isCompleted
                  ? "bg-emerald-50 border border-emerald-200 text-emerald-800"
                  : "bg-subtle border border-border text-txt-primary"
              }`}
            >
              {po.status}
            </span>
          );
        },
      },
    ],
    []
  );

  // Modals state
  const [isManualModalOpen, setIsManualModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [editingPO, setEditingPO] = useState<PO | null>(null);

  // Bulk Delete state
  const [isBulkDeleteModalOpen, setIsBulkDeleteModalOpen] = useState(false);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [bulkDeleteResult, setBulkDeleteResult] = useState<{ message: string; rejected: { id: string; reason: string }[] } | null>(null);

  // Manual / Edit Form State
  const [poNumber, setPoNumber] = useState("");
  const [accountId, setAccountId] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [sku, setSku] = useState("");
  const [productNameVi, setProductNameVi] = useState("");
  const [qty, setQty] = useState("");
  const [requestedDate, setRequestedDate] = useState("");
  const [tolerance, setTolerance] = useState("");
  const [currency, setCurrency] = useState("VND");
  const [techRequirement, setTechRequirement] = useState("");
  const [specialRequirement, setSpecialRequirement] = useState("");

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [toastMessage, setToastMessage] = useState("");

  // Excel Import Preview State
  const [parsedRows, setParsedRows] = useState<ParsedPORow[]>([]);
  const [importFileName, setImportFileName] = useState("");
  const [isParsingExcel, setIsParsingExcel] = useState(false);

  // Filter POs
  const filteredPOs = pos.filter((po) => {
    const q = searchQuery.toLowerCase().trim();
    const matchQuery =
      !q ||
      po.poNumber.toLowerCase().includes(q) ||
      po.customerName.toLowerCase().includes(q) ||
      po.sku.toLowerCase().includes(q);

    const matchStatus = selectedStatus === "ALL" || po.status === selectedStatus;
    return matchQuery && matchStatus;
  });

  const openCreateModal = () => {
    setEditingPO(null);
    setPoNumber("");
    setAccountId("");
    setCustomerName("");
    setSku("");
    setProductNameVi("");
    setQty("");
    setRequestedDate("");
    setTolerance("");
    setCurrency("VND");
    setTechRequirement("");
    setSpecialRequirement("");
    setFormError("");
    setIsManualModalOpen(true);
  };

  const openEditModal = (po: PO) => {
    setEditingPO(po);
    setPoNumber(po.poNumber);
    setAccountId(po.accountId || "");
    setCustomerName(po.customerName);
    setSku(po.sku);
    setProductNameVi(po.productNameVi);
    setQty(String(po.qty));
    setRequestedDate(po.requestedDate || "");
    setTolerance(po.tolerance ? String(po.tolerance) : "");
    setCurrency(po.currency || "VND");
    setTechRequirement(po.techRequirement || "");
    setSpecialRequirement(po.specialRequirement || "");
    setFormError("");
    setIsManualModalOpen(true);
  };

  const handleBulkDeletePO = async () => {
    if (selectedPoKeys.size === 0) return;
    setIsBulkDeleting(true);
    setBulkDeleteResult(null);
    const poIds = Array.from(selectedPoKeys);
    try {
      const res = await fetch("/api/po", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ poIds }),
      });
      const data = await res.json();
      if (!res.ok) {
        setBulkDeleteResult({ message: data.error || "Xóa đơn hàng PO thất bại.", rejected: [] });
        return;
      }
      setBulkDeleteResult({
        message: data.message || `Đã xóa thành công ${data.deletedCount}/${poIds.length} đơn hàng PO.`,
        rejected: data.rejected || [],
      });
      setSelectedPoKeys(new Set());
      mutatePOs();
      // Auto-close modal if no rejections
      if (!data.rejected || data.rejected.length === 0) {
        setToastMessage(data.message || `Đã xóa thành công ${data.deletedCount} đơn hàng PO.`);
        setIsBulkDeleteModalOpen(false);
      }
    } catch {
      setBulkDeleteResult({ message: "Không thể kết nối đến máy chủ.", rejected: [] });
    } finally {
      setIsBulkDeleting(false);
    }
  };

  // Manual PO Submit or Edit
  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");

    if (!customerName.trim() || !sku.trim() || Number(qty) <= 0 || !requestedDate) {
      setFormError("Vui lòng điền đầy đủ Tên khách hàng, SKU, Số lượng (> 0) và Ngày giao hàng.");
      return;
    }

    setIsSubmitting(true);

    try {
      const selectedProduct = products.find((p) => p.sku === sku);

      const endpoint = "/api/po";
      const method = editingPO ? "PUT" : "POST";

      const payload = {
        poId: editingPO?.poId,
        poNumber: poNumber.trim() || `PO-${Date.now()}`,
        accountId: accountId.trim(),
        customerName: customerName.trim(),
        sku: sku.trim(),
        productNameVi: productNameVi.trim() || selectedProduct?.nameVi || sku,
        qty: Number(qty),
        requestedDate,
        tolerance: tolerance ? Number(tolerance) : undefined,
        currency,
        techRequirement: techRequirement.trim(),
        specialRequirement: specialRequirement.trim(),
      };

      const res = await fetch(endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        setFormError(data.error || "Lưu đơn hàng PO thất bại.");
        setIsSubmitting(false);
        return;
      }

      setToastMessage(`Đã ${editingPO ? "cập nhật" : "tạo mới"} thành công đơn hàng PO ${data.poNumber}.`);
      setIsManualModalOpen(false);
      mutatePOs();
    } catch {
      setFormError("Không thể kết nối tới máy chủ.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Helper: parse date format dd/mm/yyyy to YYYY-MM-DD
  const parseExcelDate = (val: any): string => {
    if (!val) return new Date().toISOString().split("T")[0];

    if (typeof val === "number") {
      const dateObj = XLSX.SSF.parse_date_code(val);
      if (dateObj) {
        const yyyy = dateObj.y;
        const mm = String(dateObj.m).padStart(2, "0");
        const dd = String(dateObj.d).padStart(2, "0");
        return `${yyyy}-${mm}-${dd}`;
      }
    }

    const str = String(val).trim();
    const parts = str.split(/[/.-]/);
    if (parts.length === 3) {
      if (parts[2].length === 4) {
        const dd = String(parts[0]).padStart(2, "0");
        const mm = String(parts[1]).padStart(2, "0");
        const yyyy = parts[2];
        return `${yyyy}-${mm}-${dd}`;
      }
    }

    return str;
  };

  // Handle Excel File Selection & Client Parsing
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImportFileName(file.name);
    setIsParsingExcel(true);
    setFormError("");

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const buffer = event.target?.result;
        const workbook = XLSX.read(buffer, { type: "array" });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];

        const rawData: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

        if (!rawData || rawData.length === 0) {
          setFormError("File Excel không có dữ liệu.");
          setIsParsingExcel(false);
          return;
        }

        let headerRowIndex = -1;
        let colMap: Record<string, number> = {};

        for (let i = 0; i < Math.min(10, rawData.length); i++) {
          const row = rawData[i];
          if (!row || !Array.isArray(row)) continue;

          const rowStr = row.map((cell) => String(cell || "").toLowerCase().trim());
          if (rowStr.includes("ponumber") || rowStr.includes("productsymbol") || rowStr.includes("quantity") || rowStr.includes("customername")) {
            headerRowIndex = i;
            rowStr.forEach((colName, colIdx) => {
              if (colName) colMap[colName] = colIdx;
            });
            break;
          }
        }

        if (headerRowIndex === -1) {
          headerRowIndex = 0;
          const row = rawData[0];
          if (row) {
            row.forEach((cell, colIdx) => {
              const colName = String(cell || "").toLowerCase().trim();
              if (colName) colMap[colName] = colIdx;
            });
          }
        }

        const getValue = (row: any[], keys: string[]) => {
          for (const k of keys) {
            if (colMap[k] !== undefined && row[colMap[k]] !== undefined) {
              return row[colMap[k]];
            }
          }
          return "";
        };

        const rowsToProcess = rawData.slice(headerRowIndex + 1);
        const parsedList: ParsedPORow[] = [];

        for (const row of rowsToProcess) {
          if (!row || row.length === 0) continue;

          const indexVal = String(getValue(row, ["index", "stt", "no"]) || "").trim();
          const firstCell = String(row[0] || "").trim().toLowerCase();

          if (firstCell.includes("total") || firstCell.includes("tổng") || (!indexVal && !getValue(row, ["ponumber", "po number"]))) {
            continue;
          }

          const poNum = String(getValue(row, ["ponumber", "po number", "mã po"]) || "").trim();
          const custName = String(getValue(row, ["customername", "customer name", "khách hàng"]) || "").trim();
          const prodSym = String(getValue(row, ["productsymbol", "product symbol", "mã sản phẩm", "sku"]) || "").trim();
          const qtyVal = Number(getValue(row, ["quantity", "qty", "số lượng"]) || 0);

          if (!prodSym || qtyVal <= 0) continue;

          const matchedProduct = products.find(
            (p) => p.sku.toLowerCase() === prodSym.toLowerCase()
          );

          const finalCustomerName = matchedProduct?.customerName || custName;

          if (!finalCustomerName) continue;

          const rawDate = getValue(row, ["expecteddeliverydate", "deliverydate", "requesteddate", "ngày giao hàng"]);
          const parsedDate = parseExcelDate(rawDate);
          const finalSku = matchedProduct ? matchedProduct.sku : prodSym;

          parsedList.push({
            index: indexVal,
            poNumber: poNum || `PO-${Date.now()}-${parsedList.length + 1}`,
            accountId: String(getValue(row, ["accountid", "account id"]) || "").trim(),
            customerName: finalCustomerName,
            productSymbol: prodSym,
            sku: finalSku,
            productNameVi: String(getValue(row, ["productnamevi", "product name vi", "tên sp tieng viet"]) || matchedProduct?.nameVi || prodSym).trim(),
            productNameEn: "",
            legacySymbols: "",
            qty: qtyVal,
            expectedDeliveryDate: parsedDate,
            tolerance: Number(getValue(row, ["tolerance"])) || undefined,
            currency: String(getValue(row, ["currency"]) || "VND").trim(),
            techRequirement: String(getValue(row, ["techrequirement", "tech requirement"]) || "").trim(),
            specialRequirement: String(getValue(row, ["specialrequirement", "special requirement"]) || "").trim(),
            isNewSku: !matchedProduct,
          });
        }

        setParsedRows(parsedList);
      } catch (err) {
        console.error(err);
        setFormError("Không thể đọc file Excel. Vui lòng kiểm tra lại định dạng file.");
      } finally {
        setIsParsingExcel(false);
      }
    };

    reader.readAsArrayBuffer(file);
  };

  // State for Concise Conflict Summary Modal (No heavy line table in React state)
  const [conflictSummary, setConflictSummary] = useState<{
    totalRows: number;
    validCount: number;
    conflictCount: number;
    conflictSkusCount: number;
  } | null>(null);

  const conflictRowsRef = useRef<any[]>([]);
  const [lastImportSkippedReportRows, setLastImportSkippedReportRows] = useState<any[]>([]);

  // Helper: Export Skipped Conflict Rows to Excel File
  const downloadConflictReportExcel = (conflictRowsList: any[]) => {
    if (!conflictRowsList || conflictRowsList.length === 0) return;

    const exportRows = conflictRowsList.map((c: any) => ({
      "Số dòng trong file gốc": c.originalRowIndex,
      "Part No.": c.sku,
      "Khách hàng đề nghị (bị từ chối)": c.requestedCustomer,
      "Danh sách Khách hàng đã đăng ký sẵn cho Part No. đó": c.registeredCustomers,
      "Số PO liên quan": c.poNumber,
    }));

    const ws = XLSX.utils.json_to_sheet(exportRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Dong_Bi_Bo_Qua");
    const fileName = `Bao_Cao_Cac_Dong_Bi_Bo_Qua_Import_PO_${new Date().toISOString().split("T")[0]}.xlsx`;
    XLSX.writeFile(wb, fileName);
  };

  // Submit Excel Batch Import
  const handleConfirmImport = async (skipConflicts = false) => {
    if (parsedRows.length === 0) return;

    setIsSubmitting(true);
    setFormError("");

    try {
      const res = await fetch("/api/po/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: parsedRows, skipConflicts }),
      });

      const data = await res.json();
      if (!res.ok) {
        setFormError(data.error || "Import đơn hàng PO thất bại.");
        setIsSubmitting(false);
        return;
      }

      if (data.hasConflicts) {
        setConflictSummary({
          totalRows: data.totalRows,
          validCount: data.validCount,
          conflictCount: data.conflictCount,
          conflictSkusCount: data.conflictSkusCount,
        });
        conflictRowsRef.current = data.conflictRows || [];
        setIsSubmitting(false);
        return;
      }

      // If import succeeded with skipped conflicts, auto-download report
      if (data.conflictRows && data.conflictRows.length > 0) {
        setLastImportSkippedReportRows(data.conflictRows);
        downloadConflictReportExcel(data.conflictRows);
      } else {
        setLastImportSkippedReportRows([]);
      }

      const successMsg = data.message || `Đã import thành công ${data.count}/${data.totalRows || parsedRows.length} đơn hàng PO!`;
      setToastMessage(successMsg);
      setIsImportModalOpen(false);
      setConflictSummary(null);
      setParsedRows([]);
      setImportFileName("");
      mutatePOs();
      mutateProducts();
    } catch {
      setFormError("Không thể kết nối đến máy chủ.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Export Filtered POs to Excel
  const handleExportExcel = () => {
    if (filteredPOs.length === 0) {
      alert("Không có đơn hàng PO nào phù hợp với bộ lọc hiện tại để xuất Excel.");
      return;
    }

    const exportRows = filteredPOs.map((po) => {
      const remaining = Math.max(0, po.qty - po.shippedQty);
      const scheduleInfo = getDeliveryScheduleStatus(po);
      const scheduleText =
        po.status === "COMPLETED" || remaining === 0
          ? "Đã hoàn thành"
          : scheduleInfo?.excelText || "Chưa có hạn";

      return {
        "Số PO": po.poNumber,
        "Khách hàng": po.customerName,
        SKU: po.sku,
        "SL đặt": po.qty,
        "Đã xuất": po.shippedQty,
        "Còn lại": remaining,
        "Ngày giao yêu cầu": createExcelDateCell(po.requestedDate),
        "Trạng thái": po.status,
        "Trạng thái so với hạn giao": scheduleText,
      };
    });

    const ws = XLSX.utils.json_to_sheet(exportRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Danh_Sach_PO");
    XLSX.writeFile(wb, `Danh_Sach_PO_${new Date().toISOString().split("T")[0]}.xlsx`);
  };

  return (
    <div className="space-y-6">
      {/* Top Header & Actions Toolbar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-4 rounded bg-canvas border border-border">
        <div className="flex flex-wrap items-center gap-3">
          {/* Search Input */}
          <div className="relative flex items-center">
            <Search className="w-4 h-4 absolute left-2.5 text-txt-secondary" />
            <input
              type="text"
              placeholder="Tìm kiếm PO, Khách hàng, SKU..."
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
              <option value="NEW">NEW (Mới tạo)</option>
              <option value="IN_PRODUCTION">IN_PRODUCTION (Đang sản xuất)</option>
              <option value="PARTIALLY_SHIPPED">PARTIALLY_SHIPPED (Đã xuất 1 phần)</option>
              <option value="COMPLETED">COMPLETED (Hoàn thành)</option>
            </select>
          </div>
        </div>

        {/* Action Buttons Toolbar - Minimalist Icon-only Buttons (Single Line) */}
        <div className="flex items-center gap-1.5 shrink-0 flex-nowrap">
          {selectedPoKeys.size > 0 && (
            <span className="text-[11px] font-semibold text-accent font-mono bg-accent/10 px-2 py-1 rounded border border-accent/20 shrink-0">
              Đã chọn {selectedPoKeys.size}
            </span>
          )}

          {/* 1. Xem Tiến Độ PO */}
          <button
            type="button"
            onClick={() => {
              if (selectedPoKeys.size !== 1) return;
              const selectedPoId = Array.from(selectedPoKeys)[0];
              router.push(`/dashboard/pipeline?poId=${encodeURIComponent(selectedPoId)}`);
            }}
            disabled={selectedPoKeys.size !== 1}
            className="p-2 rounded bg-blue-50 border border-blue-200 text-blue-700 hover:bg-blue-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
            title="Xem tiến độ PO Pipeline (Chỉ chọn 1 PO)"
          >
            <ChevronRight className="w-4 h-4 text-blue-600" />
          </button>

          {/* 2. Sửa PO */}
          <button
            type="button"
            onClick={() => {
              if (selectedPoKeys.size !== 1) return;
              const selectedPoId = Array.from(selectedPoKeys)[0];
              const poToEdit = pos.find((p) => p.poId === selectedPoId);
              if (poToEdit) openEditModal(poToEdit);
            }}
            disabled={selectedPoKeys.size !== 1}
            className="p-2 rounded bg-amber-50 border border-amber-200 text-amber-800 hover:bg-amber-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
            title="Chỉnh sửa thông tin PO đã chọn (Chỉ chọn 1 PO)"
          >
            <Edit2 className="w-4 h-4 text-amber-600" />
          </button>

          {/* 3. Xóa PO */}
          <button
            type="button"
            onClick={() => {
              if (selectedPoKeys.size === 0) return;
              setBulkDeleteResult(null);
              setIsBulkDeleteModalOpen(true);
            }}
            disabled={selectedPoKeys.size === 0}
            className="p-2 rounded bg-rose-50 border border-rose-200 text-rose-700 hover:bg-rose-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
            title={selectedPoKeys.size > 0 ? `Xóa ${selectedPoKeys.size} PO đã chọn` : "Xóa PO đã chọn"}
          >
            <Trash2 className="w-4 h-4 text-rose-600" />
          </button>

          <div className="h-4 w-px bg-border mx-0.5 shrink-0" />

          {/* 4. Xuất Excel PO */}
          <button
            type="button"
            onClick={handleExportExcel}
            className="p-2 rounded bg-subtle border border-border hover:bg-border text-txt-primary transition-colors shrink-0"
            title="Xuất mảng PO đang hiển thị ra file Excel"
          >
            <Download className="w-4 h-4 text-blue-600" />
          </button>

          {/* 5. Import Excel PO */}
          <button
            type="button"
            onClick={() => setIsImportModalOpen(true)}
            className="p-2 rounded bg-emerald-50 border border-emerald-200 text-emerald-800 hover:bg-emerald-100 transition-colors shrink-0"
            title="Import đơn hàng PO từ file Excel"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
          </button>

          {lastImportSkippedReportRows.length > 0 && (
            <button
              type="button"
              onClick={() => downloadConflictReportExcel(lastImportSkippedReportRows)}
              className="p-2 rounded bg-amber-500/10 border border-amber-500/30 text-amber-700 hover:bg-amber-500/20 transition-colors shrink-0"
              title={`Tải báo cáo ${lastImportSkippedReportRows.length} dòng bị bỏ qua từ đợt import vừa rồi`}
            >
              <AlertTriangle className="w-4 h-4 text-amber-600" />
            </button>
          )}

          {/* 6. Thêm PO Mới */}
          <button
            type="button"
            onClick={openCreateModal}
            className="p-2 rounded bg-accent text-white hover:opacity-90 transition-opacity shadow-sm shrink-0"
            title="Thêm đơn hàng PO mới thủ công"
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

      {/* Shared Excel-Style DataTable for POs */}
      <DataTable<PO>
        data={filteredPOs}
        columns={poColumns}
        getItemKey={(po) => po.poId}
        selectable={true}
        selectedKeys={selectedPoKeys}
        onSelectionChange={setSelectedPoKeys}
        sortConfig={sortConfig}
        onSortChange={setSortConfig}
        enablePagination={true}
        defaultPageSize={50}
        isLoading={!posData}
        loadingMessage="Đang tải danh sách đơn hàng PO..."
        emptyMessage="Không tìm thấy đơn hàng PO nào khớp bộ lọc."
      />
      {/* Bulk Delete PO Confirmation Modal */}
      {isBulkDeleteModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-canvas border border-border rounded-lg shadow-xl max-w-lg w-full p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-10 h-10 rounded-full bg-rose-100 text-rose-600 shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-txt-primary">Xác Nhận Xóa Đơn Hàng PO</h3>
                <p className="text-xs text-txt-secondary mt-0.5">Hành động này sẽ xóa dữ liệu vĩnh viễn.</p>
              </div>
            </div>

            {!bulkDeleteResult ? (
              <div className="p-3 rounded bg-subtle border border-border space-y-2 text-xs">
                <p className="font-semibold text-txt-primary">
                  Bạn có chắc chắn muốn xóa {selectedPoKeys.size} đơn hàng PO đã chọn?
                </p>
                <p className="text-txt-secondary italic">⚠️ PO đang có WO liên quan sẽ bị từ chối, các PO còn lại sẽ được xóa thành công.</p>
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
                  onClick={handleBulkDeletePO}
                  disabled={isBulkDeleting}
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded bg-rose-600 text-white font-semibold hover:bg-rose-700 text-xs disabled:opacity-50"
                >
                  {isBulkDeleting ? "Đang xóa..." : `Xác Nhận Xóa ${selectedPoKeys.size} PO`}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Manual / Edit PO Modal */}
      {isManualModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="bg-canvas border border-border rounded-lg shadow-xl max-w-3xl w-full max-h-[92vh] overflow-y-auto p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="text-sm font-bold text-txt-primary">
                {editingPO ? `Chỉnh Sửa Đơn Hàng: ${editingPO.poNumber}` : "Tạo Đơn Hàng PO Mới (Nhập Tay)"}
              </h3>
              <button onClick={() => setIsManualModalOpen(false)} className="text-txt-secondary hover:text-txt-primary">
                <X className="w-4 h-4" />
              </button>
            </div>

            {formError && (
              <div className="p-3 rounded bg-amber-50 border border-amber-200 text-warning text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleManualSubmit} className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-medium text-txt-secondary">Số PO (poNumber):</label>
                  <input
                    type="text"
                    placeholder="VD: PO-2026-001"
                    value={poNumber}
                    onChange={(e) => setPoNumber(e.target.value)}
                    className="w-full px-3 py-1.5 bg-canvas border border-border rounded text-txt-primary font-mono focus:outline-none focus:border-accent"
                  />
                </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-medium text-txt-secondary">Chọn {LABELS.sku} (*):</label>
                  <select
                    value={sku}
                    onChange={(e) => {
                      const selectedSku = e.target.value;
                      setSku(selectedSku);
                      const p = products.find((prod) => prod.sku === selectedSku);
                      if (p) {
                        setProductNameVi(p.nameVi);
                        const custs = p.customerNames || (p.customerName ? [p.customerName] : []);
                        if (custs.length === 1) {
                          setCustomerName(custs[0]);
                        } else {
                          setCustomerName("");
                        }
                      } else {
                        setCustomerName("");
                      }
                    }}
                    className="w-full px-3 py-1.5 bg-canvas border border-border rounded text-txt-primary font-mono focus:outline-none focus:border-accent"
                  >
                    <option value="">-- Chọn {LABELS.sku} --</option>
                    {products.map((p) => {
                      const custs = p.customerNames || (p.customerName ? [p.customerName] : []);
                      const custText = custs.length > 0 ? custs.join(", ") : "Chưa gắn KH";
                      return (
                        <option key={p.sku} value={p.sku}>
                          {p.sku} - {p.nameVi} ({custText})
                        </option>
                      );
                    })}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="font-medium text-txt-secondary">Khách Hàng (*):</label>
                  <select
                    required
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    disabled={!sku}
                    className="w-full px-3 py-1.5 bg-canvas border border-border rounded text-txt-primary font-medium focus:outline-none focus:border-accent disabled:opacity-60"
                  >
                    <option value="">-- Chọn Khách Hàng --</option>
                    {(() => {
                      const selectedP = products.find((p) => p.sku === sku);
                      const allowedCusts = selectedP?.customerNames || (selectedP?.customerName ? [selectedP.customerName] : []);
                      return allowedCusts.map((cust) => (
                        <option key={cust} value={cust}>
                          {cust}
                        </option>
                      ));
                    })()}
                  </select>
                </div>
              </div>

                <div className="space-y-1">
                  <label className="font-medium text-txt-secondary">Số Lượng Đặt (qty) (*):</label>
                  <input
                    type="number"
                    min="1"
                    required
                    placeholder="VD: 500"
                    value={qty}
                    onChange={(e) => setQty(e.target.value)}
                    className="w-full px-3 py-1.5 bg-canvas border border-border rounded text-txt-primary font-mono focus:outline-none focus:border-accent"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-medium text-txt-secondary">Ngày Giao Hàng Yêu Cầu (*):</label>
                  <input
                    type="date"
                    required
                    value={requestedDate}
                    onChange={(e) => setRequestedDate(e.target.value)}
                    className="w-full px-3 py-1.5 bg-canvas border border-border rounded text-txt-primary focus:outline-none focus:border-accent cursor-pointer"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-medium text-txt-secondary">Dung Sai (%):</label>
                  <input
                    type="number"
                    placeholder="VD: 5"
                    value={tolerance}
                    onChange={(e) => setTolerance(e.target.value)}
                    className="w-full px-3 py-1.5 bg-canvas border border-border rounded text-txt-primary font-mono focus:outline-none focus:border-accent"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-border">
                <button
                  type="button"
                  onClick={() => setIsManualModalOpen(false)}
                  className="px-4 py-1.5 rounded bg-subtle border border-border text-txt-primary hover:bg-border"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-1.5 rounded bg-accent text-white font-medium hover:opacity-90 disabled:opacity-50"
                >
                  {isSubmitting ? "Đang lưu..." : editingPO ? "Cập Nhật PO" : "Xác Nhận Tạo PO"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Excel Import Modal & Preview Table */}
      {isImportModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-canvas border border-border rounded shadow-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="w-5 h-5 text-emerald-600" />
                <h3 className="text-sm font-bold text-txt-primary">Import Đơn Hàng PO Từ File Excel</h3>
              </div>
              <button onClick={() => setIsImportModalOpen(false)} className="text-txt-secondary hover:text-txt-primary">
                <X className="w-4 h-4" />
              </button>
            </div>

            {formError && (
              <div className="p-3 rounded bg-amber-50 border border-amber-200 text-warning text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            {/* Upload Area */}
            <div className="p-6 border-2 border-dashed border-border rounded bg-subtle/50 text-center space-y-3">
              <UploadCloud className="w-8 h-8 text-txt-secondary mx-auto" />
              <div>
                <p className="text-xs font-semibold text-txt-primary">Chọn file Excel (.xlsx, .xls) chứa danh sách PO</p>
                <p className="text-[11px] text-txt-secondary">Parse 100% ở trình duyệt, hỗ trợ cột index, deliveryDate (dd/mm/yyyy), customerName, productSymbol...</p>
              </div>
              <input
                type="file"
                accept=".xlsx, .xls"
                onChange={handleFileChange}
                className="hidden"
                id="excelFileInput"
              />
              <label
                htmlFor="excelFileInput"
                className="inline-flex items-center gap-2 px-4 py-2 rounded bg-canvas border border-border text-xs font-medium text-txt-primary cursor-pointer hover:bg-subtle transition-colors shadow-sm"
              >
                {isParsingExcel ? "Đang đọc file..." : importFileName ? `File đã chọn: ${importFileName}` : "Tải Lên File Excel"}
              </label>
            </div>

            {/* Preview Table */}
            {parsedRows.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-txt-primary">
                    Xem Trước Dữ Liệu Parse Được ({parsedRows.length} dòng đơn hàng):
                  </span>
                  <span className="text-[11px] text-txt-secondary">
                    Có <strong className="text-warning">{parsedRows.filter((r) => r.isNewSku).length}</strong> SKU mới sẽ tự động tạo nháp (needsRouting=true)
                  </span>
                </div>

                <div className="border border-border rounded bg-canvas overflow-x-auto max-h-60 text-xs">
                  <table className="w-full text-left border-collapse">
                    <thead className="bg-subtle border-b border-border text-[11px] font-semibold text-txt-secondary uppercase">
                      <tr>
                        <th className="p-2">STT</th>
                        <th className="p-2">Số PO</th>
                        <th className="p-2">Khách Hàng</th>
                        <th className="p-2">Product Symbol / SKU</th>
                        <th className="p-2 text-right">Số Lượng</th>
                        <th className="p-2">Ngày Giao</th>
                        <th className="p-2">Trạng Thái SKU</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {parsedRows.map((r, i) => (
                        <tr key={i} className={r.isNewSku ? "bg-amber-50/40" : "hover:bg-subtle"}>
                          <td className="p-2 font-mono text-txt-secondary">{r.index || i + 1}</td>
                          <td className="p-2 font-mono font-bold text-txt-primary">{r.poNumber}</td>
                          <td className="p-2 text-txt-primary">{r.customerName}</td>
                          <td className="p-2 font-mono text-txt-primary">{r.sku}</td>
                          <td className="p-2 text-right font-mono font-bold text-txt-primary">{r.qty}</td>
                          <td className="p-2 font-mono text-txt-secondary">{r.expectedDeliveryDate}</td>
                          <td className="p-2">
                            {r.isNewSku ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-50 border border-amber-200 text-warning text-[10px] font-semibold">
                                <AlertTriangle className="w-3 h-3" /> SKU mới — cần bổ sung routing
                              </span>
                            ) : (
                              <span className="text-[10px] text-emerald-600 font-semibold">Đã có trong hệ thống</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Modal Actions */}
            <div className="flex items-center justify-end gap-2 pt-3 border-t border-border">
              <button
                type="button"
                onClick={() => setIsImportModalOpen(false)}
                className="px-4 py-1.5 rounded bg-subtle border border-border text-txt-primary hover:bg-border text-xs"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={() => handleConfirmImport(false)}
                disabled={isSubmitting || parsedRows.length === 0}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded bg-accent text-white text-xs font-medium hover:opacity-90 disabled:opacity-40"
              >
                {isSubmitting ? "Đang import..." : `Xác Nhận Import ${parsedRows.length} PO`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Concise Conflict Decision Modal (Lightweight - No heavy row table) */}
      {conflictSummary && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-canvas border border-border rounded shadow-xl max-w-lg w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-3 text-amber-600">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 shrink-0" />
                <h3 className="text-sm font-bold text-txt-primary">Xác Nhận Xử Lý Dòng Import Xung Đột</h3>
              </div>
              <button
                onClick={() => {
                  setConflictSummary(null);
                  setIsImportModalOpen(false);
                }}
                className="text-txt-secondary hover:text-txt-primary"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs text-txt-primary">
              <p className="font-semibold text-sm text-amber-700 leading-snug">
                Phát hiện <strong className="font-bold underline">{conflictSummary.conflictCount} dòng</strong> có Khách hàng chưa từng đăng ký cho <strong className="font-bold underline">{conflictSummary.conflictSkusCount} Part No.</strong> khác nhau.
              </p>

              <div className="p-3 rounded bg-subtle border border-border space-y-2 font-mono text-xs">
                <div className="flex justify-between">
                  <span className="text-txt-secondary">• Tổng số dòng trong file gốc:</span>
                  <strong className="text-txt-primary">{conflictSummary.totalRows} dòng</strong>
                </div>
                <div className="flex justify-between text-emerald-600 font-bold">
                  <span>• Số dòng HỢP LỆ (sẽ import):</span>
                  <span>{conflictSummary.validCount} dòng</span>
                </div>
                <div className="flex justify-between text-amber-600 font-bold">
                  <span>• Số dòng XUNG ĐỘT (sẽ bỏ qua):</span>
                  <span>{conflictSummary.conflictCount} dòng</span>
                </div>
              </div>

              <p className="text-[11px] text-txt-secondary">
                Nếu chọn tiếp tục, các dòng xung đột sẽ bị bỏ qua. Hệ thống sẽ tự động xuất file Excel báo cáo chi tiết để bạn kiểm tra và đăng ký bổ sung sau.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-end gap-2 pt-3 border-t border-border">
              <button
                type="button"
                onClick={() => {
                  setConflictSummary(null);
                  setIsImportModalOpen(false);
                  setParsedRows([]);
                  setImportFileName("");
                }}
                className="w-full sm:w-auto px-4 py-2 rounded bg-subtle border border-border text-txt-primary hover:bg-border text-xs font-medium"
              >
                Hủy, tôi sẽ kiểm tra và sửa lại
              </button>
              <button
                type="button"
                onClick={() => handleConfirmImport(true)}
                disabled={isSubmitting}
                className="w-full sm:w-auto px-4 py-2 rounded bg-amber-600 text-white text-xs font-bold hover:bg-amber-700 disabled:opacity-50 transition-colors shadow-sm"
              >
                {isSubmitting ? "Đang import..." : "Tiếp tục import, bỏ qua các dòng xung đột"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
