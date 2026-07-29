import { NextRequest, NextResponse } from "next/server";
import { listPOs, listWOs, PO, WO } from "@/lib/po-wo-engine";
import { getProduct } from "@/lib/products";
import { getStockState } from "@/lib/inventory";
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
  coverageStatus: CoverageStatus;
  poStatus: string;
  createdAt: string;
  requestedDate: string;
  routing: string[];
  steps: PipelineStep[];
  linkedWos: { woId: string; status: string }[];
}

export async function GET(req: NextRequest) {
  const { response } = authorize(req);
  if (response) return response;

  try {
    const [allPos, allWos] = await Promise.all([listPOs(), listWOs()]);

    // Active POs (status != "COMPLETED")
    const activePos = allPos.filter((po) => po.status !== "COMPLETED");

    const pipelineItems: POPipelineItem[] = [];

    for (const po of activePos) {
      const product = await getProduct(po.sku);
      const routing = product?.routing || [];

      const remainingQty = Math.max(0, po.qty - (po.shippedQty || 0));

      let totalPhoiWIP = 0;
      let totalThanhPhamWIP = 0;
      let lrReadyQty = 0;

      const finishWsCode = routing.length > 0 ? routing[routing.length - 1] : "LR";

      // Linked WOs for this PO
      const linkedWos = allWos.filter((w) => w.poId === po.poId);

      const steps: PipelineStep[] = [];

      for (const wcCode of routing) {
        const stock = await getStockState(wcCode, po.sku);
        const tonPhoi = stock.tonPhoi || 0;
        const tonThanhPham = stock.tonThanhPham || 0;

        totalPhoiWIP += tonPhoi;
        totalThanhPhamWIP += tonThanhPham;

        if (wcCode === finishWsCode) {
          lrReadyQty = tonThanhPham;
        }

        // Aggregate WO step progress if any
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
      }

      // Determine coverageStatus
      const totalStock = totalPhoiWIP + totalThanhPhamWIP;
      let coverageStatus: CoverageStatus = "SHORTAGE";

      if (lrReadyQty >= remainingQty) {
        coverageStatus = "SUFFICIENT";
      } else if (totalStock >= remainingQty) {
        coverageStatus = "WIP_COVERED";
      } else {
        coverageStatus = "SHORTAGE";
      }

      pipelineItems.push({
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
        coverageStatus,
        poStatus: po.status,
        createdAt: po.createdAt,
        requestedDate: po.requestedDate,
        routing,
        steps,
        linkedWos: linkedWos.map((w) => ({ woId: w.woId, status: w.status })),
      });
    }

    return NextResponse.json(pipelineItems);
  } catch (err) {
    return handleApiError(err, "Không thể tải báo cáo dòng chảy PO & WIP.");
  }
}
