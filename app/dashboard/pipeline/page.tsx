"use client";

import { useState } from "react";
import useSWR from "swr";
import {
  Workflow,
  Search,
  Filter,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Package,
  Layers,
  Truck,
  AlertCircle,
  CheckCircle2,
  AlertTriangle,
  Factory,
} from "lucide-react";

interface PipelineStep {
  code: string;
  tonPhoi: number;
  tonThanhPham: number;
  woPlanned?: number;
  woActual?: number;
  woStatus?: string;
}

interface POPipelineItem {
  poId: string;
  poNumber: string;
  customerName: string;
  sku: string;
  productNameVi: string;
  targetQty: number;
  shippedQty: number;
  remainingQty: number;
  lrReadyQty: number;
  totalPhoiWIP: number;
  totalThanhPhamWIP: number;
  coverageStatus: "SUFFICIENT" | "WIP_COVERED" | "SHORTAGE";
  routing: string[];
  steps: PipelineStep[];
  linkedWos: { woId: string; status: string }[];
}

interface CustomerPipelineGroup {
  customerName: string;
  activePoCount: number;
  items: POPipelineItem[];
}

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export default function POPipelineViewPage() {
  const { data: customerGroups, error, isValidating, mutate } = useSWR<CustomerPipelineGroup[]>(
    "/api/reports/po-pipeline",
    fetcher,
    {
      refreshInterval: 5000,
      revalidateOnFocus: true,
    }
  );

  const [searchTerm, setSearchTerm] = useState("");
  const [coverageFilter, setCoverageFilter] = useState<string>("ALL");
  const [expandedCustomers, setExpandedCustomers] = useState<Record<string, boolean>>({});
  const [expandedPOs, setExpandedPOs] = useState<Record<string, boolean>>({});

  const groups = Array.isArray(customerGroups) ? customerGroups : [];

  const toggleCustomer = (custName: string) => {
    setExpandedCustomers((prev) => ({
      ...prev,
      [custName]: prev[custName] === undefined ? false : !prev[custName],
    }));
  };

  const togglePO = (poId: string) => {
    setExpandedPOs((prev) => ({
      ...prev,
      [poId]: !prev[poId],
    }));
  };

  const filteredGroups = groups
    .map((grp) => {
      const filteredItems = grp.items.filter((item) => {
        if (coverageFilter !== "ALL" && item.coverageStatus !== coverageFilter) {
          return false;
        }

        if (searchTerm.trim()) {
          const term = searchTerm.toLowerCase();
          const matchCust = item.customerName.toLowerCase().includes(term);
          const matchPo = item.poNumber.toLowerCase().includes(term);
          const matchSku = item.sku.toLowerCase().includes(term);
          const matchProdName = item.productNameVi.toLowerCase().includes(term);
          if (!matchCust && !matchPo && !matchSku && !matchProdName) {
            return false;
          }
        }

        return true;
      });

      return {
        ...grp,
        activePoCount: filteredItems.length,
        items: filteredItems,
      };
    })
    .filter((grp) => grp.items.length > 0);

  const allFilteredItems = filteredGroups.flatMap((g) => g.items);
  const countSufficient = allFilteredItems.filter((i) => i.coverageStatus === "SUFFICIENT").length;
  const countWipCovered = allFilteredItems.filter((i) => i.coverageStatus === "WIP_COVERED").length;
  const countShortage = allFilteredItems.filter((i) => i.coverageStatus === "SHORTAGE").length;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className="p-4 rounded bg-canvas border border-border flex items-center justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-txt-secondary">
              Đơn Hàng Active (PO)
            </p>
            <p className="text-2xl font-extrabold text-txt-primary tabular-nums font-mono mt-1">
              {allFilteredItems.length}
            </p>
          </div>
          <div className="flex items-center justify-center w-9 h-9 rounded bg-subtle text-txt-primary">
            <Workflow className="w-4 h-4" />
          </div>
        </div>

        <div className="p-4 rounded bg-canvas border border-border flex items-center justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-txt-secondary">
              Sẵn Sàng Xuất Hàng
            </p>
            <p className="text-2xl font-extrabold text-emerald-600 tabular-nums font-mono mt-1">
              {countSufficient} <span className="text-xs font-normal">PO</span>
            </p>
          </div>
          <div className="flex items-center justify-center w-9 h-9 rounded bg-emerald-50 text-emerald-600">
            <CheckCircle2 className="w-4 h-4" />
          </div>
        </div>

        <div className="p-4 rounded bg-canvas border border-border flex items-center justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-txt-secondary">
              Đủ WIP (Đang Gia Công)
            </p>
            <p className="text-2xl font-extrabold text-amber-600 tabular-nums font-mono mt-1">
              {countWipCovered} <span className="text-xs font-normal">PO</span>
            </p>
          </div>
          <div className="flex items-center justify-center w-9 h-9 rounded bg-amber-50 text-amber-600">
            <AlertTriangle className="w-4 h-4" />
          </div>
        </div>

        <div className="p-4 rounded bg-canvas border border-border flex items-center justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-txt-secondary">
              Cảnh Báo Thiếu Phôi / Hàng
            </p>
            <p className="text-2xl font-extrabold text-rose-600 tabular-nums font-mono mt-1">
              {countShortage} <span className="text-xs font-normal">PO</span>
            </p>
          </div>
          <div className="flex items-center justify-center w-9 h-9 rounded bg-rose-50 text-rose-600">
            <AlertCircle className="w-4 h-4" />
          </div>
        </div>
      </div>

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-4 rounded bg-canvas border border-border">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex items-center">
            <Search className="w-4 h-4 absolute left-2.5 text-txt-secondary" />
            <input
              type="text"
              placeholder="Tìm theo Khách hàng, PO, SKU..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-8 pr-3 py-1.5 text-xs bg-subtle border border-border rounded text-txt-primary focus:outline-none focus:border-accent w-64"
            />
          </div>

          <div className="flex items-center gap-2 px-3 py-1.5 rounded bg-subtle border border-border text-xs text-txt-secondary">
            <Filter className="w-3.5 h-3.5" />
            <span>Trạng thái hàng:</span>
            <select
              value={coverageFilter}
              onChange={(e) => setCoverageFilter(e.target.value)}
              className="bg-transparent font-medium text-txt-primary focus:outline-none cursor-pointer"
            >
              <option value="ALL">Tất cả trạng thái</option>
              <option value="SUFFICIENT">Sẵn sàng xuất (SUFFICIENT)</option>
              <option value="WIP_COVERED">Cần gia công (WIP_COVERED)</option>
              <option value="SHORTAGE">Thiếu phôi / hàng (SHORTAGE)</option>
            </select>
          </div>

          <button
            onClick={() => mutate()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-subtle border border-border text-xs font-medium text-txt-primary hover:bg-border transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isValidating ? "animate-spin text-accent" : ""}`} />
            <span>Làm mới</span>
          </button>
        </div>

        <div className="text-xs text-txt-secondary flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
          <span>Tự động cập nhật (5s)</span>
        </div>
      </div>

      {error ? (
        <div className="p-4 rounded bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
          <span>{error.message || "Đã xảy ra lỗi khi tải tiến độ PO & WIP."}</span>
        </div>
      ) : !customerGroups ? (
        <div className="p-12 border border-border rounded bg-canvas text-center text-txt-secondary text-xs">
          <div className="flex flex-col items-center justify-center gap-2">
            <RefreshCw className="w-5 h-5 animate-spin text-txt-secondary" />
            <span>Đang tính toán dòng chảy tồn kho PO & WIP...</span>
          </div>
        </div>
      ) : filteredGroups.length === 0 ? (
        <div className="p-12 border border-border rounded bg-canvas text-center text-txt-secondary text-xs">
          Không tìm thấy Đơn hàng PO phù hợp với bộ lọc.
        </div>
      ) : (
        <div className="space-y-4">
          {filteredGroups.map((group) => {
            const isCustExpanded = expandedCustomers[group.customerName] !== false;

            return (
              <div
                key={group.customerName}
                className="border border-border rounded bg-canvas overflow-hidden shadow-sm"
              >
                <button
                  onClick={() => toggleCustomer(group.customerName)}
                  className="w-full flex items-center justify-between p-4 bg-subtle/80 hover:bg-subtle border-b border-border transition-colors text-left"
                >
                  <div className="flex items-center gap-3">
                    {isCustExpanded ? (
                      <ChevronDown className="w-4 h-4 text-txt-secondary" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-txt-secondary" />
                    )}
                    <span className="font-bold text-sm text-txt-primary">{group.customerName}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-canvas border border-border text-txt-secondary">
                      {group.activePoCount} PO đang thực hiện
                    </span>
                  </div>
                </button>

                {isCustExpanded && (
                  <div className="divide-y divide-border">
                    {group.items.map((poItem) => {
                      const isPoExpanded = Boolean(expandedPOs[poItem.poId]);

                      return (
                        <div key={poItem.poId} className="bg-canvas">
                          <div
                            onClick={() => togglePO(poItem.poId)}
                            className="flex flex-col lg:flex-row lg:items-center justify-between p-4 hover:bg-subtle/40 cursor-pointer transition-colors gap-4"
                          >
                            <div className="flex items-center gap-3">
                              {isPoExpanded ? (
                                <ChevronDown className="w-4 h-4 text-accent shrink-0" />
                              ) : (
                                <ChevronRight className="w-4 h-4 text-txt-secondary shrink-0" />
                              )}

                              <div className="space-y-0.5">
                                <div className="flex items-center gap-2">
                                  <span className="font-mono font-bold text-sm text-txt-primary">
                                    {poItem.poNumber}
                                  </span>
                                  <span className="text-xs font-mono px-2 py-0.5 rounded bg-subtle border border-border text-txt-secondary">
                                    {poItem.sku}
                                  </span>
                                </div>
                                <p className="text-xs text-txt-secondary">{poItem.productNameVi}</p>
                              </div>
                            </div>

                            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs tabular-nums font-mono">
                              <div className="text-center p-2 rounded bg-subtle/50 border border-border/50">
                                <p className="text-[10px] text-txt-secondary uppercase">Nhu cầu PO</p>
                                <p className="font-bold text-txt-primary mt-0.5">{poItem.targetQty.toLocaleString()} pcs</p>
                              </div>

                              <div className="text-center p-2 rounded bg-subtle/50 border border-border/50">
                                <p className="text-[10px] text-txt-secondary uppercase">Đã giao</p>
                                <p className="font-bold text-emerald-600 mt-0.5">{poItem.shippedQty.toLocaleString()} pcs</p>
                              </div>

                              <div className="text-center p-2 rounded bg-subtle/50 border border-border/50">
                                <p className="text-[10px] text-txt-secondary uppercase">Cần giao</p>
                                <p className="font-bold text-txt-primary mt-0.5">{poItem.remainingQty.toLocaleString()} pcs</p>
                              </div>

                              <div className="text-center p-2 rounded bg-subtle/50 border border-border/50">
                                <p className="text-[10px] text-txt-secondary uppercase">Tồn tại LR</p>
                                <p className="font-bold text-emerald-700 mt-0.5">{poItem.lrReadyQty.toLocaleString()} pcs</p>
                              </div>

                              <div className="text-center p-2 rounded bg-subtle/50 border border-border/50">
                                <p className="text-[10px] text-txt-secondary uppercase">Tổng WIP</p>
                                <p className="font-bold text-txt-primary mt-0.5">
                                  {(poItem.totalPhoiWIP + poItem.totalThanhPhamWIP).toLocaleString()} pcs
                                </p>
                              </div>
                            </div>

                            <div className="flex items-center justify-end">
                              {poItem.coverageStatus === "SUFFICIENT" && (
                                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                  <span>Sẵn Sàng Xuất</span>
                                </span>
                              )}

                              {poItem.coverageStatus === "WIP_COVERED" && (
                                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                                  <AlertTriangle className="w-3.5 h-3.5" />
                                  <span>Đủ WIP (Gia Công Nốt)</span>
                                </span>
                              )}

                              {poItem.coverageStatus === "SHORTAGE" && (
                                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200">
                                  <AlertCircle className="w-3.5 h-3.5" />
                                  <span>Thiếu Phôi / Hàng</span>
                                </span>
                              )}
                            </div>
                          </div>

                          {isPoExpanded && (
                            <div className="p-4 bg-subtle/30 border-t border-border space-y-3">
                              <div className="flex items-center justify-between text-xs">
                                <span className="font-semibold text-txt-primary flex items-center gap-1.5">
                                  <Workflow className="w-4 h-4 text-accent" />
                                  <span>Dòng Chảy Tồn Kho Theo Routing Sản Xuất ({poItem.routing.join(" → ")})</span>
                                </span>
                                <span className="text-txt-secondary font-mono">WO kết nối: {poItem.linkedWos.length} WO</span>
                              </div>

                              <div className="border border-border rounded overflow-hidden bg-canvas">
                                <table className="w-full text-left text-xs tabular-nums border-collapse">
                                  <thead>
                                    <tr className="bg-subtle text-txt-secondary uppercase tracking-wider text-[10px] font-semibold border-b border-border">
                                      <th className="py-2 px-3 border-r border-border w-16 text-center">Bước</th>
                                      <th className="py-2 px-3 border-r border-border">Xưởng Sản Xuất</th>
                                      <th className="py-2 px-3 border-r border-border text-right">Tồn Phôi (WIP)</th>
                                      <th className="py-2 px-3 border-r border-border text-right">Tồn Thành Phẩm (WIP)</th>
                                      <th className="py-2 px-3 text-right">Tiến Độ WO Liên Quan</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-border">
                                    {poItem.steps.map((st, idx) => (
                                      <tr key={st.code} className="hover:bg-subtle/50">
                                        <td className="py-2 px-3 text-center border-r border-border font-mono text-txt-secondary">
                                          #{idx + 1}
                                        </td>
                                        <td className="py-2 px-3 border-r border-border font-semibold text-txt-primary">
                                          {st.code}
                                        </td>
                                        <td className="py-2 px-3 border-r border-border text-right font-mono font-medium text-txt-primary">
                                          {st.tonPhoi > 0 ? (
                                            <span className="text-amber-700">{st.tonPhoi.toLocaleString()} pcs</span>
                                          ) : (
                                            "0"
                                          )}
                                        </td>
                                        <td className="py-2 px-3 border-r border-border text-right font-mono font-medium text-txt-primary">
                                          {st.tonThanhPham > 0 ? (
                                            <span className="text-emerald-700">{st.tonThanhPham.toLocaleString()} pcs</span>
                                          ) : (
                                            "0"
                                          )}
                                        </td>
                                        <td className="py-2 px-3 text-right font-mono">
                                          {st.woPlanned ? (
                                            <span className="inline-flex items-center gap-1.5">
                                              <span>{st.woActual} / {st.woPlanned} pcs</span>
                                              <span
                                                className={`px-1.5 py-0.5 text-[10px] font-semibold rounded ${
                                                  st.woStatus === "DONE"
                                                    ? "bg-emerald-100 text-emerald-800"
                                                    : "bg-amber-100 text-amber-800"
                                                }`}
                                              >
                                                {st.woStatus}
                                              </span>
                                            </span>
                                          ) : (
                                            <span className="text-txt-secondary italic">Chưa tạo WO</span>
                                          )}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                  <tfoot>
                                    <tr className="bg-subtle/80 font-bold border-t border-border">
                                      <td colSpan={2} className="py-2.5 px-3 border-r border-border text-txt-primary">
                                        Tổng Cộng Dở Dang Toàn Chuỗi
                                      </td>
                                      <td className="py-2.5 px-3 border-r border-border text-right font-mono text-amber-700">
                                        {poItem.totalPhoiWIP.toLocaleString()} pcs
                                      </td>
                                      <td className="py-2.5 px-3 border-r border-border text-right font-mono text-emerald-700">
                                        {poItem.totalThanhPhamWIP.toLocaleString()} pcs
                                      </td>
                                      <td className="py-2.5 px-3 text-right font-mono text-txt-primary">
                                        Tổng WIP: {(poItem.totalPhoiWIP + poItem.totalThanhPhamWIP).toLocaleString()} pcs
                                      </td>
                                    </tr>
                                  </tfoot>
                                </table>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
