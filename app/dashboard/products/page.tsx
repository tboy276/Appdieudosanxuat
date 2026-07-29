"use client";

import { useState } from "react";
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
} from "lucide-react";
import AccordionList from "@/components/AccordionList";
import { Product } from "@/lib/types";
import { useSession } from "@/hooks/useSession";

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

export default function ProductsPage() {
  const { canWrite } = useSession();
  const { data: productsData, mutate } = useSWR<Product[]>("/api/products", fetcher);
  const products = Array.isArray(productsData) ? productsData : [];

  const [searchQuery, setSearchQuery] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

  // Form State
  const [sku, setSku] = useState("");
  const [nameVi, setNameVi] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [unit, setUnit] = useState("Cái");
  const [legacyInput, setLegacyInput] = useState("");
  const [legacyTags, setLegacyTags] = useState<string[]>([]);
  const [routingSteps, setRoutingSteps] = useState<string[]>(["D1", "CK1", "LR"]);
  const [needsRouting, setNeedsRouting] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [successToast, setSuccessToast] = useState("");

  const filteredProducts = products.filter((p) => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return true;
    return (
      p.sku.toLowerCase().includes(q) ||
      p.nameVi.toLowerCase().includes(q) ||
      (p.nameEn && p.nameEn.toLowerCase().includes(q))
    );
  });

  const openCreateModal = () => {
    setEditingProduct(null);
    setSku("");
    setNameVi("");
    setNameEn("");
    setUnit("Cái");
    setLegacyInput("");
    setLegacyTags([]);
    setRoutingSteps(["D1", "CK1", "LR"]);
    setNeedsRouting(false);
    setFormError("");
    setIsModalOpen(true);
  };

  const openEditModal = (p: Product) => {
    setEditingProduct(p);
    setSku(p.sku);
    setNameVi(p.nameVi);
    setNameEn(p.nameEn || "");
    setUnit(p.unit || "Cái");
    setLegacyInput("");
    setLegacyTags(p.legacySymbols || []);
    setRoutingSteps(p.routing && p.routing.length > 0 ? [...p.routing] : ["D1", "LR"]);
    setNeedsRouting(Boolean(p.needsRouting));
    setFormError("");
    setIsModalOpen(true);
  };

  const handleAddTag = () => {
    const trimmed = legacyInput.trim();
    if (trimmed && !legacyTags.includes(trimmed)) {
      setLegacyTags([...legacyTags, trimmed]);
      setLegacyInput("");
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setLegacyTags(legacyTags.filter((t) => t !== tagToRemove));
  };

  const handleAddRoutingStep = (code: string) => {
    setRoutingSteps([...routingSteps, code]);
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");
    setSuccessToast("");

    if (!sku.trim()) {
      setFormError("Mã SKU không được để rỗng.");
      return;
    }
    if (!nameVi.trim()) {
      setFormError("Tên tiếng Việt không được để rỗng.");
      return;
    }

    if (needsRouting && routingSteps.length === 0) {
      // Temporarily allowed empty routing
    } else {
      if (routingSteps.length === 0) {
        setFormError("Routing không được để rỗng trừ khi bật 'Cần bổ sung routing sau'.");
        return;
      }
      const lastStep = routingSteps[routingSteps.length - 1];
      if (lastStep !== "LR") {
        setFormError("Routing không hợp lệ: bước cuối cùng của routing bắt buộc phải là 'LR'.");
        return;
      }
    }

    setIsSubmitting(true);

    try {
      const payload: Product = {
        sku: sku.trim(),
        nameVi: nameVi.trim(),
        nameEn: nameEn.trim() || undefined,
        unit: unit.trim() || "Cái",
        legacySymbols: legacyTags,
        routing: routingSteps,
        needsRouting,
        createdAt: editingProduct?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const res = await fetch("/api/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        setFormError(data.error || "Lưu sản phẩm thất bại.");
        setIsSubmitting(false);
        return;
      }

      setSuccessToast(`Đã lưu thành công sản phẩm SKU ${payload.sku}.`);
      setIsModalOpen(false);
      mutate();
    } catch {
      setFormError("Không thể kết nối đến máy chủ.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded bg-canvas border border-border">
        <div className="flex items-center gap-3">
          <div className="relative flex items-center">
            <Search className="w-4 h-4 absolute left-2.5 text-txt-secondary" />
            <input
              type="text"
              placeholder="Tìm kiếm theo mã SKU, tên SP..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 pr-3 py-1.5 text-xs bg-subtle border border-border rounded text-txt-primary focus:outline-none focus:border-accent w-64 sm:w-80"
            />
          </div>
          <span className="text-xs text-txt-secondary">
            Tổng cộng: <strong className="text-txt-primary">{filteredProducts.length}</strong> sản phẩm
          </span>
        </div>

        {canWrite && (
          <button
            onClick={openCreateModal}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-accent text-white text-xs font-medium hover:opacity-90 transition-opacity"
          >
            <Plus className="w-4 h-4" />
            <span>Thêm SKU Mới</span>
          </button>
        )}
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

      {/* Accordion Product List */}
      <AccordionList<Product>
        items={filteredProducts}
        getItemKey={(p) => p.sku}
        emptyMessage="Chưa có sản phẩm nào trong danh mục."
        renderHeader={(product) => (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              <span className="font-mono font-bold text-txt-primary text-sm">{product.sku}</span>
              <span className="text-xs font-medium text-txt-primary">{product.nameVi}</span>
              {product.needsRouting && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-50 border border-amber-200 text-warning text-[10px] font-semibold">
                  <AlertTriangle className="w-3 h-3" />
                  <span>Cần bổ sung routing</span>
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs font-mono text-txt-secondary bg-subtle px-2 py-0.5 rounded">
                {product.routing && product.routing.length > 0 ? product.routing.join(" → ") : "Chưa có routing"}
              </span>
            </div>
          </div>
        )}
        renderDetail={(product) => (
          <div className="space-y-4 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-3 rounded bg-subtle border border-border">
              <div>
                <p className="text-txt-secondary">Tên Tiếng Anh:</p>
                <p className="font-medium text-txt-primary">{product.nameEn || "N/A"}</p>
              </div>
              <div>
                <p className="text-txt-secondary">Đơn Vị Tính:</p>
                <p className="font-medium text-txt-primary">{product.unit || "Cái"}</p>
              </div>
              <div>
                <p className="text-txt-secondary">Ký Hiệu Cũ (Legacy Symbols):</p>
                <div className="flex flex-wrap gap-1 mt-1">
                  {product.legacySymbols && product.legacySymbols.length > 0 ? (
                    product.legacySymbols.map((sym) => (
                      <span key={sym} className="px-2 py-0.5 rounded bg-canvas border border-border text-[11px] font-mono text-txt-secondary">
                        {sym}
                      </span>
                    ))
                  ) : (
                    <span className="text-txt-secondary italic">Không có</span>
                  )}
                </div>
              </div>
              <div>
                <p className="text-txt-secondary">Quy Trình Công Nghệ (Routing):</p>
                <p className="font-mono font-semibold text-txt-primary mt-1">
                  {product.routing && product.routing.length > 0 ? product.routing.join(" → ") : "Chưa khai báo"}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-between pt-2">
              <span className="text-[11px] text-txt-secondary flex items-center gap-1">
                <Clock className="w-3 h-3" /> Cập nhật lần cuối: {new Date(product.updatedAt).toLocaleString("vi-VN")}
              </span>

              {canWrite && (
                <button
                  onClick={() => openEditModal(product)}
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded bg-subtle border border-border hover:bg-border text-xs text-txt-primary font-medium transition-colors"
                >
                  <Edit2 className="w-3.5 h-3.5 text-txt-secondary" />
                  <span>Chỉnh Sửa Routing / SKU</span>
                </button>
              )}
            </div>
          </div>
        )}
      />

      {/* Modal */}
      {isModalOpen && canWrite && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-canvas border border-border rounded shadow-lg max-w-lg w-full max-h-[90vh] overflow-y-auto p-6 space-y-5">
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

            <form onSubmit={handleSubmit} className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-medium text-txt-secondary">Mã SKU (*):</label>
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

              <div className="space-y-1">
                <label className="font-medium text-txt-secondary">Tên Tiếng Anh:</label>
                <input
                  type="text"
                  placeholder="VD: Hydraulic Screw Shaft"
                  value={nameEn}
                  onChange={(e) => setNameEn(e.target.value)}
                  className="w-full px-3 py-1.5 bg-canvas border border-border rounded text-txt-primary focus:outline-none focus:border-accent"
                />
              </div>

              <div className="space-y-1.5">
                <label className="font-medium text-txt-secondary flex items-center gap-1">
                  <Tag className="w-3 h-3" />
                  <span>Ký Hiệu Cũ (Legacy Symbols):</span>
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Nhập mã ký hiệu cũ..."
                    value={legacyInput}
                    onChange={(e) => setLegacyInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleAddTag();
                      }
                    }}
                    className="flex-1 px-3 py-1.5 bg-canvas border border-border rounded text-txt-primary font-mono focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleAddTag}
                    className="px-3 py-1.5 bg-subtle border border-border rounded text-txt-primary font-medium hover:bg-border"
                  >
                    Thêm
                  </button>
                </div>
                {legacyTags.length > 0 && (
                  <div className="flex flex-wrap gap-1 pt-1">
                    {legacyTags.map((tag) => (
                      <span key={tag} className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-subtle border border-border text-txt-primary font-mono text-[11px]">
                        <span>{tag}</span>
                        <button type="button" onClick={() => handleRemoveTag(tag)} className="text-txt-secondary hover:text-txt-primary">
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
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
                  <div className="flex items-center justify-between">
                    <label className="font-semibold text-txt-primary">
                      Quy Trình Công Nghệ (Routing - Bắt buộc kết thúc bằng LR):
                    </label>
                    <span className="text-[10px] text-txt-secondary">Bước cuối: LR</span>
                  </div>

                  <div className="space-y-1.5">
                    {routingSteps.map((stepCode, index) => (
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
                    ))}
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
    </div>
  );
}
