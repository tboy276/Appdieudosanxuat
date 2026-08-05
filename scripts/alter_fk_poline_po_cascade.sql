-- SCRIPT: Thêm ON UPDATE CASCADE cho fk_poline_po
-- Mục đích: Cho phép thay đổi customer_id trên purchase_orders
--           mà po_lines.customer_id tự động cập nhật theo (CASCADE).
-- Chạy trong: Supabase SQL Editor (Database > SQL Editor > New Query)

BEGIN;

-- 1. Xóa constraint cũ (chỉ có ON DELETE CASCADE, thiếu ON UPDATE CASCADE)
ALTER TABLE po_lines DROP CONSTRAINT IF EXISTS fk_poline_po;

-- 2. Tạo lại với ON UPDATE CASCADE + ON DELETE CASCADE
ALTER TABLE po_lines
  ADD CONSTRAINT fk_poline_po
  FOREIGN KEY (po_id, customer_id)
  REFERENCES purchase_orders(id, customer_id)
  ON DELETE CASCADE
  ON UPDATE CASCADE;

COMMIT;

-- Sau khi chạy thành công, updatePO({ customerName }) sẽ hoạt động
-- đúng ngay cả khi đã có WO tham chiếu po_lines.
