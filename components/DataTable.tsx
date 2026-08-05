"use client";

import React, { useState, useMemo } from "react";
import { ArrowUpDown, ArrowUp, ArrowDown, RefreshCw } from "lucide-react";

export interface ColumnGroupDef {
  title: React.ReactNode;
  colSpan: number;
  headerClassName?: string;
}

export interface ColumnDef<T> {
  key: string;
  header: React.ReactNode;
  headerClassName?: string;
  className?: string;
  sortable?: boolean;
  sortValue?: (item: T) => string | number | boolean;
  render: (item: T, index: number) => React.ReactNode;
  align?: "left" | "center" | "right";
  width?: string;
  /** If true, this column is hidden by default in the hiddenColumns logic */
  defaultHidden?: boolean;
}

export interface DataTableProps<T> {
  data: T[];
  columns: ColumnDef<T>[];
  groupHeaders?: ColumnGroupDef[];
  getItemKey: (item: T) => string;

  /** Set of column keys to hide. Columns in this set are not rendered in header/cells. */
  hiddenColumns?: Set<string>;

  // Selection
  selectable?: boolean;
  selectedKeys?: Set<string>;
  onSelectionChange?: (keys: Set<string>) => void;

  // Sorting
  sortConfig?: { key: string; direction: "asc" | "desc" } | null;
  onSortChange?: (config: { key: string; direction: "asc" | "desc" } | null) => void;
  defaultSortKey?: string;
  defaultSortDirection?: "asc" | "desc";
  customSortHandler?: (a: T, b: T, key: string, direction: "asc" | "desc") => number;

  // Pagination
  enablePagination?: boolean;
  defaultPageSize?: number;
  pageSizeOptions?: number[];

  // Styling & Custom Empty
  emptyMessage?: React.ReactNode;
  isLoading?: boolean;
  loadingMessage?: React.ReactNode;
  className?: string;
  tableClassName?: string;
  zebra?: boolean;
  stickyHeader?: boolean;
  maxHeight?: string;
  getRowClassName?: (item: T, index: number, isSelected: boolean) => string;
}

export default function DataTable<T>({
  data,
  columns,
  groupHeaders,
  getItemKey,
  hiddenColumns,
  selectable = false,
  selectedKeys: controlledSelectedKeys,
  onSelectionChange,
  sortConfig: controlledSortConfig,
  onSortChange,
  defaultSortKey,
  defaultSortDirection = "asc",
  customSortHandler,
  enablePagination = false,
  defaultPageSize = 50,
  pageSizeOptions = [20, 50, 100, 200],
  emptyMessage = "Không có dữ liệu hiển thị.",
  isLoading = false,
  loadingMessage = "Đang tải dữ liệu...",
  className = "",
  tableClassName = "",
  zebra = true,
  stickyHeader = true,
  maxHeight,
  getRowClassName,
}: DataTableProps<T>) {
  // Internal selection state if not controlled
  const [internalSelectedKeys, setInternalSelectedKeys] = useState<Set<string>>(new Set());
  const selectedKeys = controlledSelectedKeys !== undefined ? controlledSelectedKeys : internalSelectedKeys;

  const handleSelectionChange = (nextKeys: Set<string>) => {
    if (onSelectionChange) {
      onSelectionChange(nextKeys);
    } else {
      setInternalSelectedKeys(nextKeys);
    }
  };

  // Internal sort state if not controlled
  const [internalSortConfig, setInternalSortConfig] = useState<{
    key: string;
    direction: "asc" | "desc";
  } | null>(defaultSortKey ? { key: defaultSortKey, direction: defaultSortDirection } : null);

  const sortConfig = controlledSortConfig !== undefined ? controlledSortConfig : internalSortConfig;

  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(defaultPageSize);

  const handleSortChange = (newConfig: { key: string; direction: "asc" | "desc" } | null) => {
    if (onSortChange) {
      onSortChange(newConfig);
    } else {
      setInternalSortConfig(newConfig);
    }
    setCurrentPage(1);
  };

  const handleHeaderClick = (column: ColumnDef<T>) => {
    if (!column.sortable) return;

    if (sortConfig && sortConfig.key === column.key) {
      if (sortConfig.direction === "asc") {
        handleSortChange({ key: column.key, direction: "desc" });
      } else {
        handleSortChange(null);
      }
    } else {
      handleSortChange({ key: column.key, direction: "asc" });
    }
  };

  // 1. Sort Data (With deterministic tie-breaker)
  const sortedData = useMemo(() => {
    const list = [...data];

    if (!sortConfig) {
      // Deterministic fallback by item key to prevent row jumps when unsorted
      if (getItemKey) {
        return list.sort((a, b) => getItemKey(a).localeCompare(getItemKey(b)));
      }
      return list;
    }

    const { key, direction } = sortConfig;
    const colDef = columns.find((c) => c.key === key);

    return list.sort((a, b) => {
      let cmp = 0;
      if (customSortHandler) {
        cmp = customSortHandler(a, b, key, direction);
      } else {
        let valA: any;
        let valB: any;

        if (colDef && colDef.sortValue) {
          valA = colDef.sortValue(a);
          valB = colDef.sortValue(b);
        } else {
          valA = (a as any)[key];
          valB = (b as any)[key];
        }

        const mult = direction === "asc" ? 1 : -1;

        if (typeof valA === "number" && typeof valB === "number") {
          cmp = (valA - valB) * mult;
        } else {
          const strA = String(valA || "").toLowerCase();
          const strB = String(valB || "").toLowerCase();
          cmp = strA.localeCompare(strB) * mult;
        }
      }

      // Tie-breaker: if equal under primary sort, fallback to getItemKey for 100% deterministic row order
      if (cmp === 0 && getItemKey) {
        return getItemKey(a).localeCompare(getItemKey(b));
      }
      return cmp;
    });
  }, [data, sortConfig, columns, customSortHandler, getItemKey]);

  // 2. Paginate Data
  const totalItems = sortedData.length;
  const totalPages = enablePagination ? Math.max(1, Math.ceil(totalItems / pageSize)) : 1;
  const safePage = Math.min(currentPage, totalPages);

  const displayedData = useMemo(() => {
    if (!enablePagination) return sortedData;
    const start = (safePage - 1) * pageSize;
    return sortedData.slice(start, start + pageSize);
  }, [sortedData, enablePagination, safePage, pageSize]);

  // Selection Checkbox Logic
  const displayedKeys = useMemo(() => displayedData.map(getItemKey), [displayedData, getItemKey]);
  const isAllSelected = displayedKeys.length > 0 && displayedKeys.every((k) => selectedKeys.has(k));
  const isSomeSelected = displayedKeys.some((k) => selectedKeys.has(k)) && !isAllSelected;

  const handleToggleAll = () => {
    const next = new Set(selectedKeys);
    if (isAllSelected) {
      displayedKeys.forEach((k) => next.delete(k));
    } else {
      displayedKeys.forEach((k) => next.add(k));
    }
    handleSelectionChange(next);
  };

  const handleToggleRow = (key: string) => {
    const next = new Set(selectedKeys);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    handleSelectionChange(next);
  };

  // Filter visible columns (excluding hidden ones)
  const visibleColumns = useMemo(() => {
    if (!hiddenColumns || hiddenColumns.size === 0) return columns;
    return columns.filter((col) => !hiddenColumns.has(col.key));
  }, [columns, hiddenColumns]);

  // Total Columns Count for colSpan (uses visible columns)
  const totalColSpan = visibleColumns.length + (selectable ? 1 : 0);

  // Mouse drag tracking to differentiate click vs text selection
  const mouseDownPosRef = React.useRef<{ x: number; y: number } | null>(null);

  return (
    <div className={`border border-border rounded bg-canvas overflow-hidden shadow-sm flex flex-col ${className}`}>
      {/* Scrollable Container */}
      <div className="overflow-x-auto overflow-y-auto" style={maxHeight ? { maxHeight } : undefined}>
        <table className={`w-full text-left text-xs border-collapse ${tableClassName}`}>
          <thead className={stickyHeader ? "sticky top-0 z-10 shadow-xs" : ""}>
            {/* Tier 1 Group Headers (Optional) */}
            {groupHeaders && groupHeaders.length > 0 && (
              <tr className="bg-subtle border-b border-border text-txt-secondary uppercase tracking-wider text-[10px] font-semibold select-none">
                {selectable && <th className="py-2 px-3 border-r border-border bg-subtle" />}
                {groupHeaders.map((gh, idx) => (
                  <th
                    key={`gh-${idx}`}
                    colSpan={gh.colSpan}
                    className={`py-2 px-3 text-center border-r border-border ${gh.headerClassName || ""}`}
                  >
                    {gh.title}
                  </th>
                ))}
              </tr>
            )}

            {/* Tier 2 Column Headers */}
            <tr className="bg-subtle border-b border-border text-txt-secondary text-[11px] font-semibold select-none">
              {selectable && (
                <th className="py-2.5 px-3 text-center border-r border-border w-10 bg-subtle">
                  <input
                    type="checkbox"
                    checked={isAllSelected}
                    ref={(input) => {
                      if (input) input.indeterminate = isSomeSelected;
                    }}
                    onChange={handleToggleAll}
                    className="rounded border-border cursor-pointer accent-accent"
                    title="Chọn / Bỏ chọn tất cả các dòng"
                  />
                </th>
              )}

              {visibleColumns.map((col) => {
                const alignClass =
                  col.align === "center"
                    ? "text-center"
                    : col.align === "right"
                    ? "text-right"
                    : "text-left";

                const isSorted = sortConfig && sortConfig.key === col.key;
                const sortDir = isSorted ? sortConfig.direction : null;

                return (
                  <th
                    key={col.key}
                    style={col.width ? { width: col.width } : undefined}
                    onClick={() => handleHeaderClick(col)}
                    className={`py-2.5 px-3 border-r border-border bg-subtle transition-colors ${alignClass} ${
                      col.sortable ? "cursor-pointer hover:bg-subtle/80" : ""
                    } ${col.headerClassName || ""}`}
                  >
                    <div
                      className={`flex items-center gap-1 ${
                        col.align === "center"
                          ? "justify-center"
                          : col.align === "right"
                          ? "justify-end"
                          : "justify-between"
                      }`}
                    >
                      <span>{col.header}</span>
                      {col.sortable && (
                        <span className="shrink-0 text-txt-secondary">
                          {sortDir === "asc" ? (
                            <ArrowUp className="w-3 h-3 text-accent" />
                          ) : sortDir === "desc" ? (
                            <ArrowDown className="w-3 h-3 text-accent" />
                          ) : (
                            <ArrowUpDown className="w-3 h-3 text-txt-secondary opacity-60" />
                          )}
                        </span>
                      )}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody className="divide-y divide-border">
            {isLoading ? (
              <tr>
                <td colSpan={totalColSpan} className="py-12 text-center text-txt-secondary">
                  <div className="flex flex-col items-center justify-center gap-2">
                    <RefreshCw className="w-5 h-5 animate-spin text-accent" />
                    <span>{loadingMessage}</span>
                  </div>
                </td>
              </tr>
            ) : displayedData.length === 0 ? (
              <tr>
                <td colSpan={totalColSpan} className="py-12 text-center text-txt-secondary">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              displayedData.map((item, idx) => {
                const key = getItemKey(item);
                const isSelected = selectedKeys.has(key);

                const customRowClass = getRowClassName ? getRowClassName(item, idx, isSelected) : "";
                const rowBgStyle = isSelected
                  ? "bg-accent/10 hover:bg-accent/20 border-l-2 border-l-accent"
                  : zebra && idx % 2 === 1
                  ? "bg-subtle/30 hover:bg-subtle/80"
                  : "bg-canvas hover:bg-subtle/60";

                return (
                  <tr
                    key={key}
                    onMouseDown={(e) => {
                      mouseDownPosRef.current = { x: e.clientX, y: e.clientY };
                    }}
                    onClick={(e) => {
                      if (!selectable) return;
                      if (mouseDownPosRef.current) {
                        const dx = Math.abs(e.clientX - mouseDownPosRef.current.x);
                        const dy = Math.abs(e.clientY - mouseDownPosRef.current.y);
                        if (dx > 4 || dy > 4) return;
                      }
                      handleToggleRow(key);
                    }}
                    className={`border-b border-border transition-colors text-txt-primary ${
                      selectable ? "cursor-pointer select-text" : ""
                    } ${rowBgStyle} ${customRowClass}`}
                  >
                    {selectable && (
                      <td
                        className="py-2.5 px-3 text-center border-r border-border w-10"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleToggleRow(key)}
                          className="rounded border-border cursor-pointer accent-accent"
                        />
                      </td>
                    )}

                    {visibleColumns.map((col) => {
                      const alignClass =
                        col.align === "center"
                          ? "text-center"
                          : col.align === "right"
                          ? "text-right"
                          : "text-left";

                      return (
                        <td
                          key={`${key}-${col.key}`}
                          className={`py-2.5 px-3 border-r border-border ${alignClass} ${col.className || ""}`}
                        >
                          {col.render(item, idx)}
                        </td>
                      );
                    })}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Controls Bar */}
      {enablePagination && totalItems > 0 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-3 bg-subtle/50 border-t border-border text-xs text-txt-secondary">
          <div className="flex flex-wrap items-center gap-3">
            <span>
              Hiển thị{" "}
              <strong className="text-txt-primary font-mono">
                {Math.min(totalItems, (safePage - 1) * pageSize + 1)}
              </strong>{" "}
              -{" "}
              <strong className="text-txt-primary font-mono">
                {Math.min(totalItems, safePage * pageSize)}
              </strong>{" "}
              trên tổng số <strong className="text-txt-primary font-mono">{totalItems}</strong> dòng
            </span>

            <div className="flex items-center gap-1.5">
              <span>Số dòng/trang:</span>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setCurrentPage(1);
                }}
                className="bg-canvas border border-border rounded px-2 py-1 text-xs text-txt-primary focus:outline-none cursor-pointer"
              >
                {pageSizeOptions.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt} dòng
                  </option>
                ))}
                <option value={100000}>Tất cả ({totalItems})</option>
              </select>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setCurrentPage(1)}
              disabled={safePage <= 1}
              className="px-2.5 py-1 rounded bg-canvas border border-border text-txt-primary hover:bg-subtle disabled:opacity-40 disabled:cursor-not-allowed text-xs font-medium transition-colors"
            >
              Đầu
            </button>
            <button
              type="button"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={safePage <= 1}
              className="px-2.5 py-1 rounded bg-canvas border border-border text-txt-primary hover:bg-subtle disabled:opacity-40 disabled:cursor-not-allowed text-xs font-medium transition-colors"
            >
              Trước
            </button>
            <span className="px-3 py-1 bg-subtle rounded border border-border font-mono font-semibold text-txt-primary">
              Trang {safePage} / {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={safePage >= totalPages}
              className="px-2.5 py-1 rounded bg-canvas border border-border text-txt-primary hover:bg-subtle disabled:opacity-40 disabled:cursor-not-allowed text-xs font-medium transition-colors"
            >
              Sau
            </button>
            <button
              type="button"
              onClick={() => setCurrentPage(totalPages)}
              disabled={safePage >= totalPages}
              className="px-2.5 py-1 rounded bg-canvas border border-border text-txt-primary hover:bg-subtle disabled:opacity-40 disabled:cursor-not-allowed text-xs font-medium transition-colors"
            >
              Cuối
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
