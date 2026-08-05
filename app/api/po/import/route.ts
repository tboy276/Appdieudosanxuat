import { NextRequest, NextResponse } from "next/server";
import { PO, listPOs, bulkCreatePOs } from "@/lib/po-wo-engine";
import { listProducts, upsertProduct, bulkUpsertProducts } from "@/lib/products";
import { Product } from "@/lib/types";
import { authorize, handleApiError } from "@/lib/auth";

export interface POImportConflictRow {
  originalRowIndex: number;
  poNumber: string;
  sku: string;
  requestedCustomer: string;
  registeredCustomers: string;
  qty: number;
}

export async function POST(req: NextRequest) {
  const { user, response } = authorize(req, ["ADMIN", "DISPATCHER"]);
  if (response) return response;

  try {
    const body = await req.json();
    const rows = Array.isArray(body) ? body : body.rows;
    const skipConflicts = Boolean(body.skipConflicts);

    if (!rows || !Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json(
        { error: "Danh sách đơn hàng import không được để rỗng." },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();

    // 1. Batch fetch all existing products and existing POs in 2 parallel calls
    const [existingProductsList, existingPOsList] = await Promise.all([
      listProducts(),
      listPOs(),
    ]);

    const existingProductsMap = new Map<string, Product>();
    const successfullyAvailableSkus = new Set<string>();

    existingProductsList.forEach((p) => {
      const lower = p.sku.toLowerCase();
      existingProductsMap.set(lower, p);
      successfullyAvailableSkus.add(lower);
    });

    // Safeguard 2: PO Deduplication map by (poNumber + sku)
    const existingPOsSet = new Set<string>();
    existingPOsList.forEach((po) => {
      const pNum = (po.poNumber || "").trim().toLowerCase();
      const pSku = (po.sku || "").trim().toLowerCase();
      if (pNum && pSku) {
        existingPOsSet.add(`${pNum}:${pSku}`);
      }
    });

    const draftSkusToCreateMap = new Map<string, Product>();
    const preparedPOs: PO[] = [];
    const conflictRows: POImportConflictRow[] = [];
    let skippedDuplicateCount = 0;

    // 2. Pre-process and classify all rows in-memory
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index];
      const sku = (row.sku || row.productSymbol || "").trim();
      const customerName = (row.customerName || "").trim();
      const qty = Number(row.qty || row.quantity || 0);
      const rawPoNumber = (row.poNumber || "").trim();

      if (!sku || qty <= 0) continue;

      const skuLower = sku.toLowerCase();

      // Safeguard 2: Check for existing duplicate PO by (poNumber + sku)
      if (rawPoNumber) {
        const poKey = `${rawPoNumber.toLowerCase()}:${skuLower}`;
        if (existingPOsSet.has(poKey)) {
          skippedDuplicateCount++;
          continue; // Skip duplicate PO to prevent double-click creation
        }
      }

      let existingProduct = existingProductsMap.get(skuLower) || draftSkusToCreateMap.get(skuLower);
      let finalCustomerName = customerName;

      if (existingProduct) {
        const registeredCusts = existingProduct.customerNames || (existingProduct.customerName ? [existingProduct.customerName] : []);

        if (customerName) {
          const matchedCust = registeredCusts.find(
            (c) => c.toLowerCase() === customerName.toLowerCase()
          );
          if (!matchedCust) {
            // Conflict: Customer in PO row does not match registered customers for existing SKU
            conflictRows.push({
              originalRowIndex: index + 1,
              poNumber: rawPoNumber || `PO-${index + 1}`,
              sku,
              requestedCustomer: customerName,
              registeredCustomers: registeredCusts.join(", "),
              qty,
            });
            continue; // Skip this conflict row from valid POs
          }
          finalCustomerName = matchedCust;
        } else if (registeredCusts.length === 1) {
          finalCustomerName = registeredCusts[0];
        } else {
          // Conflict: Multiple registered customers, but none specified in row
          conflictRows.push({
            originalRowIndex: index + 1,
            poNumber: rawPoNumber || `PO-${index + 1}`,
            sku,
            requestedCustomer: "Chưa chỉ định Khách hàng",
            registeredCustomers: registeredCusts.join(", "),
            qty,
          });
          continue;
        }
      } else if (!finalCustomerName) {
        // Conflict: New SKU but missing customer name
        conflictRows.push({
          originalRowIndex: index + 1,
          poNumber: rawPoNumber || `PO-${index + 1}`,
          sku,
          requestedCustomer: "Thiếu tên Khách hàng",
          registeredCustomers: "Chưa đăng ký trong danh mục",
          qty,
        });
        continue;
      }

      // If product does not exist, prepare draft product record
      if (!existingProduct) {
        const draftProduct: Product = {
          sku,
          nameVi: row.productNameVi || row.productSymbol || sku,
          customerNames: [finalCustomerName],
          customerName: finalCustomerName,
          routing: [],
          unit: "Cái",
          needsRouting: true,
          createdAt: now,
          updatedAt: now,
        };
        draftSkusToCreateMap.set(skuLower, draftProduct);
        existingProduct = draftProduct;
      }

      // Generate stable unique PO ID with index offset
      const poId = `PO-${Date.now()}-${index + 1}-${Math.floor(Math.random() * 1000)}`;

      const po: PO = {
        poId,
        poNumber: rawPoNumber || `PO-${Date.now()}-${index + 1}`,
        accountId: row.accountId || "",
        customerName: finalCustomerName,
        sku,
        productNameVi: row.productNameVi || existingProduct?.nameVi || sku,
        qty,
        requestedDate: row.requestedDate || row.expectedDeliveryDate || now.split("T")[0],
        tolerance: row.tolerance ? Number(row.tolerance) : undefined,
        currency: row.currency || "VND",
        techRequirement: row.techRequirement || "",
        specialRequirement: row.specialRequirement || "",
        shippedQty: 0,
        status: "NEW",
        createdAt: now,
        createdBy: user!.username,
      };

      preparedPOs.push(po);
      if (rawPoNumber) {
        existingPOsSet.add(`${rawPoNumber.toLowerCase()}:${skuLower}`);
      }
    }

    // If conflicts exist and user has NOT explicitly confirmed to skip conflicts:
    // Prompt the user with summary statistics for decision
    if (conflictRows.length > 0 && !skipConflicts) {
      const conflictSkusCount = new Set(conflictRows.map((c) => c.sku.toLowerCase())).size;
      return NextResponse.json({
        hasConflicts: true,
        totalRows: rows.length,
        validCount: preparedPOs.length,
        conflictCount: conflictRows.length,
        conflictSkusCount,
        conflictRows,
      });
    }

    // 3. Batch Write Draft SKUs to Supabase PostgreSQL via bulkUpsertProducts
    const draftSkusArray = Array.from(draftSkusToCreateMap.values());

    if (draftSkusArray.length > 0) {
      try {
        const createdDrafts = await bulkUpsertProducts(draftSkusArray);
        createdDrafts.forEach((prod) => {
          successfullyAvailableSkus.add(prod.sku.toLowerCase());
        });
      } catch (err: any) {
        console.error(`[PO Import] Draft SKUs bulk write to Supabase failed:`, err);
      }
    }

    // Filter prepared POs to ONLY write POs whose SKU is confirmed available
    const validPOsToWrite = preparedPOs.filter((po) =>
      successfullyAvailableSkus.has(po.sku.toLowerCase())
    );

    // 4. Batch Write Valid POs to Supabase PostgreSQL via bulkCreatePOs
    let createdPOs: PO[] = [];
    if (validPOsToWrite.length > 0) {
      createdPOs = await bulkCreatePOs(validPOsToWrite);
      if (createdPOs.length !== validPOsToWrite.length) {
        console.warn(
          `[PO Import Reconciliation] Cảnh báo: Số dòng tạo (${createdPOs.length}) khác số dòng gửi (${validPOsToWrite.length})`
        );
      }
    }

    const conflictSkusCount = new Set(conflictRows.map((c) => c.sku.toLowerCase())).size;

    return NextResponse.json({
      success: true,
      totalRows: rows.length,
      count: validPOsToWrite.length,
      draftSkusCount: draftSkusArray.length,
      skippedDuplicateCount,
      conflictCount: conflictRows.length,
      conflictSkusCount,
      conflictRows,
      reconciliation: {
        totalRows: rows.length,
        validRows: validPOsToWrite.length,
        createdLines: createdPOs.length,
        matches: createdPOs.length === validPOsToWrite.length,
      },
      message: `Đã import thành công ${validPOsToWrite.length}/${rows.length} dòng.${
        conflictRows.length > 0
          ? ` ${conflictRows.length} dòng bị bỏ qua do xung đột Khách hàng — xem chi tiết trong file báo cáo đã tải về.`
          : ""
      }`,
      pos: createdPOs.length > 0 ? createdPOs : validPOsToWrite,
    });
  } catch (err) {
    return handleApiError(err, "Import danh sách PO thất bại.");
  }
}
