"use client";

import { useState, useEffect } from "react";
import { useSWRConfig } from "swr";
import {
  ArrowLeftRight,
  Factory,
  Package,
  ArrowRight,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
} from "lucide-react";
import { WorkCenter, Product } from "@/lib/types";

export default function PhoiTransferPage() {
  const { mutate } = useSWRConfig();

  const [workCenters, setWorkCenters] = useState<WorkCenter[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [xntData, setXntData] = useState<any[]>([]);

  const [fromCode, setFromCode] = useState<string>("");
  const [selectedSku, setSelectedSku] = useState<string>("");
  const [transferQty, setTransferQty] = useState<string>("");

  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [wcsRes, prodsRes, xntRes] = await Promise.all([
        fetch("/api/workcenters"),
        fetch("/api/products"),
        fetch("/api/xnt"),
      ]);

      if (wcsRes.ok) setWorkCenters(await wcsRes.json());
      if (prodsRes.ok) setProducts(await prodsRes.json());
      if (xntRes.ok) setXntData(await xntRes.json());
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const fromWcObj = workCenters.find((w) => w.code === fromCode);
  const isFirstStepFrom = Boolean(fromWcObj?.isFirstStep);

  const activeStockItems = xntData.filter((x) => {
    const wc = workCenters.find((w) => w.code === x.wcCode);
    if (wc?.isFirstStep) return x.closing?.tonPhoi > 0;
    return x.closing?.tonThanhPham > 0 || x.closing?.tonPhoi > 0;
  });

  const availableSourceCodes = Array.from(
    new Set(activeStockItems.map((x) => x.wcCode))
  );

  const availableSkusAtSource = activeStockItems
    .filter((x) => x.wcCode === fromCode)
    .map((x) => x.sku);

  const selectedXNT = xntData.find(
    (x) => x.wcCode === fromCode && x.sku === selectedSku
  );

  const maxAvailableStock = isFirstStepFrom
    ? selectedXNT?.closing?.tonPhoi || 0
    : selectedXNT?.closing?.tonThanhPham || 0;

  const stockLabel = isFirstStepFrom ? "Phôi" : "Thành Phẩm";

  const selectedProduct = products.find((p) => p.sku === selectedSku);
  let suggestedToCode = "";
  if (selectedProduct && selectedProduct.routing && fromCode) {
    const fromIndex = selectedProduct.routing.indexOf(fromCode);
    if (fromIndex !== -1 && fromIndex < selectedProduct.routing.length - 1) {
      suggestedToCode = selectedProduct.routing[fromIndex + 1];
    }
  }

  const qtyNum = Number(transferQty) || 0;
  const isExceedingStock = qtyNum > maxAvailableStock;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");
    setSuccessMsg("");

    if (!fromCode || !suggestedToCode || !selectedSku || qtyNum <= 0) {
      setErrorMsg("Vui lòng điền đầy đủ xưởng nguồn, SKU, xưởng đích và số lượng xuất chuyển (> 0).");
      return;
    }

    setIsSubmitting(true);

    try {
      const res = await fetch("/api/production/transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fromCode,
          toCode: suggestedToCode,
          sku: selectedSku,
          qty: qtyNum,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setErrorMsg(data.error || "Xuất chuyển thất bại.");
        setIsSubmitting(false);
        return;
      }

      setSuccessMsg(`Xuất chuyển thành công! Đã chuyển ${qtyNum} pcs từ ${fromCode} sang ${suggestedToCode}.`);
      setTransferQty("");
      setSelectedSku("");

      await Promise.all([
        mutate("/api/xnt"),
        mutate("/api/wo"),
        loadData(),
      ]);
    } catch {
      setErrorMsg("Không thể kết nối đến máy chủ. Vui lòng thử lại sau.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="p-4 rounded bg-canvas border border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ArrowLeftRight className="w-5 h-5 text-txt-secondary" />
          <h2 className="text-sm font-semibold text-txt-primary">Xuất Chuyển Sang Xưởng Kế Tiếp</h2>
        </div>
        <button
          onClick={loadData}
          className="p-1.5 rounded text-txt-secondary hover:text-txt-primary hover:bg-subtle transition-colors"
          title="Làm mới dữ liệu"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
        </button>
      </div>

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

      <form onSubmit={handleSubmit} className="p-6 bg-canvas border border-border rounded space-y-5">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-txt-secondary flex items-center gap-1.5">
            <Factory className="w-3.5 h-3.5" />
            <span>1. Chọn Xưởng Nguồn (*):</span>
          </label>
          <select
            value={fromCode}
            onChange={(e) => {
              setFromCode(e.target.value);
              setSelectedSku("");
            }}
            className="w-full px-3 py-2 text-sm bg-canvas border border-border rounded text-txt-primary focus:outline-none focus:border-accent"
          >
            <option value="">-- Chọn Xưởng Nguồn --</option>
            {workCenters.map((wc) => {
              const hasStock = availableSourceCodes.includes(wc.code);
              return (
                <option key={wc.code} value={wc.code} disabled={!hasStock}>
                  {wc.code} - {wc.name} {hasStock ? "(Có hàng sẵn)" : "(Không có hàng)"}
                </option>
              );
            })}
          </select>
        </div>

        {fromCode && (
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-txt-secondary flex items-center gap-1.5">
              <Package className="w-3.5 h-3.5" />
              <span>2. Chọn SKU Cần Chuyển (*):</span>
            </label>
            {availableSkusAtSource.length === 0 ? (
              <p className="text-xs text-txt-secondary py-2 italic">
                Xưởng {fromCode} hiện chưa có sẵn tồn kho cho bất kỳ SKU nào.
              </p>
            ) : (
              <select
                value={selectedSku}
                onChange={(e) => setSelectedSku(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-canvas border border-border rounded text-txt-primary focus:outline-none focus:border-accent font-mono"
              >
                <option value="">-- Chọn SKU --</option>
                {availableSkusAtSource.map((sku) => {
                  const x = xntData.find((item) => item.wcCode === fromCode && item.sku === sku);
                  const available = isFirstStepFrom ? x?.closing?.tonPhoi || 0 : x?.closing?.tonThanhPham || 0;
                  return (
                    <option key={sku} value={sku}>
                      {sku} | Tồn {stockLabel} Sẵn Có: {available} pcs
                    </option>
                  );
                })}
              </select>
            )}
          </div>
        )}

        {selectedSku && (
          <div className="p-4 rounded bg-subtle border border-border space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-txt-primary">Quy Trình (Routing) Của SKU {selectedSku}:</span>
              <span className="font-mono text-txt-secondary">
                {selectedProduct?.routing?.join(" → ") || "N/A"}
              </span>
            </div>

            <div className="flex items-center justify-between p-3 rounded bg-canvas border border-border text-xs">
              <div>
                <p className="text-[10px] text-txt-secondary uppercase">Xưởng Nguồn</p>
                <p className="font-bold text-txt-primary">{fromCode}</p>
              </div>

              <ArrowRight className="w-4 h-4 text-txt-secondary" />

              <div>
                <p className="text-[10px] text-txt-secondary uppercase">Xưởng Đích (Tự Động Theo Routing)</p>
                <p className={`font-bold ${suggestedToCode ? "text-emerald-600" : "text-warning"}`}>
                  {suggestedToCode || "Không có bước tiếp theo"}
                </p>
              </div>
            </div>
          </div>
        )}

        {selectedSku && suggestedToCode && (
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-txt-secondary">
              4. Nhập Số Lượng Xuất Chuyển (Tối đa {maxAvailableStock} pcs {stockLabel}) (*):
            </label>
            <input
              type="number"
              min="1"
              max={maxAvailableStock}
              required
              placeholder="Nhập số lượng pcs..."
              value={transferQty}
              onChange={(e) => setTransferQty(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-canvas border border-border rounded text-txt-primary focus:outline-none focus:border-accent font-mono"
            />
            {isExceedingStock && (
              <p className="text-xs text-warning flex items-center gap-1 font-medium mt-1">
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>Số lượng chuyển vượt quá tồn kho tại {fromCode} (chỉ có sẵn {maxAvailableStock} pcs {stockLabel}).</span>
              </p>
            )}
          </div>
        )}

        <button
          type="submit"
          disabled={isSubmitting || !suggestedToCode || qtyNum <= 0 || isExceedingStock}
          className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded bg-accent text-white text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {isSubmitting ? (
            "Đang xử lý..."
          ) : (
            <>
              <span>Xác Nhận Xuất Chuyển</span>
              <ArrowRight className="w-4 h-4" />
            </>
          )}
        </button>
      </form>
    </div>
  );
}
