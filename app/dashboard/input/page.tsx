"use client";

import { useState, useEffect, useMemo } from "react";
import { useSWRConfig } from "swr";
import Link from "next/link";
import {
  Factory,
  Layers,
  ArrowRight,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  Zap,
  SlidersHorizontal,
  Package,
} from "lucide-react";
import { WorkCenter, Product } from "@/lib/types";
import { WO } from "@/lib/po-wo-engine";
import { ProductionAllocationSummary } from "@/lib/xnt-engine";

export default function ProductionInputPage() {
  const { mutate } = useSWRConfig();

  const [workCenters, setWorkCenters] = useState<WorkCenter[]>([]);
  const [wos, setWOs] = useState<WO[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [xntData, setXntData] = useState<any[]>([]);

  const [selectedWc, setSelectedWc] = useState<string>("");
  const [selectedSku, setSelectedSku] = useState<string>("");
  const [allocationMode, setAllocationMode] = useState<"auto" | "manual">("auto");
  const [selectedWoId, setSelectedWoId] = useState<string>("");
  const [actualQty, setActualQty] = useState<string>("");
  const [ngQty, setNgQty] = useState<string>("0");

  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [allocationResult, setAllocationResult] = useState<ProductionAllocationSummary | null>(null);

  const loadInitialData = async () => {
    setIsLoading(true);
    try {
      const [wcsRes, wosRes, prodsRes, xntRes] = await Promise.all([
        fetch("/api/workcenters"),
        fetch("/api/wo"),
        fetch("/api/products"),
        fetch("/api/xnt"),
      ]);

      if (wcsRes.ok) setWorkCenters(await wcsRes.json());
      if (wosRes.ok) setWOs(await wosRes.json());
      if (prodsRes.ok) setProducts(await prodsRes.json());
      if (xntRes.ok) setXntData(await xntRes.json());
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadInitialData();
  }, []);

  const currentWcObj = workCenters.find((w) => w.code === selectedWc);
  const isFirstStepWc = Boolean(currentWcObj?.isFirstStep);

  // Available SKUs for selected Work Center (from routing or product list)
  const availableSkus = useMemo(() => {
    if (!selectedWc) return [];
    return products.filter((p) => {
      if (!p.routing || p.routing.length === 0) return true;
      return p.routing.includes(selectedWc);
    });
  }, [products, selectedWc]);

  // Open WOs matching selected WorkCenter and SKU
  const openWOsForPair = useMemo(() => {
    if (!selectedWc || !selectedSku) return [];
    return wos.filter(
      (wo) =>
        wo.wcCode === selectedWc &&
        wo.sku === selectedSku &&
        wo.status !== "SHIPPED" &&
        wo.status !== "READY_TO_SHIP"
    );
  }, [wos, selectedWc, selectedSku]);

  // Total remaining demand from open WOs
  const totalRemainingDemand = useMemo(() => {
    return openWOsForPair.reduce(
      (sum, wo) => sum + Math.max(0, (wo.targetQty || 0) - (wo.shippedQty || 0)),
      0
    );
  }, [openWOsForPair]);

  // Current stock state for (selectedWc, selectedSku) from XNT data
  const currentXNT = xntData.find(
    (x) => x.wcCode === selectedWc && x.sku === selectedSku
  );

  const availablePhoiInput = isFirstStepWc
    ? Number.MAX_SAFE_INTEGER
    : currentXNT?.closing?.tonPhoi || 0;

  const actualQtyNum = Number(actualQty) || 0;
  const ngQtyNum = Math.max(0, Number(ngQty) || 0);
  const totalPhoiNeeded = actualQtyNum + ngQtyNum;
  const isExceedingInputStock = !isFirstStepWc && totalPhoiNeeded > availablePhoiInput;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");
    setAllocationResult(null);

    if (!selectedWc || !selectedSku) {
      setErrorMsg("Vui lòng chọn Xưởng và SKU sản phẩm.");
      return;
    }

    if (actualQtyNum <= 0 && ngQtyNum <= 0) {
      setErrorMsg("Vui lòng nhập sản lượng thành phẩm (> 0) hoặc số lượng NG phế phẩm (> 0).");
      return;
    }

    if (allocationMode === "manual" && !selectedWoId) {
      setErrorMsg("Vui lòng chọn Lệnh sản xuất (WO) khi sử dụng chế độ chỉ định thủ công.");
      return;
    }

    setIsSubmitting(true);

    try {
      const payload: any = {
        wcCode: selectedWc,
        sku: selectedSku,
        actualQty: actualQtyNum,
        ngQty: ngQtyNum,
      };

      if (allocationMode === "manual" && selectedWoId) {
        payload.woId = selectedWoId;
      }

      const res = await fetch("/api/production/input", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        setErrorMsg(data.error || "Báo cáo sản lượng thất bại.");
        setIsSubmitting(false);
        return;
      }

      if (data.summary) {
        setAllocationResult(data.summary);
      }

      setActualQty("");
      setNgQty("0");

      // Refresh data & Mutate SWR global cache keys
      await Promise.all([
        mutate("/api/xnt"),
        mutate("/api/wo"),
        loadInitialData(),
      ]);
    } catch {
      setErrorMsg("Không thể kết nối đến máy chủ. Vui lòng thử lại sau.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Notice Banner */}
      <div className="p-3 rounded bg-blue-50/50 border border-blue-200 text-blue-800 text-xs flex items-center justify-between">
        <span>
          💡 <strong>Khuyên dùng:</strong> Bạn có thể báo cáo sản lượng nhanh hơn bằng nút <strong>"Nhập"</strong> trực tiếp trên bảng{" "}
          <Link href="/dashboard/xnt" className="underline font-bold hover:text-blue-900">
            Xuất Nhập Tồn theo Xưởng
          </Link>
          .
        </span>
      </div>

      {/* Header */}
      <div className="p-4 rounded bg-canvas border border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Factory className="w-5 h-5 text-txt-secondary" />
          <h2 className="text-sm font-semibold text-txt-primary">Báo Cáo Sản Lượng Thực Tế Tại Xưởng</h2>
        </div>
        <button
          onClick={loadInitialData}
          className="p-1.5 rounded text-txt-secondary hover:text-txt-primary hover:bg-subtle transition-colors"
          title="Làm mới dữ liệu"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* Messages */}
      {errorMsg && (
        <div className="p-3 rounded bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Allocation Summary Modal / Banner */}
      {allocationResult && (
        <div className="p-4 rounded bg-emerald-50 border border-emerald-300 text-emerald-950 text-xs space-y-3 shadow-sm animate-in fade-in">
          <div className="flex items-center justify-between border-b border-emerald-200 pb-2">
            <div className="flex items-center gap-2 font-bold text-emerald-900">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              <span>Ghi Nhận Sản Lượng Thành Công (+{allocationResult.totalQtyOk.toLocaleString()} pcs TP{allocationResult.totalQtyNg > 0 ? ` + ${allocationResult.totalQtyNg} pcs NG` : ""})</span>
            </div>
            <button
              onClick={() => setAllocationResult(null)}
              className="text-emerald-700 hover:text-emerald-950 font-bold"
            >
              ✕
            </button>
          </div>

          <p className="text-xs text-emerald-800 font-medium">{allocationResult.message}</p>

          <div className="space-y-1.5 pt-1">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-900">Chi tiết phân bổ:</p>
            <div className="grid grid-cols-1 gap-1.5">
              {allocationResult.allocations.map((alloc, idx) => (
                <div
                  key={idx}
                  className="p-2 rounded bg-white/80 border border-emerald-200 flex items-center justify-between text-xs font-mono"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-txt-primary">
                      {alloc.woNumber ? `Lệnh ${alloc.woNumber}` : alloc.woId ? `WO ${alloc.woId}` : "📦 Tồn kho dôi dư ngoài WO"}
                    </span>
                    {alloc.isCompleted && (
                      <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-sans font-bold">
                        Đã Đạt 100%
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-bold text-emerald-700">+{alloc.allocatedQty.toLocaleString()} pcs</span>
                    {alloc.targetQty !== undefined && alloc.completedQty !== undefined && (
                      <span className="text-txt-secondary text-[11px]">
                        (Tiến độ: {alloc.completedQty}/{alloc.targetQty} pcs)
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Main Input Form */}
      <form onSubmit={handleSubmit} className="p-6 bg-canvas border border-border rounded space-y-5">
        {/* Step 1: Select Work Center & SKU */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-txt-secondary flex items-center gap-1.5">
              <Factory className="w-3.5 h-3.5" />
              <span>1. Chọn Xưởng Sản Xuất (*):</span>
            </label>
            <select
              value={selectedWc}
              onChange={(e) => {
                setSelectedWc(e.target.value);
                setSelectedSku("");
                setSelectedWoId("");
              }}
              className="w-full px-3 py-2 text-sm bg-canvas border border-border rounded text-txt-primary focus:outline-none focus:border-accent"
            >
              <option value="">-- Chọn Xưởng Sản Xuất --</option>
              {workCenters.map((wc) => (
                <option key={wc.code} value={wc.code}>
                  {wc.code} - {wc.name} {wc.isFirstStep ? "(Đầu Chuỗi)" : ""}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-txt-secondary flex items-center gap-1.5">
              <Package className="w-3.5 h-3.5" />
              <span>2. Chọn SKU Sản Phẩm (*):</span>
            </label>
            <select
              value={selectedSku}
              onChange={(e) => {
                setSelectedSku(e.target.value);
                setSelectedWoId("");
              }}
              disabled={!selectedWc}
              className="w-full px-3 py-2 text-sm bg-canvas border border-border rounded text-txt-primary focus:outline-none focus:border-accent disabled:opacity-40"
            >
              <option value="">-- Chọn SKU Sản Phẩm --</option>
              {availableSkus.map((p) => (
                <option key={p.sku} value={p.sku}>
                  {p.sku} {p.nameVi ? `(${p.nameVi})` : ""}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Step 2: Open WOs Overview & Allocation Mode */}
        {selectedWc && selectedSku && (
          <div className="space-y-3 p-4 rounded bg-subtle border border-border text-xs">
            <div className="flex items-center justify-between border-b border-border pb-2">
              <span className="font-semibold text-txt-primary flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-accent" />
                <span>Lệnh Sản Xuất Đang Mở Tại Xưởng {selectedWc}</span>
              </span>
              <span className="font-mono text-txt-secondary">
                Tổng nhu cầu WO: <strong>{totalRemainingDemand.toLocaleString()} pcs</strong>
              </span>
            </div>

            {openWOsForPair.length === 0 ? (
              <p className="text-txt-secondary italic py-1">
                Hiện không có Lệnh WO nào đang mở cho cặp ({selectedWc}, {selectedSku}). Toàn bộ sản lượng nhập sẽ được ghi nhận vào Tồn kho thành phẩm dôi dư.
              </p>
            ) : (
              <div className="space-y-1.5">
                {openWOsForPair.map((wo) => {
                  const rem = Math.max(0, (wo.targetQty || 0) - (wo.shippedQty || 0));
                  return (
                    <div
                      key={wo.woId}
                      className="p-2 rounded bg-canvas border border-border flex items-center justify-between text-xs"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-txt-primary">{wo.woId}</span>
                        <span className="text-txt-secondary">
                          (Kế hoạch: {wo.targetQty} pcs, Đã hoàn thành: {wo.shippedQty || 0} pcs)
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-mono text-txt-secondary">
                          Hạn: {wo.deadline || "—"}
                        </span>
                        <span className="font-mono font-semibold text-accent">Còn cần: {rem} pcs</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Mode Selector */}
            {openWOsForPair.length > 0 && (
              <div className="pt-2 border-t border-border flex flex-wrap items-center gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="allocMode"
                    value="auto"
                    checked={allocationMode === "auto"}
                    onChange={() => setAllocationMode("auto")}
                    className="text-accent focus:ring-accent"
                  />
                  <span className="font-medium text-txt-primary flex items-center gap-1">
                    <Zap className="w-3.5 h-3.5 text-amber-500" />
                    <span>Tự động phân bổ theo hạn giao (Khuyên dùng)</span>
                  </span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="allocMode"
                    value="manual"
                    checked={allocationMode === "manual"}
                    onChange={() => setAllocationMode("manual")}
                    className="text-accent focus:ring-accent"
                  />
                  <span className="text-txt-secondary flex items-center gap-1">
                    <SlidersHorizontal className="w-3.5 h-3.5" />
                    <span>Chỉ định WO cụ thể</span>
                  </span>
                </label>
              </div>
            )}

            {/* Manual WO Selector Dropdown */}
            {allocationMode === "manual" && openWOsForPair.length > 0 && (
              <div className="pt-2 space-y-1">
                <label className="text-xs font-medium text-txt-secondary">Chọn đích danh 1 WO:</label>
                <select
                  value={selectedWoId}
                  onChange={(e) => setSelectedWoId(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-canvas border border-border rounded text-txt-primary font-mono focus:outline-none focus:border-accent"
                >
                  <option value="">-- Chọn WO nhận sản lượng --</option>
                  {openWOsForPair.map((wo) => (
                    <option key={wo.woId} value={wo.woId}>
                      {wo.woId} (Mục tiêu: {wo.targetQty} pcs, Đã xong: {wo.shippedQty || 0} pcs)
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        )}

        {/* Step 3: Input Quantity & NG */}
        {selectedWc && selectedSku && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-txt-primary">
                  3. Số Lượng Thành Phẩm Đạt (Pcs): *
                </label>
                <input
                  type="number"
                  min="0"
                  placeholder="Ví dụ: 500"
                  value={actualQty}
                  onChange={(e) => setActualQty(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-canvas border border-border rounded text-txt-primary focus:outline-none focus:border-accent font-mono"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-txt-primary flex items-center justify-between">
                  <span>Số Lượng NG / Phế Phẩm (Pcs):</span>
                  <span className="text-[10px] text-txt-secondary">Mặc định 0</span>
                </label>
                <input
                  type="number"
                  min="0"
                  placeholder="0"
                  value={ngQty}
                  onChange={(e) => setNgQty(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-canvas border border-border rounded text-txt-primary focus:outline-none focus:border-accent font-mono"
                />
              </div>
            </div>

            {/* Phôi Info & Consumption Preview */}
            <div className="p-3 rounded bg-subtle border border-border text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <span className="text-txt-secondary">
                Tồn Phôi khả dụng tại xưởng {selectedWc}:{" "}
                <strong className={isFirstStepWc ? "text-blue-600 font-mono" : "font-mono text-txt-primary"}>
                  {isFirstStepWc ? "Vô tận (Đầu chuỗi)" : `${availablePhoiInput.toLocaleString()} pcs`}
                </strong>
              </span>
              <span className="text-txt-secondary">
                Phôi tiêu hao:{" "}
                <strong className="font-mono text-txt-primary">
                  {totalPhoiNeeded.toLocaleString()} pcs
                </strong>
              </span>
            </div>

            {isExceedingInputStock && (
              <p className="text-xs text-warning flex items-center gap-1 font-medium">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                <span>Tổng phôi tiêu hao ({totalPhoiNeeded} pcs) vượt quá lượng phôi tồn kho khả dụng ({availablePhoiInput} pcs).</span>
              </p>
            )}
          </div>
        )}

        {/* Submit Button */}
        <button
          type="submit"
          disabled={
            isSubmitting ||
            !selectedWc ||
            !selectedSku ||
            (actualQtyNum <= 0 && ngQtyNum <= 0) ||
            isExceedingInputStock ||
            (allocationMode === "manual" && !selectedWoId)
          }
          className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded bg-accent text-white text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
        >
          {isSubmitting ? (
            "Đang xử lý phân bổ..."
          ) : (
            <>
              <span>Xác Nhận Báo Cáo Sản Lượng</span>
              <ArrowRight className="w-4 h-4" />
            </>
          )}
        </button>
      </form>
    </div>
  );
}
