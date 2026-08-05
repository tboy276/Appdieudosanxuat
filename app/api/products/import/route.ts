import { NextRequest, NextResponse } from "next/server";
import { upsertProduct, getProduct, normalizeProductRouting } from "@/lib/products";
import { authorize, handleApiError } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

export interface ImportProductRow {
  sku?: string;
  SKU?: string;
  nameVi?: string;
  Ten_VI?: string;
  customerName?: string;
  Khach_hang?: string;
  rawWeight?: number | string;
  Trong_luong_phoi?: number | string;
  material?: string;
  Vat_lieu?: string;
  unit?: string;
  Don_vi?: string;
  routingStr?: string;
  Routing?: string;
  [key: string]: any;
}

function parseRoutingWithMeta(
  routingStr: string,
  validWorkcenters: Set<string>
): {
  routing: string[];
  routingScrapRates: Record<string, number>;
  routingLeadTimes: Record<string, number>;
  invalidStep?: string;
} {
  // Split by -> or ; or , (only when comma is NOT inside parentheses)
  const rawTokens = routingStr.split(/->|;|,(?![^(]*\))/).map((s) => s.trim()).filter(Boolean);
  const routing: string[] = [];
  const routingScrapRates: Record<string, number> = {};
  const routingLeadTimes: Record<string, number> = {};

  for (const token of rawTokens) {
    const colonParts = token.split(/[:=]/).map((s) => s.trim());
    const parenMatch = token.match(/^([A-Za-z0-9_]+)\s*\(([^)]+)\)/);

    let code = token.toUpperCase();
    let rate = 10;
    let leadTime = 3;

    if (parenMatch) {
      code = parenMatch[1].toUpperCase();
      const inner = parenMatch[2];
      const numbers = inner.match(/\d+(\.\d+)?/g);
      if (numbers && numbers.length > 0) rate = parseFloat(numbers[0]);
      if (numbers && numbers.length > 1) leadTime = parseInt(numbers[1], 10);
    } else if (colonParts.length >= 2) {
      code = colonParts[0].toUpperCase();
      rate = parseFloat(colonParts[1]);
      if (colonParts.length >= 3) {
        leadTime = parseInt(colonParts[2], 10);
      }
    }

    if (!validWorkcenters.has(code)) {
      return { routing: [], routingScrapRates: {}, routingLeadTimes: {}, invalidStep: code };
    }

    routing.push(code);
    if (code !== "KTP") {
      routingScrapRates[code] = isNaN(rate) ? 10 : rate;
      routingLeadTimes[code] = isNaN(leadTime) ? 3 : leadTime;
    }
  }

  const normalized = normalizeProductRouting(routing);
  return { routing: normalized, routingScrapRates, routingLeadTimes };
}

export async function POST(req: NextRequest) {
  const { user, response } = authorize(req, ["ADMIN", "DISPATCHER"]);
  if (response) return response;

  try {
    const body = await req.json();
    const rows: ImportProductRow[] = Array.isArray(body) ? body : body.rows;

    if (!rows || !Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json(
        { error: "Danh sách sản phẩm import không được để rỗng." },
        { status: 400 }
      );
    }

    // Fetch valid workshops dynamically from Supabase
    const { data: workshopsData } = await supabaseAdmin.from("workshops").select("code");
    const validWorkcenters = new Set<string>(
      (workshopsData || []).map((w: any) => w.code.toUpperCase())
    );
    // Ensure KTP is always included
    validWorkcenters.add("KTP");

    const errors: { row: number; sku: string; error: string }[] = [];
    const now = new Date().toISOString();

    const skuGroupMap = new Map<
      string,
      {
        sku: string;
        nameVi: string;
        routingStr: string;
        rawWeight?: number;
        material?: string;
        unit: string;
        customerNames: string[];
        firstRow: number;
      }
    >();

    const seenExactPairs = new Set<string>(); // "sku:customerName"

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2; // Excel row number (1-based header is row 1)
      const sku = (row.sku || row.SKU || "").trim();
      const nameVi = (row.nameVi || row.Ten_VI || "").trim();
      const customerName = (row.customerName || row.Khach_hang || row["Khách hàng"] || "").trim();
      const rawWeightVal = row.rawWeight ?? row.Trong_luong_phoi ?? row["Trọng lượng phôi"];
      const rawWeight = rawWeightVal !== undefined && rawWeightVal !== "" && !isNaN(Number(rawWeightVal)) ? Number(rawWeightVal) : undefined;
      const material = (row.material || row.Vat_lieu || row["Vật liệu"] || "").trim();
      const unit = (row.unit || row.Don_vi || "Cái").trim();
      const routingStr = (row.routingStr || row.Routing || "").trim();

      if (!sku) {
        errors.push({ row: rowNum, sku: "", error: "Mã SKU không được để rỗng." });
        continue;
      }

      if (!customerName) {
        errors.push({ row: rowNum, sku, error: "Tên Khách hàng không được để rỗng." });
        continue;
      }

      if (!nameVi) {
        errors.push({ row: rowNum, sku, error: "Tên tiếng Việt không được để rỗng." });
        continue;
      }

      if (!routingStr) {
        errors.push({ row: rowNum, sku, error: "Quy trình Routing không được để rỗng." });
        continue;
      }

      const pairKey = `${sku.toLowerCase()}:${customerName.toLowerCase()}`;
      if (seenExactPairs.has(pairKey)) {
        errors.push({
          row: rowNum,
          sku,
          error: `Cặp Part No. '${sku}' VÀ Khách hàng '${customerName}' bị trùng lặp nhiều lần trong file Excel.`,
        });
        continue;
      }
      seenExactPairs.add(pairKey);

      const parsedRouting = parseRoutingWithMeta(routingStr, validWorkcenters);
      if (parsedRouting.invalidStep) {
        errors.push({
          row: rowNum,
          sku,
          error: `Mã xưởng '${parsedRouting.invalidStep}' trong routing không tồn tại trong danh mục xưởng.`,
        });
        continue;
      }

      const skuKey = sku.toLowerCase();
      const existingGroup = skuGroupMap.get(skuKey);

      if (existingGroup) {
        // Enforce physical attribute consistency across rows with the same SKU
        if (
          existingGroup.nameVi.toLowerCase() !== nameVi.toLowerCase() ||
          existingGroup.routingStr.toLowerCase() !== routingStr.toLowerCase() ||
          existingGroup.rawWeight !== rawWeight ||
          (existingGroup.material || "").toLowerCase() !== (material || "").toLowerCase()
        ) {
          errors.push({
            row: rowNum,
            sku,
            error: `Part No. '${sku}' có thuộc tính (Tên/Routing/Trọng lượng/Vật liệu) không đồng nhất với dòng ${existingGroup.firstRow} trong file Excel.`,
          });
          continue;
        }

        existingGroup.customerNames.push(customerName);
      } else {
        skuGroupMap.set(skuKey, {
          sku,
          nameVi,
          routingStr,
          rawWeight,
          material: material || undefined,
          unit,
          customerNames: [customerName],
          firstRow: rowNum,
        });
      }
    }

    if (errors.length > 0) {
      return NextResponse.json(
        {
          error: `Phát hiện ${errors.length} dòng dữ liệu lỗi. Vui lòng kiểm tra lại file.`,
          errors,
        },
        { status: 400 }
      );
    }

    const productsToUpsert = Array.from(skuGroupMap.values());
    const upserted = await Promise.all(
      productsToUpsert.map(async (item) => {
        const existingProduct = await getProduct(item.sku);
        const existingCusts = existingProduct?.customerNames || (existingProduct?.customerName ? [existingProduct.customerName] : []);
        
        const combinedCusts = Array.from(
          new Set([...existingCusts, ...item.customerNames])
        );

        const parsedRouting = parseRoutingWithMeta(item.routingStr, validWorkcenters);

        return upsertProduct({
          sku: item.sku,
          nameVi: item.nameVi,
          customerNames: combinedCusts,
          rawWeight: item.rawWeight,
          material: item.material,
          unit: item.unit,
          routing: parsedRouting.routing,
          routingScrapRates: parsedRouting.routingScrapRates,
          routingLeadTimes: parsedRouting.routingLeadTimes,
          needsRouting: false,
          createdAt: existingProduct?.createdAt || now,
          updatedAt: now,
        });
      })
    );



    return NextResponse.json({
      success: true,
      count: upserted.length,
      products: upserted,
    });
  } catch (err) {
    return handleApiError(err, "Import danh mục sản phẩm thất bại.");
  }
}
