"use client";

import { useState, useMemo, useEffect, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import useSWR from "swr";
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
  Printer,
  Download,
  FileSpreadsheet,
  Building2,
  Plus,
  ChevronRight,
  Eye,
} from "lucide-react";
import DataTable, { ColumnDef } from "@/components/DataTable";
import { ShippableItem, ShipmentHeader } from "@/lib/shipment";
import {
  exportDeliveryNoticeExcel,
  exportShipmentHistoryExcel,
  DeliveryNoticeData,
} from "@/lib/delivery-notice";
import { getTodayVN, formatDateDisplay } from "@/lib/date-utils";

const fetcher = (url: string) => fetch(url).then((res) => res.json());

function ShipmentContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [activeTab, setActiveTab] = useState<"create" | "history">("create");
  const [searchTerm, setSearchTerm] = useState("");
  const [customerFilter, setCustomerFilter] = useState("ALL");

  // Form State for creating shipment
  const [selectedPoLineIds, setSelectedPoLineIds] = useState<Set<string>>(new Set());
  const [qtyMap, setQtyMap] = useState<Record<string, number>>({});
  const [vehicleNo, setVehicleNo] = useState("");
  const [shipmentNotes, setShipmentNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [successNotice, setSuccessNotice] = useState<DeliveryNoticeData | null>(null);

  // Detail Modal for past shipment
  const [viewingShipment, setViewingShipment] = useState<ShipmentHeader | null>(null);

  // SWR Queries
  const {
    data: shippableData,
    error: shippableErr,
    isValidating: isValidatingShippable,
    mutate: mutateShippable,
  } = useSWR<ShippableItem[]>("/api/shipment/shippable", fetcher, {
    revalidateOnFocus: true,
  });

  const {
    data: historyData,
    error: historyErr,
    isValidating: isValidatingHistory,
    mutate: mutateHistory,
  } = useSWR<ShipmentHeader[]>("/api/shipment", fetcher, {
    revalidateOnFocus: true,
  });

  const shippableItems = useMemo(
    () => (Array.isArray(shippableData) ? shippableData : []),
    [shippableData]
  );
  const historyItems = useMemo(
    () => (Array.isArray(historyData) ? historyData : []),
    [historyData]
  );

  // Auto-select POs if passed via URL param (?poLineIds=po-1,po-2)
  useEffect(() => {
    const poLineIdsParam = searchParams.get("poLineIds");
    if (poLineIdsParam && shippableItems.length > 0) {
      const ids = poLineIdsParam.split(",").map((s) => s.trim()).filter(Boolean);
      const newSelected = new Set(selectedPoLineIds);
      const newQtys = { ...qtyMap };

      for (const id of ids) {
        const found = shippableItems.find((item) => item.poLineId === id || item.poId === id);
        if (found) {
          newSelected.add(found.poLineId);
          if (!newQtys[found.poLineId]) {
            newQtys[found.poLineId] = found.maxShippableQty;
          }
        }
      }

      setSelectedPoLineIds(newSelected);
      setQtyMap(newQtys);
    }
  }, [searchParams, shippableItems]);

  // Unique customer list for filter
  const uniqueCustomers = useMemo(() => {
    const set = new Set<string>();
    shippableItems.forEach((i) => {
      if (i.customerName) set.add(i.customerName);
    });
    return Array.from(set).sort();
  }, [shippableItems]);

  // Filtered shippable items
  const filteredShippable = useMemo(() => {
    return shippableItems.filter((item) => {
      if (customerFilter !== "ALL" && item.customerName !== customerFilter) return false;
      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        const matchPo = item.poNumber.toLowerCase().includes(q);
        const matchSku = item.sku.toLowerCase().includes(q);
        const matchCust = item.customerName.toLowerCase().includes(q);
        const matchProd = (item.productNameVi || "").toLowerCase().includes(q);
        if (!matchPo && !matchSku && !matchCust && !matchProd) return false;
      }
      return true;
    });
  }, [shippableItems, customerFilter, searchTerm]);

  // Handle PO line toggle
  const handleTogglePoLine = (item: ShippableItem) => {
    const nextSelected = new Set(selectedPoLineIds);
    const nextQtyMap = { ...qtyMap };

    if (nextSelected.has(item.poLineId)) {
      nextSelected.delete(item.poLineId);
      delete nextQtyMap[item.poLineId];
    } else {
      nextSelected.add(item.poLineId);
      nextQtyMap[item.poLineId] = item.maxShippableQty;
    }

    setSelectedPoLineIds(nextSelected);
    setQtyMap(nextQtyMap);
  };

  const handleSelectAll = () => {
    if (selectedPoLineIds.size === filteredShippable.length) {
      setSelectedPoLineIds(new Set());
      setQtyMap({});
    } else {
      const nextSelected = new Set<string>();
      const nextQtyMap: Record<string, number> = {};
      for (const item of filteredShippable) {
        nextSelected.add(item.poLineId);
        nextQtyMap[item.poLineId] = item.maxShippableQty;
      }
      setSelectedPoLineIds(nextSelected);
      setQtyMap(nextQtyMap);
    }
  };

  // Create Shipment & Generate Delivery Notice
  const handleCreateDeliveryNotice = async () => {
    if (selectedPoLineIds.size === 0) {
      setErrorMsg("Vui lòng chọn ít nhất một đơn hàng PO để lập thông báo giao hàng.");
      return;
    }

    const selectedItems = shippableItems.filter((i) => selectedPoLineIds.has(i.poLineId));
    if (selectedItems.length === 0) return;

    // Validate quantities
    for (const item of selectedItems) {
      const qty = qtyMap[item.poLineId] || 0;
      if (qty <= 0) {
        setErrorMsg(`Số lượng giao cho PO ${item.poNumber} (${item.sku}) phải lớn hơn 0.`);
        return;
      }
      if (qty > item.maxShippableQty) {
        setErrorMsg(
          `Số lượng giao cho PO ${item.poNumber} (${qty} pcs) vượt quá mức khả dụng KTP (${item.maxShippableQty} pcs).`
        );
        return;
      }
    }

    setIsSubmitting(true);
    setErrorMsg("");

    try {
      // Group items by customer or use first customer
      const primaryCustomerId = selectedItems[0].customerId || "";
      const postPayload = {
        customerId: primaryCustomerId,
        note: shipmentNotes.trim(),
        items: selectedItems.map((item) => ({
          poLineId: item.poLineId,
          productId: item.productId,
          shippedQty: qtyMap[item.poLineId],
        })),
      };

      const res = await fetch("/api/shipment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(postPayload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Không thể khởi tạo phiếu xuất hàng.");
      }

      // Build Delivery Notice Data
      const deliveryNotice: DeliveryNoticeData = {
        shipmentCode: data.shipmentNumber || data.shipmentId,
        shipDate: getTodayVN(),
        customerName: Array.from(new Set(selectedItems.map((i) => i.customerName))).join(", "),
        vehicleNo: vehicleNo.trim() || undefined,
        notes: shipmentNotes.trim() || undefined,
        createdBy: "Điều độ sản xuất",
        items: selectedItems.map((item, idx) => ({
          stt: idx + 1,
          poNumber: item.poNumber,
          sku: item.sku,
          productNameVi: item.productNameVi,
          orderQty: item.orderQty,
          shippedQty: qtyMap[item.poLineId],
          remainingQty: Math.max(0, item.remainingOrderQty - qtyMap[item.poLineId]),
          notes: "",
        })),
      };

      // Set success notice modal
      setSuccessNotice(deliveryNotice);

      // Auto download Excel notice
      exportDeliveryNoticeExcel(deliveryNotice);

      // Clear selections & mutate data
      setSelectedPoLineIds(new Set());
      setQtyMap({});
      setVehicleNo("");
      setShipmentNotes("");
      mutateShippable();
      mutateHistory();
    } catch (err: any) {
      setErrorMsg(err.message || "Lập Thông Báo Giao Hàng thất bại.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Columns for Shippable Items
  const shippableColumns: ColumnDef<ShippableItem>[] = useMemo(
    () => [
      {
        key: "select",
        header: (
          <input
            type="checkbox"
            checked={filteredShippable.length > 0 && selectedPoLineIds.size === filteredShippable.length}
            onChange={handleSelectAll}
            className="rounded border-border text-accent focus:ring-0 cursor-pointer"
          />
        ),
        align: "center",
        className: "w-10",
        render: (item) => (
          <input
            type="checkbox"
            checked={selectedPoLineIds.has(item.poLineId)}
            onChange={() => handleTogglePoLine(item)}
            className="rounded border-border text-accent focus:ring-0 cursor-pointer"
          />
        ),
      },
      {
        key: "poNumber",
        header: "Số PO",
        sortable: true,
        render: (item) => <span className="font-mono font-bold text-txt-primary">{item.poNumber}</span>,
      },
      {
        key: "customerName",
        header: "Khách Hàng",
        sortable: true,
        render: (item) => <span className="font-medium text-txt-primary">{item.customerName}</span>,
      },
      {
        key: "sku",
        header: "Mã SKU",
        sortable: true,
        render: (item) => <span className="font-mono text-txt-secondary">{item.sku}</span>,
      },
      {
        key: "productNameVi",
        header: "Tên Sản Phẩm",
        sortable: true,
        render: (item) => (
          <span className="text-txt-primary truncate max-w-[200px] block" title={item.productNameVi || "—"}>
            {item.productNameVi || "—"}
          </span>
        ),
      },
      {
        key: "orderQty",
        header: "Tổng Đặt",
        sortable: true,
        align: "right",
        render: (item) => <span className="font-mono text-txt-secondary">{item.orderQty.toLocaleString()}</span>,
      },
      {
        key: "alreadyShippedQty",
        header: "Đã Giao",
        sortable: true,
        align: "right",
        render: (item) => (
          <span className="font-mono text-txt-secondary">{item.alreadyShippedQty.toLocaleString()}</span>
        ),
      },
      {
        key: "remainingOrderQty",
        header: "Còn Phải Giao",
        sortable: true,
        align: "right",
        headerClassName: "text-amber-800",
        render: (item) => (
          <span className="font-mono font-semibold text-amber-700">
            {item.remainingOrderQty.toLocaleString()}
          </span>
        ),
      },
      {
        key: "ktpAvailableQty",
        header: "Tồn KTP Khả Dụng",
        sortable: true,
        align: "right",
        headerClassName: "text-emerald-800",
        render: (item) => (
          <span className="font-mono font-bold text-emerald-600">
            {item.ktpAvailableQty.toLocaleString()}
          </span>
        ),
      },
      {
        key: "shippedQtyInput",
        header: "SL Giao Đợt Này",
        align: "center",
        render: (item) => {
          const isSelected = selectedPoLineIds.has(item.poLineId);
          return (
            <div className="flex items-center justify-center gap-1">
              <input
                type="number"
                min="1"
                max={item.maxShippableQty}
                disabled={!isSelected}
                value={qtyMap[item.poLineId] ?? item.maxShippableQty}
                onChange={(e) => {
                  const val = Math.max(1, Math.min(Number(e.target.value) || 0, item.maxShippableQty));
                  setQtyMap({ ...qtyMap, [item.poLineId]: val });
                }}
                className="w-20 px-2 py-1 text-xs font-mono font-bold text-center border rounded bg-canvas border-border focus:outline-none focus:border-accent disabled:opacity-40 disabled:bg-subtle"
              />
              <span className="text-[11px] text-txt-secondary">/ {item.maxShippableQty}</span>
            </div>
          );
        },
      },
    ],
    [filteredShippable, selectedPoLineIds, qtyMap]
  );

  // Columns for Shipment History
  const historyColumns: ColumnDef<ShipmentHeader>[] = useMemo(
    () => [
      {
        key: "shipmentNumber",
        header: "Mã Phiếu Xuất",
        sortable: true,
        render: (item) => (
          <span className="font-mono font-bold text-accent">{item.shipmentNumber || item.id}</span>
        ),
      },
      {
        key: "shippedAt",
        header: "Ngày Xuất",
        sortable: true,
        render: (item) => <span className="font-mono text-txt-secondary">{formatDateDisplay(item.shippedAt)}</span>,
      },
      {
        key: "customerName",
        header: "Khách Hàng",
        sortable: true,
        render: (item) => <span className="font-medium text-txt-primary">{item.customerName || "—"}</span>,
      },
      {
        key: "itemsCount",
        header: "Số Mặt Hàng",
        sortable: true,
        align: "center",
        render: (item) => <span className="font-mono text-txt-secondary">{item.itemsCount || 1} SKU</span>,
      },
      {
        key: "totalQty",
        header: "Tổng SL Xuất",
        sortable: true,
        align: "right",
        render: (item) => (
          <span className="font-mono font-bold text-emerald-600">
            {(item.totalQty || 0).toLocaleString()} pcs
          </span>
        ),
      },
      {
        key: "createdByName",
        header: "Người Lập",
        sortable: true,
        render: (item) => <span className="text-txt-secondary">{item.createdByName || item.createdBy || "—"}</span>,
      },
      {
        key: "note",
        header: "Ghi Chú",
        render: (item) => <span className="text-txt-secondary text-xs">{item.note || "—"}</span>,
      },
      {
        key: "actions",
        header: "Thao Tác",
        align: "center",
        render: (item) => (
          <div className="flex items-center justify-center gap-1.5">
            <button
              onClick={async () => {
                try {
                  const res = await fetch(`/api/shipment?id=${encodeURIComponent(item.id)}`);
                  const detail = await res.json();
                  const notice: DeliveryNoticeData = {
                    shipmentCode: detail.shipmentNumber || item.shipmentNumber || item.id,
                    shipDate: detail.shippedAt || item.shippedAt,
                    customerName: detail.customerName || item.customerName || "",
                    vehicleNo: "",
                    notes: detail.note || item.note || "",
                    createdBy: detail.createdByName || item.createdByName || item.createdBy,
                    items: (detail.items || []).map((it: any, idx: number) => ({
                      stt: idx + 1,
                      poNumber: it.poNumber || "",
                      sku: it.sku || "",
                      productNameVi: it.productNameVi || "",
                      orderQty: it.orderQty || 0,
                      shippedQty: it.shippedQty || 0,
                      remainingQty: Math.max(0, (it.orderQty || 0) - (it.shippedQty || 0)),
                    })),
                  };
                  if (notice.items.length === 0) {
                    notice.items.push({
                      stt: 1,
                      poNumber: "",
                      sku: "",
                      productNameVi: "",
                      orderQty: item.totalQty || 0,
                      shippedQty: item.totalQty || 0,
                      remainingQty: 0,
                    });
                  }
                  exportDeliveryNoticeExcel(notice);
                } catch {
                  alert("Không thể tải chi tiết phiếu để xuất Excel.");
                }
              }}
              className="p-1.5 rounded bg-blue-50 border border-blue-200 text-blue-700 hover:bg-blue-100 transition-colors"
              title="Xuất file Thông Báo Giao Hàng Excel"
            >
              <Download className="w-3.5 h-3.5" />
            </button>
          </div>
        ),
      },
    ],
    []
  );

  return (
    <div className="space-y-6">
      {/* Top Banner & Tab Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-accent/10 text-accent">
            <Truck className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-txt-primary">Quản Lý Xuất Hàng & Giao Nhận</h1>
            <p className="text-xs text-txt-secondary mt-0.5">
              Lựa chọn các PO đủ tồn kho KTP để lập Thông Báo Giao Hàng và quản lý lịch sử xuất kho.
            </p>
          </div>
        </div>

        {/* Tab Controls */}
        <div className="flex items-center gap-1.5 p-1 bg-subtle border border-border rounded-lg">
          <button
            onClick={() => setActiveTab("create")}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded text-xs font-semibold transition-colors ${
              activeTab === "create"
                ? "bg-canvas text-accent shadow-sm border border-border"
                : "text-txt-secondary hover:text-txt-primary"
            }`}
          >
            <Plus className="w-4 h-4" />
            <span>Lập Thông Báo Giao Hàng</span>
            {shippableItems.length > 0 && (
              <span className="px-1.5 py-0.2 bg-emerald-100 text-emerald-800 rounded-full text-[10px] font-bold">
                {shippableItems.length}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab("history")}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded text-xs font-semibold transition-colors ${
              activeTab === "history"
                ? "bg-canvas text-accent shadow-sm border border-border"
                : "text-txt-secondary hover:text-txt-primary"
            }`}
          >
            <History className="w-4 h-4" />
            <span>Lịch Sử Xuất Hàng</span>
            {historyItems.length > 0 && (
              <span className="px-1.5 py-0.2 bg-subtle text-txt-secondary rounded-full text-[10px] font-bold">
                {historyItems.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* TAB 1: LẬP THÔNG BÁO GIAO HÀNG */}
      {activeTab === "create" && (
        <div className="space-y-6">
          {/* Filter Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-canvas border border-border rounded-lg shadow-sm">
            <div className="flex flex-wrap items-center gap-3">
              {/* Search */}
              <div className="relative flex items-center">
                <Search className="w-4 h-4 absolute left-2.5 text-txt-secondary" />
                <input
                  type="text"
                  placeholder="Tìm theo PO, SKU, khách hàng..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-8 pr-3 py-1.5 text-xs bg-subtle border border-border rounded text-txt-primary focus:outline-none focus:border-accent w-56"
                />
              </div>

              {/* Customer Filter */}
              <div className="flex items-center gap-1.5">
                <Building2 className="w-3.5 h-3.5 text-txt-secondary" />
                <select
                  value={customerFilter}
                  onChange={(e) => setCustomerFilter(e.target.value)}
                  className="px-2 py-1.5 text-xs bg-subtle border border-border rounded text-txt-primary focus:outline-none focus:border-accent cursor-pointer"
                >
                  <option value="ALL">Tất cả khách hàng</option>
                  {uniqueCustomers.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              <button
                onClick={() => mutateShippable()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-subtle border border-border text-xs font-medium text-txt-primary hover:bg-border transition-colors"
                title="Làm mới danh sách PO khả dụng"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${isValidatingShippable ? "animate-spin text-accent" : ""}`}
                />
                <span>Làm mới</span>
              </button>
            </div>

            {selectedPoLineIds.size > 0 && (
              <span className="text-xs font-semibold text-accent font-mono bg-accent/10 px-2.5 py-1 rounded border border-accent/20">
                Đã chọn {selectedPoLineIds.size} mặt hàng PO
              </span>
            )}
          </div>

          {/* Error Alert */}
          {errorMsg && (
            <div className="p-3 rounded bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{errorMsg}</span>
              </div>
              <button onClick={() => setErrorMsg("")} className="text-rose-700 hover:text-rose-900">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Shippable Items Table */}
          <DataTable<ShippableItem>
            data={filteredShippable}
            columns={shippableColumns}
            getItemKey={(item) => item.poLineId}
            isLoading={!shippableData}
            loadingMessage="Đang kiểm tra tồn kho KTP cho các đơn hàng PO..."
            emptyMessage="Hiện tại không có đơn hàng PO nào đủ tồn kho KTP để xuất hàng."
          />

          {/* Action Form Footer */}
          {filteredShippable.length > 0 && (
            <div className="p-5 rounded-lg bg-canvas border border-border shadow-sm space-y-4">
              <div className="flex items-center gap-2 pb-2 border-b border-border">
                <Truck className="w-4 h-4 text-accent" />
                <h3 className="text-sm font-bold text-txt-primary">Thông Tin Phiếu Xuất Hàng</h3>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-txt-secondary mb-1">
                    Phương Tiện / Biển Số Xe (Không bắt buộc)
                  </label>
                  <input
                    type="text"
                    placeholder="VD: 29C-12345 / Xe tải 2.5T..."
                    value={vehicleNo}
                    onChange={(e) => setVehicleNo(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs bg-subtle border border-border rounded text-txt-primary focus:outline-none focus:border-accent"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-txt-secondary mb-1">
                    Ghi Chú Giao Hàng
                  </label>
                  <input
                    type="text"
                    placeholder="VD: Giao hàng đợt 1 / Lưu ý bốc dỡ..."
                    value={shipmentNotes}
                    onChange={(e) => setShipmentNotes(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs bg-subtle border border-border rounded text-txt-primary focus:outline-none focus:border-accent"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between pt-2">
                <p className="text-xs text-txt-secondary">
                  💡 Sau khi xác nhận, hệ thống sẽ trừ tồn kho KTP, cập nhật tiến độ PO và tự động tải file
                  Excel <strong>Thông Báo Giao Hàng</strong>.
                </p>

                <button
                  type="button"
                  onClick={handleCreateDeliveryNotice}
                  disabled={selectedPoLineIds.size === 0 || isSubmitting}
                  className="inline-flex items-center gap-2 px-5 py-2 rounded-lg bg-accent text-white font-semibold text-xs hover:opacity-90 transition-opacity shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <FileSpreadsheet className="w-4 h-4" />
                  <span>
                    {isSubmitting
                      ? "Đang lập phiếu xuất..."
                      : `Lập & Tải Thông Báo Giao Hàng (${selectedPoLineIds.size} PO)`}
                  </span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: LỊCH SỬ XUẤT HÀNG */}
      {activeTab === "history" && (
        <div className="space-y-6">
          {/* History Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-canvas border border-border rounded-lg shadow-sm">
            <div className="flex items-center gap-3">
              <button
                onClick={() => mutateHistory()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-subtle border border-border text-xs font-medium text-txt-primary hover:bg-border transition-colors"
                title="Làm mới lịch sử"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${isValidatingHistory ? "animate-spin text-accent" : ""}`}
                />
                <span>Làm mới</span>
              </button>
            </div>

            <button
              onClick={() => exportShipmentHistoryExcel(historyItems)}
              disabled={historyItems.length === 0}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded bg-subtle border border-border hover:bg-border text-txt-primary text-xs font-medium transition-colors disabled:opacity-40"
              title="Xuất toàn bộ lịch sử xuất hàng ra file Excel"
            >
              <Download className="w-4 h-4 text-blue-600" />
              <span>Xuất Danh Mục Excel</span>
            </button>
          </div>

          {/* History DataTable */}
          <DataTable<ShipmentHeader>
            data={historyItems}
            columns={historyColumns}
            getItemKey={(item) => item.id}
            isLoading={!historyData}
            loadingMessage="Đang tải lịch sử xuất hàng..."
            emptyMessage="Chưa có dữ liệu lịch sử xuất hàng nào."
          />
        </div>
      )}

      {/* Success Modal for Delivery Notice */}
      {successNotice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-canvas border border-border rounded-lg shadow-2xl max-w-2xl w-full p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <div className="flex items-center gap-2.5">
                <div className="flex items-center justify-center w-9 h-9 rounded-full bg-emerald-100 text-emerald-600 shrink-0">
                  <CheckCircle2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-txt-primary">Lập Thông Báo Giao Hàng Thành Công!</h3>
                  <p className="text-xs text-txt-secondary">
                    Mã phiếu: <strong className="font-mono text-accent">{successNotice.shipmentCode}</strong>
                  </p>
                </div>
              </div>
              <button
                onClick={() => setSuccessNotice(null)}
                className="text-txt-secondary hover:text-txt-primary p-1 rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3 bg-subtle rounded border border-border text-xs space-y-2">
              <div className="grid grid-cols-2 gap-2 text-txt-secondary">
                <div>
                  Khách hàng: <strong className="text-txt-primary">{successNotice.customerName}</strong>
                </div>
                <div>
                  Ngày giao: <strong className="text-txt-primary">{formatDateDisplay(successNotice.shipDate)}</strong>
                </div>
                <div>
                  Biển số xe: <strong className="text-txt-primary">{successNotice.vehicleNo || "—"}</strong>
                </div>
                <div>
                  Ghi chú: <strong className="text-txt-primary">{successNotice.notes || "—"}</strong>
                </div>
              </div>

              <div className="pt-2 border-t border-border/60">
                <span className="font-semibold text-txt-primary block mb-1">Chi tiết các mặt hàng:</span>
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {successNotice.items.map((it, idx) => (
                    <div key={idx} className="flex justify-between items-center bg-canvas p-1.5 rounded border border-border">
                      <span className="font-mono font-bold text-txt-primary">
                        {it.poNumber} — {it.sku} ({it.productNameVi || ""})
                      </span>
                      <span className="font-mono text-emerald-600 font-bold">
                        +{it.shippedQty.toLocaleString()} pcs
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
              <button
                type="button"
                onClick={() => exportDeliveryNoticeExcel(successNotice)}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 transition-colors"
              >
                <Download className="w-4 h-4" />
                <span>Tải Lại File Excel</span>
              </button>

              <button
                type="button"
                onClick={() => setSuccessNotice(null)}
                className="px-4 py-2 rounded bg-subtle border border-border text-txt-primary text-xs font-medium hover:bg-border"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ShipmentPage() {
  return (
    <Suspense fallback={<div className="p-6 text-xs text-txt-secondary">Đang tải trang Xuất hàng...</div>}>
      <ShipmentContent />
    </Suspense>
  );
}
