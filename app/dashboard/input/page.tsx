"use client";

import { useState, useEffect } from "react";
import { useSWRConfig } from "swr";
import {
  Factory,
  Layers,
  ArrowRight,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
} from "lucide-react";
import { WorkCenter, Product } from "@/lib/types";
import { WO } from "@/lib/po-wo-engine";

export default function ProductionInputPage() {
  const { mutate } = useSWRConfig();

  const [workCenters, setWorkCenters] = useState<WorkCenter[]>([]);
  const [wos, setWOs] = useState<WO[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [xntData, setXntData] = useState<any[]>([]);

  const [selectedWc, setSelectedWc] = useState<string>("");
  const [selectedWoId, setSelectedWoId] = useState<string>("");
  const [actualQty, setActualQty] = useState<string>("");

  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

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

  // Filter WOs matching selected WorkCenter
  const availableWOs = wos.filter((wo) => {
    if (!selectedWc) return false;
    const step = wo.steps?.find((s) => s.code === selectedWc);
    return Boolean(step && step.status !== "DONE" && wo.status !== "SHIPPED");
  });

  const selectedWoObj = wos.find((w) => w.woId === selectedWoId);
  const currentStep = selectedWoObj?.steps?.find((s) => s.code === selectedWc);

  // Find stock state for (selectedWc, selectedWoObj.sku) from XNT data
  const currentXNT = xntData.find(
    (x) => x.wcCode === selectedWc && x.sku === selectedWoObj?.sku
  );

  const availablePhoiInput = isFirstStepWc
    ? Number.MAX_SAFE_INTEGER
    : currentXNT?.closing?.tonPhoi || 0;

  const inputQtyNum = Number(actualQty) || 0;
  const isExceedingInputStock = !isFirstStepWc && inputQtyNum > availablePhoiInput;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");
    setSuccessMsg("");

    if (!selectedWc || !selectedWoObj || inputQtyNum <= 0) {
      setErrorMsg("Vui lòng điền đầy đủ xưởng, Lệnh sản xuất và sản lượng (> 0).");
      return;
    }

    setIsSubmitting(true);

    try {
      const res = await fetch("/api/production/input", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wcCode: selectedWc,
          sku: selectedWoObj.sku,
          woId: selectedWoObj.woId,
          actualQty: inputQtyNum,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        // Display exact server error message
        setErrorMsg(data.error || "Nhập sản lượng thất bại.");
        setIsSubmitting(false);
        return;
      }

      setSuccessMsg(`Nhập sản lượng thành công! Đã ghi nhận ${inputQtyNum} pcs cho WO ${selectedWoObj.woId}.`);
      setActualQty("");
      setSelectedWoId("");

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
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Title & Instructions */}
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

      {successMsg && (
        <div className="p-3 rounded bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Input Form */}
      <form onSubmit={handleSubmit} className="p-6 bg-canvas border border-border rounded space-y-5">
        {/* Step 1: Select Work Center */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-txt-secondary flex items-center gap-1.5">
            <Factory className="w-3.5 h-3.5" />
            <span>1. Chọn Xưởng Báo Cáo (*):</span>
          </label>
          <select
            value={selectedWc}
            onChange={(e) => {
              setSelectedWc(e.target.value);
              setSelectedWoId("");
            }}
            className="w-full px-3 py-2 text-sm bg-canvas border border-border rounded text-txt-primary focus:outline-none focus:border-accent"
          >
            <option value="">-- Chọn Xưởng Sản Xuất --</option>
            {workCenters.map((wc) => (
              <option key={wc.code} value={wc.code}>
                {wc.code} - {wc.name} {wc.isFirstStep ? "(Tạo Phôi Đầu Chuỗi)" : ""}
              </option>
            ))}
          </select>
        </div>

        {/* Step 2: Select Work Order (WO) */}
        {selectedWc && (
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-txt-secondary flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5" />
              <span>2. Chọn Lệnh Sản Xuất (WO) (*):</span>
            </label>
            {availableWOs.length === 0 ? (
              <p className="text-xs text-txt-secondary py-2 italic">
                Không có WO nào đang chờ sản xuất (PENDING) tại xưởng {selectedWc}.
              </p>
            ) : (
              <select
                value={selectedWoId}
                onChange={(e) => setSelectedWoId(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-canvas border border-border rounded text-txt-primary focus:outline-none focus:border-accent"
              >
                <option value="">-- Chọn WO Cần Báo Cáo --</option>
                {availableWOs.map((wo) => {
                  const st = wo.steps?.find((s) => s.code === selectedWc);
                  return (
                    <option key={wo.woId} value={wo.woId}>
                      {wo.woId} | SKU: {wo.sku} | Kế hoạch: {st?.plannedQty || 0} pcs (Đã làm: {st?.actualQty || 0} pcs)
                    </option>
                  );
                })}
              </select>
            )}
          </div>
        )}

        {/* Progress & Availability Card */}
        {selectedWoObj && currentStep && (
          <div className="p-4 rounded bg-subtle border border-border space-y-2 text-xs">
            <div className="flex items-center justify-between border-b border-border pb-2">
              <span className="font-semibold text-txt-primary">Thông Tin Tiến Độ Bước {selectedWc}</span>
              <span className="font-mono text-txt-secondary">SKU: {selectedWoObj.sku}</span>
            </div>

            <div className="grid grid-cols-3 gap-2 text-center pt-1">
              <div className="p-2 rounded bg-canvas border border-border">
                <p className="text-[10px] text-txt-secondary uppercase">Kế Hoạch (Planned)</p>
                <p className="text-sm font-bold text-txt-primary font-mono mt-0.5">{currentStep.plannedQty} pcs</p>
              </div>
              <div className="p-2 rounded bg-canvas border border-border">
                <p className="text-[10px] text-txt-secondary uppercase">Đã Làm (Actual)</p>
                <p className="text-sm font-bold text-emerald-600 font-mono mt-0.5">{currentStep.actualQty} pcs</p>
              </div>
              <div className="p-2 rounded bg-canvas border border-border">
                <p className="text-[10px] text-txt-secondary uppercase">Khả Dụng Phôi</p>
                <p className={`text-sm font-bold font-mono mt-0.5 ${isFirstStepWc ? "text-blue-600" : isExceedingInputStock ? "text-warning" : "text-txt-primary"}`}>
                  {isFirstStepWc ? "Vô tận (NVL)" : `${availablePhoiInput} pcs`}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Step 3: Input Actual Quantity */}
        {selectedWoId && (
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-txt-secondary">
              3. Nhập Sản Lượng Thực Tế Đạt Được (actualQty) (*):
            </label>
            <input
              type="number"
              min="1"
              required
              placeholder="Nhập số lượng pcs..."
              value={actualQty}
              onChange={(e) => setActualQty(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-canvas border border-border rounded text-txt-primary focus:outline-none focus:border-accent font-mono"
            />
            {isExceedingInputStock && (
              <p className="text-xs text-warning flex items-center gap-1 font-medium mt-1">
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>Sản lượng vượt quá phôi có sẵn tại xưởng (tối đa {availablePhoiInput} pcs).</span>
              </p>
            )}
          </div>
        )}

        {/* Submit Button */}
        <button
          type="submit"
          disabled={isSubmitting || !selectedWoId || inputQtyNum <= 0 || isExceedingInputStock}
          className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded bg-accent text-white text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {isSubmitting ? (
            "Đang xử lý..."
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
