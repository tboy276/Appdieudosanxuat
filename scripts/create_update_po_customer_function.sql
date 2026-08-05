-- SCRIPT: Tạo PL/pgSQL Function update_po_customer
-- Mục đích: Bọc toàn bộ quy trình thay đổi Khách hàng (customer_id) của PO vào 1 Transaction thật (Atomic Transaction).
--           Nếu bất kỳ bước nào thất bại (VD: SKU chưa đăng ký cho Khách hàng mới, vi phạm composite FK product_customers,
--           hoặc đã có WO tham chiếu po_lines), TOÀN BỘ Transaction sẽ tự động ROLLBACK, giữ nguyên vẹn 100% po_lines cũ.
--
-- Hướng dẫn: Mở Supabase SQL Editor (https://supabase.com/dashboard/project/smjtxmnkgsascejjpfpu/sql/new)
--            Paste toàn bộ nội dung script này và bấm RUN.

CREATE OR REPLACE FUNCTION update_po_customer(
    p_po_id UUID,
    p_new_customer_id UUID
)
RETURNS VOID AS $$
DECLARE
    v_lines_count INT := 0;
BEGIN
    -- 1. Kiểm tra PO có tồn tại hay không
    IF NOT EXISTS (SELECT 1 FROM purchase_orders WHERE id = p_po_id) THEN
        RAISE EXCEPTION 'Không tìm thấy đơn hàng PO với ID: %', p_po_id;
    END IF;

    -- 2. Lưu danh sách po_lines hiện tại vào Bảng tạm (TEMP TABLE)
    CREATE TEMP TABLE tmp_po_lines ON COMMIT DROP AS
    SELECT id, product_id, order_qty
    FROM po_lines
    WHERE po_id = p_po_id;

    SELECT COUNT(*) INTO v_lines_count FROM tmp_po_lines;
    IF v_lines_count = 0 THEN
        RAISE EXCEPTION 'Đơn hàng PO % không có chi tiết sản phẩm (po_lines).', p_po_id;
    END IF;

    -- 3. Xóa các dòng po_lines cũ
    -- (Nếu đã có WO tham chiếu po_lines.id, PostgreSQL sẽ tự động chặn bởi FK RESTRICT và ROLLBACK toàn bộ transaction)
    DELETE FROM po_lines WHERE po_id = p_po_id;

    -- 4. Cập nhật customer_id mới trên purchase_orders
    UPDATE purchase_orders
    SET customer_id = p_new_customer_id,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = p_po_id;

    -- 5. Chèn lại các dòng po_lines với customer_id mới
    -- (Nếu sản phẩm product_id chưa đăng ký với p_new_customer_id trong product_customers, 
    --  PostgreSQL sẽ vi phạm constraint fk_poline_product_customer và ROLLBACK toàn bộ transaction, 
    --  giữ nguyên vẹn po_lines cũ và PO cũ)
    INSERT INTO po_lines (id, po_id, customer_id, product_id, order_qty)
    SELECT id, p_po_id, p_new_customer_id, product_id, order_qty
    FROM tmp_po_lines;

END;
$$ LANGUAGE plpgsql;
