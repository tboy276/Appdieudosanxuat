"use client";

import { useState } from "react";
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
} from "lucide-react";
import AccordionList from "@/components/AccordionList";
import { PO, POStatus } from "@/lib/po-wo-engine";
import { Product } from "@/lib/types";

const fetcher = (url: string) => fetch(url).then((res) => res.json());

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
  const { data: posData, mutate: mutatePOs } = useSWR<PO[]>("/api/po", fetcher);
  const { data: productsData, mutate: mutateProducts } = useSWR<Product[]>("/api/products", fetcher);

  const pos = Array.isArray(posData) ? posData : [];
  const products = Array.isArray(productsData) ? productsData : [];

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedStatus, setSelectedStatus] = useState<string>("ALL");

  // Modals state
  const [isManualModalOpen, setIsManualModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);

  // Manual Form State
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

  // Manual PO Submit
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

      const res = await fetch("/api/po", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
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
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setFormError(data.error || "Tạo đơn hàng PO thất bại.");
        setIsSubmitting(false);
        return;
      }

      setToastMessage(`Đã tạo thành công đơn hàng PO ${data.poNumber}.`);
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

    // If Excel serial number
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
    // Check if dd/mm/yyyy or d/m/yyyy
    const parts = str.split(/[/.-]/);
    if (parts.length === 3) {
      if (parts[2].length === 4) {
        // Assume dd/mm/yyyy
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

        // Find header row (case insensitive column matching)
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
          // Fallback: assume first row is header
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

          // Skip total rows or empty index
          if (firstCell.includes("total") || firstCell.includes("tổng") || (!indexVal && !getValue(row, ["ponumber", "po number"]))) {
            continue;
          }

          const poNum = String(getValue(row, ["ponumber", "po number", "mã po"]) || "").trim();
          const custName = String(getValue(row, ["customername", "customer name", "khách hàng"]) || "").trim();
          const prodSym = String(getValue(row, ["productsymbol", "product symbol", "mã sản phẩm", "sku"]) || "").trim();
          const qtyVal = Number(getValue(row, ["quantity", "qty", "số lượng"]) || 0);

          if (!custName || !prodSym || qtyVal <= 0) continue;

          const rawDate = getValue(row, ["expecteddeliverydate", "deliverydate", "requesteddate", "ngày giao hàng"]);
          const parsedDate = parseExcelDate(rawDate);

          // Cross-reference product symbol with loaded products
          const matchedProduct = products.find(
            (p) =>
              p.sku.toLowerCase() === prodSym.toLowerCase() ||
              (p.legacySymbols && p.legacySymbols.some((s) => s.toLowerCase() === prodSym.toLowerCase()))
          );

          const finalSku = matchedProduct ? matchedProduct.sku : prodSym;

          parsedList.push({
            index: indexVal,
            poNumber: poNum || `PO-${Date.now()}-${parsedList.length + 1}`,
            accountId: String(getValue(row, ["accountid", "account id"]) || "").trim(),
            customerName: custName,
            productSymbol: prodSym,
            sku: finalSku,
            productNameVi: String(getValue(row, ["productnamevi", "product name vi", "tên sp tieng viet"]) || matchedProduct?.nameVi || prodSym).trim(),
            productNameEn: String(getValue(row, ["productnameen", "product name en"]) || matchedProduct?.nameEn || "").trim(),
            legacySymbols: String(getValue(row, ["legacysymbols", "legacy symbols"]) || "").trim(),
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

  // Submit Excel Batch Import
  const handleConfirmImport = async () => {
    if (parsedRows.length === 0) return;

    setIsSubmitting(true);
    setFormError("");

    try {
      const res = await fetch("/api/po/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: parsedRows }),
      });

      const data = await res.json();
      if (!res.ok) {
        setFormError(data.error || "Import đơn hàng PO thất bại.");
        setIsSubmitting(false);
        return;
      }

      setToastMessage(`Đã import thành công ${data.count} đơn hàng PO!`);
      setIsImportModalOpen(false);
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

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsImportModalOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-subtle border border-border hover:bg-border text-xs font-medium text-txt-primary transition-colors"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
            <span>Import Excel PO</span>
          </button>

          <button
            onClick={() => setIsManualModalOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-accent text-white text-xs font-medium hover:opacity-90 transition-opacity"
          >
            <Plus className="w-4 h-4" />
            <span>Thêm PO Mới</span>
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

      {/* Accordion PO List */}
      <AccordionList<PO>
        items={filteredPOs}
        getItemKey={(po) => po.poId}
        emptyMessage="Không tìm thấy đơn hàng PO nào."
        renderHeader={(po) => {
          const isCompleted = po.status === "COMPLETED";

          return (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center gap-3">
                <span className="font-mono font-bold text-txt-primary text-sm">{po.poNumber}</span>
                <span className="text-xs font-medium text-txt-primary">{po.customerName}</span>
                <span className="font-mono text-xs text-txt-secondary">SKU: {po.sku}</span>
              </div>

              <div className="flex items-center gap-3">
                <span className="text-xs font-mono text-txt-secondary">
                  Đã xuất: <strong className="text-txt-primary">{po.shippedQty}</strong> / {po.qty} pcs
                </span>

                {/* Minimalist Status Badge */}
                <span
                  className={`px-2.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${
                    isCompleted
                      ? "bg-emerald-50 border border-emerald-200 text-emerald-800"
                      : "bg-subtle border border-border text-txt-primary"
                  }`}
                >
                  {po.status}
                </span>
              </div>
            </div>
          );
        }}
        renderDetail={(po) => (
          <div className="space-y-4 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-3 rounded bg-subtle border border-border">
              <div>
                <p className="text-txt-secondary">Tên Sản Phẩm (VI):</p>
                <p className="font-medium text-txt-primary">{po.productNameVi}</p>
              </div>
              <div>
                <p className="text-txt-secondary">Tên Sản Phẩm (EN):</p>
                <p className="font-medium text-txt-primary">{po.productNameEn || "N/A"}</p>
              </div>
              <div>
                <p className="text-txt-secondary">Ngày Giao Hàng Yêu Cầu:</p>
                <p className="font-mono font-semibold text-txt-primary">{po.requestedDate}</p>
              </div>
              <div>
                <p className="text-txt-secondary">Dung Sai Hàng Giao:</p>
                <p className="font-mono text-txt-primary">{po.tolerance ? `±${po.tolerance}%` : "Không có"}</p>
              </div>
              <div>
                <p className="text-txt-secondary">Loại Tiền Tệ:</p>
                <p className="font-mono text-txt-primary">{po.currency || "VND"}</p>
              </div>
              <div>
                <p className="text-txt-secondary">Mã Tài Khoản KH (AccountId):</p>
                <p className="font-mono text-txt-primary">{po.accountId || "N/A"}</p>
              </div>
            </div>

            {(po.techRequirement || po.specialRequirement) && (
              <div className="p-3 rounded bg-canvas border border-border space-y-1.5">
                {po.techRequirement && (
                  <p className="text-txt-secondary">
                    <strong className="text-txt-primary">Yêu cầu kỹ thuật:</strong> {po.techRequirement}
                  </p>
                )}
                {po.specialRequirement && (
                  <p className="text-txt-secondary">
                    <strong className="text-txt-primary">Yêu cầu đặc biệt:</strong> {po.specialRequirement}
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      />

      {/* Manual PO Entry Modal */}
      {isManualModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-canvas border border-border rounded shadow-lg max-w-lg w-full max-h-[90vh] overflow-y-auto p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="text-sm font-bold text-txt-primary">Tạo Đơn Hàng PO Mới (Nhập Tay)</h3>
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
                <div className="space-y-1">
                  <label className="font-medium text-txt-secondary">Tên Khách Hàng (*):</label>
                  <input
                    type="text"
                    required
                    placeholder="VD: Công ty Cơ Khí Nhật Bản"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    className="w-full px-3 py-1.5 bg-canvas border border-border rounded text-txt-primary focus:outline-none focus:border-accent"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-medium text-txt-secondary">Chọn SKU Sản Phẩm (*):</label>
                  <select
                    value={sku}
                    onChange={(e) => {
                      setSku(e.target.value);
                      const p = products.find((prod) => prod.sku === e.target.value);
                      if (p) setProductNameVi(p.nameVi);
                    }}
                    className="w-full px-3 py-1.5 bg-canvas border border-border rounded text-txt-primary font-mono focus:outline-none focus:border-accent"
                  >
                    <option value="">-- Chọn SKU --</option>
                    {products.map((p) => (
                      <option key={p.sku} value={p.sku}>
                        {p.sku} - {p.nameVi}
                      </option>
                    ))}
                  </select>
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
                  {isSubmitting ? "Đang tạo..." : "Xác Nhận Tạo PO"}
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
                onClick={handleConfirmImport}
                disabled={isSubmitting || parsedRows.length === 0}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded bg-accent text-white text-xs font-medium hover:opacity-90 disabled:opacity-40"
              >
                {isSubmitting ? "Đang import..." : `Xác Nhận Import ${parsedRows.length} PO`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
