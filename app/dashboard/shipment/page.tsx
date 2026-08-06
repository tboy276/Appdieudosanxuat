"use client";

import { useState, useMemo, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import {
  Truck,
  History,
  CheckCircle2,
  AlertTriangle,
  Search,
  RefreshCw,
  X,
  Printer,
  Download,
  FileSpreadsheet,
  Building2,
  Plus,
  Eye,
  Calendar,
  MapPin,
  Phone,
  Clock,
  User,
  BadgeAlert,
} from "lucide-react";
import DataTable, { ColumnDef } from "@/components/DataTable";
import { ShippableItem, ShipmentHeader, ShipmentDetail } from "@/lib/shipment";
import {
  exportDeliveryNoticeExcel,
  exportShipmentHistoryExcel,
  DeliveryNoticeData,
} from "@/lib/delivery-notice";
import { getTodayVN, formatDateDisplay } from "@/lib/date-utils";
import DeliveryNoticeDocument from "@/components/DeliveryNoticeDocument";

const fetcher = (url: string) => fetch(url).then((res) => res.json());

function ShipmentContent() {
  const searchParams = useSearchParams();

  const [activeTab, setActiveTab] = useState<"create" | "history">("create");
  const [searchTerm, setSearchTerm] = useState("");
  const [customerFilter, setCustomerFilter] = useState("ALL");

  // Selection state
  const [selectedPoLineIds, setSelectedPoLineIds] = useState<Set<string>>(new Set());
  const [qtyMap, setQtyMap] = useState<Record<string, number>>({});
  const [itemNotesMap, setItemNotesMap] = useState<Record<string, string>>({});

  // Modal State for Creating Shipment Form
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [formShipDate, setFormShipDate] = useState(getTodayVN());
  const [formCustomerAddress, setFormCustomerAddress] = useState("");
  const [formCustomerPhone, setFormCustomerPhone] = useState("");
  const [formDeliveryTime, setFormDeliveryTime] = useState("Trong ngày");
  const [formCreatorName, setFormCreatorName] = useState("Đỗ Như Ba");
  const [formCreatorTitle, setFormCreatorTitle] = useState("P.PSX");
  const [formGeneralNote, setFormGeneralNote] = useState("");

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  // Print/Preview Modal State
  const [previewNotice, setPreviewNotice] = useState<DeliveryNoticeData | null>(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);

  // SWR Queries
  const {
    data: shippableData,
    isValidating: isValidatingShippable,
    mutate: mutateShippable,
  } = useSWR<ShippableItem[]>("/api/shipment/shippable", fetcher, {
    revalidateOnFocus: true,
  });

  const {
    data: historyData,
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

  // Selected customer information for single-customer validation
  const currentSelectedCustomer = useMemo(() => {
    if (selectedPoLineIds.size === 0) return null;
    for (const item of shippableItems) {
      if (selectedPoLineIds.has(item.poLineId)) {
        return {
          customerId: item.customerId,
          customerName: item.customerName,
          customerAddress: item.customerAddress || "",
          customerPhone: item.customerPhone || "",
        };
      }
    }
    return null;
  }, [selectedPoLineIds, shippableItems]);

  // Auto-select POs if passed via URL param (?poLineIds=po-1,po-2)
  useEffect(() => {
    const poLineIdsParam = searchParams.get("poLineIds");
    if (poLineIdsParam && shippableItems.length > 0) {
      const ids = poLineIdsParam.split(",").map((s) => s.trim()).filter(Boolean);
      const newSelected = new Set<string>();
      const newQtys: Record<string, number> = {};

      let firstCustId: string | null = null;
      let conflictDetected = false;

      for (const id of ids) {
        const found = shippableItems.find((item) => item.poLineId === id || item.poId === id);
        if (found) {
          if (!firstCustId) {
            firstCustId = found.customerId || found.customerName;
            newSelected.add(found.poLineId);
            newQtys[found.poLineId] = found.maxShippableQty;
          } else if (firstCustId === (found.customerId || found.customerName)) {
            newSelected.add(found.poLineId);
            newQtys[found.poLineId] = found.maxShippableQty;
          } else {
            conflictDetected = true;
          }
        }
      }

      if (conflictDetected) {
        setErrorMsg("Chỉ có thể gộp các PO cùng 1 khách hàng vào 1 phiếu. Một số PO khác khách hàng đã được bỏ chọn.");
      }

      setSelectedPoLineIds(newSelected);
      setQtyMap((prev) => ({ ...prev, ...newQtys }));
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

  // Handle PO line toggle with strict single-customer validation
  const handleTogglePoLine = (item: ShippableItem) => {
    const nextSelected = new Set(selectedPoLineIds);
    const nextQtyMap = { ...qtyMap };

    if (nextSelected.has(item.poLineId)) {
      nextSelected.delete(item.poLineId);
      delete nextQtyMap[item.poLineId];
      setSelectedPoLineIds(nextSelected);
      setQtyMap(nextQtyMap);
      setErrorMsg("");
      return;
    }

    // Check customer consistency
    if (currentSelectedCustomer && currentSelectedCustomer.customerId !== item.customerId && currentSelectedCustomer.customerName !== item.customerName) {
      setErrorMsg(
        `Chỉ có thể gộp các PO cùng 1 khách hàng vào 1 phiếu. Bạn đang chọn PO của "${currentSelectedCustomer.customerName}", không thể chọn thêm PO của "${item.customerName}".`
      );
      return;
    }

    setErrorMsg("");
    nextSelected.add(item.poLineId);
    nextQtyMap[item.poLineId] = item.maxShippableQty;
    setSelectedPoLineIds(nextSelected);
    setQtyMap(nextQtyMap);
  };

  const handleSelectAllFiltered = () => {
    if (filteredShippable.length === 0) return;

    if (selectedPoLineIds.size > 0) {
      setSelectedPoLineIds(new Set());
      setQtyMap({});
      setErrorMsg("");
      return;
    }

    // Check if filtered items belong to multiple customers
    const custIds = new Set(filteredShippable.map((i) => i.customerId || i.customerName));
    if (custIds.size > 1) {
      const firstCust = filteredShippable[0].customerName;
      const matchingItems = filteredShippable.filter(
        (i) => (i.customerId || i.customerName) === (filteredShippable[0].customerId || firstCust)
      );
      const nextSelected = new Set<string>();
      const nextQtyMap: Record<string, number> = {};
      matchingItems.forEach((it) => {
        nextSelected.add(it.poLineId);
        nextQtyMap[it.poLineId] = it.maxShippableQty;
      });
      setSelectedPoLineIds(nextSelected);
      setQtyMap(nextQtyMap);
      setErrorMsg(`Chỉ tự động chọn ${matchingItems.length} PO của khách hàng "${firstCust}". Vui lòng lọc theo từng khách hàng để chọn toàn bộ.`);
      return;
    }

    const nextSelected = new Set<string>();
    const nextQtyMap: Record<string, number> = {};
    for (const item of filteredShippable) {
      nextSelected.add(item.poLineId);
      nextQtyMap[item.poLineId] = item.maxShippableQty;
    }
    setSelectedPoLineIds(nextSelected);
    setQtyMap(nextQtyMap);
    setErrorMsg("");
  };

  // Open Creation Modal & Pre-fill Customer Details
  const handleOpenCreateModal = () => {
    if (selectedPoLineIds.size === 0) {
      setErrorMsg("Vui lòng chọn ít nhất một PO Line để lập thông báo giao hàng.");
      return;
    }

    const selectedItems = shippableItems.filter((i) => selectedPoLineIds.has(i.poLineId));
    if (selectedItems.length === 0) return;

    const firstItem = selectedItems[0];
    setFormShipDate(getTodayVN());
    setFormCustomerAddress(firstItem.customerAddress || "");
    setFormCustomerPhone(firstItem.customerPhone || "");
    setFormDeliveryTime("Trong ngày");
    setFormCreatorName("Đỗ Như Ba");
    setFormCreatorTitle("P.PSX");
    setFormGeneralNote("");
    setIsCreateModalOpen(true);
    setErrorMsg("");
  };

  // Submit Shipment & Generate Official Delivery Notice
  const handleSubmitShipment = async () => {
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
          `Số lượng giao cho PO ${item.poNumber} (${qty} pcs) vượt quá tồn KTP (${item.maxShippableQty} pcs).`
        );
        return;
      }
    }

    setIsSubmitting(true);
    setErrorMsg("");

    try {
      const postPayload = {
        customerId: selectedItems[0].customerId || "",
        shipDate: formShipDate,
        customerAddress: formCustomerAddress.trim(),
        customerPhone: formCustomerPhone.trim(),
        deliveryTime: formDeliveryTime.trim(),
        creatorName: formCreatorName.trim(),
        creatorTitle: formCreatorTitle.trim(),
        note: formGeneralNote.trim(),
        items: selectedItems.map((item) => ({
          poLineId: item.poLineId,
          productId: item.productId,
          shippedQty: qtyMap[item.poLineId],
          notes: itemNotesMap[item.poLineId]?.trim() || "",
        })),
      };

      const res = await fetch("/api/shipment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(postPayload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Không thể tạo phiếu xuất hàng.");
      }

      // Build BM/05-000-005 Notice Data
      const deliveryNotice: DeliveryNoticeData = {
        shipmentCode: data.shipmentNumber || data.shipmentId,
        shipDate: formShipDate,
        customerName: selectedItems[0].customerName,
        customerAddress: formCustomerAddress.trim(),
        customerPhone: formCustomerPhone.trim(),
        deliveryTime: formDeliveryTime.trim(),
        poNumbers: Array.from(new Set(selectedItems.map((i) => i.poNumber).filter(Boolean))),
        creatorName: formCreatorName.trim() || "Đỗ Như Ba",
        creatorTitle: formCreatorTitle.trim() || "P.PSX",
        notes: formGeneralNote.trim(),
        items: selectedItems.map((item, idx) => ({
          stt: idx + 1,
          poNumber: item.poNumber,
          sku: item.sku,
          productNameVi: item.productNameVi,
          unit: "Cái",
          orderQty: item.orderQty,
          shippedQty: qtyMap[item.poLineId],
          remainingQty: Math.max(0, item.remainingOrderQty - qtyMap[item.poLineId]),
          location: "Kho TP",
          notes: itemNotesMap[item.poLineId]?.trim() || "",
        })),
      };

      // Close create modal and open print preview modal
      setIsCreateModalOpen(false);
      setPreviewNotice(deliveryNotice);

      // Auto download Excel file
      exportDeliveryNoticeExcel(deliveryNotice);

      // Clear selections & refresh data
      setSelectedPoLineIds(new Set());
      setQtyMap({});
      setItemNotesMap({});
      mutateShippable();
      mutateHistory();
    } catch (err: any) {
      setErrorMsg(err.message || "Tạo Thông Báo Giao Hàng thất bại.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // View / Print from History Row
  const handleViewPastShipment = async (header: ShipmentHeader) => {
    setIsLoadingDetail(true);
    try {
      const res = await fetch(`/api/shipment?id=${header.id}`);
      if (!res.ok) {
        throw new Error("Không thể tải chi tiết phiếu xuất.");
      }
      const detail: ShipmentDetail = await res.json();

      const notice: DeliveryNoticeData = {
        shipmentCode: detail.shipmentNumber,
        shipDate: detail.shippedAt,
        customerName: detail.customerName,
        customerAddress: detail.customerAddress || "",
        customerPhone: detail.customerPhone || "",
        deliveryTime: detail.deliveryTime || "Trong ngày",
        poNumbers: detail.poNumbers || [],
        creatorName: detail.creatorName || detail.createdByName || "Đỗ Như Ba",
        creatorTitle: detail.creatorTitle || "P.PSX",
        notes: detail.note || "",
        items: (detail.items || []).map((it, idx) => ({
          stt: idx + 1,
          poNumber: it.poNumber,
          sku: it.sku,
          productNameVi: it.productNameVi,
          unit: it.unit || "Cái",
          orderQty: it.orderQty,
          shippedQty: it.shippedQty,
          location: "Kho TP",
          notes: it.notes || "",
        })),
      };

      setPreviewNotice(notice);
    } catch (err: any) {
      alert(err.message || "Không thể mở phiếu xuất.");
    } finally {
      setIsLoadingDetail(false);
    }
  };

  // Export full history flat table
  const handleExportFullHistory = async () => {
    if (historyItems.length === 0) return;
    try {
      // Fetch full details for all history records to include items
      const details = await Promise.all(
        historyItems.map(async (h) => {
          try {
            const res = await fetch(`/api/shipment?id=${h.id}`);
            if (res.ok) return await res.json();
          } catch {
            // ignore
          }
          return h;
        })
      );
      exportShipmentHistoryExcel(details);
    } catch {
      exportShipmentHistoryExcel(historyItems);
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
            onChange={handleSelectAllFiltered}
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
        render: (item) => (
          <div className="flex flex-col">
            <span className="font-medium text-txt-primary">{item.customerName}</span>
            {item.customerAddress && (
              <span className="text-[11px] text-txt-secondary truncate max-w-[180px]">
                {item.customerAddress}
              </span>
            )}
          </div>
        ),
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
        header: "Còn Lại",
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
        header: "SL Xuất Lần Này",
        align: "right",
        className: "w-36",
        render: (item) => {
          const isSelected = selectedPoLineIds.has(item.poLineId);
          return (
            <div className="flex items-center justify-end gap-1.5">
              <input
                type="number"
                min={1}
                max={item.maxShippableQty}
                value={qtyMap[item.poLineId] || item.maxShippableQty}
                disabled={!isSelected}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10) || 0;
                  setQtyMap((prev) => ({
                    ...prev,
                    [item.poLineId]: Math.min(Math.max(0, val), item.maxShippableQty),
                  }));
                }}
                className={`w-24 text-right px-2 py-1 text-xs rounded border font-mono font-bold ${
                  isSelected
                    ? "bg-canvas border-accent text-txt-primary focus:outline-none focus:ring-1 focus:ring-accent"
                    : "bg-subtle/50 border-border text-txt-secondary opacity-50 cursor-not-allowed"
                }`}
              />
              <span className="text-[11px] text-txt-secondary font-mono">pcs</span>
            </div>
          );
        },
      },
    ],
    [filteredShippable, selectedPoLineIds, qtyMap, currentSelectedCustomer]
  );

  // Columns for History Table
  const historyColumns: ColumnDef<ShipmentHeader>[] = useMemo(
    () => [
      {
        key: "shipmentNumber",
        header: "Mã Phiếu",
        sortable: true,
        render: (item) => <span className="font-mono font-bold text-accent">{item.shipmentNumber}</span>,
      },
      {
        key: "shippedAt",
        header: "Ngày Xuất",
        sortable: true,
        render: (item) => (
          <div className="flex items-center gap-1.5 text-txt-secondary">
            <Calendar className="w-3.5 h-3.5" />
            <span>{formatDateDisplay(item.shippedAt)}</span>
          </div>
        ),
      },
      {
        key: "customerName",
        header: "Khách Hàng",
        sortable: true,
        render: (item) => <span className="font-semibold text-txt-primary">{item.customerName}</span>,
      },
      {
        key: "creatorName",
        header: "Người Lập Phiếu",
        render: (item) => (
          <div className="flex flex-col">
            <span className="font-medium text-txt-primary">{item.creatorName || item.createdByName || "—"}</span>
            {item.creatorTitle && <span className="text-[11px] text-txt-secondary">{item.creatorTitle}</span>}
          </div>
        ),
      },
      {
        key: "totalQty",
        header: "Tổng SL Xuất",
        sortable: true,
        align: "right",
        render: (item) => (
          <span className="font-mono font-bold text-emerald-600">
            {item.totalQty.toLocaleString()} pcs
          </span>
        ),
      },
      {
        key: "itemsCount",
        header: "Số Dòng PO",
        sortable: true,
        align: "center",
        render: (item) => (
          <span className="px-2 py-0.5 rounded-full bg-subtle text-txt-secondary text-xs font-mono font-semibold">
            {item.itemsCount}
          </span>
        ),
      },
      {
        key: "note",
        header: "Ghi Chú",
        render: (item) => (
          <span className="text-txt-secondary text-xs truncate max-w-[180px] block" title={item.note || ""}>
            {item.note || "—"}
          </span>
        ),
      },
      {
        key: "actions",
        header: "Thao Tác",
        align: "center",
        render: (item) => (
          <button
            type="button"
            onClick={() => handleViewPastShipment(item)}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-subtle border border-border text-txt-primary text-xs font-medium hover:bg-border transition-colors"
            title="Xem và in lại phiếu Thông Báo Giao Hàng"
          >
            <Printer className="w-3.5 h-3.5 text-accent" />
            <span>In Phiếu</span>
          </button>
        ),
      },
    ],
    []
  );

  return (
    <div className="p-6 space-y-6 max-w-[1600px] mx-auto min-h-screen">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-border">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-accent/10 text-accent">
              <Truck className="w-5 h-5" />
            </div>
            <h1 className="text-lg font-bold text-txt-primary tracking-tight">
              Quản Lý Xuất Hàng & Thông Báo Giao Hàng (DISOCO)
            </h1>
          </div>
          <p className="text-xs text-txt-secondary">
            Lập phiếu <strong>Thông Báo Giao Hàng (BM/05-000-005)</strong>, trừ tồn kho thành phẩm KTP và đối soát lịch sử giao nhận.
          </p>
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
          {/* Filter & Selection Bar */}
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

            {/* Selected Status / Action */}
            <div className="flex items-center gap-3">
              {currentSelectedCustomer && (
                <div className="flex items-center gap-2 px-3 py-1 bg-accent/10 border border-accent/20 rounded text-xs">
                  <span className="text-txt-secondary">Khách hàng:</span>
                  <strong className="text-accent font-semibold">{currentSelectedCustomer.customerName}</strong>
                  <span className="text-txt-secondary font-mono">({selectedPoLineIds.size} PO Line)</span>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedPoLineIds(new Set());
                      setQtyMap({});
                    }}
                    className="ml-1 text-txt-secondary hover:text-rose-600"
                    title="Bỏ chọn tất cả"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              <button
                type="button"
                onClick={handleOpenCreateModal}
                disabled={selectedPoLineIds.size === 0}
                className="inline-flex items-center gap-2 px-4 py-1.5 rounded bg-accent text-white font-semibold text-xs hover:opacity-90 transition-opacity shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <FileSpreadsheet className="w-4 h-4" />
                <span>Lập Thông Báo Giao Hàng ({selectedPoLineIds.size})</span>
              </button>
            </div>
          </div>

          {/* Error / Warning Alert */}
          {errorMsg && (
            <div className="p-3 rounded bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-center justify-between shadow-sm">
              <div className="flex items-center gap-2.5">
                <BadgeAlert className="w-4 h-4 text-amber-600 shrink-0" />
                <span className="font-medium">{errorMsg}</span>
              </div>
              <button onClick={() => setErrorMsg("")} className="text-amber-700 hover:text-amber-900">
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
              onClick={handleExportFullHistory}
              disabled={historyItems.length === 0}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded bg-subtle border border-border hover:bg-border text-txt-primary text-xs font-medium transition-colors disabled:opacity-40"
              title="Xuất toàn bộ danh mục PO đã xuất ra file Excel thô"
            >
              <Download className="w-4 h-4 text-emerald-600" />
              <span>Xuất Excel Danh Mục PO Đã Xuất</span>
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

      {/* MODAL 1: TẠO THÔNG BÁO GIAO HÀNG (BM/05-000-005) */}
      {isCreateModalOpen && currentSelectedCustomer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="bg-canvas border border-border rounded-xl shadow-2xl max-w-4xl w-full p-6 space-y-5 my-8">
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-accent/10 text-accent">
                  <FileSpreadsheet className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-txt-primary">
                    Lập Thông Báo Giao Hàng (Mẫu BM/05-000-005 DISOCO)
                  </h3>
                  <p className="text-xs text-txt-secondary">
                    Điền đầy đủ thông tin giao nhận để xuất phiếu in và trừ tồn kho KTP.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsCreateModalOpen(false)}
                className="text-txt-secondary hover:text-txt-primary p-1.5 rounded-lg hover:bg-subtle"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Error inside modal */}
            {errorMsg && (
              <div className="p-3 rounded bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600" />
                <span>{errorMsg}</span>
              </div>
            )}

            {/* Metadata Fields Form */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 p-4 bg-subtle/50 rounded-lg border border-border text-xs">
              {/* Customer Name */}
              <div className="space-y-1">
                <label className="font-semibold text-txt-secondary flex items-center gap-1.5">
                  <Building2 className="w-3.5 h-3.5" />
                  Khách Hàng (Đơn vị nhận)
                </label>
                <input
                  type="text"
                  readOnly
                  value={currentSelectedCustomer.customerName}
                  className="w-full px-3 py-1.5 bg-canvas border border-border rounded font-semibold text-txt-primary focus:outline-none"
                />
              </div>

              {/* Ship Date */}
              <div className="space-y-1">
                <label className="font-semibold text-txt-secondary flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-accent" />
                  Ngày Giao Hàng
                </label>
                <input
                  type="date"
                  value={formShipDate}
                  onChange={(e) => setFormShipDate(e.target.value)}
                  className="w-full px-3 py-1.5 bg-canvas border border-border rounded text-txt-primary focus:outline-none focus:border-accent"
                />
              </div>

              {/* Delivery Time */}
              <div className="space-y-1">
                <label className="font-semibold text-txt-secondary flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-accent" />
                  Thời Gian Giao Hàng
                </label>
                <input
                  type="text"
                  placeholder="VD: Trong ngày, 08h00 ngày mai..."
                  value={formDeliveryTime}
                  onChange={(e) => setFormDeliveryTime(e.target.value)}
                  className="w-full px-3 py-1.5 bg-canvas border border-border rounded text-txt-primary focus:outline-none focus:border-accent"
                />
              </div>

              {/* Customer Address */}
              <div className="space-y-1">
                <label className="font-semibold text-txt-secondary flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5 text-accent" />
                  Địa Chỉ Khách Hàng
                </label>
                <input
                  type="text"
                  placeholder="Nhập địa chỉ giao hàng..."
                  value={formCustomerAddress}
                  onChange={(e) => setFormCustomerAddress(e.target.value)}
                  className="w-full px-3 py-1.5 bg-canvas border border-border rounded text-txt-primary focus:outline-none focus:border-accent"
                />
              </div>

              {/* Customer Phone */}
              <div className="space-y-1">
                <label className="font-semibold text-txt-secondary flex items-center gap-1.5">
                  <Phone className="w-3.5 h-3.5 text-accent" />
                  Điện Thoại Khách Hàng
                </label>
                <input
                  type="text"
                  placeholder="VD: 0243.888.9999..."
                  value={formCustomerPhone}
                  onChange={(e) => setFormCustomerPhone(e.target.value)}
                  className="w-full px-3 py-1.5 bg-canvas border border-border rounded text-txt-primary focus:outline-none focus:border-accent"
                />
              </div>

              {/* General Note */}
              <div className="space-y-1">
                <label className="font-semibold text-txt-secondary flex items-center gap-1.5">
                  Ghi Chú Chung
                </label>
                <input
                  type="text"
                  placeholder="Ghi chú thêm nếu có..."
                  value={formGeneralNote}
                  onChange={(e) => setFormGeneralNote(e.target.value)}
                  className="w-full px-3 py-1.5 bg-canvas border border-border rounded text-txt-primary focus:outline-none focus:border-accent"
                />
              </div>

              {/* Creator Name */}
              <div className="space-y-1">
                <label className="font-semibold text-txt-secondary flex items-center gap-1.5">
                  <User className="w-3.5 h-3.5 text-accent" />
                  Người Lập Phiếu (Họ tên)
                </label>
                <input
                  type="text"
                  placeholder="VD: Đỗ Như Ba"
                  value={formCreatorName}
                  onChange={(e) => setFormCreatorName(e.target.value)}
                  className="w-full px-3 py-1.5 bg-canvas border border-border rounded text-txt-primary focus:outline-none focus:border-accent"
                />
              </div>

              {/* Creator Title */}
              <div className="space-y-1">
                <label className="font-semibold text-txt-secondary flex items-center gap-1.5">
                  Chức Danh Người Lập
                </label>
                <input
                  type="text"
                  placeholder="VD: P.PSX"
                  value={formCreatorTitle}
                  onChange={(e) => setFormCreatorTitle(e.target.value)}
                  className="w-full px-3 py-1.5 bg-canvas border border-border rounded text-txt-primary focus:outline-none focus:border-accent"
                />
              </div>
            </div>

            {/* Selected PO Lines Detail Table */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs font-semibold text-txt-primary">
                <span>1. Danh mục mặt hàng giao ({selectedPoLineIds.size} dòng PO):</span>
                <span className="text-txt-secondary">
                  Tổng SL xuất:{" "}
                  <strong className="font-mono text-accent">
                    {shippableItems
                      .filter((i) => selectedPoLineIds.has(i.poLineId))
                      .reduce((sum, i) => sum + (qtyMap[i.poLineId] || 0), 0)
                      .toLocaleString()}{" "}
                    pcs
                  </strong>
                </span>
              </div>

              <div className="border border-border rounded-lg overflow-hidden max-h-60 overflow-y-auto">
                <table className="w-full text-xs text-left border-collapse">
                  <thead className="bg-subtle text-txt-secondary font-semibold border-b border-border sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-center w-10">STT</th>
                      <th className="px-3 py-2 w-28">Số PO</th>
                      <th className="px-3 py-2">Tên Mặt Hàng / SKU</th>
                      <th className="px-3 py-2 text-center w-16">ĐVT</th>
                      <th className="px-3 py-2 text-right w-24">Tồn KTP</th>
                      <th className="px-3 py-2 text-right w-28">SL Giao</th>
                      <th className="px-3 py-2 w-44">Ghi Chú Dòng</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border bg-canvas">
                    {shippableItems
                      .filter((i) => selectedPoLineIds.has(i.poLineId))
                      .map((item, idx) => (
                        <tr key={item.poLineId} className="hover:bg-subtle/40">
                          <td className="px-3 py-2 text-center font-bold text-txt-secondary">{idx + 1}</td>
                          <td className="px-3 py-2 font-mono font-bold text-txt-primary">{item.poNumber}</td>
                          <td className="px-3 py-2">
                            <span className="font-medium text-txt-primary block">
                              {item.productNameVi || item.sku}
                            </span>
                            <span className="text-[11px] font-mono text-txt-secondary block">
                              {item.sku}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-center text-txt-secondary">Cái</td>
                          <td className="px-3 py-2 text-right font-mono text-emerald-600 font-bold">
                            {item.ktpAvailableQty.toLocaleString()}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <input
                              type="number"
                              min={1}
                              max={item.maxShippableQty}
                              value={qtyMap[item.poLineId] || item.maxShippableQty}
                              onChange={(e) => {
                                const val = parseInt(e.target.value, 10) || 0;
                                setQtyMap((prev) => ({
                                  ...prev,
                                  [item.poLineId]: Math.min(Math.max(0, val), item.maxShippableQty),
                                }));
                              }}
                              className="w-24 text-right px-2 py-1 bg-subtle border border-border rounded font-mono font-bold text-txt-primary focus:outline-none focus:border-accent"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="text"
                              placeholder="Ghi chú dòng..."
                              value={itemNotesMap[item.poLineId] || ""}
                              onChange={(e) => {
                                const val = e.target.value;
                                setItemNotesMap((prev) => ({
                                  ...prev,
                                  [item.poLineId]: val,
                                }));
                              }}
                              className="w-full px-2 py-1 bg-subtle border border-border rounded text-txt-primary focus:outline-none focus:border-accent text-xs"
                            />
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-between pt-3 border-t border-border">
              <p className="text-[11px] text-txt-secondary">
                * Phiếu in sẽ hiển thị đúng theo mẫu chuẩn BM/05-000-005 và tự động tải file Excel.
              </p>
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="px-4 py-2 rounded-lg bg-subtle border border-border text-txt-primary text-xs font-medium hover:bg-border"
                >
                  Hủy
                </button>
                <button
                  type="button"
                  onClick={handleSubmitShipment}
                  disabled={isSubmitting}
                  className="inline-flex items-center gap-2 px-5 py-2 rounded-lg bg-accent text-white font-semibold text-xs hover:opacity-90 transition-opacity shadow-sm disabled:opacity-40"
                >
                  <Printer className="w-4 h-4" />
                  <span>{isSubmitting ? "Đang xử lý xuất hàng..." : "Xác Nhận & Xuất Phiếu"}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: PRINT & EXCEL PREVIEW (DISOCO BM/05-000-005) */}
      {previewNotice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md p-4 overflow-y-auto print:p-0 print:m-0 print:bg-white">
          <div className="bg-canvas border border-border rounded-xl shadow-2xl max-w-4xl w-full p-6 space-y-4 my-8 print:border-none print:shadow-none print:p-0 print:m-0 print:w-full print:max-w-none">
            {/* Modal Toolbar (hidden when printing) */}
            <div className="flex items-center justify-between pb-3 border-b border-border print:hidden">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded bg-emerald-100 text-emerald-700">
                  <CheckCircle2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-txt-primary">
                    Thông Báo Giao Hàng (Mẫu BM/05-000-005)
                  </h3>
                  <p className="text-xs text-txt-secondary">
                    Mã hệ thống: <strong className="font-mono text-accent">{previewNotice.shipmentCode}</strong>
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => exportDeliveryNoticeExcel(previewNotice)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-subtle border border-border hover:bg-border text-txt-primary text-xs font-semibold transition-colors"
                >
                  <Download className="w-4 h-4 text-emerald-600" />
                  <span>Tải File Excel</span>
                </button>

                <button
                  type="button"
                  onClick={() => window.print()}
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-accent text-white text-xs font-semibold hover:opacity-90 transition-opacity shadow-sm"
                >
                  <Printer className="w-4 h-4" />
                  <span>In Phiếu (A4 / PDF)</span>
                </button>

                <button
                  type="button"
                  onClick={() => setPreviewNotice(null)}
                  className="text-txt-secondary hover:text-txt-primary p-1.5 rounded-lg hover:bg-subtle"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Official Document Paper Preview */}
            <div className="bg-gray-100 p-4 sm:p-6 rounded-lg overflow-x-auto border border-border print:p-0 print:m-0 print:border-none print:bg-white">
              <DeliveryNoticeDocument data={previewNotice} />
            </div>

            {/* Modal Bottom Close (hidden when printing) */}
            <div className="flex items-center justify-end pt-3 border-t border-border print:hidden">
              <button
                type="button"
                onClick={() => setPreviewNotice(null)}
                className="px-5 py-2 rounded-lg bg-subtle border border-border text-txt-primary text-xs font-medium hover:bg-border"
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
