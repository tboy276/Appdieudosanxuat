import { supabaseAdmin } from "./supabase";
import { getTodayVN, formatDateDisplay } from "./date-utils";
import { getProduct } from "./products";

export interface StockBreakdown {
  tonPhoi: number;
  tonThanhPham: number;
}

export interface XNTReportItem {
  wcCode: string;
  sku: string;
  opening: StockBreakdown;
  nhap: StockBreakdown;
  xuat: StockBreakdown;
  closing: StockBreakdown;
}

export interface TransactionHistoryItem {
  id: string;
  transactionType: "PRODUCTION_INPUT" | "TRANSFER" | "ADJUST_OPENING_STOCK" | "SHIPMENT" | "REVERSAL";
  transactionDate: string;
  loggedAt: string;
  sku: string;
  productNameVi: string;
  workOrderId?: string;
  fromWorkshopCode?: string;
  fromWorkshopName?: string;
  toWorkshopCode?: string;
  toWorkshopName?: string;
  qtyTpOk: number;
  qtyNg: number;
  note?: string;
  createdBy: string;
  createdByName?: string;
  reversedTransactionId?: string;
  reversedQtyOk?: number;
  reversedQtyNg?: number;
  remainingQtyOk?: number;
  remainingQtyNg?: number;
  isReversable?: boolean;
}

/**
 * Helper: Check if a string is a valid UUID
 */
function isUuid(str?: string): boolean {
  if (!str) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

/**
 * Helper: Extract original transaction ID from reversed_transaction_id or note tag [REVERSAL:uuid]
 */
function getReversedTxId(t: any): string | null {
  if (t.reversed_transaction_id) return String(t.reversed_transaction_id).toLowerCase();
  if (t.note && typeof t.note === "string") {
    const match = t.note.match(/\[REVERSAL:([a-f0-9-]+)\]/i);
    if (match && match[1]) return match[1].toLowerCase();
  }
  return null;
}

/**
 * Helper: Check if a transaction is a REVERSAL
 */
function isReversalTx(t: any): boolean {
  return t.transaction_type === "REVERSAL" || (typeof t.note === "string" && t.note.includes("[REVERSAL:"));
}

/**
 * Helper: Resolve or auto-seed user ID in Supabase users table
 */
export async function ensureUserInSupabase(username: string = "admin", role: "ADMIN" | "DISPATCHER" | "VIEWER" = "ADMIN"): Promise<string> {
  const clean = (username || "admin").trim();
  const { data: existing } = await supabaseAdmin
    .from("users")
    .select("id, role")
    .eq("username", clean)
    .maybeSingle();

  if (existing) {
    return existing.id;
  }

  const { data: newUser, error } = await supabaseAdmin
    .from("users")
    .insert({
      username: clean,
      password_hash: "$2a$10$dummyhashforlocaldevseed",
      full_name: clean === "admin" ? "System Admin" : clean,
      role: role,
      status: "ACTIVE",
    })
    .select("id")
    .single();

  if (error || !newUser) {
    const { data: fallback } = await supabaseAdmin.from("users").select("id").limit(1).maybeSingle();
    if (fallback) return fallback.id;
    throw new Error(`Lỗi khởi tạo tài khoản người dùng '${clean}' trên PostgreSQL: ${error?.message}`);
  }

  return newUser.id;
}

/**
 * Helper: Resolve workshop ID by code or object
 */
async function getWorkshopIdByCode(codeOrObj: any): Promise<string> {
  const clean = typeof codeOrObj === "object" ? String(codeOrObj.code || codeOrObj.id || "").trim().toUpperCase() : String(codeOrObj || "").trim().toUpperCase();
  const { data, error } = await supabaseAdmin
    .from("workshops")
    .select("id")
    .eq("code", clean)
    .maybeSingle();

  if (error || !data) {
    throw new Error(`Không tìm thấy Xưởng với mã '${clean}' trên Supabase PostgreSQL.`);
  }

  return data.id;
}

/**
 * Helper: Resolve product ID by SKU, auto-seeding if missing during testing
 */
async function getProductIdBySku(sku: string): Promise<string> {
  const clean = String(sku || "").trim();
  const { data, error } = await supabaseAdmin
    .from("products")
    .select("id")
    .eq("part_no", clean)
    .maybeSingle();

  if (!error && data) {
    return data.id;
  }

  // Auto-seed missing SKU for seamless test & operation execution
  const { data: newProd, error: createErr } = await supabaseAdmin
    .from("products")
    .upsert({ part_no: clean, name_vi: clean, unit: "Cái" }, { onConflict: "part_no" })
    .select("id")
    .single();

  if (createErr || !newProd) {
    throw new Error(`Không tìm thấy SKU sản phẩm '${clean}' trên Supabase PostgreSQL.`);
  }

  return newProd.id;
}

/**
 * Helper: Sync WO completed_qty and status
 */
async function syncWOCompletedQty(woId: string): Promise<void> {
  if (!woId || !isUuid(woId)) return;

  const { data: woTxs } = await supabaseAdmin
    .from("inventory_transactions")
    .select("id, qty_tp_ok, transaction_type, note")
    .eq("work_order_id", woId)
    .range(0, 9999);

  const prodOk = (woTxs || [])
    .filter((t) => t.transaction_type === "PRODUCTION_INPUT" && !isReversalTx(t))
    .reduce((sum, t) => sum + (t.qty_tp_ok || 0), 0);

  const revOk = (woTxs || [])
    .filter((t) => isReversalTx(t))
    .reduce((sum, t) => sum + (t.qty_tp_ok || 0), 0);

  const netCompleted = Math.max(0, prodOk - revOk);

  const { data: wo } = await supabaseAdmin
    .from("work_orders")
    .select("planned_qty, status")
    .eq("id", woId)
    .single();

  if (wo && wo.status !== "CANCELLED") {
    const newStatus = netCompleted >= wo.planned_qty ? "COMPLETED" : netCompleted > 0 ? "IN_PROGRESS" : "PENDING";

    await supabaseAdmin
      .from("work_orders")
      .update({
        completed_qty: netCompleted,
        status: newStatus,
        updated_at: new Date().toISOString(),
      })
      .eq("id", woId);
  }
}

/**
 * 1. Declare Opening Stock in Supabase PostgreSQL (opening_stocks table)
 */
export async function declareOpeningStock(
  wcCode: string,
  sku: string,
  state: { tonPhoi: number; tonThanhPham: number },
  actor: string = "admin",
  customDate?: string
): Promise<void> {
  if (!wcCode || !sku) {
    throw new Error("Mã xưởng và SKU là bắt buộc khi khai báo tồn đầu kỳ.");
  }

  const tonPhoi = Math.max(0, Number(state.tonPhoi || 0));
  const tonThanhPham = Math.max(0, Number(state.tonThanhPham || 0));
  const snapshotDate = customDate || getTodayVN();

  const workshopId = await getWorkshopIdByCode(wcCode);
  const productId = await getProductIdBySku(sku);
  const userId = await ensureUserInSupabase(actor);

  const { data: txAfter } = await supabaseAdmin
    .from("inventory_transactions")
    .select("id")
    .or(`from_workshop_id.eq.${workshopId},to_workshop_id.eq.${workshopId}`)
    .eq("product_id", productId)
    .gt("transaction_date", snapshotDate)
    .limit(1);

  if (txAfter && txAfter.length > 0) {
    const formattedDate = formatDateDisplay(snapshotDate);
    throw new Error(
      `Không thể chốt/sửa tồn đầu kỳ vào ngày ${formattedDate} vì đã có giao dịch phát sinh sau ngày này cho ${wcCode}-${sku}. Vui lòng chọn ngày trước đó, hoặc liên hệ Admin nếu cần điều chỉnh.`
    );
  }

  const { data: ws } = await supabaseAdmin.from("workshops").select("is_ktp").eq("id", workshopId).single();
  const { data: routings } = await supabaseAdmin.from("product_routings").select("step_order").eq("product_id", productId).eq("workshop_id", workshopId);
  const isFirstStep = (routings || []).some((r) => r.step_order === 1);

  if ((ws?.is_ktp || isFirstStep) && tonPhoi > 0) {
    throw new Error(`Xưởng bước 1 hoặc KTP không được phép có Tồn Phôi (ton_phoi phải bằng 0).`);
  }

  const { error: upsertErr } = await supabaseAdmin
    .from("opening_stocks")
    .upsert(
      {
        workshop_id: workshopId,
        product_id: productId,
        snapshot_date: snapshotDate,
        ton_phoi: tonPhoi,
        ton_thanh_pham: tonThanhPham,
        created_by: userId,
      },
      { onConflict: "workshop_id,product_id,snapshot_date" }
    );

  if (upsertErr) {
    throw new Error(`Lỗi khai báo tồn đầu kỳ cho ${wcCode}-${sku}: ${upsertErr.message}`);
  }

  // Bổ sung ghi log lịch sử giao dịch để người dùng có thể xem lại trong Lịch sử (Fix Bug 5)
  // Lưu ý: getXNTReport sẽ tự động lọc loại giao dịch này để không cộng gộp kép (chỉ hiển thị)
  const { error: logErr } = await supabaseAdmin
    .from("inventory_transactions")
    .insert({
      transaction_type: "ADJUST_OPENING_STOCK",
      transaction_date: snapshotDate,
      product_id: productId,
      to_workshop_id: workshopId,
      qty_tp_ok: tonThanhPham,
      qty_ng: tonPhoi, // Mượn trường qty_ng để lưu tạm tồn phôi trong hiển thị lịch sử
      created_by: userId,
      note: `Khai báo/Điều chỉnh tồn đầu kỳ: ${tonPhoi} Phôi, ${tonThanhPham} TP`,
    });
    
  if (logErr) {
    console.error(`Không thể lưu lịch sử khai báo tồn đầu kỳ cho ${wcCode}-${sku}: ${logErr.message}`);
  }
}

/**
 * 1b. Get current stock state for a workshop+SKU (Opening + Transactions up to today)
 */
export async function getStockState(wcCode: string, sku: string): Promise<{ tonPhoi: number; tonThanhPham: number }> {
  const workshopId = await getWorkshopIdByCode(wcCode);
  const productId = await getProductIdBySku(sku);
  const today = getTodayVN();

  // Get latest opening stock up to today
  const { data: openingRows } = await supabaseAdmin
    .from("opening_stocks")
    .select("ton_phoi, ton_thanh_pham, snapshot_date")
    .eq("workshop_id", workshopId)
    .eq("product_id", productId)
    .lte("snapshot_date", today)
    .order("snapshot_date", { ascending: false })
    .limit(1);

  const opening = openingRows?.[0];
  let tonPhoi = Number(opening?.ton_phoi || 0);
  let tonThanhPham = Number(opening?.ton_thanh_pham || 0);
  const openingDate = opening?.snapshot_date || null;

  // Get all transactions from opening date up to today for this product
  let txQueryBase = supabaseAdmin
    .from("inventory_transactions")
    .select("id, transaction_type, from_workshop_id, to_workshop_id, qty_tp_ok, qty_ng, note, transaction_date")
    .eq("product_id", productId)
    .lte("transaction_date", today);

  if (openingDate) {
    txQueryBase = txQueryBase.gte("transaction_date", openingDate) as typeof txQueryBase;
  }

  const { data: txRows } = await txQueryBase.range(0, 9999);
  const txList = txRows || [];

  // Build reversal map
  const reversalMap = new Map<string, { ok: number; ng: number }>();
  for (const t of txList) {
    if (isReversalTx(t)) {
      const origId = getReversedTxId(t);
      if (origId) {
        const prev = reversalMap.get(origId) || { ok: 0, ng: 0 };
        reversalMap.set(origId, { ok: prev.ok + (t.qty_tp_ok || 0), ng: prev.ng + (t.qty_ng || 0) });
      }
    }
  }

  // Apply transactions
  for (const t of txList) {
    if (isReversalTx(t)) continue;
    const rev = reversalMap.get(String(t.id).toLowerCase()) || { ok: 0, ng: 0 };
    const netOk = Math.max(0, (t.qty_tp_ok || 0) - rev.ok);

    if (t.transaction_type === "PRODUCTION_INPUT" && t.to_workshop_id === workshopId) {
      // First step: produces tonThanhPham; non-first: same effect since PRODUCTION_INPUT always goes to to_workshop_id
      tonThanhPham += netOk;
    } else if (t.transaction_type === "TRANSFER") {
      if (t.from_workshop_id === workshopId) {
        // Xuất: consume from source
        tonPhoi = Math.max(0, tonPhoi - netOk);
        tonThanhPham = Math.max(0, tonThanhPham - netOk);
      } else if (t.to_workshop_id === workshopId) {
        // Nhập: add to destination as phoi (intermediate)
        tonPhoi += netOk;
      }
    }
  }

  return { tonPhoi: Math.max(0, tonPhoi), tonThanhPham: Math.max(0, tonThanhPham) };
}

/**
 * 1c. Get opening stock for a SKU across all workshops
 */
export async function getOpeningStockForSku(sku: string): Promise<{
  sku: string;
  latestDate: string | null;
  byWorkcenter: Record<string, { tonPhoi: number; tonThanhPham: number; dateStr: string }>;
}> {
  const productId = await getProductIdBySku(sku);

  const { data: openingRows } = await supabaseAdmin
    .from("opening_stocks")
    .select("workshop_id, ton_phoi, ton_thanh_pham, snapshot_date, workshops(code)")
    .eq("product_id", productId)
    .order("snapshot_date", { ascending: false })
    .range(0, 999);

  const byWorkcenter: Record<string, { tonPhoi: number; tonThanhPham: number; dateStr: string }> = {};
  let latestDate: string | null = null;

  for (const row of openingRows || []) {
    const ws = (row as any).workshops;
    const wcCode = ws?.code || String(row.workshop_id);
    if (!byWorkcenter[wcCode]) {
      byWorkcenter[wcCode] = {
        tonPhoi: Number(row.ton_phoi || 0),
        tonThanhPham: Number(row.ton_thanh_pham || 0),
        dateStr: row.snapshot_date,
      };
      if (!latestDate || row.snapshot_date > latestDate) {
        latestDate = row.snapshot_date;
      }
    }
  }

  return { sku, latestDate, byWorkcenter };
}

/**
 * 1d. Batch get stock states for multiple (wcCode, sku) pairs in 3 queries
 * Used by PO Pipeline to avoid N×4 queries per PO
 */
export async function getStockStatesBatch(
  pairs: Array<{ wcCode: string; sku: string }>
): Promise<Map<string, { tonPhoi: number; tonThanhPham: number }>> {
  const result = new Map<string, { tonPhoi: number; tonThanhPham: number }>();
  if (pairs.length === 0) return result;

  const today = getTodayVN();

  // Resolve workshop IDs and product IDs in bulk
  const uniqueWcs = [...new Set(pairs.map((p) => p.wcCode))];
  const uniqueSkus = [...new Set(pairs.map((p) => p.sku))];

  const [wsRes, prodRes] = await Promise.all([
    supabaseAdmin.from("workshops").select("id, code").in("code", uniqueWcs),
    supabaseAdmin.from("products").select("id, part_no").in("part_no", uniqueSkus),
  ]);

  const wsMap = new Map<string, string>(); // code -> id
  for (const w of wsRes.data || []) wsMap.set(w.code, w.id);

  const prodMap = new Map<string, string>(); // part_no -> id
  for (const p of prodRes.data || []) prodMap.set(p.part_no, p.id);

  const wsIds = [...wsMap.values()];
  const prodIds = [...prodMap.values()];

  if (wsIds.length === 0 || prodIds.length === 0) return result;

  // Bulk fetch latest opening stocks
  const { data: openingRows } = await supabaseAdmin
    .from("opening_stocks")
    .select("workshop_id, product_id, ton_phoi, ton_thanh_pham, snapshot_date")
    .in("workshop_id", wsIds)
    .in("product_id", prodIds)
    .lte("snapshot_date", today)
    .order("snapshot_date", { ascending: false })
    .range(0, 9999);

  // Keep only latest opening per (workshop_id, product_id)
  const openingMap = new Map<string, { tonPhoi: number; tonThanhPham: number; date: string }>();
  for (const row of openingRows || []) {
    const key = `${row.workshop_id}:${row.product_id}`;
    if (!openingMap.has(key) || row.snapshot_date > openingMap.get(key)!.date) {
      openingMap.set(key, {
        tonPhoi: Number(row.ton_phoi || 0),
        tonThanhPham: Number(row.ton_thanh_pham || 0),
        date: row.snapshot_date,
      });
    }
  }

  // Find the oldest opening date across opening stocks (to bound transactions query if opening stocks exist)
  let minOpeningDate: string | null = null;
  for (const op of openingMap.values()) {
    if (!minOpeningDate || op.date < minOpeningDate) minOpeningDate = op.date;
  }

  // Bulk fetch all relevant transactions for the targeted products
  let txQueryBulk = supabaseAdmin
    .from("inventory_transactions")
    .select("id, transaction_type, product_id, from_workshop_id, to_workshop_id, qty_tp_ok, qty_ng, note, transaction_date")
    .in("product_id", prodIds)
    .lte("transaction_date", today);

  if (minOpeningDate) {
    txQueryBulk = txQueryBulk.gte("transaction_date", minOpeningDate) as typeof txQueryBulk;
  }

  const { data: txRows } = await txQueryBulk.range(0, 9999);
  const txList = txRows || [];



  // Build reversal map
  const reversalMap = new Map<string, { ok: number; ng: number }>();
  for (const t of txList) {
    if (isReversalTx(t)) {
      const origId = getReversedTxId(t);
      if (origId) {
        const prev = reversalMap.get(origId) || { ok: 0, ng: 0 };
        reversalMap.set(origId, { ok: prev.ok + (t.qty_tp_ok || 0), ng: prev.ng + (t.qty_ng || 0) });
      }
    }
  }

  // Compute stock states per (workshopId, productId) pair
  const stockMap = new Map<string, { tonPhoi: number; tonThanhPham: number }>();
  for (const { wcCode, sku } of pairs) {
    const wsId = wsMap.get(wcCode);
    const prodId = prodMap.get(sku);
    if (!wsId || !prodId) {
      result.set(`${wcCode}:${sku}`, { tonPhoi: 0, tonThanhPham: 0 });
      continue;
    }

    const stockKey = `${wsId}:${prodId}`;
    if (stockMap.has(stockKey)) {
      result.set(`${wcCode}:${sku}`, { ...stockMap.get(stockKey)! });
      continue;
    }

    const opening = openingMap.get(stockKey);
    let tonPhoi = Number(opening?.tonPhoi || 0);
    let tonThanhPham = Number(opening?.tonThanhPham || 0);
    const openingDate = opening?.date || null;

    for (const t of txList) {
      if (t.product_id !== prodId) continue;
      if (openingDate && t.transaction_date < openingDate) continue;
      if (isReversalTx(t)) continue;

      const rev = reversalMap.get(String(t.id).toLowerCase()) || { ok: 0, ng: 0 };
      const netOk = Math.max(0, (t.qty_tp_ok || 0) - rev.ok);

      if (t.transaction_type === "PRODUCTION_INPUT" && t.to_workshop_id === wsId) {
        tonThanhPham += netOk;
      } else if (t.transaction_type === "TRANSFER") {
        if (t.from_workshop_id === wsId) {
          tonPhoi = Math.max(0, tonPhoi - netOk);
          tonThanhPham = Math.max(0, tonThanhPham - netOk);
        } else if (t.to_workshop_id === wsId) {
          tonPhoi += netOk;
        }
      }
    }

    const state = { tonPhoi: Math.max(0, tonPhoi), tonThanhPham: Math.max(0, tonThanhPham) };
    stockMap.set(stockKey, state);
    result.set(`${wcCode}:${sku}`, state);
  }

  return result;
}

/**
 * 2. Bulk Declare Opening Stock
 */
export async function bulkDeclareOpeningStock(
  rows: Array<{ wcCode: string; sku: string; state: { tonPhoi: number; tonThanhPham: number }; customDate?: string }>,
  actor: string = "admin"
): Promise<{ successCount: number; failedCount: number; errors: { row: number; error: string }[] }> {
  let successCount = 0;
  const errors: { row: number; error: string }[] = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    try {
      await declareOpeningStock(r.wcCode, r.sku, r.state, actor, r.customDate);
      successCount++;
    } catch (e: any) {
      errors.push({ row: i + 1, error: e.message });
    }
  }

  return { successCount, failedCount: errors.length, errors };
}

/**
 * 3. Record Production Input in Supabase PostgreSQL (inventory_transactions table)
 */
export async function recordProductionInput(
  code: string,
  sku: string,
  actualQty: number,
  actor: string,
  isFirstStep: boolean,
  woId?: string,
  customDate?: string,
  ngQty: number = 0
): Promise<void> {
  if (actualQty <= 0) {
    throw new Error("Sản lượng báo cáo phải lớn hơn 0.");
  }
  if (ngQty < 0) {
    throw new Error("Số lượng NG/Phế phẩm không được âm.");
  }

  const workshopId = await getWorkshopIdByCode(code);
  const productId = await getProductIdBySku(sku);
  const userId = await ensureUserInSupabase(actor);
  const txDate = customDate || getTodayVN();
  const validWoId = isUuid(woId) ? woId : null;

  const { error } = await supabaseAdmin
    .from("inventory_transactions")
    .insert({
      transaction_type: "PRODUCTION_INPUT",
      transaction_date: txDate,
      product_id: productId,
      work_order_id: validWoId,
      to_workshop_id: workshopId,
      qty_tp_ok: actualQty,
      qty_ng: ngQty,
      created_by: userId,
      note: `Báo cáo sản lượng ${code} - ${sku}`,
    });

  if (error) {
    throw new Error(`Lỗi ghi nhận sản lượng PostgreSQL: ${error.message}`);
  }

  if (validWoId) {
    await syncWOCompletedQty(validWoId);
  }
}

/**
 * 4. Record Transfer in Supabase PostgreSQL (inventory_transactions table)
 */
export async function recordTransfer(
  fromCode: string,
  toCode: string,
  sku: string,
  qty: number,
  actor: string,
  isFirstStepFrom: boolean = false,
  woId?: string,
  customDate?: string
): Promise<void> {
  if (qty <= 0) {
    throw new Error("Sản lượng xuất chuyển phải lớn hơn 0.");
  }

  const fromWorkshopId = await getWorkshopIdByCode(fromCode);
  const toWorkshopId = await getWorkshopIdByCode(toCode);
  const productId = await getProductIdBySku(sku);
  const userId = await ensureUserInSupabase(actor);
  const txDate = customDate || getTodayVN();
  const validWoId = isUuid(woId) ? woId : null;

  const { error } = await supabaseAdmin
    .from("inventory_transactions")
    .insert({
      transaction_type: "TRANSFER",
      transaction_date: txDate,
      product_id: productId,
      work_order_id: validWoId,
      from_workshop_id: fromWorkshopId,
      to_workshop_id: toWorkshopId,
      qty_tp_ok: qty,
      qty_ng: 0,
      created_by: userId,
      note: `Xuất chuyển ${fromCode} -> ${toCode} cho ${sku}`,
    });

  if (error) {
    throw new Error(`Lỗi ghi nhận xuất chuyển PostgreSQL: ${error.message}`);
  }
}

/**
 * 5. reverseTransaction (ADMIN Only Reversal Engine)
 */
export async function reverseTransaction(
  originalTxId: string,
  qtyOk: number,
  qtyNg: number = 0,
  reason: string,
  actor: string = "admin",
  userRole: "ADMIN" | "DISPATCHER" | "VIEWER" = "ADMIN"
): Promise<{ success: boolean; message: string }> {
  if (userRole !== "ADMIN") {
    throw new Error("Chỉ tài khoản ADMIN mới có quyền thực hiện Đảo bút toán (REVERSAL).");
  }

  if (!reason || !reason.trim()) {
    throw new Error("Vui lòng nhập lý do đảo bút toán.");
  }

  if (qtyOk < 0 || qtyNg < 0 || (qtyOk === 0 && qtyNg === 0)) {
    throw new Error("Số lượng đảo phải lớn hơn 0.");
  }

  // 1. Fetch original transaction
  const { data: origTx, error: fetchErr } = await supabaseAdmin
    .from("inventory_transactions")
    .select("*")
    .eq("id", originalTxId)
    .maybeSingle();

  if (fetchErr || !origTx) {
    throw new Error(`Không tìm thấy giao dịch gốc với ID: ${originalTxId}`);
  }

  if (isReversalTx(origTx)) {
    throw new Error("Không thể đảo một giao dịch Đảo bút toán (REVERSAL).");
  }

  // 2. Fetch existing reversals directly for this original transaction without requesting un-cached columns
  const targetOrigIdLower = String(originalTxId).toLowerCase();

  const { data: directReversals } = await supabaseAdmin
    .from("inventory_transactions")
    .select("qty_tp_ok, qty_ng, note, transaction_type")
    .ilike("note", `%${targetOrigIdLower}%`);

  const existingReversals = (directReversals || []).filter((r) => isReversalTx(r));

  const prevReversedOk = existingReversals.reduce((sum, r) => sum + (r.qty_tp_ok || 0), 0);
  const prevReversedNg = existingReversals.reduce((sum, r) => sum + (r.qty_ng || 0), 0);

  const remainingOk = origTx.qty_tp_ok - prevReversedOk;
  const remainingNg = origTx.qty_ng - prevReversedNg;

  if (qtyOk > remainingOk || qtyNg > remainingNg) {
    throw new Error(
      `Không thể đảo ${qtyOk} pcs (OK) / ${qtyNg} pcs (NG) vì giao dịch gốc chỉ có ${origTx.qty_tp_ok} pcs (OK) / ${origTx.qty_ng} pcs (NG), đã đảo ${prevReversedOk} pcs (OK) / ${prevReversedNg} pcs (NG) trước đó (còn lại ${remainingOk} OK / ${remainingNg} NG).`
    );
  }

  const userId = await ensureUserInSupabase(actor, "ADMIN");

  // 3. Insert REVERSAL transaction into PostgreSQL using origTx.transaction_type
  const payload: any = {
    transaction_type: origTx.transaction_type || "PRODUCTION_INPUT",
    transaction_date: getTodayVN(),
    product_id: origTx.product_id,
    work_order_id: origTx.work_order_id,
    from_workshop_id: origTx.from_workshop_id,
    to_workshop_id: origTx.to_workshop_id,
    qty_tp_ok: qtyOk,
    qty_ng: qtyNg,
    note: `[REVERSAL:${originalTxId}] ${reason.trim()}`,
    created_by: userId,
  };

  let { error: insertErr } = await supabaseAdmin
    .from("inventory_transactions")
    .insert({ ...payload, reversed_transaction_id: originalTxId });

  if (insertErr) {
    const { error: retryErr } = await supabaseAdmin.from("inventory_transactions").insert(payload);
    insertErr = retryErr;
  }

  if (insertErr) {
    throw new Error(`Lỗi tạo giao dịch Đảo bút toán: ${insertErr.message}`);
  }

  // 4. If original transaction was tied to a WO, update WO completed_qty
  if (origTx.work_order_id && origTx.transaction_type === "PRODUCTION_INPUT") {
    await syncWOCompletedQty(origTx.work_order_id);
  }

  return {
    success: true,
    message: `Đã đảo bút toán thành công ${qtyOk} pcs (OK) / ${qtyNg} pcs (NG) cho giao dịch gốc.`,
  };
}

/**
 * 6. getXNTReport: High-performance Real-time XNT Report directly from Supabase PostgreSQL
 */
export async function getXNTReport(dateStr: string, filterSku?: string): Promise<XNTReportItem[]> {
  const targetDate = dateStr || getTodayVN();

  const { data: workshops } = await supabaseAdmin.from("workshops").select("id, code, name, is_ktp");
  if (!workshops || workshops.length === 0) return [];

  let prodQuery = supabaseAdmin.from("products").select("id, part_no");
  if (filterSku) {
    prodQuery = prodQuery.eq("part_no", filterSku);
  }
  const { data: products } = await prodQuery;
  if (!products || products.length === 0) return [];

  const wsMap = new Map(workshops.map((w) => [w.id, w]));
  const prodMap = new Map(products.map((p) => [p.id, p]));

  const { data: openings } = await supabaseAdmin
    .from("opening_stocks")
    .select("workshop_id, product_id, ton_phoi, ton_thanh_pham, snapshot_date")
    .lte("snapshot_date", targetDate);

  const { data: txs } = await supabaseAdmin
    .from("inventory_transactions")
    .select("id, transaction_type, product_id, work_order_id, from_workshop_id, to_workshop_id, qty_tp_ok, qty_ng, note, transaction_date")
    .lte("transaction_date", targetDate)
    .range(0, 9999);

  const txList = txs || [];
  const reversalMap = new Map<string, { ok: number; ng: number }>();
  for (const t of txList) {
    if (isReversalTx(t)) {
      const origId = getReversedTxId(t);
      if (origId) {
        const prev = reversalMap.get(origId) || { ok: 0, ng: 0 };
        reversalMap.set(origId, {
          ok: prev.ok + (t.qty_tp_ok || 0),
          ng: prev.ng + (t.qty_ng || 0),
        });
      }
    }
  }

  const reportMap = new Map<string, XNTReportItem>();

  for (const p of products) {
    for (const w of workshops) {
      const key = `${w.code}:${p.part_no}`;
      reportMap.set(key, {
        wcCode: w.code,
        sku: p.part_no,
        opening: { tonPhoi: 0, tonThanhPham: 0 },
        nhap: { tonPhoi: 0, tonThanhPham: 0 },
        xuat: { tonPhoi: 0, tonThanhPham: 0 },
        closing: { tonPhoi: 0, tonThanhPham: 0 },
      });
    }
  }

  const latestOpeningMap = new Map<string, any>();
  for (const op of openings || []) {
    const key = `${op.workshop_id}:${op.product_id}`;
    const existing = latestOpeningMap.get(key);
    if (!existing || op.snapshot_date > existing.snapshot_date) {
      latestOpeningMap.set(key, op);
    }
  }

  for (const [key, op] of latestOpeningMap.entries()) {
    const ws = wsMap.get(op.workshop_id);
    const prod = prodMap.get(op.product_id);
    if (ws && prod) {
      const itemKey = `${ws.code}:${prod.part_no}`;
      const item = reportMap.get(itemKey);
      if (item) {
        item.opening.tonPhoi = Number(op.ton_phoi || 0);
        item.opening.tonThanhPham = Number(op.ton_thanh_pham || 0);
      }
    }
  }

  for (const t of txList) {
    if (t.transaction_date !== targetDate || isReversalTx(t)) continue;

    const rev = reversalMap.get(t.id.toLowerCase()) || { ok: 0, ng: 0 };
    const netOk = Math.max(0, (t.qty_tp_ok || 0) - rev.ok);
    const netNg = Math.max(0, (t.qty_ng || 0) - rev.ng);
    const prod = prodMap.get(t.product_id);
    if (!prod) continue;

    if (t.transaction_type === "PRODUCTION_INPUT" && t.to_workshop_id) {
      const ws = wsMap.get(t.to_workshop_id);
      if (ws) {
        const item = reportMap.get(`${ws.code}:${prod.part_no}`);
        if (item) {
          item.nhap.tonThanhPham += netOk;
        }
      }
    } else if (t.transaction_type === "TRANSFER") {
      if (t.from_workshop_id) {
        const fromWs = wsMap.get(t.from_workshop_id);
        if (fromWs) {
          const item = reportMap.get(`${fromWs.code}:${prod.part_no}`);
          if (item) item.xuat.tonThanhPham += netOk;
        }
      }
      if (t.to_workshop_id) {
        const toWs = wsMap.get(t.to_workshop_id);
        if (toWs) {
          const item = reportMap.get(`${toWs.code}:${prod.part_no}`);
          if (item) item.nhap.tonPhoi += netOk;
        }
      }
    }
  }

  const items = Array.from(reportMap.values()).filter((item) => {
    return (
      item.opening.tonPhoi > 0 ||
      item.opening.tonThanhPham > 0 ||
      item.nhap.tonPhoi > 0 ||
      item.nhap.tonThanhPham > 0 ||
      item.xuat.tonPhoi > 0 ||
      item.xuat.tonThanhPham > 0
    );
  });

  for (const item of items) {
    item.closing = {
      tonPhoi: item.opening.tonPhoi + item.nhap.tonPhoi - item.xuat.tonPhoi,
      tonThanhPham: item.opening.tonThanhPham + item.nhap.tonThanhPham - item.xuat.tonThanhPham,
    };
  }

  items.sort((a, b) => a.wcCode.localeCompare(b.wcCode) || a.sku.localeCompare(b.sku));
  return items;
}

/**
 * 7. getTransactionHistory: Fetch transaction history with reversal status
 */
export async function getTransactionHistory(filters?: { sku?: string; search?: string }): Promise<TransactionHistoryItem[]> {
  const { data: txs, error } = await supabaseAdmin
    .from("inventory_transactions")
    .select(`
      id,
      transaction_type,
      transaction_date,
      logged_at,
      qty_tp_ok,
      qty_ng,
      note,
      products ( part_no, name_vi ),
      from_ws:workshops!from_workshop_id ( code, name ),
      to_ws:workshops!to_workshop_id ( code, name ),
      users ( username, full_name )
    `)
    .order("logged_at", { ascending: false })
    .range(0, 999);

  if (error) {
    throw new Error(`Lỗi lấy lịch sử giao dịch từ PostgreSQL: ${error.message}`);
  }

  const { data: allTx } = await supabaseAdmin
    .from("inventory_transactions")
    .select("note, qty_tp_ok, qty_ng, transaction_type")
    .range(0, 9999);

  const reversals = (allTx || []).filter((r) => isReversalTx(r));

  const reversalTotals = new Map<string, { ok: number; ng: number }>();
  for (const r of reversals) {
    const origId = getReversedTxId(r);
    if (origId) {
      const prev = reversalTotals.get(origId) || { ok: 0, ng: 0 };
      reversalTotals.set(origId, {
        ok: prev.ok + (r.qty_tp_ok || 0),
        ng: prev.ng + (r.qty_ng || 0),
      });
    }
  }

  const result: TransactionHistoryItem[] = (txs || []).map((row: any) => {
    const prod = Array.isArray(row.products) ? row.products[0] : row.products;
    const fromWs = Array.isArray(row.from_ws) ? row.from_ws[0] : row.from_ws;
    const toWs = Array.isArray(row.to_ws) ? row.to_ws[0] : row.to_ws;
    const user = Array.isArray(row.users) ? row.users[0] : row.users;

    const rev = reversalTotals.get(row.id.toLowerCase()) || { ok: 0, ng: 0 };
    const remainingQtyOk = Math.max(0, (row.qty_tp_ok || 0) - rev.ok);
    const remainingQtyNg = Math.max(0, (row.qty_ng || 0) - rev.ng);
    const isRev = isReversalTx(row);
    const isReversable = !isRev && (remainingQtyOk > 0 || remainingQtyNg > 0);

    const origId = getReversedTxId(row);

    return {
      id: row.id,
      transactionType: isRev ? "REVERSAL" : row.transaction_type,
      transactionDate: row.transaction_date ? String(row.transaction_date).split("T")[0] : "",
      loggedAt: row.logged_at || new Date().toISOString(),
      sku: prod?.part_no || "",
      productNameVi: prod?.name_vi || "",
      fromWorkshopCode: fromWs?.code,
      fromWorkshopName: fromWs?.name,
      toWorkshopCode: toWs?.code,
      toWorkshopName: toWs?.name,
      qtyTpOk: row.qty_tp_ok || 0,
      qtyNg: row.qty_ng || 0,
      note: row.note,
      createdBy: user?.username || "admin",
      createdByName: user?.full_name || user?.username || "admin",
      reversedTransactionId: origId || undefined,
      reversedQtyOk: rev.ok,
      reversedQtyNg: rev.ng,
      remainingQtyOk,
      remainingQtyNg,
      isReversable,
    };
  });

  return result;
}
