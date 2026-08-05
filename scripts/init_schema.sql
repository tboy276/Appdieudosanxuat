-- DDL SCRIPT FOR MANUFACTURING DISPATCH SYSTEM (POSTGRESQL v4 FINAL)
-- File: scripts/init_schema.sql

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. USERS
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(50) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    full_name VARCHAR(100) NOT NULL,
    role VARCHAR(20) NOT NULL CHECK (role IN ('ADMIN', 'DISPATCHER', 'VIEWER')),
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'LOCKED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 2. CUSTOMERS
CREATE TABLE customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_code VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    contact_info TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 3. PRODUCTS (raw_weight & material are NULLABLE)
CREATE TABLE products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    part_no VARCHAR(100) NOT NULL UNIQUE,
    name_vi VARCHAR(255) NOT NULL,
    raw_weight NUMERIC(10, 3) NULL CHECK (raw_weight IS NULL OR raw_weight > 0),
    material VARCHAR(100) NULL,
    unit VARCHAR(20) NOT NULL DEFAULT 'Cái',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 4. PRODUCT - CUSTOMER RELATIONSHIP
CREATE TABLE product_customers (
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (product_id, customer_id)
);

-- 5. WORKSHOPS
CREATE TABLE workshops (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL,
    is_ktp BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- SINGLE KTP PARTIAL UNIQUE INDEX
CREATE UNIQUE INDEX uq_single_ktp ON workshops (is_ktp) WHERE is_ktp = TRUE;

-- 6. PRODUCT ROUTINGS
CREATE TABLE product_routings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    workshop_id UUID NOT NULL REFERENCES workshops(id) ON DELETE RESTRICT,
    step_order INTEGER NOT NULL CHECK (step_order > 0),
    ng_rate NUMERIC(5, 2) NOT NULL DEFAULT 0.00 CHECK (ng_rate >= 0 AND ng_rate < 100),
    lead_time_days INTEGER NOT NULL DEFAULT 1 CHECK (lead_time_days >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_product_step UNIQUE (product_id, step_order),
    CONSTRAINT uq_product_workshop UNIQUE (product_id, workshop_id)
);

-- 7. PURCHASE ORDERS (PO)
CREATE TABLE purchase_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    po_number VARCHAR(100) NOT NULL,
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    order_date DATE NOT NULL DEFAULT CURRENT_DATE,
    requested_date DATE NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW', 'IN_PRODUCTION', 'COMPLETED', 'CANCELLED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_customer_po UNIQUE (customer_id, po_number),
    CONSTRAINT uq_po_id_customer UNIQUE (id, customer_id)
);

-- 8. PO LINES (WITH COMPOSITE FK ENFORCING SKU-CUSTOMER REGISTRATION)
CREATE TABLE po_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    po_id UUID NOT NULL,
    customer_id UUID NOT NULL,
    product_id UUID NOT NULL,
    order_qty INTEGER NOT NULL CHECK (order_qty > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_poline_po FOREIGN KEY (po_id, customer_id) REFERENCES purchase_orders(id, customer_id) ON DELETE CASCADE,
    CONSTRAINT fk_poline_product_customer FOREIGN KEY (product_id, customer_id) REFERENCES product_customers(product_id, customer_id) ON DELETE RESTRICT
);

-- 9. WORK ORDERS (WO)
CREATE TABLE work_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wo_number VARCHAR(100) NOT NULL UNIQUE,
    po_line_id UUID NOT NULL REFERENCES po_lines(id) ON DELETE RESTRICT,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    workshop_id UUID NOT NULL REFERENCES workshops(id) ON DELETE RESTRICT,
    step_order INTEGER NOT NULL,
    planned_qty INTEGER NOT NULL CHECK (planned_qty > 0),
    completed_qty INTEGER NOT NULL DEFAULT 0 CHECK (completed_qty >= 0),
    lead_time_days INTEGER NOT NULL CHECK (lead_time_days >= 0),
    deadline DATE NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_poline_workshop UNIQUE (po_line_id, workshop_id)
);

-- 10. OPENING STOCKS
CREATE TABLE opening_stocks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workshop_id UUID NOT NULL REFERENCES workshops(id) ON DELETE RESTRICT,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    snapshot_date DATE NOT NULL,
    ton_phoi INTEGER NOT NULL DEFAULT 0 CHECK (ton_phoi >= 0),
    ton_thanh_pham INTEGER NOT NULL DEFAULT 0 CHECK (ton_thanh_pham >= 0),
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_opening_stock UNIQUE (workshop_id, product_id, snapshot_date)
);

-- 11. INVENTORY TRANSACTIONS
CREATE TABLE inventory_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_type VARCHAR(30) NOT NULL CHECK (transaction_type IN ('PRODUCTION_INPUT', 'TRANSFER', 'ADJUST_OPENING_STOCK', 'SHIPMENT')),
    transaction_date DATE NOT NULL DEFAULT CURRENT_DATE,
    logged_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    work_order_id UUID REFERENCES work_orders(id) ON DELETE RESTRICT,
    from_workshop_id UUID REFERENCES workshops(id) ON DELETE RESTRICT,
    to_workshop_id UUID REFERENCES workshops(id) ON DELETE RESTRICT,
    qty_tp_ok INTEGER NOT NULL DEFAULT 0 CHECK (qty_tp_ok >= 0),
    qty_ng INTEGER NOT NULL DEFAULT 0 CHECK (qty_ng >= 0),
    total_phoi_consumed INTEGER GENERATED ALWAYS AS (qty_tp_ok + qty_ng) STORED,
    note TEXT,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    is_corrected BOOLEAN NOT NULL DEFAULT FALSE,
    CONSTRAINT chk_tx_production_input CHECK (
        transaction_type != 'PRODUCTION_INPUT' OR (from_workshop_id IS NULL AND to_workshop_id IS NOT NULL)
    ),
    CONSTRAINT chk_tx_transfer CHECK (
        transaction_type != 'TRANSFER' OR (from_workshop_id IS NOT NULL AND to_workshop_id IS NOT NULL AND from_workshop_id != to_workshop_id)
    ),
    CONSTRAINT chk_tx_adjust_opening CHECK (
        transaction_type != 'ADJUST_OPENING_STOCK' OR (from_workshop_id IS NULL AND to_workshop_id IS NOT NULL)
    ),
    CONSTRAINT chk_tx_shipment CHECK (
        transaction_type != 'SHIPMENT' OR (from_workshop_id IS NOT NULL AND to_workshop_id IS NULL)
    )
);

-- 12. TRANSACTION CORRECTIONS
CREATE TABLE transaction_corrections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    original_transaction_id UUID NOT NULL REFERENCES inventory_transactions(id) ON DELETE RESTRICT,
    old_data JSONB NOT NULL,
    new_data JSONB NOT NULL,
    reason TEXT NOT NULL,
    corrected_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    corrected_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 13. SHIPMENTS
CREATE TABLE shipments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shipment_code VARCHAR(100) NOT NULL UNIQUE,
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    ship_date DATE NOT NULL DEFAULT CURRENT_DATE,
    notes TEXT,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 14. SHIPMENT ITEMS
CREATE TABLE shipment_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shipment_id UUID NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
    po_line_id UUID NOT NULL REFERENCES po_lines(id) ON DELETE RESTRICT,
    shipped_qty INTEGER NOT NULL CHECK (shipped_qty > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- FULL FOREIGN KEY INDEXES
CREATE INDEX idx_po_lines_po_id ON po_lines(po_id);
CREATE INDEX idx_po_lines_product_id ON po_lines(product_id);
CREATE INDEX idx_po_lines_customer_id ON po_lines(customer_id);

CREATE INDEX idx_wo_po_line_id ON work_orders(po_line_id);
CREATE INDEX idx_wo_product_id ON work_orders(product_id);
CREATE INDEX idx_wo_workshop_id ON work_orders(workshop_id);
CREATE INDEX idx_wo_deadline ON work_orders(deadline);

CREATE INDEX idx_routing_product_id ON product_routings(product_id);
CREATE INDEX idx_routing_workshop_id ON product_routings(workshop_id);

CREATE INDEX idx_tx_work_order_id ON inventory_transactions(work_order_id);
CREATE INDEX idx_tx_product_id ON inventory_transactions(product_id);
CREATE INDEX idx_tx_from_ws_date ON inventory_transactions(from_workshop_id, transaction_date);
CREATE INDEX idx_tx_to_ws_date ON inventory_transactions(to_workshop_id, transaction_date);
CREATE INDEX idx_tx_created_by ON inventory_transactions(created_by);

CREATE INDEX idx_opening_product_id ON opening_stocks(product_id);
CREATE INDEX idx_opening_workshop_id ON opening_stocks(workshop_id);
CREATE INDEX idx_opening_lookup ON opening_stocks(workshop_id, product_id, snapshot_date);

CREATE INDEX idx_shipment_items_shipment_id ON shipment_items(shipment_id);
CREATE INDEX idx_shipment_items_po_line_id ON shipment_items(po_line_id);
CREATE INDEX idx_corrections_orig_tx_id ON transaction_corrections(original_transaction_id);

-- =============================================================================
-- TRIGGERS IMPLEMENTATION
-- =============================================================================

-- 1. TRIGGER CHẶN XƯỞNG KTP TRONG ROUTING
CREATE OR REPLACE FUNCTION fn_check_routing_not_ktp()
RETURNS TRIGGER AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM workshops WHERE id = NEW.workshop_id AND is_ktp = TRUE) THEN
        RAISE EXCEPTION 'Xưởng trong Routing không được phép là Kho Thành Phẩm (KTP). KTP là bước mặc định ngầm định.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_check_routing_not_ktp
BEFORE INSERT OR UPDATE ON product_routings
FOR EACH ROW EXECUTE FUNCTION fn_check_routing_not_ktp();


-- 2. TRIGGER TÍNH LẠI DEADLINE KHI PO.REQUESTED_DATE THAY ĐỔI
CREATE OR REPLACE FUNCTION fn_recalculate_wo_deadlines_for_po()
RETURNS TRIGGER AS $$
DECLARE
    v_po_line RECORD;
    v_wo RECORD;
    v_current_deadline DATE;
BEGIN
    IF OLD.requested_date IS DISTINCT FROM NEW.requested_date THEN
        FOR v_po_line IN SELECT id FROM po_lines WHERE po_id = NEW.id LOOP
            v_current_deadline := NEW.requested_date;
            
            FOR v_wo IN 
                SELECT id, step_order, lead_time_days 
                FROM work_orders 
                WHERE po_line_id = v_po_line.id 
                ORDER BY step_order DESC 
            LOOP
                UPDATE work_orders 
                SET deadline = v_current_deadline,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = v_wo.id;

                v_current_deadline := v_current_deadline - v_wo.lead_time_days;
            END LOOP;
        END LOOP;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_po_requested_date_update
AFTER UPDATE OF requested_date ON purchase_orders
FOR EACH ROW EXECUTE FUNCTION fn_recalculate_wo_deadlines_for_po();


-- 3. TRIGGER TÍNH LẠI DEADLINE KHI WO.LEAD_TIME_DAYS THAY ĐỔI
CREATE OR REPLACE FUNCTION fn_recalculate_wo_deadlines_on_wo_lead_time_change()
RETURNS TRIGGER AS $$
DECLARE
    v_po_requested_date DATE;
    v_wo RECORD;
    v_current_deadline DATE;
BEGIN
    IF OLD.lead_time_days IS DISTINCT FROM NEW.lead_time_days THEN
        SELECT po.requested_date INTO v_po_requested_date
        FROM po_lines pl
        JOIN purchase_orders po ON po.id = pl.po_id
        WHERE pl.id = NEW.po_line_id;

        v_current_deadline := v_po_requested_date;

        FOR v_wo IN 
            SELECT id, step_order, lead_time_days 
            FROM work_orders 
            WHERE po_line_id = NEW.po_line_id 
            ORDER BY step_order DESC 
        LOOP
            UPDATE work_orders 
            SET deadline = v_current_deadline,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = v_wo.id;

            v_current_deadline := v_current_deadline - v_wo.lead_time_days;
        END LOOP;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_wo_lead_time_update
AFTER UPDATE OF lead_time_days ON work_orders
FOR EACH ROW EXECUTE FUNCTION fn_recalculate_wo_deadlines_on_wo_lead_time_change();


-- 4. TRIGGER CHẶN VÀ TÍNH LẠI PLANNED_QTY KHI SỬA PO_LINES.ORDER_QTY (LOGIC ĐÃ SỬA CHUẨN)
CREATE OR REPLACE FUNCTION fn_guard_poline_order_qty_update()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.order_qty IS DISTINCT FROM NEW.order_qty THEN
        IF EXISTS (
            SELECT 1 FROM work_orders 
            WHERE po_line_id = NEW.id 
              AND status IN ('IN_PROGRESS', 'COMPLETED')
        ) THEN
            RAISE EXCEPTION 'Không thể sửa order_qty của PO Line khi đã có Work Order đang sản xuất (IN_PROGRESS) hoặc đã hoàn thành (COMPLETED).';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_guard_poline_order_qty
BEFORE UPDATE OF order_qty ON po_lines
FOR EACH ROW EXECUTE FUNCTION fn_guard_poline_order_qty_update();

CREATE OR REPLACE FUNCTION fn_recalculate_planned_qty_for_poline()
RETURNS TRIGGER AS $$
DECLARE
    v_wo RECORD;
    v_current_demand NUMERIC;
    v_ng_rate NUMERIC;
BEGIN
    IF OLD.order_qty IS DISTINCT FROM NEW.order_qty THEN
        v_current_demand := NEW.order_qty;

        FOR v_wo IN 
            SELECT wo.id, wo.product_id, wo.workshop_id, wo.step_order, pr.ng_rate
            FROM work_orders wo
            LEFT JOIN product_routings pr ON pr.product_id = wo.product_id AND pr.workshop_id = wo.workshop_id
            WHERE wo.po_line_id = NEW.id
            ORDER BY wo.step_order DESC
        LOOP
            v_ng_rate := COALESCE(v_wo.ng_rate, 0.00);

            -- 1. Gán nhu cầu đầu ra cho bước đang xét
            UPDATE work_orders
            SET planned_qty = v_current_demand,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = v_wo.id;

            -- 2. Tính nhu cầu phôi cần cung cấp cho bước đang xét (là đầu ra cho bước đứng trước)
            v_current_demand := CEIL(v_current_demand * (1 + (v_ng_rate / 100.0)));
        END LOOP;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_recalculate_planned_qty_on_poline
AFTER UPDATE OF order_qty ON po_lines
FOR EACH ROW EXECUTE FUNCTION fn_recalculate_planned_qty_for_poline();


-- 5. TRIGGER TỰ ĐỘNG ĐỒNG BỘ WO.COMPLETED_QTY VÀ TRẠNG THÁI SẢN XUẤT (HỖ TRỢ LÙI TRẠNG THÁI 2 CHIỀU)
CREATE OR REPLACE FUNCTION fn_sync_wo_completed_qty()
RETURNS TRIGGER AS $$
DECLARE
    v_target_wo_id UUID;
    v_total_completed INT;
    v_planned_qty INT;
    v_current_status VARCHAR;
BEGIN
    IF TG_OP = 'DELETE' THEN
        v_target_wo_id := OLD.work_order_id;
    ELSE
        v_target_wo_id := NEW.work_order_id;
    END IF;

    IF v_target_wo_id IS NOT NULL THEN
        SELECT COALESCE(SUM(qty_tp_ok), 0) INTO v_total_completed
        FROM inventory_transactions
        WHERE work_order_id = v_target_wo_id
          AND transaction_type = 'PRODUCTION_INPUT'
          AND is_corrected = FALSE;

        SELECT planned_qty, status INTO v_planned_qty, v_current_status
        FROM work_orders
        WHERE id = v_target_wo_id;

        IF v_current_status != 'CANCELLED' THEN
            UPDATE work_orders
            SET completed_qty = v_total_completed,
                status = CASE 
                    WHEN v_total_completed >= v_planned_qty THEN 'COMPLETED'::VARCHAR
                    WHEN v_total_completed > 0 THEN 'IN_PROGRESS'::VARCHAR
                    ELSE 'PENDING'::VARCHAR
                END,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = v_target_wo_id;
        ELSE
            UPDATE work_orders
            SET completed_qty = v_total_completed,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = v_target_wo_id;
        END IF;
    END IF;

    IF TG_OP = 'UPDATE' AND OLD.work_order_id IS DISTINCT FROM NEW.work_order_id AND OLD.work_order_id IS NOT NULL THEN
        SELECT COALESCE(SUM(qty_tp_ok), 0) INTO v_total_completed
        FROM inventory_transactions
        WHERE work_order_id = OLD.work_order_id
          AND transaction_type = 'PRODUCTION_INPUT'
          AND is_corrected = FALSE;

        UPDATE work_orders
        SET completed_qty = v_total_completed,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = OLD.work_order_id;
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sync_wo_completed_qty
AFTER INSERT OR UPDATE OR DELETE ON inventory_transactions
FOR EACH ROW EXECUTE FUNCTION fn_sync_wo_completed_qty();


-- 6. TRIGGER RÀNG BUỘC TỒN PHÔI BẰNG 0 TẠI BƯỚC 1 VÀ KTP
CREATE OR REPLACE FUNCTION fn_check_opening_stock_phoi()
RETURNS TRIGGER AS $$
DECLARE
    v_is_ktp BOOLEAN;
    v_is_first_step BOOLEAN;
BEGIN
    SELECT is_ktp INTO v_is_ktp FROM workshops WHERE id = NEW.workshop_id;
    
    SELECT EXISTS (
        SELECT 1 FROM product_routings 
        WHERE product_id = NEW.product_id 
          AND workshop_id = NEW.workshop_id 
          AND step_order = 1
    ) INTO v_is_first_step;

    IF (v_is_ktp OR v_is_first_step) AND NEW.ton_phoi > 0 THEN
        RAISE EXCEPTION 'Xưởng bước 1 hoặc KTP không được phép có Tồn Phôi (ton_phoi phải bằng 0).';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_check_opening_stock_phoi
BEFORE INSERT OR UPDATE ON opening_stocks
FOR EACH ROW EXECUTE FUNCTION fn_check_opening_stock_phoi();


-- 7. TRIGGER KHÓA NGÀY CHỐT TỒN ĐẦU KỲ KHI ĐÃ CÓ GIAO DỊCH PHÁT SINH
CREATE OR REPLACE FUNCTION fn_check_opening_stock_lock_date()
RETURNS TRIGGER AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM inventory_transactions
        WHERE (from_workshop_id = NEW.workshop_id OR to_workshop_id = NEW.workshop_id)
          AND product_id = NEW.product_id
          AND transaction_date > NEW.snapshot_date
    ) THEN
        RAISE EXCEPTION 'Không thể chốt/sửa tồn đầu kỳ vào ngày % vì đã có giao dịch phát sinh sau ngày này.', NEW.snapshot_date;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_check_opening_stock_lock_date
BEFORE INSERT OR UPDATE ON opening_stocks
FOR EACH ROW EXECUTE FUNCTION fn_check_opening_stock_lock_date();
