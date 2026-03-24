-- ══════════════════════════════════════════════════════════════════════════════
-- Schema Multi-Tenant — Sistema di Prenotazione Appuntamenti SaaS
-- ══════════════════════════════════════════════════════════════════════════════

-- ── Helper functions ─────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION is_super_admin()
RETURNS BOOLEAN AS $$
BEGIN
    RETURN (SELECT (raw_app_meta_data->>'role')::text = 'super_admin'
            FROM auth.users WHERE id = auth.uid());
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── Tenants ──────────────────────────────────────────────────────────────────

CREATE TABLE tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    email TEXT DEFAULT '',
    address TEXT DEFAULT '',
    maps_url TEXT DEFAULT '',
    logo_url TEXT DEFAULT '',
    primary_color TEXT DEFAULT '#4F46E5',
    header_color TEXT DEFAULT '#1e1b4b',
    slot_duration TEXT DEFAULT '60 minuti',
    booking_notice TEXT DEFAULT '',
    -- Orari giornalieri
    opening_time TEXT DEFAULT '09:00',         -- apertura
    closing_time TEXT DEFAULT '19:00',         -- chiusura
    slot_duration_min INT DEFAULT 60,          -- durata slot in minuti
    break_start TEXT DEFAULT '',               -- pausa pranzo inizio (es. '13:00', vuoto = nessuna)
    break_end TEXT DEFAULT '',                 -- pausa pranzo fine (es. '14:00')
    closed_days JSONB DEFAULT '["Domenica"]',  -- giorni di chiusura
    -- Pagamenti
    payments_enabled BOOLEAN DEFAULT FALSE,    -- se false, nessun tracciamento pagamenti
    -- Annullamento
    cancellation_hours INT DEFAULT 24,         -- ore minime per annullare gratis
    cancellation_policy TEXT DEFAULT 'Puoi annullare gratuitamente fino a 24 ore prima dell''appuntamento.',
    -- Notifiche
    notify_admin_new_booking BOOLEAN DEFAULT TRUE,    -- notifica admin nuova prenotazione
    notify_admin_cancellation BOOLEAN DEFAULT TRUE,   -- notifica admin annullamento
    notify_client_reminder BOOLEAN DEFAULT TRUE,      -- promemoria al cliente
    reminder_times JSONB DEFAULT '[24, 1]',           -- array ore prima dell'appuntamento (es. [24, 1] = 24h e 1h prima)
    -- Servizi: [{id, name, price, capacity, color, active}]
    services JSONB DEFAULT '[
        {"id":"servizio-1","name":"Appuntamento Base","price":25,"capacity":1,"color":"#2ecc71","active":true},
        {"id":"servizio-2","name":"Appuntamento Standard","price":35,"capacity":1,"color":"#3498db","active":true},
        {"id":"servizio-3","name":"Appuntamento Premium","price":50,"capacity":1,"color":"#9b59b6","active":true}
    ]',
    -- Orari settimanali: [{id, name, schedule: {Lunedi: [{time, type}]}}]
    week_templates JSONB DEFAULT '[]',
    active_week_template INT DEFAULT 1,
    -- Billing (Stripe)
    plan TEXT DEFAULT 'trial',                 -- 'trial', 'active', 'past_due', 'cancelled', 'expired'
    trial_ends_at TIMESTAMPTZ DEFAULT (now() + interval '30 days'),
    stripe_customer_id TEXT,                   -- Stripe Customer ID (cus_xxx)
    stripe_subscription_id TEXT,               -- Stripe Subscription ID (sub_xxx)
    plan_updated_at TIMESTAMPTZ,
    --
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view active tenants" ON tenants FOR SELECT USING (active = TRUE OR is_super_admin());
CREATE POLICY "Super admin manage tenants" ON tenants FOR ALL USING (is_super_admin());

-- ── Tenant Members ───────────────────────────────────────────────────────────

CREATE TABLE tenant_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'admin', -- 'owner', 'admin', 'staff'
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(tenant_id, user_id)
);

ALTER TABLE tenant_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members view own" ON tenant_members FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Super admin manage members" ON tenant_members FOR ALL USING (is_super_admin());

-- Tenant admin check
CREATE OR REPLACE FUNCTION is_tenant_admin(p_tenant_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM tenant_members
        WHERE tenant_id = p_tenant_id
        AND user_id = auth.uid()
        AND role IN ('owner', 'admin', 'staff')
    ) OR is_super_admin();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Tenant admin can update their own tenant
CREATE POLICY "Tenant admin update tenant" ON tenants FOR UPDATE USING (
    EXISTS (SELECT 1 FROM tenant_members WHERE tenant_id = tenants.id AND user_id = auth.uid() AND role IN ('owner', 'admin'))
);

-- Tenant admin can manage members of their tenant
CREATE POLICY "Tenant admin manage members" ON tenant_members FOR ALL USING (
    EXISTS (SELECT 1 FROM tenant_members tm WHERE tm.tenant_id = tenant_members.tenant_id AND tm.user_id = auth.uid() AND tm.role IN ('owner', 'admin'))
);

-- ── Profiles ─────────────────────────────────────────────────────────────────

CREATE TABLE profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL UNIQUE,
    whatsapp TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own profile" ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users update own profile" ON profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Users insert own profile" ON profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "Super admin view all profiles" ON profiles FOR SELECT USING (is_super_admin());

-- ── Bookings ─────────────────────────────────────────────────────────────────

CREATE TABLE bookings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    local_id TEXT,
    user_id UUID REFERENCES auth.users(id),
    date DATE NOT NULL,
    time TEXT NOT NULL,
    slot_type TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    whatsapp TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'confirmed',
    paid BOOLEAN DEFAULT FALSE,
    payment_method TEXT,
    paid_at TIMESTAMPTZ,
    date_display TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT now(),
    cancelled_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_bookings_tenant_date ON bookings(tenant_id, date);
CREATE INDEX idx_bookings_user ON bookings(user_id);

ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own bookings" ON bookings FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert bookings" ON bookings FOR INSERT WITH CHECK (
    auth.uid() = user_id AND EXISTS (SELECT 1 FROM tenants WHERE id = tenant_id AND active = TRUE)
);
CREATE POLICY "Tenant admin view bookings" ON bookings FOR SELECT USING (is_tenant_admin(tenant_id));
CREATE POLICY "Tenant admin update bookings" ON bookings FOR UPDATE USING (is_tenant_admin(tenant_id));
CREATE POLICY "Tenant admin delete bookings" ON bookings FOR DELETE USING (is_tenant_admin(tenant_id));
CREATE POLICY "Super admin all bookings" ON bookings FOR ALL USING (is_super_admin());

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER bookings_updated_at BEFORE UPDATE ON bookings FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── Schedule Overrides ───────────────────────────────────────────────────────

CREATE TABLE schedule_overrides (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    date DATE NOT NULL,
    time TEXT NOT NULL,
    slot_type TEXT NOT NULL,
    extras JSONB DEFAULT '[]',
    UNIQUE(tenant_id, date, time)
);

CREATE INDEX idx_schedule_tenant ON schedule_overrides(tenant_id, date);

ALTER TABLE schedule_overrides ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone view schedule" ON schedule_overrides FOR SELECT USING (TRUE);
CREATE POLICY "Tenant admin manage schedule" ON schedule_overrides FOR ALL USING (is_tenant_admin(tenant_id));

-- ── Credits ──────────────────────────────────────────────────────────────────

CREATE TABLE credits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    name TEXT NOT NULL DEFAULT '',
    whatsapp TEXT,
    email TEXT NOT NULL,
    balance NUMERIC(10,2) DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(tenant_id, email)
);

ALTER TABLE credits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant admin manage credits" ON credits FOR ALL USING (is_tenant_admin(tenant_id));

-- ── Push Subscriptions ───────────────────────────────────────────────────────

CREATE TABLE push_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL UNIQUE,
    keys JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own subs" ON push_subscriptions FOR ALL USING (auth.uid() = user_id);

-- ══════════════════════════════════════════════════════════════════════════════
-- RPC Functions (all tenant-aware)
-- ══════════════════════════════════════════════════════════════════════════════

-- Atomic booking
CREATE OR REPLACE FUNCTION book_slot_atomic(
    p_tenant_id UUID,
    p_local_id TEXT,
    p_user_id UUID,
    p_date DATE,
    p_time TEXT,
    p_slot_type TEXT,
    p_max_capacity INT,
    p_name TEXT,
    p_email TEXT,
    p_whatsapp TEXT,
    p_notes TEXT,
    p_created_at TIMESTAMPTZ,
    p_date_display TEXT
) RETURNS JSONB AS $$
DECLARE v_count INT; v_booking_id UUID;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext(p_tenant_id::text || p_date::text || p_time));
    SELECT count(*) INTO v_count FROM bookings
    WHERE tenant_id = p_tenant_id AND date = p_date AND time = p_time
      AND slot_type = p_slot_type AND status = 'confirmed';
    IF v_count >= p_max_capacity THEN
        RETURN jsonb_build_object('success', false, 'error', 'slot_full');
    END IF;
    INSERT INTO bookings (tenant_id, local_id, user_id, date, time, slot_type, name, email, whatsapp, notes, created_at, date_display)
    VALUES (p_tenant_id, p_local_id, p_user_id, p_date, p_time, p_slot_type, p_name, p_email, p_whatsapp, p_notes, p_created_at, p_date_display)
    RETURNING id INTO v_booking_id;
    RETURN jsonb_build_object('success', true, 'booking_id', v_booking_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Availability range (anonymous-safe)
CREATE OR REPLACE FUNCTION get_availability_range(p_tenant_id UUID, p_start DATE, p_end DATE)
RETURNS TABLE(slot_date DATE, slot_time TEXT, slot_type TEXT, confirmed_count BIGINT) AS $$
BEGIN
    RETURN QUERY
    SELECT b.date, b.time, b.slot_type, count(*)
    FROM bookings b
    WHERE b.tenant_id = p_tenant_id AND b.date BETWEEN p_start AND p_end AND b.status = 'confirmed'
    GROUP BY b.date, b.time, b.slot_type;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Admin update booking
CREATE OR REPLACE FUNCTION admin_update_booking(
    p_booking_id UUID, p_status TEXT, p_paid BOOLEAN, p_payment_method TEXT,
    p_paid_at TIMESTAMPTZ, p_cancelled_at TIMESTAMPTZ DEFAULT NULL,
    p_expected_updated_at TIMESTAMPTZ DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE v_tenant_id UUID;
BEGIN
    SELECT tenant_id INTO v_tenant_id FROM bookings WHERE id = p_booking_id;
    IF NOT is_tenant_admin(v_tenant_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'not_admin');
    END IF;
    UPDATE bookings SET status = p_status, paid = p_paid, payment_method = p_payment_method,
        paid_at = p_paid_at, cancelled_at = p_cancelled_at
    WHERE id = p_booking_id;
    RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Get all profiles for a tenant (via bookings + tenant_members)
CREATE OR REPLACE FUNCTION get_tenant_profiles(p_tenant_id UUID)
RETURNS TABLE(name TEXT, email TEXT, whatsapp TEXT) AS $$
BEGIN
    IF NOT is_tenant_admin(p_tenant_id) THEN RETURN; END IF;
    RETURN QUERY
    SELECT DISTINCT p.name, p.email, p.whatsapp FROM profiles p
    WHERE p.id IN (SELECT DISTINCT user_id FROM bookings WHERE tenant_id = p_tenant_id AND user_id IS NOT NULL)
    ORDER BY p.name;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Check WhatsApp uniqueness
CREATE OR REPLACE FUNCTION is_whatsapp_taken(phone TEXT, exclude_user_id UUID DEFAULT NULL)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (SELECT 1 FROM profiles WHERE whatsapp = phone AND (exclude_user_id IS NULL OR id != exclude_user_id));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── Tenant Invites (pending admin invitations) ───────────────────────────────

CREATE TABLE tenant_invites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'admin',
    claimed BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(tenant_id, email)
);

ALTER TABLE tenant_invites ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Super admin manage invites" ON tenant_invites FOR ALL USING (is_super_admin());

-- ── Create profile + auto-link to tenant on signup ───────────────────────────

CREATE OR REPLACE FUNCTION handle_new_user() RETURNS TRIGGER AS $$
DECLARE
    v_invite RECORD;
BEGIN
    -- 1. Crea il profilo
    INSERT INTO profiles (id, name, email, whatsapp)
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', ''),
        COALESCE(NEW.email, ''),
        COALESCE(NEW.raw_user_meta_data->>'whatsapp', '')
    ) ON CONFLICT (id) DO NOTHING;

    -- 2. Collega automaticamente ai tenant che hanno un invito pendente per questa email
    FOR v_invite IN
        SELECT tenant_id, role FROM tenant_invites
        WHERE email = lower(NEW.email) AND claimed = FALSE
    LOOP
        INSERT INTO tenant_members (tenant_id, user_id, role)
        VALUES (v_invite.tenant_id, NEW.id, v_invite.role)
        ON CONFLICT (tenant_id, user_id) DO NOTHING;

        UPDATE tenant_invites SET claimed = TRUE
        WHERE tenant_id = v_invite.tenant_id AND email = lower(NEW.email);
    END LOOP;

    -- 3. Se l'utente è stato invitato via metadata (inviteUserByEmail), collega anche da lì
    IF NEW.raw_user_meta_data->>'tenant_id' IS NOT NULL THEN
        INSERT INTO tenant_members (tenant_id, user_id, role)
        VALUES (
            (NEW.raw_user_meta_data->>'tenant_id')::UUID,
            NEW.id,
            COALESCE(NEW.raw_user_meta_data->>'role', 'admin')
        ) ON CONFLICT (tenant_id, user_id) DO NOTHING;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ── Enable Realtime ──────────────────────────────────────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE bookings;
ALTER PUBLICATION supabase_realtime ADD TABLE schedule_overrides;
ALTER PUBLICATION supabase_realtime ADD TABLE tenants;
