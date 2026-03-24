// ═══════════════════════════════════════════════════════════════════════════════
// data.js — Storage e configurazione per il sistema di prenotazioni generico
// ═══════════════════════════════════════════════════════════════════════════════

// ── Utility ──────────────────────────────────────────────────────────────────

function _debounce(fn, delay) {
    let timer;
    return function (...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), delay);
    };
}

function _localDateStr(d = new Date()) {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function _parseSlotTime(str) {
    if (!str || typeof str !== 'string') return null;
    const parts = str.split(' - ');
    if (parts.length !== 2) return null;
    const [sh, sm] = parts[0].trim().split(':').map(Number);
    const [eh, em] = parts[1].trim().split(':').map(Number);
    if ([sh, sm, eh, em].some(isNaN)) return null;
    return { startH: sh, startM: sm, endH: eh, endM: em };
}

// _lsSet and _lsGetJSON are defined in ui.js (loaded before data.js and tenant.js)

function _rpcWithTimeout(promise, ms = 12000) {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('rpc_timeout')), ms))
    ]);
}

// ── Configurazione servizi ───────────────────────────────────────────────────
// Personalizza questi valori per ogni attività

const SLOT_TYPES = {
    SERVICE_1: 'servizio-1',
    SERVICE_2: 'servizio-2',
    SERVICE_3: 'servizio-3',
};

const SLOT_MAX_CAPACITY = {
    'servizio-1': 1,
    'servizio-2': 1,
    'servizio-3': 1,
};

const SLOT_PRICES = {
    'servizio-1': 25,
    'servizio-2': 35,
    'servizio-3': 50,
};

const SLOT_NAMES = {
    'servizio-1': 'Appuntamento Base',
    'servizio-2': 'Appuntamento Standard',
    'servizio-3': 'Appuntamento Premium',
};

// Colori per tipo servizio (usati nel CSS tramite classe)
const SLOT_COLORS = {
    'servizio-1': '#2ecc71',
    'servizio-2': '#3498db',
    'servizio-3': '#9b59b6',
};

// Slot orari — personalizzabili per durata e fascia oraria
const TIME_SLOTS = [
    '09:00 - 10:00',
    '10:00 - 11:00',
    '11:00 - 12:00',
    '12:00 - 13:00',
    '14:00 - 15:00',
    '15:00 - 16:00',
    '16:00 - 17:00',
    '17:00 - 18:00',
    '18:00 - 19:00',
];

const SCHEDULE_VERSION = 'v1';

// Orario settimanale di default — tutti gli slot con servizio base
const DEFAULT_WEEKLY_SCHEDULE = {
    'Lunedì': TIME_SLOTS.map(t => ({ time: t, type: SLOT_TYPES.SERVICE_1 })),
    'Martedì': TIME_SLOTS.map(t => ({ time: t, type: SLOT_TYPES.SERVICE_1 })),
    'Mercoledì': TIME_SLOTS.map(t => ({ time: t, type: SLOT_TYPES.SERVICE_1 })),
    'Giovedì': TIME_SLOTS.map(t => ({ time: t, type: SLOT_TYPES.SERVICE_1 })),
    'Venerdì': TIME_SLOTS.map(t => ({ time: t, type: SLOT_TYPES.SERVICE_1 })),
    'Sabato': [
        '09:00 - 10:00', '10:00 - 11:00', '11:00 - 12:00', '12:00 - 13:00'
    ].map(t => ({ time: t, type: SLOT_TYPES.SERVICE_1 })),
    'Domenica': [],
};

function getWeeklySchedule() {
    const templatesRaw = localStorage.getItem('week_templates');
    if (templatesRaw) {
        try {
            const templates = JSON.parse(templatesRaw);
            const activeId = parseInt(localStorage.getItem('active_week_template') || '1', 10);
            const active = templates.find(t => t.id === activeId);
            if (active && active.schedule) {
                _lsSet('weeklyScheduleTemplate', JSON.stringify(active.schedule));
                return active.schedule;
            }
        } catch { /* corrupted */ }
    }
    const saved = localStorage.getItem('weeklyScheduleTemplate');
    const savedVersion = localStorage.getItem('scheduleVersion');
    if (saved && savedVersion === SCHEDULE_VERSION) {
        try {
            const parsed = JSON.parse(saved);
            const storedTimes = Object.values(parsed).flat().map(s => s.time);
            const isCurrentFormat = storedTimes.length === 0 || storedTimes.every(t => TIME_SLOTS.includes(t));
            if (isCurrentFormat) return parsed;
        } catch { /* corrupted */ }
    }
    localStorage.removeItem('scheduleOverrides');
    _lsSet('weeklyScheduleTemplate', JSON.stringify(DEFAULT_WEEKLY_SCHEDULE));
    _lsSet('scheduleVersion', SCHEDULE_VERSION);
    return DEFAULT_WEEKLY_SCHEDULE;
}

let WEEKLY_SCHEDULE_TEMPLATE = getWeeklySchedule();

// ── BookingStorage ───────────────────────────────────────────────────────────

class BookingStorage {
    static BOOKINGS_KEY = 'app_bookings';
    static STATS_KEY = 'app_stats';
    static _cache = [];

    static getAllBookings() { return this._cache; }

    static _syncRetryTimer = null;

    static async syncFromSupabase({ ownOnly = false } = {}) {
        if (typeof supabaseClient === 'undefined') return;
        const tenantId = typeof CURRENT_TENANT !== 'undefined' && CURRENT_TENANT ? CURRENT_TENANT.id : null;
        if (!tenantId || tenantId.startsWith('demo-')) return; // demo mode: no Supabase sync
        try {
            const user = typeof getCurrentUser === 'function' ? getCurrentUser() : null;
            const isAdmin = sessionStorage.getItem('adminAuth') === 'true';
            const todayStr = _localDateStr();
            const endDate = new Date(); endDate.setDate(endDate.getDate() + 90);
            const endStr = _localDateStr(endDate);

            if (!user && !isAdmin) {
                const { data: availData, error } = await _rpcWithTimeout(
                    supabaseClient.rpc('get_availability_range', { p_tenant_id: tenantId, p_start: todayStr, p_end: endStr })
                ).catch(e => ({ data: null, error: e }));
                if (error) { console.error('[Supabase] availability error:', error.message); return; }
                const synth = this._buildSyntheticBookings(availData, {});
                const local = this._cache.filter(b => !b.id?.startsWith('_avail_'));
                this._cache = [...synth, ...local];
                return;
            }

            let qBookings = supabaseClient.from('bookings').select('*').eq('tenant_id', tenantId).order('created_at', { ascending: false });
            if (ownOnly && user) qBookings = qBookings.eq('user_id', user.id);
            const pastD = new Date(); pastD.setDate(pastD.getDate() - (isAdmin ? 180 : 28));
            const futureD = new Date(); futureD.setDate(futureD.getDate() + 90);
            qBookings = qBookings.gte('date', _localDateStr(pastD)).lte('date', _localDateStr(futureD));

            const fetchAvail = !isAdmin
                ? _rpcWithTimeout(supabaseClient.rpc('get_availability_range', { p_tenant_id: tenantId, p_start: todayStr, p_end: endStr }))
                    .catch(e => ({ data: null, error: e }))
                : Promise.resolve({ data: null, error: null });

            const [{ data, error }, { data: availData, error: e2 }] = await Promise.all([qBookings, fetchAvail]);
            if (error) { console.error('[Supabase] sync error:', error.message); return; }

            const mapped = data.map(row => this._mapRow(row));
            let synth = [];
            if (!isAdmin && availData) {
                const ownCounts = {};
                for (const b of mapped) {
                    if (b.status === 'confirmed') {
                        const k = `${b.date}|${b.time}`;
                        ownCounts[k] = (ownCounts[k] || 0) + 1;
                    }
                }
                synth = this._buildSyntheticBookings(availData, ownCounts);
            }

            const supabaseIds = new Set(mapped.map(m => m.id));
            const local = this._cache.filter(b => !b.id?.startsWith('_avail_'));
            const now = Date.now();
            const pending = local.filter(b => {
                if (supabaseIds.has(b.id) || b.status === 'cancelled') return false;
                return (now - new Date(b.createdAt).getTime()) < 30 * 60 * 1000;
            });

            this._cache = [...mapped, ...synth, ...pending];
            clearTimeout(BookingStorage._syncRetryTimer);
        } catch (e) {
            console.error('[Supabase] sync exception:', e);
            clearTimeout(BookingStorage._syncRetryTimer);
            BookingStorage._syncRetryTimer = setTimeout(() => BookingStorage.syncFromSupabase(), 5000);
        }
    }

    static _mapRow(row) {
        return {
            id:          row.local_id || row.id,
            _sbId:       row.id,
            userId:      row.user_id,
            date:        row.date,
            time:        row.time,
            slotType:    row.slot_type,
            dateDisplay: row.date_display || '',
            name:        row.name,
            email:       row.email,
            whatsapp:    row.whatsapp,
            notes:       row.notes || '',
            status:      row.status,
            paid:        row.paid || false,
            paymentMethod: row.payment_method || null,
            paidAt:      row.paid_at || null,
            createdAt:   row.created_at,
            cancelledAt: row.cancelled_at || null,
            updatedAt:   row.updated_at || null,
        };
    }

    static _buildSyntheticBookings(availData, ownCounts) {
        const result = [];
        for (const row of availData || []) {
            const own = ownCounts[`${row.slot_date}|${row.slot_time}`] || 0;
            const count = Math.max(0, Number(row.confirmed_count) - own);
            for (let i = 0; i < count; i++) {
                result.push({
                    id: `_avail_${row.slot_date}_${row.slot_time.replace(/[: ]/g, '')}_${row.slot_type}_${i}`,
                    date: row.slot_date, time: row.slot_time, slotType: row.slot_type,
                    status: 'confirmed', name: '', email: '', whatsapp: '', notes: '',
                    paid: false, createdAt: row.slot_date + 'T00:00:00.000Z',
                });
            }
        }
        return result;
    }

    static async saveBooking(booking) {
        booking.id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        booking.createdAt = new Date().toISOString();
        booking.status = 'confirmed';

        // Demo mode: salva in cache locale e ritorna ok
        if (typeof supabaseClient === 'undefined') {
            const remainingSpots = this.getRemainingSpots(booking.date, booking.time, booking.slotType);
            if (remainingSpots <= 0) return { ok: false, error: 'slot_full', booking };
            this._cache.push(booking);
            this.updateStats(booking);
            return { ok: true, booking };
        }

        const user = typeof getCurrentUser === 'function' ? getCurrentUser() : null;
        let bookingUserId = user?.id || null;
        if (user && booking.email && user.email && booking.email.toLowerCase() !== user.email.toLowerCase()) {
            try {
                const { data: prof } = await supabaseClient
                    .from('profiles').select('id').eq('email', booking.email.toLowerCase()).maybeSingle();
                bookingUserId = prof?.id || null;
            } catch { /* fallback */ }
        }

        const tenantId = typeof CURRENT_TENANT !== 'undefined' && CURRENT_TENANT ? CURRENT_TENANT.id : null;
        const maxCap = this.getEffectiveCapacity(booking.date, booking.time, booking.slotType);
        const _abortCtrl = new AbortController();
        const _abortTimer = setTimeout(() => _abortCtrl.abort(), 45000);
        let data, error;
        try {
            ({ data, error } = await supabaseClient.rpc('book_slot_atomic', {
                p_tenant_id: tenantId,
                p_local_id: booking.id, p_user_id: bookingUserId,
                p_date: booking.date, p_time: booking.time, p_slot_type: booking.slotType,
                p_max_capacity: maxCap, p_name: booking.name, p_email: booking.email,
                p_whatsapp: booking.whatsapp, p_notes: booking.notes || '',
                p_created_at: booking.createdAt, p_date_display: booking.dateDisplay || ''
            }).abortSignal(_abortCtrl.signal));
        } catch (e) {
            clearTimeout(_abortTimer);
            return { ok: false, error: 'server_error', booking };
        }
        clearTimeout(_abortTimer);
        if (error) return { ok: false, error: 'server_error', booking };
        if (!data?.success) return { ok: false, error: data?.error || 'unknown', booking };

        booking._sbId = data.booking_id || null;
        this._cache.push(booking);
        this.updateStats(booking);
        return { ok: true, booking };
    }

    static getBookingsForSlot(date, time) {
        return this.getAllBookings().filter(b => b.date === date && b.time === time && b.status !== 'cancelled');
    }

    static getEffectiveCapacity(date, time, slotType) {
        const overrides = this.getScheduleOverrides();
        const slots = overrides[date] || [];
        const slot = slots.find(s => s.time === time);
        const isMainType = !slot || slot.type === slotType;
        const base = isMainType ? (SLOT_MAX_CAPACITY[slotType] || 0) : 0;
        if (!slot?.extras?.length) return base;
        return base + slot.extras.filter(e => e.type === slotType).length;
    }

    static getRemainingSpots(date, time, slotType) {
        const bookings = this.getBookingsForSlot(date, time);
        const confirmedCount = bookings.filter(b => b.status === 'confirmed' && (!b.slotType || b.slotType === slotType)).length;
        return this.getEffectiveCapacity(date, time, slotType) - confirmedCount;
    }

    static cancelDirectly(id) {
        const all = this.getAllBookings();
        const booking = all.find(b => b.id === id);
        if (!booking || booking.status !== 'confirmed') return false;
        booking.status = 'cancelled';
        booking.cancelledAt = new Date().toISOString();
        booking.paid = false;
        booking.paymentMethod = null;
        booking.paidAt = null;
        this.replaceAllBookings(all);
        return true;
    }

    static updateStats(booking) {
        const stats = this.getStats();
        stats.totalBookings = (stats.totalBookings || 0) + 1;
        stats.totalRevenue = (stats.totalRevenue || 0) + (SLOT_PRICES[booking.slotType] || 0);
        if (!stats.typeDistribution) stats.typeDistribution = {};
        stats.typeDistribution[booking.slotType] = (stats.typeDistribution[booking.slotType] || 0) + 1;
        if (!stats.dailyBookings) stats.dailyBookings = {};
        stats.dailyBookings[booking.date] = (stats.dailyBookings[booking.date] || 0) + 1;
        _lsSet(this.STATS_KEY, JSON.stringify(stats));
    }

    static getStats() {
        const data = localStorage.getItem(this.STATS_KEY);
        return data ? JSON.parse(data) : { totalBookings: 0, totalRevenue: 0, typeDistribution: {}, dailyBookings: {} };
    }

    // ── Schedule overrides ──────────────────────────────────────────────────

    static _scheduleOverridesCache = null;

    static getScheduleOverrides() {
        if (this._scheduleOverridesCache) return this._scheduleOverridesCache;
        try {
            this._scheduleOverridesCache = JSON.parse(localStorage.getItem('scheduleOverrides') || '{}');
        } catch { this._scheduleOverridesCache = {}; }
        return this._scheduleOverridesCache;
    }

    static saveScheduleOverrides(overrides, changedDates) {
        this._scheduleOverridesCache = overrides;
        _lsSet('scheduleOverrides', JSON.stringify(overrides));
        if (typeof supabaseClient === 'undefined') return;

        const tenantId = typeof CURRENT_TENANT !== 'undefined' && CURRENT_TENANT ? CURRENT_TENANT.id : null;
        const datesToSync = changedDates || Object.keys(overrides);
        const rows = [];
        for (const dateStr of datesToSync) {
            const slots = overrides[dateStr];
            if (slots?.length) {
                for (const slot of slots) {
                    rows.push({ tenant_id: tenantId, date: dateStr, time: slot.time, slot_type: slot.type, extras: slot.extras || [] });
                }
            }
        }

        (async () => {
            try {
                if (rows.length > 0) {
                    const { error } = await supabaseClient.from('schedule_overrides')
                        .upsert(rows, { onConflict: 'date,time' });
                    if (error) console.error('[Supabase] saveScheduleOverrides error:', error.message);
                }
                for (const dateStr of datesToSync) {
                    const activeTimes = (overrides[dateStr] || []).map(s => s.time);
                    const { data: existing } = await supabaseClient.from('schedule_overrides')
                        .select('id, time').eq('date', dateStr);
                    if (existing) {
                        const toDelete = existing.filter(r => !activeTimes.includes(r.time)).map(r => r.id);
                        if (toDelete.length > 0) await supabaseClient.from('schedule_overrides').delete().in('id', toDelete);
                    }
                }
            } catch (e) { console.error('[Supabase] saveScheduleOverrides exception:', e); }
        })();
    }

    static async syncAppSettingsFromSupabase() {
        if (typeof supabaseClient === 'undefined') return;
        const tenantId = typeof CURRENT_TENANT !== 'undefined' && CURRENT_TENANT ? CURRENT_TENANT.id : null;
        if (!tenantId || tenantId.startsWith('demo-')) return;
        try {
            const [schedRes] = await Promise.allSettled([
                supabaseClient.from('schedule_overrides').select('date, time, slot_type, extras').eq('tenant_id', tenantId).order('date').order('time'),
            ]);
            const settRes = { status: 'fulfilled', value: { data: null } }; // settings now in tenants table
            const _v = (r) => r.status === 'fulfilled' ? r.value : { data: null };

            const { data: overridesData } = _v(schedRes);
            const { data: settingsData } = _v(settRes);

            if (overridesData) {
                const overrides = {};
                for (const r of overridesData) {
                    if (!overrides[r.date]) overrides[r.date] = [];
                    const slot = { time: r.time, type: r.slot_type };
                    if (r.extras?.length) slot.extras = r.extras;
                    overrides[r.date].push(slot);
                }
                BookingStorage._scheduleOverridesCache = overrides;
                _lsSet('scheduleOverrides', JSON.stringify(overrides));
            }

            if (settingsData?.length) {
                const sMap = Object.fromEntries(settingsData.map(r => [r.key, r.value]));
                if (sMap.week_templates) _lsSet(WeekTemplateStorage.KEY, sMap.week_templates);
                if (sMap.active_week_template) _lsSet(WeekTemplateStorage.ACTIVE_KEY, sMap.active_week_template);
                WEEKLY_SCHEDULE_TEMPLATE = getWeeklySchedule();
            }
        } catch (e) { console.error('[Supabase] syncAppSettings exception:', e); }
    }

    static async syncScheduleFromSupabase() { await this.syncAppSettingsFromSupabase(); }

    static replaceAllBookings(bookings) {
        const prev = [...this._cache];
        this._cache = bookings;
        if (typeof supabaseClient === 'undefined') return;

        const prevMap = Object.fromEntries(prev.map(b => [b.id, b]));
        const changed = bookings.filter(b => {
            const p = prevMap[b.id];
            if (!p) return false;
            return p.status !== b.status || p.paid !== b.paid || p.paymentMethod !== b.paymentMethod || p.paidAt !== b.paidAt;
        });

        for (const b of changed) {
            if (!b._sbId) continue;
            supabaseClient.rpc('admin_update_booking', {
                p_booking_id: b._sbId,
                p_status: b.status,
                p_paid: b.paid || false,
                p_payment_method: b.paymentMethod || null,
                p_paid_at: b.paidAt || null,
                p_credit_applied: 0,
                p_cancellation_requested_at: null,
                p_cancelled_at: b.cancelledAt || null,
                p_cancelled_payment_method: null,
                p_cancelled_paid_at: null,
                p_cancelled_with_bonus: false,
                p_cancelled_with_penalty: false,
                p_cancelled_refund_pct: null,
                p_expected_updated_at: b.updatedAt || null,
            }).then(({ error }) => {
                if (error) console.error('[Supabase] admin_update_booking error:', error.message);
            });
        }
    }

    static removeBookingById(id) {
        if (!id) return;
        const all = this._cache;
        const idx = all.findIndex(b => b.id === id);
        if (idx !== -1 && all[idx].status !== 'cancelled') {
            const updated = all.map((b, i) => i !== idx ? b : {
                ...b, status: 'cancelled', cancelledAt: new Date().toISOString(), paid: false, paymentMethod: null, paidAt: null,
            });
            this.replaceAllBookings(updated);
        }
    }

    // ── Ensure current + next week overrides exist ───────────────────────────

    static _ensureWeekOverrides() {
        const overrides = _lsGetJSON('scheduleOverrides', {});
        const dayNames = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'];
        const now = new Date();
        const dow = now.getDay();
        const monday = new Date(now);
        monday.setDate(now.getDate() + (dow === 0 ? -6 : 1 - dow));
        monday.setHours(0, 0, 0, 0);

        let changed = false;
        for (let w = 0; w < 2; w++) {
            for (let d = 0; d < 7; d++) {
                const date = new Date(monday);
                date.setDate(monday.getDate() + w * 7 + d);
                const dateStr = this.formatDate(date);
                if (!overrides[dateStr]) {
                    const slots = DEFAULT_WEEKLY_SCHEDULE[dayNames[date.getDay()]] || [];
                    if (slots.length > 0) { overrides[dateStr] = slots; changed = true; }
                }
            }
        }
        if (changed) {
            this._scheduleOverridesCache = overrides;
            _lsSet('scheduleOverrides', JSON.stringify(overrides));
        }
    }

    static initializeDemoData() {
        this._ensureWeekOverrides();
        if (localStorage.getItem('dataClearedByUser') === 'true') return;
        if (this._cache.length > 0) return;

        // Demo data: genera prenotazioni fittizie per la demo
        const clients = [
            { name: 'Mario Rossi', email: 'mario.rossi@email.it', whatsapp: '+39 348 1234567' },
            { name: 'Laura Bianchi', email: 'laura.bianchi@email.it', whatsapp: '+39 347 7654321' },
            { name: 'Giuseppe Verdi', email: 'giuseppe.verdi@email.it', whatsapp: '+39 333 2345678' },
            { name: 'Anna Ferrari', email: 'anna.ferrari@email.it', whatsapp: '+39 320 8765432' },
            { name: 'Francesca Romano', email: 'francesca.romano@email.it', whatsapp: '+39 338 9876543' },
        ];

        const demoBookings = [];
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const start = new Date(today); start.setDate(today.getDate() - 14);
        const dayNames = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'];

        const current = new Date(start);
        while (current <= today) {
            const dayName = dayNames[current.getDay()];
            const slots = DEFAULT_WEEKLY_SCHEDULE[dayName] || [];
            const dateStr = this.formatDate(current);
            const isPast = current < today;

            slots.forEach((slot, si) => {
                if (Math.random() > 0.4) {
                    const client = clients[si % clients.length];
                    demoBookings.push({
                        id: `demo-${dateStr}-${slot.time.replace(/[^0-9]/g, '')}-${si}`,
                        date: dateStr, time: slot.time, slotType: slot.type,
                        name: client.name, email: client.email, whatsapp: client.whatsapp,
                        notes: '', paid: isPast && Math.random() > 0.1,
                        paymentMethod: isPast ? 'contanti' : null,
                        createdAt: start.toISOString(), status: 'confirmed',
                    });
                }
            });
            current.setDate(current.getDate() + 1);
        }

        this._cache = demoBookings;
    }

    static formatDate(date) {
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    }
}

// ── CreditStorage (pagamenti/crediti) ────────────────────────────────────────

class CreditStorage {
    static _cache = {};
    static _getAll() { return this._cache; }

    static async _save(data) {
        this._cache = data;
        if (typeof supabaseClient === 'undefined') return;
        const rows = Object.values(data).map(r => ({
            name: r.name, whatsapp: r.whatsapp || null,
            email: (r.email || '').toLowerCase(), balance: r.balance || 0,
        }));
        if (rows.length === 0) return;
        await supabaseClient.from('credits').upsert(rows, { onConflict: 'email' })
            .then(({ error }) => { if (error) console.error('[Supabase] credits save error:', error.message); });
    }

    static async syncFromSupabase() {
        if (typeof supabaseClient === 'undefined') return;
        try {
            const { data, error } = await supabaseClient.from('credits').select('id, name, whatsapp, email, balance');
            if (error || !data?.length) return;
            const result = {};
            for (const c of data) {
                result[`${c.whatsapp || ''}||${c.email}`] = { name: c.name, whatsapp: c.whatsapp || '', email: c.email, balance: c.balance, history: [] };
            }
            this._cache = result;
        } catch (e) { console.error('[Supabase] credits sync exception:', e); }
    }

    static _key(whatsapp, email) { return `${whatsapp}||${email}`; }

    static _matchContact(record, whatsapp, email) {
        const normStored = normalizePhone(record.whatsapp);
        const normInput = normalizePhone(whatsapp);
        const phoneMatch = normInput && normStored && normStored === normInput;
        const emailMatch = email && record.email && record.email.toLowerCase() === email.toLowerCase();
        return phoneMatch || emailMatch;
    }

    static _findKey(whatsapp, email) {
        for (const [key, record] of Object.entries(this._getAll())) {
            if (this._matchContact(record, whatsapp, email)) return key;
        }
        return null;
    }

    static getBalance(whatsapp, email) {
        const key = this._findKey(whatsapp, email);
        return key ? (this._getAll()[key]?.balance || 0) : 0;
    }

    static async addCredit(whatsapp, email, name, amount, note = '') {
        const all = this._getAll();
        let key = this._findKey(whatsapp, email);
        if (!key) key = this._key(whatsapp, email);
        if (!all[key]) all[key] = { name, whatsapp, email, balance: 0, history: [] };
        all[key].name = name;
        all[key].balance = Math.round((all[key].balance + amount) * 100) / 100;
        all[key].history.push({ date: new Date().toISOString(), amount, note });
        await this._save(all);
    }

    static getRecord(whatsapp, email) {
        const key = this._findKey(whatsapp, email);
        return key ? this._getAll()[key] : null;
    }

    static getAllWithBalance() {
        return Object.values(this._getAll()).filter(c => c.balance > 0).sort((a, b) => b.balance - a.balance);
    }
}

// ── WeekTemplateStorage ──────────────────────────────────────────────────────

class WeekTemplateStorage {
    static KEY = 'week_templates';
    static ACTIVE_KEY = 'active_week_template';

    static _defaultTemplates() {
        return [
            { id: 1, name: 'Settimana Standard 1', schedule: JSON.parse(JSON.stringify(DEFAULT_WEEKLY_SCHEDULE)) },
            { id: 2, name: 'Settimana Standard 2', schedule: JSON.parse(JSON.stringify(DEFAULT_WEEKLY_SCHEDULE)) },
            { id: 3, name: 'Settimana Standard 3', schedule: JSON.parse(JSON.stringify(DEFAULT_WEEKLY_SCHEDULE)) },
        ];
    }

    static getAll() {
        // Priorità: tenant config → localStorage → default
        if (typeof CURRENT_TENANT !== 'undefined' && CURRENT_TENANT?.week_templates?.length) {
            return CURRENT_TENANT.week_templates;
        }
        const raw = localStorage.getItem(this.KEY);
        if (raw) { try { return JSON.parse(raw); } catch {} }
        const defaults = this._defaultTemplates();
        _lsSet(this.KEY, JSON.stringify(defaults));
        return defaults;
    }

    static save(templates) {
        _lsSet(this.KEY, JSON.stringify(templates));
        // Salva nel tenant (Supabase)
        if (typeof saveTenantConfig === 'function') {
            saveTenantConfig({ week_templates: templates });
        }
    }

    static getActiveId() {
        if (typeof CURRENT_TENANT !== 'undefined' && CURRENT_TENANT?.active_week_template) {
            return CURRENT_TENANT.active_week_template;
        }
        return parseInt(localStorage.getItem(this.ACTIVE_KEY) || '1', 10);
    }

    static setActiveId(id) {
        _lsSet(this.ACTIVE_KEY, String(id));
        if (typeof saveTenantConfig === 'function') {
            saveTenantConfig({ active_week_template: id });
        }
        const templates = this.getAll();
        const active = templates.find(t => t.id === id);
        if (active) {
            WEEKLY_SCHEDULE_TEMPLATE = active.schedule;
            _lsSet('weeklyScheduleTemplate', JSON.stringify(active.schedule));
        }
    }

    static getActiveSchedule() {
        const templates = this.getAll();
        const active = templates.find(t => t.id === this.getActiveId());
        return active ? active.schedule : DEFAULT_WEEKLY_SCHEDULE;
    }

    static updateTemplate(id, data) {
        const templates = this.getAll();
        const tpl = templates.find(t => t.id === id);
        if (!tpl) return;
        if (data.name !== undefined) tpl.name = data.name;
        if (data.schedule !== undefined) tpl.schedule = data.schedule;
        this.save(templates);
        if (id === this.getActiveId()) {
            WEEKLY_SCHEDULE_TEMPLATE = tpl.schedule;
            _lsSet('weeklyScheduleTemplate', JSON.stringify(tpl.schedule));
        }
    }
}

// ── UserStorage ──────────────────────────────────────────────────────────────

class UserStorage {
    static _cache = [];

    static getAll() {
        const seenEmails = new Set();
        const seenPhones = new Set();
        const result = [];
        const _normPhone = p => (p || '').replace(/\D/g, '').slice(-10);

        const _add = (user) => {
            const { name, email, whatsapp } = user;
            if (!name || (!email && !whatsapp)) return;
            const e = (email || '').toLowerCase().trim();
            const p = _normPhone(whatsapp);
            if ((e && seenEmails.has(e)) || (p.length >= 9 && seenPhones.has(p))) return;
            if (e) seenEmails.add(e);
            if (p.length >= 9) seenPhones.add(p);
            result.push({ ...user, email: email || '', whatsapp: whatsapp || '' });
        };

        this._cache.forEach(_add);
        BookingStorage._cache.filter(b => b.name && (b.email || b.whatsapp)).forEach(_add);
        return result.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    }

    static async syncUsersFromSupabase() {
        if (typeof supabaseClient === 'undefined') return;
        try {
            const { data, error } = await supabaseClient.rpc('get_all_profiles');
            if (error || !data?.length) return;
            this._cache = data.map(row => ({
                name: row.name || '', email: row.email || '', whatsapp: row.whatsapp || '',
            }));
        } catch (e) { console.error('[Supabase] syncUsers exception:', e); }
    }
}

// ── Settings helper ──────────────────────────────────────────────────────────

function _upsertSetting(key, value) {
    if (typeof supabaseClient === 'undefined') return;
    supabaseClient.from('settings').upsert({
        key, value: String(value), updated_at: new Date().toISOString()
    }).then(({ error }) => { if (error) console.error(`[Supabase] setting save error:`, error.message); });
}

// ── Init demo data on load ───────────────────────────────────────────────────
BookingStorage.initializeDemoData();
