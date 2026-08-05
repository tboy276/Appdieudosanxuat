"use client";

import React, { useState, useMemo } from "react";
import { GanttWOItem } from "@/lib/wo-postgres";
import { formatDateDisplay, daysBetween, getTodayVN } from "@/lib/date-utils";
import {
  Search,
  Filter,
  Layers,
  ArrowLeftRight,
  ChevronRight,
  Clock,
} from "lucide-react";

export type GanttStatusKey = "COMPLETED" | "IN_PROGRESS" | "NOT_STARTED" | "OVERDUE";

/**
 * 4-State Helper synchronized 100% with WO Flat Table
 */
export function getWOGanttStatus(
  item: GanttWOItem,
  todayStr: string
): { key: GanttStatusKey; label: string; pillBg: string; pillText: string; pillBorder: string } {
  const done = item.completedQty || 0;
  const plan = item.plannedQty || 1;
  const deadline = item.deadline;
  const isPastDeadline = deadline ? todayStr > deadline : false;

  // 1. Đã hoàn thành
  if (done >= plan && plan > 0) {
    if (item.actualEnd && deadline && item.actualEnd > deadline) {
      return {
        key: "OVERDUE",
        label: "Đã trễ deadline",
        pillBg: "bg-rose-50",
        pillText: "text-rose-700",
        pillBorder: "border-rose-200",
      };
    }
    return {
      key: "COMPLETED",
      label: "Đã hoàn thành",
      pillBg: "bg-blue-50",
      pillText: "text-blue-700",
      pillBorder: "border-blue-200",
    };
  }

  // 2. Đã trễ deadline
  if (isPastDeadline || item.isDelayed) {
    return {
      key: "OVERDUE",
      label: "Đã trễ deadline",
      pillBg: "bg-rose-50",
      pillText: "text-rose-700",
      pillBorder: "border-rose-200",
    };
  }

  // 3. Chưa bắt đầu
  if (done === 0 && !item.actualStart) {
    return {
      key: "NOT_STARTED",
      label: "Chưa bắt đầu",
      pillBg: "bg-slate-100",
      pillText: "text-slate-600",
      pillBorder: "border-slate-200",
    };
  }

  // 4. Đang sản xuất
  return {
    key: "IN_PROGRESS",
    label: "Đang sản xuất",
    pillBg: "bg-emerald-50",
    pillText: "text-emerald-700",
    pillBorder: "border-emerald-200",
  };
}

interface GanttChartViewProps {
  items: GanttWOItem[];
  isLoading: boolean;
  requiresFilter: boolean;
  totalCount: number;
  onSwitchToTable?: () => void;
}

interface TimelineDateHeader {
  dateStr: string;
  dayNumber: number;
  monthLabel: string | null;
  isToday: boolean;
}

export default function GanttChartView({
  items,
  isLoading,
  requiresFilter,
  totalCount,
  onSwitchToTable,
}: GanttChartViewProps) {
  const [localSearch, setLocalSearch] = useState("");
  const [hoveredWoId, setHoveredWoId] = useState<string | null>(null);
  const todayStr = getTodayVN();

  // Filter items by search query
  const filteredItems = useMemo(() => {
    if (!localSearch.trim()) return items;
    const q = localSearch.toLowerCase().trim();
    return items.filter((item) => {
      const woNum = (item.woNumber || item.id || "").toLowerCase();
      const poNum = (item.poNumber || "").toLowerCase();
      const sku = (item.sku || "").toLowerCase();
      const cust = (item.customerName || "").toLowerCase();
      const ws = (item.workshopCode || item.workshopName || "").toLowerCase();
      return (
        woNum.includes(q) ||
        poNum.includes(q) ||
        sku.includes(q) ||
        cust.includes(q) ||
        ws.includes(q)
      );
    });
  }, [items, localSearch]);

  // Calculate timeline date boundaries
  const { minDateStr, totalDays, datesHeader } = useMemo(() => {
    if (items.length === 0) {
      const minStr = getTodayVN(-5);
      const numDays = 24;
      return {
        minDateStr: minStr,
        totalDays: numDays,
        datesHeader: generateTimelineDates(minStr, numDays, todayStr),
      };
    }

    let minT = new Date(todayStr).getTime();
    let maxT = new Date(todayStr).getTime();

    items.forEach((item) => {
      if (item.plannedStart) {
        const t = new Date(item.plannedStart).getTime();
        if (!isNaN(t) && t < minT) minT = t;
      }
      if (item.deadline) {
        const t = new Date(item.deadline).getTime();
        if (!isNaN(t) && t > maxT) maxT = t;
      }
      if (item.actualStart) {
        const t = new Date(item.actualStart).getTime();
        if (!isNaN(t) && t < minT) minT = t;
      }
      if (item.actualEnd) {
        const t = new Date(item.actualEnd).getTime();
        if (!isNaN(t) && t > maxT) maxT = t;
      }
    });

    // Buffer 3 days before min, 5 days after max for spacious timeline
    const minD = new Date(minT - 3 * 24 * 60 * 60 * 1000);
    const maxD = new Date(maxT + 5 * 24 * 60 * 60 * 1000);

    const minStr = minD.toISOString().slice(0, 10);
    const maxStr = maxD.toISOString().slice(0, 10);
    const numDays = Math.max(16, daysBetween(minStr, maxStr) + 1);

    return {
      minDateStr: minStr,
      totalDays: numDays,
      datesHeader: generateTimelineDates(minStr, numDays, todayStr),
    };
  }, [items, todayStr]);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center p-16 rounded-xl border border-slate-200 bg-white shadow-sm animate-pulse">
        <Clock className="w-8 h-8 text-slate-400 animate-spin mb-3" />
        <p className="text-sm font-medium text-slate-600">Đang tải biểu đồ Gantt tiến độ...</p>
      </div>
    );
  }

  if (requiresFilter) {
    return (
      <div className="p-10 rounded-xl border border-slate-200 bg-white flex flex-col items-center text-center shadow-sm">
        <div className="p-3 rounded-full bg-slate-100 border border-slate-200 mb-3">
          <Filter className="w-6 h-6 text-slate-600" />
        </div>
        <h3 className="text-base font-bold text-slate-800 mb-1">Vui lòng áp dụng bộ lọc</h3>
        <p className="text-xs text-slate-500 max-w-md mb-4">
          Hệ thống đang có <span className="font-semibold text-slate-700">{totalCount} Lệnh WO</span>. Vui lòng chọn Khách hàng, Xưởng hoặc tìm kiếm WO/PO để hiển thị tối ưu.
        </p>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="p-12 rounded-xl border border-slate-200 bg-white text-center shadow-sm">
        <Layers className="w-10 h-10 text-slate-300 mx-auto mb-2" />
        <p className="text-slate-500 text-sm font-medium">Không tìm thấy Lệnh sản xuất nào phù hợp.</p>
      </div>
    );
  }

  const pxPerDay = 40;
  const timelineWidth = totalDays * pxPerDay;
  const leftColWidth = 220; // 220px width for Task info column

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm flex flex-col space-y-4 text-slate-800">
      {/* Top Bar matching exact mockup */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 px-6 pt-5 pb-3">
        <div className="flex items-center gap-3">
          <h2 className="text-base font-bold text-slate-900 tracking-tight">
            Tiến Độ Lệnh Sản Xuất
          </h2>
          <span className="text-xs font-medium text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full border border-slate-200">
            {filteredItems.length} WO
          </span>
        </div>

        <div className="flex items-center gap-3 w-full sm:w-auto">
          {/* Search Box with clean pill border */}
          <div className="relative flex-1 sm:w-64">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={localSearch}
              onChange={(e) => setLocalSearch(e.target.value)}
              placeholder="Tìm WO, PO, SKU..."
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400 transition-all"
            />
          </div>

          {/* Minimalist Switch to Table View Button */}
          {onSwitchToTable && (
            <button
              onClick={onSwitchToTable}
              className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg transition-colors flex items-center gap-1.5 shrink-0 shadow-xs"
              title="Chuyển sang chế độ xem bảng phẳng"
            >
              <ArrowLeftRight className="w-3.5 h-3.5 text-slate-500" />
              <span>Xem Bảng</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Gantt Grid Container */}
      <div className="border-t border-slate-100 overflow-x-auto">
        <div className="min-w-max flex flex-col">
          {/* Timeline Header */}
          <div className="flex border-b border-slate-200 bg-slate-50/50 sticky top-0 z-20">
            {/* Left Column Header */}
            <div
              style={{ width: `${leftColWidth}px` }}
              className="p-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400 border-r border-slate-100 sticky left-0 z-30 bg-slate-50/90 backdrop-blur-xs flex items-center"
            >
              TASK
            </div>

            {/* Right Date Columns Header */}
            <div className="flex relative" style={{ width: `${timelineWidth}px` }}>
              {datesHeader.map((d, idx) => (
                <div
                  key={idx}
                  style={{ width: `${pxPerDay}px` }}
                  className="border-r border-slate-100 py-2 flex flex-col items-center justify-center text-center select-none"
                >
                  {/* Month Label (e.g. Jul, Aug) */}
                  <span className="text-[10px] font-medium text-slate-400 h-3.5 leading-none">
                    {d.monthLabel || ""}
                  </span>

                  {/* Day Number or Highlighted Black Circle for Today */}
                  <div className="mt-1 flex items-center justify-center">
                    {d.isToday ? (
                      <div
                        className="w-5 h-5 rounded-full bg-slate-900 text-white font-bold text-[11px] flex items-center justify-center shadow-xs"
                        title="Hôm nay"
                      >
                        {d.dayNumber}
                      </div>
                    ) : (
                      <span className="text-xs font-medium text-slate-600">
                        {d.dayNumber}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Gantt Rows */}
          <div className="divide-y divide-slate-100 relative">
            {filteredItems.map((item, index) => {
              const statusObj = getWOGanttStatus(item, todayStr);
              const plannedStartDays = daysBetween(minDateStr, item.plannedStart);
              const deadlineDays = daysBetween(minDateStr, item.deadline);
              const plannedWidthDays = Math.max(1, deadlineDays - plannedStartDays + 1);

              const plannedLeftPx = Math.max(0, plannedStartDays * pxPerDay);
              const plannedWidthPx = plannedWidthDays * pxPerDay;

              // Actual Bar Calculations
              let actualLeftPx = plannedLeftPx;
              let actualWidthPx = 0;
              let hasOverrun = false;
              let normalActualWidthPx = 0;
              let overrunWidthPx = 0;

              if (item.actualStart) {
                const actualStartDays = daysBetween(minDateStr, item.actualStart);
                actualLeftPx = Math.max(0, actualStartDays * pxPerDay);

                const actualEndStr = item.actualEnd || todayStr;
                const actualEndDays = daysBetween(minDateStr, actualEndStr);
                const actualDurationDays = Math.max(1, actualEndDays - actualStartDays + 1);
                actualWidthPx = actualDurationDays * pxPerDay;

                // Check if actual bar exceeds deadline
                if (actualEndDays > deadlineDays) {
                  hasOverrun = true;
                  const plannedEndRightPx = plannedLeftPx + plannedWidthPx;
                  const actualRightPx = actualLeftPx + actualWidthPx;
                  const overrunStartPx = Math.max(actualLeftPx, plannedEndRightPx);
                  overrunWidthPx = Math.max(0, actualRightPx - overrunStartPx);
                  normalActualWidthPx = Math.max(0, actualWidthPx - overrunWidthPx);
                } else {
                  normalActualWidthPx = actualWidthPx;
                }
              }

              // Color for Actual Inset Bar matching design system
              let actualBarColor = "bg-emerald-500";
              if (statusObj.key === "COMPLETED") actualBarColor = "bg-blue-500";
              if (statusObj.key === "OVERDUE") actualBarColor = "bg-rose-500";
              if (statusObj.key === "IN_PROGRESS") actualBarColor = "bg-emerald-500";

              const woDisplayCode = item.woNumber || item.id || `WO-${index + 1}`;
              const plannedRangeText = `${formatShortDate(item.plannedStart)} - ${formatShortDate(item.deadline)}`;

              return (
                <div
                  key={item.id}
                  onMouseEnter={() => setHoveredWoId(item.id)}
                  onMouseLeave={() => setHoveredWoId(null)}
                  className="flex items-center hover:bg-slate-50/80 transition-colors group relative"
                >
                  {/* Left Task Info Area */}
                  <div
                    style={{ width: `${leftColWidth}px` }}
                    className="p-3 border-r border-slate-100 sticky left-0 z-20 bg-white group-hover:bg-slate-50/90 flex flex-col justify-center shrink-0"
                  >
                    {/* Status Pill Badge */}
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${statusObj.pillBg} ${statusObj.pillText} ${statusObj.pillBorder}`}
                      >
                        {statusObj.label}
                      </span>
                      <span className="text-[10px] font-medium text-slate-400">
                        {item.workshopCode}
                      </span>
                    </div>

                    {/* Bold WO Code */}
                    <span className="text-xs font-bold text-slate-800 tracking-tight mt-1 truncate">
                      {woDisplayCode}
                    </span>

                    {/* Subtitle Date Range: Planned Start → Deadline */}
                    <span className="text-[11px] text-slate-400 font-normal mt-0.5 truncate">
                      {plannedRangeText}
                    </span>
                  </div>

                  {/* Right Timeline Bar Area */}
                  <div
                    className="flex-1 relative py-3"
                    style={{ width: `${timelineWidth}px`, minHeight: "56px" }}
                  >
                    {/* Subtle Background Grid Lines */}
                    <div className="absolute inset-0 flex pointer-events-none">
                      {datesHeader.map((_, i) => (
                        <div
                          key={i}
                          style={{ width: `${pxPerDay}px` }}
                          className="border-r border-slate-100 h-full"
                        />
                      ))}
                    </div>

                    {/* 1. PLANNED BACKGROUND BAR (Thanh Kế Hoạch Bo Góc Xám Nhạt) */}
                    <div
                      className="absolute top-2.5 bottom-2.5 rounded-lg bg-[#F1F2F4] border border-slate-200/90 transition-all flex items-center px-3 overflow-hidden shadow-2xs"
                      style={{
                        left: `${plannedLeftPx}px`,
                        width: `${plannedWidthPx}px`,
                      }}
                    >
                      {/* WO Name Label on Plan Bar when not started */}
                      {!item.actualStart && (
                        <span className="text-xs font-semibold text-slate-600 truncate select-none">
                          {woDisplayCode}
                        </span>
                      )}
                    </div>

                    {/* 2. ACTUAL INSET BAR (Thanh Thực Tế Lồng Bên Trong) */}
                    {item.actualStart && (
                      <div
                        className="absolute top-3.5 bottom-3.5 flex transition-all z-10 rounded-md overflow-hidden shadow-xs"
                        style={{
                          left: `${actualLeftPx}px`,
                          width: `${Math.max(24, actualWidthPx)}px`,
                        }}
                      >
                        {/* Normal Section (Within Planned Range) */}
                        <div
                          className={`h-full ${actualBarColor} flex items-center px-2.5 text-white font-semibold text-[11px] truncate`}
                          style={{
                            width: hasOverrun ? `${normalActualWidthPx}px` : "100%",
                          }}
                        >
                          <span className="truncate drop-shadow-2xs">
                            {woDisplayCode} {item.completedQty > 0 ? `(${item.progressPercent}%)` : ""}
                          </span>
                        </div>

                        {/* Overrun Section Past Deadline (Vượt deadline đổi màu đỏ đậm) */}
                        {hasOverrun && overrunWidthPx > 0 && (
                          <div
                            className="h-full bg-rose-600 flex items-center justify-center px-1.5 text-white font-bold text-[10px] shrink-0"
                            style={{ width: `${overrunWidthPx}px` }}
                            title="Vượt quá hạn chót (Deadline Overrun)"
                          >
                            <span className="truncate">Trễ</span>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Hover Tooltip Popup */}
                    {hoveredWoId === item.id && (
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-72 p-3 rounded-lg border border-slate-200 bg-slate-900 text-white shadow-xl text-xs z-40 pointer-events-none animate-in fade-in zoom-in-95">
                        <div className="flex items-center justify-between pb-1.5 mb-1.5 border-b border-slate-800">
                          <span className="font-bold text-white">{item.woNumber || item.id}</span>
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-semibold text-white ${
                              statusObj.key === "COMPLETED"
                                ? "bg-blue-600"
                                : statusObj.key === "IN_PROGRESS"
                                ? "bg-emerald-600"
                                : statusObj.key === "NOT_STARTED"
                                ? "bg-slate-600"
                                : "bg-rose-600"
                            }`}
                          >
                            {statusObj.label}
                          </span>
                        </div>
                        <div className="space-y-1 text-slate-300">
                          <p>
                            <span className="text-slate-400">Khách hàng:</span> {item.customerName || "Khách lẻ"}
                          </p>
                          <p>
                            <span className="text-slate-400">SKU:</span> {item.sku} ({item.productNameVi})
                          </p>
                          <p>
                            <span className="text-slate-400">Xưởng:</span> {item.workshopName} ({item.workshopCode})
                          </p>
                          <p>
                            <span className="text-slate-400">Sản lượng:</span> {item.completedQty.toLocaleString()} / {item.plannedQty.toLocaleString()} ({item.progressPercent}%)
                          </p>
                          <p>
                            <span className="text-slate-400">Kế hoạch:</span> {formatDateDisplay(item.plannedStart)} → {formatDateDisplay(item.deadline)}
                          </p>
                          <p>
                            <span className="text-slate-400">Thực tế:</span> {formatDateDisplay(item.actualStart)} → {item.actualEnd ? formatDateDisplay(item.actualEnd) : "Đang sản xuất"}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Minimalist Legend Footer */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-6 py-3 border-t border-slate-100 text-xs text-slate-500">
        <div className="flex flex-wrap items-center gap-5">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-slate-300 inline-block" />
            <span className="text-slate-600">Chưa bắt đầu</span>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" />
            <span className="text-slate-600">Đang sản xuất</span>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-blue-500 inline-block" />
            <span className="text-slate-600">Đã hoàn thành</span>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500 inline-block" />
            <span className="text-slate-600">Đã trễ deadline</span>
          </div>
        </div>

        <div className="text-[11px] text-slate-400 flex items-center gap-1">
          <span>Thanh xám = Kế hoạch | Thanh màu = Tiến độ thực tế</span>
        </div>
      </div>
    </div>
  );
}

/**
 * Generate formatted short date "28/07" or "Jul 28"
 */
function formatShortDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "--";
  const parts = dateStr.slice(0, 10).split("-");
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}`;
  }
  return dateStr;
}

/**
 * Generate dates for timeline header
 */
function generateTimelineDates(
  startStr: string,
  totalDays: number,
  todayStr: string
): TimelineDateHeader[] {
  const dates: TimelineDateHeader[] = [];
  const currDate = new Date(startStr);
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  for (let i = 0; i < totalDays; i++) {
    const dStr = currDate.toISOString().slice(0, 10);
    const dayNumber = currDate.getDate();
    const monthIndex = currDate.getMonth();
    const isToday = dStr === todayStr;

    // Show month label if 1st column or 1st day of month
    let monthLabel: string | null = null;
    if (i === 0 || dayNumber === 1) {
      monthLabel = monthNames[monthIndex];
    }

    dates.push({
      dateStr: dStr,
      dayNumber,
      monthLabel,
      isToday,
    });

    currDate.setDate(currDate.getDate() + 1);
  }

  return dates;
}
