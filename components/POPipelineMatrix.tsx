"use client";

import { useState, useMemo } from "react";
import useSWR from "swr";
import { useRouter } from "next/navigation";
import {
  Workflow,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  Search,
  Filter,
  RefreshCw,
  Layers,
  Building2,
  Truck,
  ChevronRight,
} from "lucide-react";
import DataTable, { ColumnDef } from "@/components/DataTable";
import { formatDateDisplay, daysBetween, getTodayVN } from "@/lib/date-utils";

interface PipelineStep {
  workshopCode: string;
  stepName: string;
  stepOrder: number;
  isKtp: boolean;
  tonPhoi: number;
  tonThanhPham: number;
  totalStepStock: number;
}

export interface POPipelineItem {
  poId: string;
  poNumber: string;
  customerName: string;
  productId: string;
  sku: string;
  productNameVi: string;
  targetQty: number;
  shippedQty: number;
  remainingQty: number;
  finishWsCode: string;
  lrReadyQty: number;
  cumWsStock: number;
  totalAvailableStock: number;
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
  return formatDateDisplay(dateStr);
}

function getPipelineDeliveryAssessment(item: POPipelineItem): {
  label: string;
  badgeClass: string;
} {
  if (item.poStatus === "COMPLETED" || item.remainingQty === 0) {
    return {
      label: "Đã xong",
      badgeClass: "bg-emerald-50 text-emerald-800 border border-emerald-200",
    };
  }

  if (!item.requestedDate) {
    return {
      label: "Chưa có hạn",
      badgeClass: "bg-subtle text-txt-secondary border border-border",
    };
  }

  const todayStr = getTodayVN();
  const diffDays = daysBetween(todayStr, item.requestedDate);

  if (diffDays < 0 || (item.coverageStatus === "SHORTAGE" && diffDays <= 5)) {
    return {
      label: `Chắc chắn trễ (${diffDays < 0 ? `${Math.abs(diffDays)}d trễ` : `${diffDays}d còn`})`,
      badgeClass: "bg-red-500/10 text-red-600 font-bold border border-red-500/30",
    };
  } else if (
    item.coverageStatus === "SHORTAGE" ||
    (item.coverageStatus === "WIP_COVERED" && diffDays <= 7) ||
    diffDays <= 3
  ) {
    return {
      label: `Rủi ro trễ (${diffDays}d còn)`,
      badgeClass: "bg-amber-500/10 text-amber-600 font-semibold border border-amber-500/30",
    };
  } else {
    return {
      label: `Có khả năng kịp (${diffDays}d còn)`,
      badgeClass: "bg-emerald-500/10 text-emerald-600 font-medium border border-emerald-500/30",
    };
  }
}

export default function POPipelineMatrix({ initialPoId }: { initialPoId?: string }) {
  const router = useRouter();

  const { data: rawPoItems, error, isValidating, mutate } = useSWR<POPipelineItem[]>(
    "/api/reports/po-pipeline",
    fetcher,
    {
      revalidateOnFocus: true,
    }
  );

  const [searchTerm, setSearchTerm] = useState(initialPoId || "");
  const [coverageFilter, setCoverageFilter] = useState<string>("ALL");
  const [poStatusFilter, setPoStatusFilter] = useState<string>("ALL");
  const [customerFilter, setCustomerFilter] = useState<string>("ALL");
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

  const poItems = useMemo(() => (Array.isArray(rawPoItems) ? rawPoItems : []), [rawPoItems]);

  const pipelineColumns: ColumnDef<POPipelineItem>[] = useMemo(
    () => [
      {
        key: "poNumber",
        header: "Mã PO & Ngày Ký",
        sortable: true,
        headerClassName: "font-bold text-txt-primary",
        render: (item) => (
          <div className="space-y-0.5">
            <span className="font-mono font-bold text-txt-primary block">{item.poNumber}</span>
            <span className="text-[11px] text-txt-secondary font-mono block">{formatDate(item.createdAt)}</span>
          </div>
        ),
      },
      {
        key: "customerName",
        header: "Khách Hàng",
        sortable: true,
        render: (item) => <span className="font-medium text-txt-primary">{item.customerName}</span>,
      },
      {
        key: "sku",
        header: "Sản Phẩm Đặt Hàng",
        sortable: true,
        render: (item) => (
          <div className="space-y-0.5">
            <span className="font-mono font-bold text-xs text-txt-primary block">{item.sku}</span>
            <span className="text-[11px] text-txt-secondary block truncate max-w-[180px]">
              {item.productNameVi}
            </span>
          </div>
        ),
      },
      {
        key: "targetQty",
        header: "SL Đặt PO",
        sortable: true,
        align: "right",
        sortValue: (item) => item.targetQty,
        render: (item) => (
          <span className="font-bold font-mono text-txt-primary">{item.targetQty.toLocaleString()}</span>
        ),
      },
      {
        key: "shippedQty",
        header: "Đã Xuất",
        sortable: true,
        align: "right",
        sortValue: (item) => item.shippedQty,
        render: (item) => (
          <span className="font-mono text-emerald-600 font-semibold">{item.shippedQty.toLocaleString()}</span>
        ),
      },
      {
        key: "remainingQty",
        header: "Còn Thiếu",
        sortable: true,
        align: "right",
        sortValue: (item) => item.remainingQty,
        render: (item) => (
          <span className="font-mono font-semibold text-txt-primary">{item.remainingQty.toLocaleString()}</span>
        ),
      },
      {
        key: "finishWsCode",
        header: "Điểm Hội Tụ",
        sortable: true,
        align: "center",
        headerClassName: "bg-amber-50/50 text-amber-900 font-bold",
        className: "bg-amber-50/30 font-bold text-amber-800 font-mono",
        render: (item) => item.finishWsCode,
      },
      {
        key: "lrReadyQty",
        header: "Tồn Tại KTP / Nhu Cầu PO",
        align: "center",
        headerClassName: "bg-emerald-50/50 text-emerald-900 font-bold",
        className: "bg-emerald-50/30 font-mono text-xs",
        render: (item) => (
          <div className="flex flex-col items-center gap-0.5">
            <span className="font-bold text-txt-primary">
              Tại KTP: {item.lrReadyQty.toLocaleString()} / PO: {item.targetQty.toLocaleString()} pcs
            </span>
            {item.lrReadyQty >= item.remainingQty ? (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/10 text-emerald-600 border border-emerald-500/30">
                🟢 Đủ hàng xuất
              </span>
            ) : (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-red-500/10 text-red-600 border border-red-500/30">
                🔴 Thiếu {item.remainingQty - item.lrReadyQty} pcs
              </span>
            )}
          </div>
        ),
      },
      {
        key: "coverageStatus",
        header: "Đánh Giá Mức Độ Rủi Ro",
        sortable: true,
        align: "center",
        render: (item) => (
          <>
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
          </>
        ),
      },
      {
        key: "requestedDate",
        header: "Hạn Giao Hàng",
        sortable: true,
        align: "center",
        render: (item) => {
          const deliveryAssessment = getPipelineDeliveryAssessment(item);
          return (
            <div className="flex flex-col items-center gap-1 font-mono">
              <span className="font-semibold text-txt-primary">{formatDate(item.requestedDate)}</span>
              <span className={`px-2 py-0.5 rounded text-[10px] tracking-wide ${deliveryAssessment.badgeClass}`}>
                {deliveryAssessment.label}
              </span>
            </div>
          );
        },
      },
    ],
    []
  );

  // Distinct customer list for dropdown filter
  const customerList = useMemo(() => {
    const set = new Set<string>();
    poItems.forEach((item) => {
      if (item.customerName) set.add(item.customerName);
    });
    return Array.from(set).sort();
  }, [poItems]);

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
        const matchProd = (item.productNameVi || "").toLowerCase().includes(term);
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

  const handleNavigateShipment = () => {
    if (selectedKeys.size === 0) return;
    const ids = Array.from(selectedKeys).join(",");
    router.push(`/dashboard/shipment?poLineIds=${encodeURIComponent(ids)}`);
  };

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
              title="Làm mới dữ liệu (Tự động cập nhật khi quay lại trang)"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isValidating ? "animate-spin text-accent" : ""}`} />
              <span>Làm mới</span>
            </button>

            {/* Navigate to Shipment */}
            {selectedKeys.size > 0 && (
              <button
                type="button"
                onClick={handleNavigateShipment}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded bg-emerald-600 text-white font-semibold text-xs hover:bg-emerald-700 transition-colors shadow-sm"
                title="Lập Thông Báo Giao Hàng cho các PO đã chọn"
              >
                <Truck className="w-3.5 h-3.5" />
                <span>Xuất Hàng ({selectedKeys.size})</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Main Shared DataTable for PO Pipeline */}
      {error ? (
        <div className="p-4 rounded bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
          <span>{error.message || "Đã xảy ra lỗi khi tải dữ liệu PO Pipeline."}</span>
        </div>
      ) : (
        <DataTable<POPipelineItem>
          data={filteredItems}
          columns={pipelineColumns}
          getItemKey={(item) => item.poId}
          selectable={true}
          selectedKeys={selectedKeys}
          onSelectionChange={setSelectedKeys}
          enablePagination={true}
          defaultPageSize={50}
          isLoading={!rawPoItems}
          loadingMessage="Đang tải ma trận dòng chảy tồn kho PO..."
          emptyMessage="Không tìm thấy đơn hàng PO nào khớp với bộ lọc hiện tại."
        />
      )}
    </div>
  );
}
