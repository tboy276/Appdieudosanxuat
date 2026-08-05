-- ============================================================================
-- SCHEMA V5: SHIPMENTS MODULE, ATOMIC PL/PGSQL FUNCTION & RLS HARDENING SCRIPT
-- MES Lite Production System (Next.js + Supabase PostgreSQL)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. TAO BANG SHIPMENTS VA SHIPMENT_ITEMS (NEU CHUA TON TAI)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.shipments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shipment_number TEXT UNIQUE NOT NULL DEFAULT ('SHIP-' || to_char(now(), 'YYYYMMDD') || '-' || lpad(floor(random() * 10000)::text, 4, '0')),
    customer_id UUID REFERENCES public.customers(id) ON DELETE RESTRICT,
    shipped_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.shipment_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shipment_id UUID NOT NULL REFERENCES public.shipments(id) ON DELETE CASCADE,
    po_line_id UUID NOT NULL REFERENCES public.po_lines(id) ON DELETE RESTRICT,
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
    shipped_qty INT NOT NULL CHECK (shipped_qty > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index cho hieu nang truy van JOIN
CREATE INDEX IF NOT EXISTS idx_shipments_customer ON public.shipments(customer_id);
CREATE INDEX IF NOT EXISTS idx_shipment_items_shipment ON public.shipment_items(shipment_id);
CREATE INDEX IF NOT EXISTS idx_shipment_items_po_line ON public.shipment_items(po_line_id);

-- ----------------------------------------------------------------------------
-- 2. PL/PGSQL FUNCTION: create_shipment (ATOMIC + ROW LOCKING FOR UPDATE)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_shipment(
  p_customer_id UUID,
  p_actor_id UUID,
  p_note TEXT,
  p_items JSONB -- Array of { po_line_id, product_id, shipped_qty }
)
RETURNS UUID AS $$
DECLARE
  v_shipment_id UUID;
  v_item JSONB;
  v_po_line_id UUID;
  v_product_id UUID;
  v_qty INT;
  v_order_qty INT;
  v_already_shipped INT;
  v_po_id UUID;
  v_total_po_order INT;
  v_total_po_shipped INT;
BEGIN
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Danh sách mặt hàng xuất không được để rỗng.';
  END IF;

  -- Insert shipment header
  INSERT INTO public.shipments (customer_id, created_by, note)
  VALUES (p_customer_id, p_actor_id, p_note)
  RETURNING id INTO v_shipment_id;

  -- Loop through shipment items
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_po_line_id := (v_item->>'po_line_id')::UUID;
    v_product_id := (v_item->>'product_id')::UUID;
    v_qty := (v_item->>'shipped_qty')::INT;

    IF v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'Số lượng xuất hàng phải lớn hơn 0.';
    END IF;

    -- RACE CONDITION FIX: Explicit Row Locking FOR UPDATE on target po_line
    SELECT order_qty, po_id INTO v_order_qty, v_po_id
    FROM public.po_lines
    WHERE id = v_po_line_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'PO Line ID % không tồn tại trong hệ thống.', v_po_line_id;
    END IF;

    -- Calculate total previously shipped qty for this po_line
    SELECT COALESCE(SUM(shipped_qty), 0) INTO v_already_shipped
    FROM public.shipment_items
    WHERE po_line_id = v_po_line_id;

    IF (v_already_shipped + v_qty) > v_order_qty THEN
      RAISE EXCEPTION 'Số lượng xuất hàng lũy kế (% pcs) vượt quá order_qty (% pcs) của PO Line %.',
        (v_already_shipped + v_qty), v_order_qty, v_po_line_id;
    END IF;

    -- Insert shipment item detail
    INSERT INTO public.shipment_items (shipment_id, po_line_id, product_id, shipped_qty)
    VALUES (v_shipment_id, v_po_line_id, v_product_id, v_qty);

    -- Update PO header status based on overall shipment progress
    SELECT COALESCE(SUM(order_qty), 0) INTO v_total_po_order
    FROM public.po_lines WHERE po_id = v_po_id;

    SELECT COALESCE(SUM(si.shipped_qty), 0) INTO v_total_po_shipped
    FROM public.shipment_items si
    JOIN public.po_lines pl ON pl.id = si.po_line_id
    WHERE pl.po_id = v_po_id;

    IF v_total_po_shipped >= v_total_po_order THEN
      UPDATE public.purchase_orders SET status = 'COMPLETED', updated_at = now() WHERE id = v_po_id;
    ELSIF v_total_po_shipped > 0 THEN
      UPDATE public.purchase_orders SET status = 'IN_PRODUCTION', updated_at = now() WHERE id = v_po_id;
    END IF;
  END LOOP;

  RETURN v_shipment_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ----------------------------------------------------------------------------
-- 3. RLS HARDENING (DEFENSE-IN-DEPTH / DENY ALL DIRECT PUBLIC ACCESS)
-- ----------------------------------------------------------------------------
-- Bat RLS cho tat ca 12 bang
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_routings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.po_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.opening_stocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shipments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shipment_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- Xoa tat ca policy cu
DO $$ 
DECLARE 
    r RECORD;
BEGIN
    FOR r IN (SELECT policyname, tablename FROM pg_policies WHERE schemaname = 'public') LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', r.policyname, r.tablename);
    END LOOP;
END $$;

-- Policies Deny All Direct Public Access cho tat ca 12 bang
-- Vi tat ca traffic app chay qua Next.js Server API (service_role bypass RLS),
-- Cac truy cap truc tiep qua PostgREST Anon/Public Key se bi BLOCK 100%.

CREATE POLICY "deny_direct_access_products" ON public.products FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY "deny_direct_access_product_customers" ON public.product_customers FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY "deny_direct_access_product_routings" ON public.product_routings FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY "deny_direct_access_customers" ON public.customers FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY "deny_direct_access_purchase_orders" ON public.purchase_orders FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY "deny_direct_access_po_lines" ON public.po_lines FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY "deny_direct_access_work_orders" ON public.work_orders FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY "deny_direct_access_opening_stocks" ON public.opening_stocks FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY "deny_direct_access_inventory_transactions" ON public.inventory_transactions FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY "deny_direct_access_shipments" ON public.shipments FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY "deny_direct_access_shipment_items" ON public.shipment_items FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY "deny_direct_access_users" ON public.users FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
