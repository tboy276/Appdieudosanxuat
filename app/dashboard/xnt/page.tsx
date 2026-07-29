"use client";

import { useState } from "react";
import useSWR from "swr";
import {
  CalendarDays,
  Search,
  RefreshCw,
  AlertTriangle,
  Layers,
  ArrowDownRight,
  ArrowUpRight,
  SlidersHorizontal,
} from "lucide-react";

interface StockBreakdown {
  tonPhoi: number;
  tonPhoiDauVao: number;
  tonBanThanhPham: number;
}

interface XNTItem {
  wcCode: string;
  sku: string;
  opening: StockBreakdown;
  nhap: StockBreakdown;
  xuat: StockBreakdown;
  closing: StockBreakdown;
}

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export default function XNTDashboardPage() {
  const [selectedDate, setSelectedDate] = useState<string>(
    new Date().toISOString().split("T")[0]
  );
  const [filterSku, setFilterSku] = useState("");
  const [lowStockThreshold, setLowStockThreshold] = useState<number>(50);

  const swrKey = `/api/xnt?date=${selectedDate}${
    filterSku ? `&sku=${encodeURIComponent(filterSku)}` : ""
  }`;

  const { data: report, error, isValidating, mutate } = useSWR<XNTItem[]>(
    swrKey,
    fetcher,
    {
      refreshInterval: 5000, // 5-second real-time polling
      revalidateOnFocus: true,
    }
  );

  const reportItems = Array.isArray(report) ? report : [];

  // Summary Metrics
  const totalPairs = reportItems.length;
  const totalOutputBTP = reportItems.reduce(
    (sum, item) => sum + (item.nhap.tonBanThanhPham || 0),
    0
  );
  const lowStockCount = reportItems.filter(
    (item) => item.closing.tonPhoiDauVao < lowStockThreshold
  ).length;

  return (
    <div className="space-y-6">
      {/* Top Summary Metrics Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-4 rounded bg-canvas border border-border flex items-center justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-txt-secondary">
              Tổng Số Cặp Xưởng - SKU
            </p>
            <p className="text-2xl font-extrabold text-txt-primary tabular-nums font-mono mt-1">
              {totalPairs}
            </p>
          </div>
          <div className="flex items-center justify-center w-9 h-9 rounded bg-subtle text-txt-primary">
            <Layers className="w-4 h-4" />
          </div>
        </div>

        <div className="p-4 rounded bg-canvas border border-border flex items-center justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-txt-secondary">
              Sản Lượng BTP Mới Tạo Trong Kỳ
            </p>
            <p className="text-2xl font-extrabold text-emerald-600 tabular-nums font-mono mt-1">
              +{totalOutputBTP.toLocaleString()} <span className="text-xs font-normal">pcs</span>
            </p>
          </div>
          <div className="flex items-center justify-center w-9 h-9 rounded bg-emerald-50 text-emerald-600">
            <ArrowUpRight className="w-4 h-4" />
          </div>
        </div>

        <div className="p-4 rounded bg-canvas border border-border flex items-center justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-txt-secondary">
              Xưởng Cảnh Báo Thiếu Phôi
            </p>
            <p className="text-2xl font-extrabold text-amber-600 tabular-nums font-mono mt-1">
              {lowStockCount} <span className="text-xs font-normal">cảnh báo</span>
            </p>
          </div>
          <div className="flex items-center justify-center w-9 h-9 rounded bg-amber-50 text-amber-600">
            <AlertTriangle className="w-4 h-4" />
          </div>
        </div>
      </div>

      {/* Action Header & Filters */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-4 rounded bg-canvas border border-border">
        <div className="flex flex-wrap items-center gap-3">
          {/* Date Picker Filter */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded bg-subtle border border-border text-xs text-txt-secondary">
            <CalendarDays className="w-4 h-4" />
            <span className="font-medium text-txt-primary">Kỳ ngày:</span>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="bg-transparent font-medium text-txt-primary focus:outline-none cursor-pointer"
            />
          </div>

          {/* SKU Combobox Search Filter */}
          <div className="relative flex items-center">
            <Search className="w-4 h-4 absolute left-2.5 text-txt-secondary" />
            <input
              type="text"
              placeholder="Tìm kiếm theo mã SKU..."
              value={filterSku}
              onChange={(e) => setFilterSku(e.target.value)}
              className="pl-8 pr-3 py-1.5 text-xs bg-subtle border border-border rounded text-txt-primary focus:outline-none focus:border-accent w-48 sm:w-64"
            />
          </div>

          {/* Threshold Config */}
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-subtle border border-border text-xs text-txt-secondary">
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span>Ngưỡng cảnh báo:</span>
            <input
              type="number"
              min="0"
              value={lowStockThreshold}
              onChange={(e) => setLowStockThreshold(Number(e.target.value) || 0)}
              className="w-14 bg-canvas border border-border rounded px-1.5 py-0.5 text-xs text-txt-primary text-center focus:outline-none"
            />
            <span>pcs</span>
          </div>

          {/* Manual Refresh & Polling Status */}
          <button
            onClick={() => mutate()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-subtle border border-border text-xs font-medium text-txt-primary hover:bg-border transition-colors"
            title="Làm mới dữ liệu (tự động cập nhật mỗi 5 giây)"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isValidating ? "animate-spin text-accent" : ""}`} />
            <span>Làm mới</span>
          </button>
        </div>

        <div className="flex items-center gap-2 text-xs text-txt-secondary">
          <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
          <span>Tự động cập nhật real-time (5s)</span>
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="p-3 rounded bg-amber-50 border border-amber-200 text-amber-800 text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
          <span>{error.message || "Đã xảy ra lỗi khi tải dữ liệu Xuất-Nhập-Tồn."}</span>
        </div>
      )}

      {/* Industrial Density XNT Data Table */}
      <div className="border border-border rounded bg-canvas overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs tabular-nums border-collapse">
            <thead>
              {/* Grouped Category Header */}
              <tr className="bg-subtle border-b border-border text-txt-secondary uppercase tracking-wider text-[10px] font-semibold">
                <th colSpan={2} className="py-2 px-4 border-r border-border">Thực Thể</th>
                <th colSpan={3} className="py-2 px-4 text-center border-r border-border bg-subtle/80">1. Tồn Đầu Kỳ</th>
                <th colSpan={3} className="py-2 px-4 text-center border-r border-border bg-emerald-50/40 text-emerald-700">2. Nhập Trong Kỳ</th>
                <th colSpan={3} className="py-2 px-4 text-center border-r border-border bg-amber-50/40 text-amber-700">3. Xuất Trong Kỳ</th>
                <th colSpan={3} className="py-2 px-4 text-center font-bold text-txt-primary bg-subtle/80">4. Tồn Cuối Kỳ</th>
              </tr>
              {/* Detail Column Header */}
              <tr className="bg-subtle/50 border-b border-border text-txt-secondary text-[11px] font-medium">
                <th className="py-2 px-4 border-r border-border">Xưởng</th>
                <th className="py-2 px-4 border-r border-border">SKU</th>

                {/* Opening */}
                <th className="py-2 px-3 text-right">Phôi</th>
                <th className="py-2 px-3 text-right">Phôi Vào</th>
                <th className="py-2 px-3 text-right border-r border-border">BTP</th>

                {/* Nhap */}
                <th className="py-2 px-3 text-right text-emerald-700">Phôi</th>
                <th className="py-2 px-3 text-right text-emerald-700">Phôi Vào</th>
                <th className="py-2 px-3 text-right border-r border-border text-emerald-700">BTP</th>

                {/* Xuat */}
                <th className="py-2 px-3 text-right text-amber-700">Phôi</th>
                <th className="py-2 px-3 text-right text-amber-700">Phôi Vào</th>
                <th className="py-2 px-3 text-right border-r border-border text-amber-700">BTP</th>

                {/* Closing */}
                <th className="py-2 px-3 text-right font-bold text-txt-primary">Phôi</th>
                <th className="py-2 px-3 text-right font-bold text-txt-primary">Phôi Vào</th>
                <th className="py-2 px-3 text-right font-bold text-txt-primary">BTP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {!report ? (
                <tr>
                  <td colSpan={14} className="py-12 text-center text-txt-secondary">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <RefreshCw className="w-5 h-5 animate-spin text-txt-secondary" />
                      <span>Đang tải dữ liệu Xuất-Nhập-Tồn...</span>
                    </div>
                  </td>
                </tr>
              ) : reportItems.length === 0 ? (
                <tr>
                  <td colSpan={14} className="py-12 text-center text-txt-secondary">
                    Chưa có giao dịch phát sinh hoặc chưa khởi tạo tồn kho cho ngày này.
                  </td>
                </tr>
              ) : (
                reportItems.map((item, idx) => {
                  const isLowStock = item.closing.tonPhoiDauVao < lowStockThreshold;

                  return (
                    <tr
                      key={`${item.wcCode}-${item.sku}-${idx}`}
                      className={`transition-colors ${
                        isLowStock ? "bg-amber-50/50 hover:bg-amber-50/80" : "hover:bg-subtle"
                      }`}
                    >
                      {/* Work Center */}
                      <td className="py-2.5 px-4 font-semibold text-txt-primary border-r border-border">
                        <div className="flex items-center gap-1.5">
                          {isLowStock && (
                            <span title={`Cảnh báo: Tồn phôi đầu vào (${item.closing.tonPhoiDauVao} pcs) thấp hơn ngưỡng ${lowStockThreshold} pcs`}>
                              <AlertTriangle className="w-3.5 h-3.5 text-warning shrink-0" />
                            </span>
                          )}
                          <span>{item.wcCode}</span>
                        </div>
                      </td>

                      {/* SKU */}
                      <td className="py-2.5 px-4 font-mono text-txt-secondary border-r border-border">
                        {item.sku}
                      </td>

                      {/* Opening */}
                      <td className="py-2.5 px-3 text-right text-txt-secondary font-mono">{item.opening.tonPhoi}</td>
                      <td className="py-2.5 px-3 text-right text-txt-secondary font-mono">{item.opening.tonPhoiDauVao}</td>
                      <td className="py-2.5 px-3 text-right text-txt-secondary font-mono border-r border-border">{item.opening.tonBanThanhPham}</td>

                      {/* Nhap */}
                      <td className="py-2.5 px-3 text-right font-medium text-emerald-600 font-mono">
                        {item.nhap.tonPhoi > 0 ? `+${item.nhap.tonPhoi}` : 0}
                      </td>
                      <td className="py-2.5 px-3 text-right font-medium text-emerald-600 font-mono">
                        {item.nhap.tonPhoiDauVao > 0 ? `+${item.nhap.tonPhoiDauVao}` : 0}
                      </td>
                      <td className="py-2.5 px-3 text-right font-medium text-emerald-600 font-mono border-r border-border">
                        {item.nhap.tonBanThanhPham > 0 ? `+${item.nhap.tonBanThanhPham}` : 0}
                      </td>

                      {/* Xuat */}
                      <td className="py-2.5 px-3 text-right font-medium text-amber-600 font-mono">
                        {item.xuat.tonPhoi > 0 ? `-${item.xuat.tonPhoi}` : 0}
                      </td>
                      <td className="py-2.5 px-3 text-right font-medium text-amber-600 font-mono">
                        {item.xuat.tonPhoiDauVao > 0 ? `-${item.xuat.tonPhoiDauVao}` : 0}
                      </td>
                      <td className="py-2.5 px-3 text-right font-medium text-amber-600 font-mono border-r border-border">
                        {item.xuat.tonBanThanhPham > 0 ? `-${item.xuat.tonBanThanhPham}` : 0}
                      </td>

                      {/* Closing */}
                      <td className="py-2.5 px-3 text-right font-bold text-txt-primary font-mono">{item.closing.tonPhoi}</td>
                      <td className={`py-2.5 px-3 text-right font-bold font-mono ${isLowStock ? "text-amber-700" : "text-txt-primary"}`}>
                        {item.closing.tonPhoiDauVao}
                      </td>
                      <td className="py-2.5 px-3 text-right font-bold text-txt-primary font-mono">{item.closing.tonBanThanhPham}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
