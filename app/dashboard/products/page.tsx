"use client";

import React, { useState, useMemo } from "react";
import useSWR from "swr";
import {
  Package,
  Plus,
  Search,
  AlertTriangle,
  CheckCircle2,
  ArrowUp,
  ArrowDown,
  Trash2,
  X,
  Edit2,
  Tag,
  Clock,
  UploadCloud,
  Download,
  Layers,
  ArrowUpDown,
} from "lucide-react";
import AccordionList from "@/components/AccordionList";
import DataTable, { ColumnDef } from "@/components/DataTable";
import { Product } from "@/lib/types";
import { useSession } from "@/hooks/useSession";
import { LABELS } from "@/lib/labels";
import { getTodayVN } from "@/lib/date-utils";

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
  { code: "LR", name: "Xưởng Lắp Ráp" },
  { code: "KTP", name: "Kho Thành phẩm" },
];

export default function ProductsPage() {
  const { canWrite } = useSession();
  const { data: productsData, mutate } = useSWR<Product[]>("/api/products", fetcher);
  const products = Array.isArray(productsData) ? productsData : [];

  const [searchQuery, setSearchQuery] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isBulkImportModalOpen, setIsBulkImportModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

  // Form State
  const [sku, setSku] = useState("");
  const [nameVi, setNameVi] = useState("");
  const [customerNames, setCustomerNames] = useState<string[]>([]);
  const [newCustomerInput, setNewCustomerInput] = useState("");
  const [rawWeight, setRawWeight] = useState("");
  const [material, setMaterial] = useState("");
  const [unit, setUnit] = useState("Cái");
  const [routingSteps, setRoutingSteps] = useState<string[]>(["D1", "CK1", "KTP"]);
  const [routingScrapRates, setRoutingScrapRates] = useState<Record<string, number>>({ D1: 10, CK1: 5 });
  const [routingLeadTimes, setRoutingLeadTimes] = useState<Record<string, number>>({ D1: 3, CK1: 3 });
  const [needsRouting, setNeedsRouting] = useState(false);

  // Opening stock per-workcenter state
  const [openingStockMap, setOpeningStockMap] = useState<Record<string, { tonPhoi: string; tonThanhPham: string }>>({});
  const [openingDate, setOpeningDate] = useState(getTodayVN());

  const effectiveWcs = useMemo(() => {
    if (needsRouting || !routingSteps || routingSteps.length === 0) {
      return ["CUAPHOI", "KTP"];
    }
    const list = [...routingSteps];
    if (list[list.length - 1] !== "KTP") {
      list.push("KTP");
    }
    return list;
  }, [needsRouting, routingSteps]);

  const handleOpeningStockChange = (wcCode: string, field: "tonPhoi" | "tonThanhPham", value: string) => {
    setOpeningStockMap((prev) => ({
      ...prev,
      [wcCode]: {
        tonPhoi: prev[wcCode]?.tonPhoi || "0",
        tonThanhPham: prev[wcCode]?.tonThanhPham || "0",
        [field]: value,
      },
    }));
  };

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [successToast, setSuccessToast] = useState("");

  // Row Selection State
  const [selectedSkus, setSelectedSkus] = useState<Set<string>>(new Set());

  // Sort State
  const [sortConfig, setSortConfig] = useState<{
    key: string;
    direction: "asc" | "desc";
  } | null>(null);

  // Bulk Delete Modal State
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [bulkDeleteResult, setBulkDeleteResult] = useState<{ message: string; rejected: { id: string; reason: string }[] } | null>(null);

  // Extract unique customer names for suggestions
  const existingCustomers = Array.from(
    new Set(
      products
        .flatMap((p) => p.customerNames || (p.customerName ? [p.customerName] : []))
        .filter(Boolean)
    )
  ).sort();

  const openCreateModal = () => {
    setEditingProduct(null);
    setSku("");
    setNameVi("");
    setCustomerNames([]);
    setNewCustomerInput("");
    setRawWeight("");
    setMaterial("");
    setUnit("Cái");
    setRoutingSteps(["D1", "CK1", "KTP"]);
    setRoutingScrapRates({ D1: 10, CK1: 5 });
    setRoutingLeadTimes({ D1: 3, CK1: 3 });
    setNeedsRouting(false);
    setOpeningStockMap({});
    setOpeningDate(getTodayVN());
    setFormError("");
    setIsModalOpen(true);
  };

  const openEditModal = async (p: Product) => {
    setEditingProduct(p);
    setSku(p.sku);
    setNameVi(p.nameVi);
    const custs = Array.isArray(p.customerNames) && p.customerNames.length > 0
      ? [...p.customerNames]
      : (p.customerName ? [p.customerName] : []);
    setCustomerNames(custs);
    setNewCustomerInput("");
    setRawWeight(p.rawWeight !== undefined && p.rawWeight !== null ? String(p.rawWeight) : "");
    setMaterial(p.material || "");
    setUnit(p.unit || "Cái");
    setRoutingSteps(p.routing && p.routing.length > 0 ? [...p.routing] : ["D1", "KTP"]);
    
    // Populate routingScrapRates & routingLeadTimes from product or defaults
    const defaultScrapRates: Record<string, number> = {};
    const defaultLeadTimes: Record<string, number> = {};
    (p.routing || ["D1"]).forEach((wc) => {
      if (wc.toUpperCase() !== "KTP") {
        defaultScrapRates[wc] = p.routingScrapRates?.[wc] ?? (wc.startsWith("CK") ? 5 : 10);
        defaultLeadTimes[wc] = p.routingLeadTimes?.[wc] ?? 3;
      }
    });
    setRoutingScrapRates(defaultScrapRates);
    setRoutingLeadTimes(defaultLeadTimes);

    setNeedsRouting(Boolean(p.needsRouting));
    setOpeningStockMap({});
    setOpeningDate(getTodayVN());
    setFormError("");
    setIsModalOpen(true);

    // Fetch existing opening stock snapshots for this SKU (Requirement 1, 2, 3)
    try {
      const res = await fetch(`/api/inventory/opening?sku=${encodeURIComponent(p.sku)}`);
      if (res.ok) {
        const data = await res.json();
        if (data && data.byWorkcenter) {
          const map: Record<string, { tonPhoi: string; tonThanhPham: string }> = {};
          Object.keys(data.byWorkcenter).forEach((wcCode) => {
            const item = data.byWorkcenter[wcCode];
            map[wcCode] = {
              tonPhoi: String(item.tonPhoi ?? 0),
              tonThanhPham: String(item.tonThanhPham ?? 0),
            };
          });
          setOpeningStockMap(map);
          if (data.latestDate) {
            setOpeningDate(data.latestDate);
          }
        }
      }
    } catch (err) {
      console.error("Failed to fetch opening stock for SKU:", err);
    }
  };

  const handleAddCustomer = (cust: string) => {
    const trimmed = cust.trim();
    if (!trimmed) return;
    if (customerNames.some((c) => c.toLowerCase() === trimmed.toLowerCase())) {
      setNewCustomerInput("");
      return;
    }
    setCustomerNames([...customerNames, trimmed]);
    setNewCustomerInput("");
  };

  const handleRemoveCustomer = (index: number) => {
    const updated = [...customerNames];
    updated.splice(index, 1);
    setCustomerNames(updated);
  };

  const handleDeleteProduct = async (productSku: string) => {
    if (!window.confirm(`Bạn có chắc chắn muốn xóa ${LABELS.sku}: ${productSku}?`)) return;

    try {
      const res = await fetch(`/api/products?sku=${encodeURIComponent(productSku)}`, {
        method: "DELETE",
      });

      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Xóa sản phẩm thất bại.");
        return;
      }

      setSuccessToast(`Đã xóa thành công ${LABELS.sku} ${productSku}.`);
      mutate();
    } catch {
      alert("Không thể kết nối đến máy chủ.");
    }
  };

  const handleAddRoutingStep = (code: string) => {
    setRoutingSteps([...routingSteps, code]);
    if (code.toUpperCase() !== "KTP") {
      if (typeof routingScrapRates[code] !== "number") {
        setRoutingScrapRates((prev) => ({ ...prev, [code]: code.startsWith("CK") ? 5 : 10 }));
      }
      if (typeof routingLeadTimes[code] !== "number") {
        setRoutingLeadTimes((prev) => ({ ...prev, [code]: 3 }));
      }
    }
  };

  const handleRemoveRoutingStep = (index: number) => {
    const updated = [...routingSteps];
    updated.splice(index, 1);
    setRoutingSteps(updated);
  };

  const handleMoveStep = (index: number, direction: "up" | "down") => {
    if (direction === "up" && index === 0) return;
    if (direction === "down" && index === routingSteps.length - 1) return;

    const updated = [...routingSteps];
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    const temp = updated[index];
    updated[index] = updated[targetIndex];
    updated[targetIndex] = temp;
    setRoutingSteps(updated);
  };

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");

    if (!sku.trim()) {
      setFormError(`Vui lòng nhập ${LABELS.skuCode}.`);
      return;
    }

    if (!nameVi.trim()) {
      setFormError("Vui lòng nhập Tên tiếng Việt.");
      return;
    }

    // Include newCustomerInput if typed but not added via button
    let finalCustList = [...customerNames];
    if (newCustomerInput.trim() && !finalCustList.some((c) => c.toLowerCase() === newCustomerInput.trim().toLowerCase())) {
      finalCustList.push(newCustomerInput.trim());
    }

    if (finalCustList.length === 0) {
      setFormError("Vui lòng gắn ít nhất 1 Khách hàng cho SKU.");
      return;
    }

    const weightNum = rawWeight !== "" ? parseFloat(rawWeight) : undefined;
    if (rawWeight !== "" && (isNaN(weightNum!) || weightNum! < 0)) {
      setFormError("Trọng lượng phôi phải là số dương hợp lệ.");
      return;
    }

    const payload: Product = {
      sku: sku.trim(),
      nameVi: nameVi.trim(),
      customerNames: finalCustList,
      rawWeight: weightNum,
      material: material.trim() || undefined,
      unit: unit.trim() || "Cái",
      needsRouting,
      routing: routingSteps,
      routingScrapRates,
      routingLeadTimes,
      createdAt: editingProduct?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    setIsSubmitting(true);

    try {
      const res = await fetch("/api/products", {
        method: editingProduct ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        setFormError(data.error || "Lưu thông tin sản phẩm thất bại.");
        return;
      }

      // Save per-workcenter opening stock for effectiveWcs if quantities > 0
      // Business rule: firstWc = effectiveWcs[0], KTP — Tồn Phôi is N/A (forced to 0)
      const firstWcForSave = effectiveWcs[0];
      const openingErrors: string[] = [];
      for (const wcCode of effectiveWcs) {
        const isFirstWcForSave = wcCode === firstWcForSave;
        const isKtpForSave = wcCode.toUpperCase() === "KTP";

        // Force tonPhoi = 0 for first step and KTP (business rule: not applicable)
        const rawTonPhoi = (isFirstWcForSave || isKtpForSave) ? 0 : Math.max(0, Number(openingStockMap[wcCode]?.tonPhoi || 0));
        const tonPhoiNum = rawTonPhoi;
        const tonTPNum = Math.max(0, Number(openingStockMap[wcCode]?.tonThanhPham || 0));

        if (tonPhoiNum > 0 || tonTPNum > 0 || Boolean(openingStockMap[wcCode])) {
          try {
            const openingRes = await fetch("/api/inventory/opening", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                wcCode,
                sku: sku.trim(),
                state: { tonPhoi: tonPhoiNum, tonThanhPham: tonTPNum },
                customDate: openingDate || getTodayVN(),
              }),
            });
            if (!openingRes.ok) {
              const openErr = await openingRes.json();
              openingErrors.push(`[${wcCode}]: ${openErr.error}`);
            }
          } catch (err) {
            console.error(`Failed to declare opening stock for ${wcCode}:`, err);
            openingErrors.push(`[${wcCode}]: Lỗi kết nối máy chủ.`);
          }
        }
      }

      if (openingErrors.length > 0) {
        alert(`Đã lưu SKU thành công, nhưng khai báo tồn đầu kỳ có lỗi tại các xưởng:\n${openingErrors.join("\n")}`);
      }

      setSuccessToast(
        editingProduct
          ? `Đã cập nhật thành công ${LABELS.sku} ${sku}.`
          : `Đã thêm mới thành công ${LABELS.sku} ${sku}.`
      );
      setIsModalOpen(false);
      mutate();
    } catch {
      setFormError("Không thể kết nối đến máy chủ.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const filteredProducts = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return products.filter((p) => {
      if (!q) return true;
      const matchSku = p.sku.toLowerCase().includes(q);
      const matchNameVi = p.nameVi.toLowerCase().includes(q);
      const custs = p.customerNames || (p.customerName ? [p.customerName] : []);
      const matchCust = custs.some((c) => c.toLowerCase().includes(q));
      const matchMaterial = p.material ? p.material.toLowerCase().includes(q) : false;
      return matchSku || matchNameVi || matchCust || matchMaterial;
    });
  }, [products, searchQuery]);

  const sortedProducts = useMemo(() => {
    const list = [...filteredProducts];
    if (!sortConfig) {
      return list.sort((a, b) => a.sku.localeCompare(b.sku));
    }
    return list.sort((a, b) => {
      let valA: any = a[sortConfig.key as keyof Product];
      let valB: any = b[sortConfig.key as keyof Product];

      if (sortConfig.key === "customer") {
        const custsA = a.customerNames || (a.customerName ? [a.customerName] : []);
        const custsB = b.customerNames || (b.customerName ? [b.customerName] : []);
        valA = custsA[0] || "";
        valB = custsB[0] || "";
      } else if (sortConfig.key === "routing") {
        valA = a.routing ? a.routing.join(",") : "";
        valB = b.routing ? b.routing.join(",") : "";
      }

      if (typeof valA === "number" && typeof valB === "number") {
        return sortConfig.direction === "asc" ? valA - valB : valB - valA;
      }

      const strA = String(valA || "").toLowerCase();
      const strB = String(valB || "").toLowerCase();
      const cmp = strA.localeCompare(strB);
      return sortConfig.direction === "asc" ? cmp : -cmp;
    });
  }, [filteredProducts, sortConfig]);

  const handleToggleSelect = (sku: string) => {
    const next = new Set(selectedSkus);
    if (next.has(sku)) {
      next.delete(sku);
    } else {
      next.add(sku);
    }
    setSelectedSkus(next);
  };

  const isAllSelected = sortedProducts.length > 0 && sortedProducts.every((p) => selectedSkus.has(p.sku));
  const handleToggleSelectAll = () => {
    if (isAllSelected) {
      setSelectedSkus(new Set());
    } else {
      setSelectedSkus(new Set(sortedProducts.map((p) => p.sku)));
    }
  };

  const handleSort = (key: string) => {
    let direction: "asc" | "desc" = "asc";
    if (sortConfig && sortConfig.key === key && sortConfig.direction === "asc") {
      direction = "desc";
    }
    setSortConfig({ key, direction });
  };

  const handleTopEditClick = () => {
    if (selectedSkus.size !== 1) return;
    const skuToEdit = Array.from(selectedSkus)[0];
    const prod = products.find((p) => p.sku === skuToEdit);
    if (prod) openEditModal(prod);
  };

  const handleConfirmBulkDelete = async () => {
    if (selectedSkus.size === 0) return;
    setIsDeleting(true);
    setBulkDeleteResult(null);
    const skusArr = Array.from(selectedSkus);
    try {
      const res = await fetch("/api/products", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skus: skusArr }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFormError(data.error || "Xóa sản phẩm thất bại.");
        setIsDeleting(false);
        setIsDeleteModalOpen(false);
        return;
      }
      setBulkDeleteResult({
        message: data.message || `Đã xóa thành công ${data.deletedCount}/${skusArr.length} sản phẩm.`,
        rejected: data.rejected || [],
      });
      setSelectedSkus(new Set());
      mutate();
      // Auto-close if no rejections
      if (!data.rejected || data.rejected.length === 0) {
        setSuccessToast(data.message || `Đã xóa thành công ${data.deletedCount} sản phẩm.`);
        setIsDeleteModalOpen(false);
      }
    } catch {
      setFormError("Không thể kết nối đến máy chủ.");
    } finally {
      setIsDeleting(false);
    }
  };

  // Column Definitions for Shared DataTable
  const productColumns: ColumnDef<Product>[] = useMemo(
    () => [
      {
        key: "stt",
        header: "STT",
        align: "center",
        width: "3rem",
        render: (_, index) => <span className="text-txt-secondary font-mono font-medium">{index + 1}</span>,
      },
      {
        key: "customer",
        header: "Khách hàng",
        sortable: true,
        sortValue: (p) => {
          const custs = p.customerNames || (p.customerName ? [p.customerName] : []);
          return custs[0] || "";
        },
        render: (product) => {
          const custs = product.customerNames || (product.customerName ? [product.customerName] : []);
          const firstCust = custs[0] || "Chưa gắn KH";
          const restCount = custs.length > 1 ? custs.length - 1 : 0;
          return (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span
                title={custs.join(", ")}
                className="px-2 py-0.5 rounded bg-subtle border border-border text-[11px] font-medium text-txt-primary"
              >
                {firstCust}
              </span>
              {restCount > 0 && (
                <span
                  title={custs.slice(1).join(", ")}
                  className="px-1.5 py-0.5 rounded bg-blue-50 border border-blue-200 text-blue-700 font-bold text-[10px] cursor-help"
                >
                  +{restCount} KH
                </span>
              )}
            </div>
          );
        },
      },
      {
        key: "nameVi",
        header: "Tên SP",
        sortable: true,
        render: (p) => <span className="font-medium text-txt-primary">{p.nameVi}</span>,
      },
      {
        key: "sku",
        header: "Kí hiệu",
        sortable: true,
        headerClassName: "font-bold text-txt-primary",
        render: (p) => <span className="font-mono font-bold text-txt-primary">{p.sku}</span>,
      },
      {
        key: "material",
        header: "Vật liệu",
        sortable: true,
        render: (p) => <span className="font-mono text-txt-secondary">{p.material || "—"}</span>,
      },
      {
        key: "rawWeight",
        header: "TL phôi (kg)",
        sortable: true,
        align: "right",
        sortValue: (p) => p.rawWeight ?? 0,
        render: (p) => (
          <span className="font-mono text-txt-primary">
            {p.rawWeight !== undefined && p.rawWeight !== null ? `${p.rawWeight} kg` : "—"}
          </span>
        ),
      },
      {
        key: "unit",
        header: "ĐVT",
        sortable: true,
        align: "center",
        render: (p) => <span className="text-txt-secondary">{p.unit || "Cái"}</span>,
      },
      {
        key: "routing",
        header: "Quy trình - Routing",
        sortable: true,
        sortValue: (p) => (p.routing ? p.routing.join(",") : ""),
        render: (product) => (
          <div className="font-mono text-[11px]" onClick={(e) => e.stopPropagation()}>
            {product.needsRouting ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-50 border border-amber-200 text-amber-700 text-[10px] font-semibold">
                <AlertTriangle className="w-3 h-3" /> Cần bổ sung routing
              </span>
            ) : product.routing && product.routing.length > 0 ? (
              <div className="flex items-center gap-1 flex-wrap">
                {product.routing.map((step, sIdx) => {
                  const isKtp = step.toUpperCase() === "KTP";
                  const scrapPct = product.routingScrapRates?.[step] ?? (step.startsWith("CK") ? 5 : 10);
                  const leadDays = product.routingLeadTimes?.[step] ?? 3;
                  return (
                    <React.Fragment key={`${product.sku}-${step}-${sIdx}`}>
                      <span className="px-1.5 py-0.5 rounded bg-subtle border border-border text-txt-primary font-bold inline-flex items-center gap-1">
                        <span>{step}</span>
                        {!isKtp && (
                          <span className="text-[9px] text-amber-700 font-semibold bg-amber-50 px-1 rounded border border-amber-200">
                            +{scrapPct}% NG ({leadDays}d)
                          </span>
                        )}
                      </span>
                      {sIdx < product.routing.length - 1 && (
                        <span className="text-txt-secondary text-[10px]">→</span>
                      )}
                    </React.Fragment>
                  );
                })}
              </div>
            ) : (
              <span className="text-txt-secondary italic text-[11px]">Chưa cấu hình</span>
            )}
          </div>
        ),
      },
    ],
    []
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-txt-primary flex items-center gap-2">
            <Package className="w-6 h-6 text-txt-secondary" />
            {LABELS.skuTitle}
          </h1>
          <p className="text-xs text-txt-secondary mt-1">
            Quản lý mã Part No., Quy trình Routing sản xuất và Danh sách Khách hàng áp dụng.
          </p>
        </div>

        {canWrite && (
          <div className="flex items-center gap-1.5 self-start sm:self-auto shrink-0 flex-nowrap">
            <button
              onClick={() => setIsBulkImportModalOpen(true)}
              className="p-2 rounded bg-emerald-50 border border-emerald-200 text-emerald-800 hover:bg-emerald-100 transition-colors shrink-0"
              title="Nhập danh mục SKU hàng loạt từ file Excel"
            >
              <UploadCloud className="w-4 h-4 text-emerald-600" />
            </button>

            <button
              onClick={openCreateModal}
              className="p-2 rounded bg-accent text-white hover:opacity-90 transition-opacity shadow-sm shrink-0"
              title="Thêm SKU sản phẩm mới"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {/* Action Toolbar: Search + Selection Counter + Edit & Delete Action Buttons */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 bg-card p-3 rounded border border-border">
        <div className="flex items-center gap-2 flex-1 bg-subtle border border-border rounded px-3 py-1.5">
          <Search className="w-4 h-4 text-txt-secondary shrink-0" />
          <input
            type="text"
            placeholder="Tìm kiếm theo mã SKU, tên sản phẩm, tên khách hàng, vật liệu..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-transparent text-xs text-txt-primary focus:outline-none placeholder:text-txt-secondary"
          />
        </div>

        <div className="flex items-center gap-1.5 shrink-0 flex-nowrap">
          {selectedSkus.size > 0 && (
            <span className="text-[11px] font-semibold text-accent font-mono bg-accent/10 px-2 py-1 rounded border border-accent/20 shrink-0">
              Đã chọn {selectedSkus.size}
            </span>
          )}

          {canWrite && (
            <div className="flex items-center gap-1.5 border-l border-border pl-2">
              <button
                type="button"
                onClick={handleTopEditClick}
                disabled={selectedSkus.size !== 1}
                className="p-2 rounded bg-amber-50 border border-amber-200 text-amber-800 hover:bg-amber-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                title="Chỉnh sửa SKU sản phẩm (Chỉ áp dụng khi chọn 1 dòng)"
              >
                <Edit2 className="w-3.5 h-3.5 text-amber-600" />
              </button>

              <button
                type="button"
                onClick={() => setIsDeleteModalOpen(true)}
                disabled={selectedSkus.size === 0}
                className="p-2 rounded bg-rose-50 border border-rose-200 text-rose-700 hover:bg-rose-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                title={selectedSkus.size > 0 ? `Xóa ${selectedSkus.size} SKU đã chọn` : "Xóa SKU đã chọn"}
              >
                <Trash2 className="w-3.5 h-3.5 text-rose-600" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Success Toast */}
      {successToast && (
        <div className="p-3 rounded bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{successToast}</span>
          </div>
          <button onClick={() => setSuccessToast("")} className="text-emerald-700 hover:text-emerald-900">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Excel-Style Shared DataTable for Product Catalog */}
      <DataTable<Product>
        data={filteredProducts}
        columns={productColumns}
        getItemKey={(p) => p.sku}
        selectable={true}
        selectedKeys={selectedSkus}
        onSelectionChange={setSelectedSkus}
        sortConfig={sortConfig}
        onSortChange={setSortConfig}
        enablePagination={true}
        defaultPageSize={50}
        isLoading={!productsData}
        loadingMessage="Đang tải danh mục sản phẩm SKU..."
        emptyMessage="Chưa có sản phẩm nào trong danh mục hoặc không khớp bộ lọc."
      />

      {/* Bulk Delete Warning Modal */}
      {isDeleteModalOpen && canWrite && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-canvas border border-border rounded-lg shadow-xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-10 h-10 rounded-full bg-rose-100 text-rose-600 shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-txt-primary">Xác Nhận Xóa Sản Phẩm</h3>
                <p className="text-xs text-txt-secondary mt-0.5">
                  Hành động này sẽ xóa dữ liệu vĩnh viễn khỏi danh mục.
                </p>
              </div>
            </div>

            {!bulkDeleteResult ? (
              <div className="p-3 rounded bg-subtle border border-border space-y-2 text-xs">
                <p className="font-semibold text-txt-primary">
                  Bạn có chắc chắn muốn xóa {selectedSkus.size} dữ liệu đã chọn?
                </p>
                <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto pt-1">
                  {Array.from(selectedSkus).map((s) => (
                    <span key={s} className="px-2 py-0.5 rounded bg-canvas border border-border font-mono font-bold text-txt-primary text-[11px]">
                      {s}
                    </span>
                  ))}
                </div>
                <p className="text-txt-secondary italic">⚠️ SKU đang có PO/WO liên quan sẽ bị từ chối. Các SKU còn lại sẽ được xóa thành công.</p>
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
                onClick={() => { setIsDeleteModalOpen(false); setBulkDeleteResult(null); }}
                disabled={isDeleting}
                className="px-4 py-1.5 rounded bg-subtle border border-border text-txt-primary hover:bg-border text-xs font-medium"
              >
                {bulkDeleteResult ? "Đóng" : "Hủy"}
              </button>
              {!bulkDeleteResult && (
                <button
                  type="button"
                  onClick={handleConfirmBulkDelete}
                  disabled={isDeleting}
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded bg-rose-600 text-white font-semibold hover:bg-rose-700 text-xs disabled:opacity-50"
                >
                  {isDeleting ? "Đang xóa..." : "Xác Nhận Xóa"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal */}
      {isModalOpen && canWrite && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="bg-canvas border border-border rounded-lg shadow-xl max-w-4xl w-full max-h-[92vh] overflow-y-auto p-6 space-y-5">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="text-sm font-bold text-txt-primary">
                {editingProduct ? `Chỉnh Sửa SKU: ${editingProduct.sku}` : "Thêm SKU Sản Phẩm Mới"}
              </h3>
              <button onClick={() => setIsModalOpen(false)} className="text-txt-secondary hover:text-txt-primary">
                <X className="w-4 h-4" />
              </button>
            </div>

            {formError && (
              <div className="p-3 rounded bg-amber-50 border border-amber-200 text-warning text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleSaveProduct} className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-medium text-txt-secondary">{LABELS.skuCode} (*):</label>
                  <input
                    type="text"
                    required
                    disabled={Boolean(editingProduct)}
                    placeholder="VD: SKU-101"
                    value={sku}
                    onChange={(e) => setSku(e.target.value)}
                    className="w-full px-3 py-1.5 bg-canvas border border-border rounded text-txt-primary font-mono focus:outline-none focus:border-accent disabled:opacity-60"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-medium text-txt-secondary">Đơn Vị Tính:</label>
                  <input
                    type="text"
                    placeholder="VD: Cái, Bộ, Chi tiết..."
                    value={unit}
                    onChange={(e) => setUnit(e.target.value)}
                    className="w-full px-3 py-1.5 bg-canvas border border-border rounded text-txt-primary focus:outline-none focus:border-accent"
                  />
                </div>
              </div>

              <div className="space-y-2 p-3 rounded bg-subtle border border-border">
                <label className="font-semibold text-txt-primary block">
                  Khách Hàng Áp Dụng (*) ({customerNames.length}):
                </label>

                {customerNames.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {customerNames.map((cust, idx) => (
                      <span
                        key={cust}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-canvas border border-border text-txt-primary font-medium text-xs shadow-xs"
                      >
                        <span>{cust}</span>
                        <button
                          type="button"
                          onClick={() => handleRemoveCustomer(idx)}
                          className="text-txt-secondary hover:text-rose-600 transition-colors"
                          title="Xóa khách hàng này khỏi SKU"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-rose-600 font-medium italic mb-2">
                    * Chưa có khách hàng nào được gắn. Vui lòng thêm ít nhất 1 khách hàng.
                  </p>
                )}

                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    list="existing-customers-list"
                    placeholder="Chọn hoặc nhập tên Khách hàng mới..."
                    value={newCustomerInput}
                    onChange={(e) => setNewCustomerInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleAddCustomer(newCustomerInput);
                      }
                    }}
                    className="flex-1 px-3 py-1.5 bg-canvas border border-border rounded text-txt-primary focus:outline-none focus:border-accent text-xs"
                  />
                  <datalist id="existing-customers-list">
                    {existingCustomers.map((cust) => (
                      <option key={cust} value={cust} />
                    ))}
                  </datalist>
                  <button
                    type="button"
                    onClick={() => handleAddCustomer(newCustomerInput)}
                    className="px-3 py-1.5 rounded bg-subtle hover:bg-border border border-border text-txt-primary font-medium text-xs flex items-center gap-1 transition-colors shrink-0"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Thêm KH</span>
                  </button>
                </div>
              </div>

              <div className="space-y-1">
                <label className="font-medium text-txt-secondary">Tên Tiếng Việt (*):</label>
                <input
                  type="text"
                  required
                  placeholder="VD: Trục Vít Nâng Thủy Lực"
                  value={nameVi}
                  onChange={(e) => setNameVi(e.target.value)}
                  className="w-full px-3 py-1.5 bg-canvas border border-border rounded text-txt-primary focus:outline-none focus:border-accent"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-medium text-txt-secondary">Trọng Lượng Phôi (kg):</label>
                  <input
                    type="number"
                    step="0.001"
                    min="0"
                    placeholder="VD: 0.35"
                    value={rawWeight}
                    onChange={(e) => setRawWeight(e.target.value)}
                    className="w-full px-3 py-1.5 bg-canvas border border-border rounded text-txt-primary focus:outline-none focus:border-accent"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-medium text-txt-secondary">Vật Liệu:</label>
                  <input
                    type="text"
                    placeholder="VD: S45C, SUS304..."
                    value={material}
                    onChange={(e) => setMaterial(e.target.value)}
                    className="w-full px-3 py-1.5 bg-canvas border border-border rounded text-txt-primary focus:outline-none focus:border-accent"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2 pt-2 border-t border-border">
                <input
                  type="checkbox"
                  id="needsRoutingCheck"
                  checked={needsRouting}
                  onChange={(e) => setNeedsRouting(e.target.checked)}
                  className="rounded border-border"
                />
                <label htmlFor="needsRoutingCheck" className="font-medium text-txt-primary cursor-pointer select-none">
                  Đánh dấu cần bổ sung routing sau (Tạm thời cho phép rỗng)
                </label>
              </div>

              {!needsRouting && (
                <div className="space-y-3 pt-2 border-t border-border">
                  <div>
                    <label className="font-semibold text-txt-primary block">
                      Quy Trình Công Nghệ (Routing):
                    </label>
                    <p className="text-[11px] text-txt-secondary mt-0.5">
                      💡 Hệ thống sẽ tự động thêm bước cuối là Kho Thành Phẩm (KTP) sau khi hoàn tất quy trình đã khai báo.
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    {routingSteps.map((stepCode, index) => {
                      const isKtp = stepCode.toUpperCase() === "KTP";
                      return (
                        <div key={`${stepCode}-${index}`} className="flex items-center justify-between p-2 rounded bg-subtle border border-border">
                          <div className="flex items-center gap-2">
                            <span className="w-5 h-5 flex items-center justify-center rounded-full bg-canvas border border-border font-bold text-[10px] text-txt-secondary">
                              {index + 1}
                            </span>
                            <span className="font-mono font-bold text-txt-primary">{stepCode}</span>
                            <span className="text-[11px] text-txt-secondary">
                              ({MASTER_WORK_CENTERS.find((w) => w.code === stepCode)?.name || stepCode})
                            </span>
                          </div>

                          <div className="flex items-center gap-2">
                            {!isKtp && (
                              <>
                                <div className="flex items-center gap-1.5 bg-canvas px-2 py-1 rounded border border-border">
                                  <span className="text-[10px] text-txt-secondary whitespace-nowrap font-medium">Dự phòng NG:</span>
                                  <input
                                    type="number"
                                    min="0"
                                    max="100"
                                    step="1"
                                    value={routingScrapRates[stepCode] ?? (stepCode.startsWith("CK") ? 5 : 10)}
                                    onChange={(e) => {
                                      const val = Math.max(0, Math.min(100, parseFloat(e.target.value) || 0));
                                      setRoutingScrapRates((prev) => ({ ...prev, [stepCode]: val }));
                                    }}
                                    className="w-12 text-right px-1 py-0.5 text-xs font-mono font-bold bg-subtle border border-border rounded text-txt-primary focus:outline-none focus:border-accent"
                                  />
                                  <span className="text-[10px] text-txt-secondary font-bold">%</span>
                                </div>

                                <div className="flex items-center gap-1.5 bg-canvas px-2 py-1 rounded border border-border">
                                  <span className="text-[10px] text-txt-secondary whitespace-nowrap font-medium">Lead time:</span>
                                  <input
                                    type="number"
                                    min="0"
                                    max="365"
                                    step="1"
                                    value={routingLeadTimes[stepCode] ?? 3}
                                    onChange={(e) => {
                                      const val = Math.max(0, Math.min(365, parseInt(e.target.value, 10) || 0));
                                      setRoutingLeadTimes((prev) => ({ ...prev, [stepCode]: val }));
                                    }}
                                    className="w-12 text-right px-1 py-0.5 text-xs font-mono font-bold bg-subtle border border-border rounded text-txt-primary focus:outline-none focus:border-accent"
                                  />
                                  <span className="text-[10px] text-txt-secondary font-medium">ngày</span>
                                </div>
                              </>
                            )}

                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => handleMoveStep(index, "up")}
                                disabled={index === 0}
                                className="p-1 text-txt-secondary hover:text-txt-primary disabled:opacity-30"
                              >
                                <ArrowUp className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleMoveStep(index, "down")}
                                disabled={index === routingSteps.length - 1}
                                className="p-1 text-txt-secondary hover:text-txt-primary disabled:opacity-30"
                              >
                                <ArrowDown className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleRemoveRoutingStep(index)}
                                className="p-1 text-red-600 hover:text-red-800"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="space-y-1">
                    <p className="text-[11px] text-txt-secondary font-medium">Thêm bước xưởng vào quy trình:</p>
                    <div className="flex flex-wrap gap-1">
                      {MASTER_WORK_CENTERS.map((wc) => (
                        <button
                          key={wc.code}
                          type="button"
                          onClick={() => handleAddRoutingStep(wc.code)}
                          className="px-2 py-1 rounded bg-canvas border border-border text-[11px] font-mono hover:bg-subtle text-txt-primary"
                        >
                          + {wc.code}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

                {/* 1-Click Per-Workcenter Opening Stock Table */}
              <div className="space-y-3 pt-2 border-t border-border">
                <div className="flex items-center justify-between">
                  <label className="font-semibold text-txt-primary flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Khai Báo Tồn Đầu Kỳ Chi Tiết Theo Xưởng (Tùy Chọn):</span>
                  </label>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] text-txt-secondary font-medium">Ngày chốt tồn:</span>
                    <input
                      type="date"
                      value={openingDate}
                      onChange={(e) => setOpeningDate(e.target.value)}
                      className="px-2 py-0.5 bg-canvas border border-border rounded text-txt-primary font-mono text-xs focus:outline-none focus:border-accent"
                    />
                  </div>
                </div>

                <div className="border border-border rounded overflow-hidden">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-subtle border-b border-border text-txt-secondary font-semibold">
                      <tr>
                        <th className="py-2 px-3 w-10 text-center">STT</th>
                        <th className="py-2 px-3">Xưởng / Khâu</th>
                        <th className="py-2 px-3 text-center w-36">Tồn Phôi (Pcs)</th>
                        <th className="py-2 px-3 text-center w-36">Tồn Thành Phẩm (Pcs)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border bg-canvas">
                      {effectiveWcs.map((wcCode, index) => {
                        const wcObj = MASTER_WORK_CENTERS.find((w) => w.code === wcCode);
                        const wcName = wcObj ? wcObj.name : wcCode === "KTP" ? "Kho Thành Phẩm" : wcCode;
                        const currentPhoi = openingStockMap[wcCode]?.tonPhoi ?? "0";
                        const currentTP = openingStockMap[wcCode]?.tonThanhPham ?? "0";

                        // Business rule: Tồn Phôi is N/A for first step (no raw material tracking)
                        // and for KTP (all goods at KTP are treated as finished product for shipping)
                        const isFirstWc = index === 0;
                        const isKTP = wcCode.toUpperCase() === "KTP";
                        const isPhoiDisabled = isFirstWc || isKTP;

                        return (
                          <tr key={`${wcCode}-${index}`} className="hover:bg-subtle/50 transition-colors">
                            <td className="py-2 px-3 text-center font-mono font-bold text-txt-secondary text-[11px]">
                              {index + 1}
                            </td>
                            <td className="py-2 px-3">
                              <div className="flex items-center gap-2">
                                <span className="font-mono font-bold text-txt-primary">{wcCode}</span>
                                <span className="text-txt-secondary text-[11px]">({wcName})</span>
                                {isFirstWc && (
                                  <span className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 text-[10px] font-medium">
                                    Xưởng Đầu
                                  </span>
                                )}
                                {isKTP && !isFirstWc && (
                                  <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-medium">
                                    Kho Đích
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="py-1.5 px-3">
                              {isPhoiDisabled ? (
                                <div
                                  className="w-full px-2 py-1 bg-subtle/60 border border-dashed border-border/60 rounded text-txt-secondary/50 font-mono text-xs text-right select-none"
                                  title={isFirstWc ? "Tồn Phôi không áp dụng cho xưởng đầu tiên (không theo dõi NVL đầu vào)" : "Tồn Phôi không áp dụng cho KTP (mọi hàng tại KTP đều là Thành Phẩm sẵn bán)"}
                                >
                                  —&nbsp;Không áp dụng
                                </div>
                              ) : (
                                <input
                                  type="number"
                                  min="0"
                                  placeholder="0"
                                  value={currentPhoi}
                                  onChange={(e) => handleOpeningStockChange(wcCode, "tonPhoi", e.target.value)}
                                  className="w-full px-2 py-1 bg-subtle border border-border rounded text-txt-primary font-mono text-xs text-right focus:outline-none focus:border-accent"
                                />
                              )}
                            </td>
                            <td className="py-1.5 px-3">
                              <input
                                type="number"
                                min="0"
                                placeholder="0"
                                value={currentTP}
                                onChange={(e) => handleOpeningStockChange(wcCode, "tonThanhPham", e.target.value)}
                                className="w-full px-2 py-1 bg-subtle border border-border rounded text-txt-primary font-mono text-xs text-right focus:outline-none focus:border-accent"
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="text-[10px] text-txt-secondary leading-tight">
                  💡 <strong>Tồn Phôi</strong>: WIP đang chờ xử lý tại xưởng. <strong>Tồn TP</strong>: đã xử lý xong, chờ chuyển tiếp. Ô &quot;Không áp dụng&quot; (xưởng đầu và KTP) sẽ tự động bỏ qua khi lưu.
                </p>
              </div>

              <div className="flex items-center justify-end gap-2 pt-4 border-t border-border">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-1.5 rounded bg-subtle border border-border text-txt-primary hover:bg-border"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded bg-accent text-white font-medium hover:opacity-90 disabled:opacity-50"
                >
                  {isSubmitting ? "Đang lưu..." : "Lưu Sản Phẩm"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Import Bulk Excel (Problem 1) */}
      {isBulkImportModalOpen && canWrite && (
        <BulkImportModal
          onClose={() => setIsBulkImportModalOpen(false)}
          onSuccess={(msg) => {
            setIsBulkImportModalOpen(false);
            setSuccessToast(msg);
            mutate();
          }}
        />
      )}
    </div>
  );
}

function BulkImportModal({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: (msg: string) => void;
}) {
  const { mutate: mutateProducts } = useSWR("/api/products", fetcher);
  const { mutate: mutateXNT } = useSWR("/api/xnt", fetcher);

  const [activeTab, setActiveTab] = useState<"SKU" | "OPENING">("SKU");
  const [fileName, setFileName] = useState("");
  const [cutoverDate, setCutoverDate] = useState(new Date().toISOString().split("T")[0]);

  const [skuRows, setSkuRows] = useState<any[]>([]);
  const [openingRows, setOpeningRows] = useState<any[]>([]);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [importResult, setImportResult] = useState<{
    success?: boolean;
    message?: string;
    error?: string;
  } | null>(null);

  const MASTER_CODES = ["CUAPHOI", "D1", "D2", "R1", "R2", "CK1", "CK2", "CK3", "MNL", "LR", "KTP"];

  const handleCancelUpload = () => {
    setFileName("");
    setSkuRows([]);
    setOpeningRows([]);
    setImportResult(null);
    const fileInput = document.getElementById("modal-excel-file-input") as HTMLInputElement;
    if (fileInput) fileInput.value = "";
  };

  const handleDownloadTemplate = async () => {
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();

    const skuData = [
      {
        SKU: "SKU-001",
        Ten_VI: "Trục Khửu D20",
        Khach_hang: "Công ty Honda",
        Trong_luong_phoi: 0.35,
        Vat_lieu: "S45C",
        Don_vi: "Cái",
        Routing: "CUAPHOI,D1,CK1,KTP",
      },
      {
        SKU: "SKU-001",
        Ten_VI: "Trục Khửu D20",
        Khach_hang: "Công ty Yamaha",
        Trong_luong_phoi: 0.35,
        Vat_lieu: "S45C",
        Don_vi: "Cái",
        Routing: "CUAPHOI,D1,CK1,KTP",
      },
    ];
    const skuSheet = XLSX.utils.json_to_sheet(skuData);
    XLSX.utils.book_append_sheet(wb, skuSheet, "SKU");

    const openingData = [
      { SKU: "SKU-001", Xuong: "CUAPHOI", Ton_Phoi: 500, Ton_ThanhPham: 0 },
      { SKU: "SKU-001", Xuong: "D1", Ton_Phoi: 0, Ton_ThanhPham: 120 },
    ];
    const openingSheet = XLSX.utils.json_to_sheet(openingData);
    XLSX.utils.book_append_sheet(wb, openingSheet, "TonDauKy");

    XLSX.writeFile(wb, "File_Mau_Khoi_Tao_He_Thong_MES.xlsx");
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setImportResult(null);

    const XLSX = await import("xlsx");
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: "binary" });

        const skuSheetName = wb.SheetNames.find((s) => s.toLowerCase().includes("sku")) || wb.SheetNames[0];
        const rawSkuData: any[] = XLSX.utils.sheet_to_json(wb.Sheets[skuSheetName] || {});

        const parsedSkus: any[] = [];
        const seenExactPairs = new Set<string>();
        const seenSkuAttrs = new Map<string, any>();

        rawSkuData.forEach((row, index) => {
          const rowNum = index + 2;
          const sku = String(row.SKU || row.sku || row["Mã SKU"] || "").trim();
          const nameVi = String(row.Ten_VI || row.nameVi || row["Tên tiếng Việt"] || "").trim();
          const customerName = String(row.Khach_hang || row.customerName || row["Khách hàng"] || "").trim();
          const rawWeightVal = row.Trong_luong_phoi ?? row.rawWeight ?? row["Trọng lượng phôi"];
          const rawWeight = rawWeightVal !== undefined && rawWeightVal !== "" && !isNaN(Number(rawWeightVal)) ? Number(rawWeightVal) : undefined;
          const material = String(row.Vat_lieu || row.material || row["Vật liệu"] || "").trim();
          const unit = String(row.Don_vi || row.unit || row["Đơn vị"] || "Cái").trim();
          const routingStr = String(row.Routing || row.routing || "").trim();

          let error: string | undefined;
          let errorField: string | undefined;
          const pairKey = `${sku.toLowerCase()}:${customerName.toLowerCase()}`;
          const skuKey = sku.toLowerCase();

          if (!sku) {
            error = "Mã SKU không được để rỗng.";
            errorField = "sku";
          } else if (!customerName) {
            error = "Tên Khách hàng không được để rỗng.";
            errorField = "customerName";
          } else if (!nameVi) {
            error = "Tên tiếng Việt không được để rỗng.";
            errorField = "nameVi";
          } else if (!routingStr) {
            error = "Quy trình Routing không được để rỗng.";
            errorField = "routing";
          } else if (seenExactPairs.has(pairKey)) {
            error = `Cặp Part No. '${sku}' VÀ Khách hàng '${customerName}' bị trùng lặp trong file Excel.`;
            errorField = "sku";
          } else if (seenSkuAttrs.has(skuKey)) {
            const prev = seenSkuAttrs.get(skuKey);
            if (
              prev.nameVi.toLowerCase() !== nameVi.toLowerCase() ||
              prev.routingStr.toLowerCase() !== routingStr.toLowerCase() ||
              prev.rawWeight !== rawWeight ||
              prev.material?.toLowerCase() !== material.toLowerCase()
            ) {
              error = `Part No. '${sku}' có thuộc tính không đồng nhất với dòng ${prev.rowNum} trong file.`;
              errorField = "general";
            }
          }

          if (!error) {
            const steps = routingStr.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
            if (steps.length === 0) {
              error = "Routing không hợp lệ.";
              errorField = "routing";
            } else {
              const invalidStep = steps.find((st) => !MASTER_CODES.includes(st));
              if (invalidStep) {
                error = `Mã xưởng '${invalidStep}' trong routing không tồn tại.`;
                errorField = "routing";
              }
            }
          }

          if (sku && customerName) seenExactPairs.add(pairKey);
          if (sku && !seenSkuAttrs.has(skuKey)) {
            seenSkuAttrs.set(skuKey, { nameVi, routingStr, rawWeight, material, rowNum });
          }

          parsedSkus.push({ rowNum, sku, nameVi, customerName, rawWeight, material, unit, routingStr, error, errorField });
        });

        setSkuRows(parsedSkus);

        const openingSheetName = wb.SheetNames.find((s) => s.toLowerCase().includes("ton")) || wb.SheetNames[1];
        if (openingSheetName && wb.Sheets[openingSheetName]) {
          const rawOpeningData: any[] = XLSX.utils.sheet_to_json(wb.Sheets[openingSheetName]);
          const parsedOpening: any[] = [];

          rawOpeningData.forEach((row, index) => {
            const rowNum = index + 2;
            const sku = String(row.SKU || row.sku || "").trim();
            const wcCode = String(row.Xuong || row.wcCode || row["Xưởng"] || "").trim().toUpperCase();
            const tonPhoi = Number(row.Ton_Phoi ?? row.tonPhoi ?? 0);
            const tonThanhPham = Number(row.Ton_ThanhPham ?? row.tonThanhPham ?? 0);

            let error: string | undefined;
            let warning: string | undefined;
            let errorField: string | undefined;

            if (!sku) {
              error = "Mã SKU không được để rỗng.";
              errorField = "sku";
            } else if (!wcCode) {
              error = "Mã Xưởng không được để rỗng.";
              errorField = "wcCode";
            } else if (!MASTER_CODES.includes(wcCode)) {
              error = `Mã xưởng '${wcCode}' không hợp lệ.`;
              errorField = "wcCode";
            } else if (isNaN(tonPhoi) || tonPhoi < 0) {
              error = "Tồn phôi phải là số lớn hơn hoặc bằng 0.";
              errorField = "tonPhoi";
            } else if (isNaN(tonThanhPham) || tonThanhPham < 0) {
              error = "Tồn thành phẩm phải là số lớn hơn hoặc bằng 0.";
              errorField = "tonThanhPham";
            } else if (tonPhoi > 0) {
              // Business rule warnings: Tồn Phôi N/A for first step or KTP
              if (wcCode === "KTP") {
                warning = `Tồn Phôi tại KTP không có ý nghĩa (mọi hàng tại KTP là TP sẵn bán). Giá trị ${tonPhoi} sẽ bị bỏ qua, chỉ Tồn TP được lưu.`;
              } else {
                // Find the SKU's routing from parsedSkus to detect first step
                const skuMatch = parsedSkus.find((r: any) => r.sku?.toLowerCase() === sku.toLowerCase() && !r.error);
                if (skuMatch) {
                  const steps = skuMatch.routingStr.split(",").map((s: string) => s.trim().toUpperCase()).filter(Boolean);
                  if (steps.length > 0 && steps[0] === wcCode) {
                    warning = `Xưởng '${wcCode}' là bước đầu tiên trong routing (không theo dõi NVL đầu vào). Tồn Phôi ${tonPhoi} sẽ bị bỏ qua, chỉ Tồn TP được lưu.`;
                  }
                }
              }
            }

            parsedOpening.push({ rowNum, sku, wcCode, tonPhoi, tonThanhPham, error, warning, errorField });
          });

          setOpeningRows(parsedOpening);
        } else {
          setOpeningRows([]);
        }
      } catch {
        setImportResult({ error: "Không thể đọc file Excel. Vui lòng kiểm tra lại định dạng file." });
      }
    };
    reader.readAsBinaryString(file);
  };

  const skuErrorCount = skuRows.filter((r) => r.error).length;
  const openingErrorCount = openingRows.filter((r) => r.error).length;
  const openingWarningCount = openingRows.filter((r) => !r.error && r.warning).length;
  const totalErrorCount = skuErrorCount + openingErrorCount;
  const totalRowCount = skuRows.length + openingRows.length;

  const handleConfirmImport = async () => {
    if (skuRows.length === 0 && openingRows.length === 0) return;
    if (totalErrorCount > 0) return;

    setIsSubmitting(true);
    setImportResult(null);

    try {
      if (skuRows.length > 0) {
        const resSku = await fetch("/api/products/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(skuRows),
        });
        const dataSku = await resSku.json();
        if (!resSku.ok) {
          setImportResult({ error: dataSku.error || "Import danh mục SKU thất bại." });
          setIsSubmitting(false);
          return;
        }
      }

      if (openingRows.length > 0) {
        const resOpening = await fetch("/api/inventory/opening/bulk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cutoverDate,
            items: openingRows
              .filter((r) => !r.error)
              .map((r) => ({
                sku: r.sku,
                wcCode: r.wcCode,
                // Business rule: strip tonPhoi for warned rows (first step or KTP)
                state: { tonPhoi: r.warning ? 0 : r.tonPhoi, tonThanhPham: r.tonThanhPham },
              })),
          }),
        });
        const dataOpening = await resOpening.json();
        if (!resOpening.ok) {
          setImportResult({ error: dataOpening.error || "Import tồn kho đầu kỳ thất bại." });
          setIsSubmitting(false);
          return;
        }
      }

      mutateProducts();
      mutateXNT();
      onSuccess(`Khởi tạo hệ thống thành công! Đã nhập ${skuRows.length} dòng SKU và ${openingRows.length} bản ghi tồn đầu kỳ.`);
    } catch (err: any) {
      setImportResult({ error: err.message || "Xảy ra lỗi trong quá trình khởi tạo hệ thống." });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-canvas border border-border rounded-lg shadow-xl max-w-5xl w-full max-h-[92vh] flex flex-col p-6 space-y-4">
        <div className="flex items-center justify-between border-b border-border pb-3">
          <div className="flex items-center gap-2">
            <UploadCloud className="w-5 h-5 text-emerald-600" />
            <h3 className="text-base font-bold text-txt-primary">Nhập Excel Hàng Loạt (Bulk Import SKU & Tồn Đầu Kỳ)</h3>
          </div>
          <button onClick={onClose} className="text-txt-secondary hover:text-txt-primary p-1 rounded">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Upload zone */}
        <div className="p-4 rounded bg-card border border-border space-y-3 text-xs">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-txt-primary">Chọn File Excel (.xlsx, .xls)</span>
            <button
              onClick={handleDownloadTemplate}
              className="px-3 py-1 rounded bg-subtle hover:bg-border text-txt-primary font-medium flex items-center gap-1.5 transition-colors"
            >
              <Download className="w-3.5 h-3.5" /> Tải File Excel Mẫu
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
            <div className="sm:col-span-2">
              <input
                id="modal-excel-file-input"
                type="file"
                accept=".xlsx, .xls"
                onChange={handleFileUpload}
                className="w-full text-xs text-txt-primary file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-xs file:font-semibold file:bg-subtle file:text-txt-primary hover:file:bg-border cursor-pointer"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-txt-secondary mb-1">Ngày Chốt Sổ Tồn Đầu Kỳ</label>
              <input
                type="date"
                value={cutoverDate}
                onChange={(e) => setCutoverDate(e.target.value)}
                className="w-full h-8 px-2.5 text-xs bg-canvas border border-border rounded text-txt-primary"
              />
            </div>
          </div>

          {fileName && (
            <div className="flex items-center justify-between text-xs bg-canvas px-3 py-1.5 rounded border border-border">
              <span className="text-txt-secondary">Đã nạp: <strong className="text-txt-primary">{fileName}</strong></span>
              <button onClick={handleCancelUpload} className="text-rose-600 font-semibold text-xs flex items-center gap-1">
                <X className="w-3.5 h-3.5" /> Hủy tải lên
              </button>
            </div>
          )}
        </div>

        {/* Error / Result alert */}
        {importResult && (
          <div className={`p-3 rounded border text-xs flex items-center gap-2 ${importResult.success ? "bg-emerald-50 border-emerald-200 text-emerald-900" : "bg-rose-50 border-rose-200 text-rose-900"}`}>
            {importResult.success ? <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" /> : <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />}
            <span>{importResult.message || importResult.error}</span>
          </div>
        )}

        {/* Preview section */}
        {(skuRows.length > 0 || openingRows.length > 0) && (
          <div className="flex-1 overflow-y-auto space-y-3 text-xs">
            {totalErrorCount > 0 ? (
              <div className="p-3 rounded border border-rose-300 bg-rose-50 text-rose-900 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0" />
                  <span className="font-bold">Phát hiện {totalErrorCount} dòng lỗi trên tổng {totalRowCount} dòng dữ liệu.</span>
                </div>
                <button onClick={handleCancelUpload} className="px-3 py-1 rounded bg-rose-100 hover:bg-rose-200 border border-rose-300 font-semibold text-rose-800 shrink-0">
                  Hủy tải lên
                </button>
              </div>
            ) : (
              <div className="p-2.5 rounded border border-emerald-200 bg-emerald-50 text-emerald-900 flex items-center justify-between">
                <div className="flex items-center gap-2 font-medium text-emerald-800">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>Tất cả {totalRowCount} dòng dữ liệu đều hợp lệ!</span>
                </div>
                <button onClick={handleCancelUpload} className="px-2.5 py-0.5 rounded bg-canvas border border-border text-txt-secondary hover:text-txt-primary">
                  Hủy tải lên
                </button>
              </div>
            )}

            {/* Tab navigation */}
            <div className="flex items-center justify-between border-b border-border pb-2">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setActiveTab("SKU")}
                  className={`px-3 py-1.5 rounded text-xs font-semibold flex items-center gap-1.5 ${activeTab === "SKU" ? "bg-subtle text-txt-primary border border-border" : "text-txt-secondary"}`}
                >
                  <Package className="w-3.5 h-3.5" /> Sheet 1: SKU ({skuRows.length} dòng)
                  {skuErrorCount > 0 && <span className="px-1.5 py-0.5 rounded bg-rose-200 text-rose-900 font-bold text-[10px]">{skuErrorCount} lỗi</span>}
                </button>
                <button
                  onClick={() => setActiveTab("OPENING")}
                  className={`px-3 py-1.5 rounded text-xs font-semibold flex items-center gap-1.5 ${activeTab === "OPENING" ? "bg-subtle text-txt-primary border border-border" : "text-txt-secondary"}`}
                >
                  <Layers className="w-3.5 h-3.5" /> Sheet 2: Tồn Đầu Kỳ ({openingRows.length} dòng)
                  {openingErrorCount > 0 && <span className="px-1.5 py-0.5 rounded bg-rose-200 text-rose-900 font-bold text-[10px]">{openingErrorCount} lỗi</span>}
                  {openingWarningCount > 0 && <span className="px-1.5 py-0.5 rounded bg-amber-200 text-amber-900 font-bold text-[10px]">{openingWarningCount} cảnh báo</span>}
                </button>
              </div>

              <div className="flex items-center gap-2">
                <button onClick={onClose} className="px-3 py-1 rounded bg-canvas border border-border text-txt-secondary hover:text-txt-primary">
                  Đóng
                </button>
                <button
                  onClick={handleConfirmImport}
                  disabled={isSubmitting || totalErrorCount > 0}
                  className="px-4 py-1.5 bg-subtle hover:bg-border disabled:opacity-50 text-txt-primary font-semibold rounded"
                >
                  {isSubmitting ? "Đang import..." : "Xác Nhận Import"}
                </button>
              </div>
            </div>

            {/* SKU Table Preview */}
            {activeTab === "SKU" && (
              <div className="border border-border rounded max-h-60 overflow-y-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-subtle text-txt-secondary border-b border-border font-medium">
                      <th className="p-2 w-10 text-center">Hàng</th>
                      <th className="p-2">Mã SKU</th>
                      <th className="p-2">Khách Hàng</th>
                      <th className="p-2">Tên Tiếng Việt</th>
                      <th className="p-2">Trọng Lượng (kg)</th>
                      <th className="p-2">Vật Liệu</th>
                      <th className="p-2">Đơn Vị</th>
                      <th className="p-2">Routing</th>
                      <th className="p-2">Trạng Thái</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {skuRows.map((r) => (
                      <tr key={r.rowNum} className={r.error ? "bg-rose-50/90 border-l-4 border-l-rose-600" : "hover:bg-subtle/50"}>
                        <td className="p-2 text-center text-txt-secondary font-mono">{r.rowNum}</td>
                        <td className="p-2 font-mono font-semibold">{r.sku || "—"}</td>
                        <td className="p-2">{r.customerName || "—"}</td>
                        <td className="p-2">{r.nameVi || "—"}</td>
                        <td className="p-2 font-mono">{r.rawWeight !== undefined ? `${r.rawWeight} kg` : "—"}</td>
                        <td className="p-2">{r.material || "—"}</td>
                        <td className="p-2">{r.unit || "Cái"}</td>
                        <td className="p-2 font-mono">{r.routingStr || "—"}</td>
                        <td className="p-2">
                          {r.error ? (
                            <span className="text-rose-700 font-bold text-[11px] flex items-center gap-1 bg-rose-100 px-2 py-0.5 rounded border border-rose-200">
                              <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0" /> {r.error}
                            </span>
                          ) : (
                            <span className="text-emerald-700 flex items-center gap-1 font-semibold text-[11px]">
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> Hợp lệ
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Opening Table Preview */}
            {activeTab === "OPENING" && (
              <div className="border border-border rounded max-h-60 overflow-y-auto">
                {openingWarningCount > 0 && (
                  <div className="px-3 py-2 bg-amber-50 border-b border-amber-200 text-amber-800 text-[11px] flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    <span><strong>{openingWarningCount} dòng cảnh báo</strong>: Tồn Phôi không áp dụng cho xưởng đầu tiên hoặc KTP — giá trị sẽ bị bỏ qua khi import, chỉ Tồn TP được ghi lại.</span>
                  </div>
                )}
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-subtle text-txt-secondary border-b border-border font-medium">
                      <th className="p-2 w-10 text-center">Hàng</th>
                      <th className="p-2">Mã SKU</th>
                      <th className="p-2">Mã Xưởng</th>
                      <th className="p-2 text-right">Tồn Phôi</th>
                      <th className="p-2 text-right">Tồn Thành Phẩm</th>
                      <th className="p-2">Trạng Thái</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {openingRows.map((r) => (
                      <tr
                        key={r.rowNum}
                        className={
                          r.error
                            ? "bg-rose-50/90 border-l-4 border-l-rose-600"
                            : r.warning
                            ? "bg-amber-50/60 border-l-4 border-l-amber-400"
                            : "hover:bg-subtle/50"
                        }
                      >
                        <td className="p-2 text-center text-txt-secondary font-mono">{r.rowNum}</td>
                        <td className="p-2 font-mono font-semibold">{r.sku || "—"}</td>
                        <td className="p-2 font-mono font-semibold">{r.wcCode || "—"}</td>
                        <td className="p-2 text-right font-mono">
                          {r.warning ? (
                            <span className="line-through text-txt-secondary/50">{r.tonPhoi?.toLocaleString() || 0}</span>
                          ) : (
                            r.tonPhoi?.toLocaleString() || 0
                          )}
                        </td>
                        <td className="p-2 text-right font-mono">{r.tonThanhPham?.toLocaleString() || 0}</td>
                        <td className="p-2">
                          {r.error ? (
                            <span className="text-rose-700 font-bold text-[11px] flex items-center gap-1 bg-rose-100 px-2 py-0.5 rounded border border-rose-200">
                              <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0" /> {r.error}
                            </span>
                          ) : r.warning ? (
                            <span className="text-amber-700 text-[11px] flex items-start gap-1 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                              <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-px" />
                              <span>{r.warning}</span>
                            </span>
                          ) : (
                            <span className="text-emerald-700 flex items-center gap-1 font-semibold text-[11px]">
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> Hợp lệ
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
