import { NextRequest, NextResponse } from "next/server";
import { listPOs, listWOs, computeEquivalentFinishedQty, PO, WO } from "@/lib/po-wo-engine";
import { getProduct } from "@/lib/products";
import { getStockState } from "@/lib/inventory";
import { StockState } from "@/lib/types";
import { authorize, handleApiError } from "@/lib/auth";

export type CoverageStatus = "SUFFICIENT" | "WIP_COVERED" | "SHORTAGE";

export interface PipelineStep {
  code: string;
  tonPhoi: number;
  tonThanhPham: number;
  woPlanned?: number;
  woActual?: number;
  woStatus?: string;
}

export interface POPipelineItem {
  poId: string;
  poNumber: string;
  customerName: string;
  sku: string;
  productNameVi: string;
  targetQty: number;
  shippedQty: number;
  remainingQty: number;
  finishWsCode: string;
  lrReadyQty: number;
  totalPhoiWIP: number;
  totalThanhPhamWIP: number;
  totalStock: number;
  totalEquivalentWIP: number;
  coverageStatus: CoverageStatus;
  poStatus: string;
  createdAt: string;
  requestedDate: string;
  routing: string[];
  steps: PipelineStep[];
  linkedWos: { woId: string; status: string }[];
  warnings?: string[];
}

export async function GET(req: NextRequest) {
  const { response } = authorize(req);
  if (response) return response;

  try {
    const [allPos, allWos] = await Promise.all([listPOs(), listWOs()]);

    // Active POs (status != "COMPLETED")
    const activePos = allPos.filter((po) => po.status !== "COMPLETED");

    // 1. Parallel fetch all Products for active POs using Promise.allSettled
    const productSettledResults = await Promise.allSettled(
      activePos.map((po) => getProduct(po.sku))
    );

    // 2. Process each PO with parallel stock fetching using Promise.allSettled per PO
    const poPromises = activePos.map(async (po, poIdx) => {
      const itemWarnings: string[] = [];
      const prodRes = productSettledResults[poIdx];
      let product = null;

      if (prodRes.status === "fulfilled") {
        product = prodRes.value;
      } else {
        const reasonStr = String(prodRes.reason || "Lỗi không xác định");
        console.warn(`[PO-Pipeline] Lỗi khi lấy sản phẩm SKU ${po.sku} cho PO ${po.poId}:`, prodRes.reason);
        itemWarnings.push(`Không thể tải dữ liệu SKU ${po.sku}: ${reasonStr}`);
      }

      if (!product) {
        itemWarnings.push(`Không tìm thấy sản phẩm SKU ${po.sku} trong hệ thống.`);
      } else if (product.needsRouting || !product.routing || product.routing.length === 0) {
        itemWarnings.push(`Sản phẩm SKU ${po.sku} chưa được khai báo quy trình công nghệ (routing).`);
      }

      const routing = product?.routing || [];
      const remainingQty = Math.max(0, po.qty - (po.shippedQty || 0));
      const finishWsCode = routing.length > 0 ? routing[routing.length - 1] : "LR";
      const linkedWos = allWos.filter((w) => w.poId === po.poId);

      // Parallel fetch stock states for all routing steps of this PO using Promise.allSettled
      const stockSettledResults = await Promise.allSettled(
        routing.map((wcCode) => getStockState(wcCode, po.sku))
      );

      let totalPhoiWIP = 0;
      let totalThanhPhamWIP = 0;
      let lrReadyQty = 0;
      const stockByCode: Record<string, StockState> = {};
      const steps: PipelineStep[] = [];

      routing.forEach((wcCode, stepIdx) => {
        const stockRes = stockSettledResults[stepIdx];
        let stock: StockState = { tonPhoi: 0, tonThanhPham: 0 };
        if (stockRes.status === "fulfilled") {
          stock = stockRes.value;
        } else {
          const reasonStr = String(stockRes.reason || "Lỗi không xác định");
          console.warn(`[PO-Pipeline] Lỗi khi lấy tồn kho xưởng ${wcCode} cho SKU ${po.sku}:`, stockRes.reason);
          itemWarnings.push(`Thiếu dữ liệu tồn kho tại xưởng ${wcCode}: ${reasonStr}`);
        }

        const tonPhoi = stock.tonPhoi || 0;
        const tonThanhPham = stock.tonThanhPham || 0;
        stockByCode[wcCode] = { tonPhoi, tonThanhPham };

        totalPhoiWIP += tonPhoi;
        totalThanhPhamWIP += tonThanhPham;

        if (wcCode === finishWsCode) {
          lrReadyQty = tonThanhPham;
        }

        let woPlanned = 0;
        let woActual = 0;
        let woStatus = "NO_WO";

        for (const wo of linkedWos) {
          const st = wo.steps?.find((s) => s.code === wcCode);
          if (st) {
            woPlanned += st.plannedQty || 0;
            woActual += st.actualQty || 0;
            woStatus = st.status;
          }
        }

        steps.push({
          code: wcCode,
          tonPhoi,
          tonThanhPham,
          woPlanned,
          woActual,
          woStatus,
        });
      });

      const totalStock = totalPhoiWIP + totalThanhPhamWIP;
      const totalEquivalentWIP = computeEquivalentFinishedQty(po.sku, routing, stockByCode);

      let coverageStatus: CoverageStatus = "SHORTAGE";
      if (lrReadyQty >= remainingQty) {
        coverageStatus = "SUFFICIENT";
      } else if (totalEquivalentWIP >= remainingQty) {
        coverageStatus = "WIP_COVERED";
      } else {
        coverageStatus = "SHORTAGE";
      }

      return {
        poId: po.poId,
        poNumber: po.poNumber,
        customerName: po.customerName || "Khách Hàng Chưa Phân Loại",
        sku: po.sku,
        productNameVi: po.productNameVi || product?.nameVi || po.sku,
        targetQty: po.qty,
        shippedQty: po.shippedQty || 0,
        remainingQty,
        finishWsCode,
        lrReadyQty,
        totalPhoiWIP,
        totalThanhPhamWIP,
        totalStock,
        totalEquivalentWIP,
        coverageStatus,
        poStatus: po.status,
        createdAt: po.createdAt,
        requestedDate: po.requestedDate,
        routing,
        steps,
        linkedWos: linkedWos.map((w) => ({ woId: w.woId, status: w.status })),
        warnings: itemWarnings.length > 0 ? itemWarnings : undefined,
      };
    });

    const items = await Promise.all(poPromises);
    return NextResponse.json(items);
  } catch (err) {
    return handleApiError(err, "Không thể tải báo cáo dòng chảy PO & WIP.");
  }
}
