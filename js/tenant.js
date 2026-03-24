// ══════════════════════════════════════════════════════════════════════════════
// tenant.js — Multi-tenant resolution & routing
// Caricato PRIMA di tutti gli altri script (dopo supabase-client.js)
//
// URL structure: pagina.html#slug  (es. index.html#barbiere-mario)
// ══════════════════════════════════════════════════════════════════════════════

const TENANT_SLUG = (window.location.hash || '').replace('#', '').split('/')[0] || null;
let CURRENT_TENANT = null;

// ── Resolve tenant from Supabase or demo ─────────────────────────────────────

async function resolveTenant() {
    if (!TENANT_SLUG) return null;

    // Con Supabase: carica il tenant dal DB
    if (typeof supabaseClient !== 'undefined') {
        try {
            const { data, error } = await supabaseClient
                .from('tenants')
                .select('*')
                .eq('slug', TENANT_SLUG)
                .eq('active', true)
                .maybeSingle();
            if (!error && data) {
                CURRENT_TENANT = data;
                _applyTenantConfig(data);
                return data;
            }
        } catch (e) {
            console.warn('[Tenant] Resolve error:', e.message);
        }
    }

    // Senza Supabase o tenant non trovato: usa config demo da localStorage
    const localConfig = _lsGetJSON('demo_tenant_' + TENANT_SLUG, null);
    if (localConfig) {
        CURRENT_TENANT = localConfig;
        _applyTenantConfig(localConfig);
        return localConfig;
    }

    // Primo accesso in demo: crea un tenant demo
    const demoTenant = {
        id: 'demo-' + TENANT_SLUG,
        slug: TENANT_SLUG,
        name: _slugToName(TENANT_SLUG),
        description: 'Sistema di prenotazione appuntamenti',
        phone: '', email: '', address: '', maps_url: '',
        logo_url: '', primary_color: '#4F46E5', header_color: '#1e1b4b',
        slot_duration: '60 minuti', booking_notice: '',
        // Orari
        opening_time: '09:00', closing_time: '19:00',
        slot_duration_min: 60,
        break_start: '', break_end: '',
        closed_days: ['Domenica'],
        // Pagamenti
        payments_enabled: false,
        // Annullamento
        cancellation_hours: 24,
        cancellation_policy: 'Puoi annullare gratuitamente fino a 24 ore prima dell\'appuntamento.',
        // Notifiche
        notify_admin_new_booking: true,
        notify_admin_cancellation: true,
        notify_client_reminder: true,
        reminder_times: [24, 1],
        // Clienti manuali
        manual_clients: [],
        // Servizi
        services: [
            { id: 'servizio-1', name: 'Appuntamento Base', price: 25, capacity: 1, color: '#2ecc71', active: true },
            { id: 'servizio-2', name: 'Appuntamento Standard', price: 35, capacity: 1, color: '#3498db', active: true },
            { id: 'servizio-3', name: 'Appuntamento Premium', price: 50, capacity: 1, color: '#9b59b6', active: true },
        ],
        week_templates: [],
        active_week_template: 1,
        active: true,
    };
    _lsSet('demo_tenant_' + TENANT_SLUG, JSON.stringify(demoTenant));
    CURRENT_TENANT = demoTenant;
    _applyTenantConfig(demoTenant);
    return demoTenant;
}

// ── Apply tenant config to the page ──────────────────────────────────────────

function _applyTenantConfig(tenant) {
    // Aggiorna i servizi globali da data.js
    if (tenant.services && Array.isArray(tenant.services)) {
        tenant.services.forEach(s => {
            SLOT_NAMES[s.id] = s.name;
            SLOT_PRICES[s.id] = s.price;
            SLOT_MAX_CAPACITY[s.id] = s.capacity;
            if (typeof SLOT_COLORS !== 'undefined') SLOT_COLORS[s.id] = s.color;
        });
    }

    // Aggiorna branding
    if (tenant.name) {
        document.title = tenant.name;
        const brandText = document.querySelector('.brand-text');
        if (brandText) brandText.textContent = tenant.name;
    }
    // Logo nella navbar
    const brandLink = document.querySelector('.nav-brand-link');
    if (brandLink) {
        if (tenant.logo_url) {
            // Sostituisci emoji con immagine logo
            let logoImg = brandLink.querySelector('.nav-brand-logo');
            if (!logoImg) {
                logoImg = document.createElement('img');
                logoImg.className = 'nav-brand-logo';
                brandLink.insertBefore(logoImg, brandLink.firstChild);
                // Nascondi l'emoji
                const emoji = brandLink.childNodes[0];
                if (emoji && emoji.nodeType === 3 && emoji.textContent.trim()) emoji.textContent = '';
            }
            logoImg.src = tenant.logo_url;
            logoImg.alt = tenant.name || 'Logo';
        }
    }
    // Rimuovi eventuali emoji rimaste nel brand link
    if (brandLink) {
        brandLink.childNodes.forEach(node => {
            if (node.nodeType === 3 && node.textContent.trim()) node.textContent = ' ';
        });
    }
    if (tenant.primary_color && tenant.primary_color !== '#4F46E5') {
        document.documentElement.style.setProperty('--primary-cyan', tenant.primary_color);
        document.documentElement.style.setProperty('--primary-cyan-dark', _darkenColor(tenant.primary_color, 15));
    }
    if (tenant.header_color && tenant.header_color !== '#1e1b4b') {
        document.documentElement.style.setProperty('--dark-bg', tenant.header_color);
        document.documentElement.style.setProperty('--dark-gray', _darkenColor(tenant.header_color, -10));
    }
    // Hero (index.html)
    const heroName = document.getElementById('heroName');
    if (heroName && tenant.name) heroName.textContent = tenant.name;
    const heroDesc = document.getElementById('heroDescription');
    if (heroDesc && tenant.description) heroDesc.textContent = tenant.description;
    const heroDur = document.querySelector('#heroDuration span');
    if (heroDur && tenant.slot_duration) heroDur.textContent = tenant.slot_duration;
    if (tenant.address) {
        const addr = document.getElementById('heroAddress');
        const addrText = document.getElementById('heroAddressText');
        if (addr && addrText) {
            addrText.textContent = tenant.address;
            addr.style.display = '';
            if (tenant.maps_url) {
                addr.style.cursor = 'pointer';
                addr.onclick = () => window.open(tenant.maps_url, '_blank');
            }
        }
    }

    // PWA manifest dinamico per tenant
    _setDynamicManifest(tenant);
}

function _setDynamicManifest(tenant) {
    const manifest = {
        name: tenant.name || 'Prenotazioni',
        short_name: (tenant.name || 'Prenota').substring(0, 12),
        description: tenant.description || 'Sistema di prenotazione appuntamenti',
        start_url: './index.html#' + (tenant.slug || ''),
        scope: './',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#ffffff',
        theme_color: tenant.primary_color || '#4F46E5',
        lang: 'it',
        icons: [
            { src: tenant.logo_url || './images/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: tenant.logo_url || './images/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        ]
    };
    const blob = new Blob([JSON.stringify(manifest)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.querySelector('link[rel="manifest"]');
    if (link) link.href = url;
    // Aggiorna anche il theme-color meta
    const themeMeta = document.querySelector('meta[name="theme-color"]');
    if (themeMeta) themeMeta.content = tenant.primary_color || '#4F46E5';
}

// ── URL helpers ──────────────────────────────────────────────────────────────

function tenantUrl(page) {
    if (!TENANT_SLUG) return page;
    return page + '#' + TENANT_SLUG;
}

function rewriteTenantLinks() {
    if (!TENANT_SLUG) return;
    document.querySelectorAll('a[href="/"], a[href="index.html"]').forEach(a => a.href = 'index.html#' + TENANT_SLUG);
    document.querySelectorAll('a[href="login.html"]').forEach(a => a.href = 'login.html#' + TENANT_SLUG);
    document.querySelectorAll('a[href="prenotazioni.html"]').forEach(a => a.href = 'prenotazioni.html#' + TENANT_SLUG);
    document.querySelectorAll('a[href="admin.html"]').forEach(a => a.href = 'admin.html#' + TENANT_SLUG);
}

// ── Check tenant billing status ───────────────────────────────────────────────

function isTenantAccessible() {
    if (!CURRENT_TENANT) return false;
    if (CURRENT_TENANT.id?.startsWith('demo-')) return true; // demo always accessible
    const plan = CURRENT_TENANT.plan || 'trial';
    if (plan === 'active') return true;
    if (plan === 'trial') {
        const trialEnd = CURRENT_TENANT.trial_ends_at ? new Date(CURRENT_TENANT.trial_ends_at) : null;
        if (!trialEnd || trialEnd > new Date()) return true;
        return false; // trial expired
    }
    return false; // cancelled, expired, past_due
}

function showTenantExpiredPage() {
    const name = CURRENT_TENANT?.name || 'Questa attività';
    document.body.innerHTML = `
    <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f8f9fa;font-family:system-ui,sans-serif;">
        <div style="text-align:center;max-width:450px;padding:2rem;">
            <div style="font-size:3rem;margin-bottom:1rem;">⏸</div>
            <h1 style="font-size:1.5rem;color:#333;margin-bottom:0.5rem;">${_escHtml(name)}</h1>
            <p style="color:#888;line-height:1.6;">Il servizio di prenotazione è momentaneamente sospeso.<br>Contatta direttamente l'attività per prenotare.</p>
            ${CURRENT_TENANT?.phone ? `<p style="margin-top:1rem;"><a href="tel:${_escHtml(CURRENT_TENANT.phone)}" style="color:#4F46E5;font-weight:600;font-size:1.1rem;">${_escHtml(CURRENT_TENANT.phone)}</a></p>` : ''}
        </div>
    </div>`;
}

// ── Check tenant admin role ──────────────────────────────────────────────────

async function checkTenantRole(tenantId) {
    // Demo mode: sempre admin
    if (typeof supabaseClient === 'undefined') return 'owner';
    const user = typeof getCurrentUser === 'function' ? getCurrentUser() : null;
    if (!user?.id) return null;
    try {
        const { data } = await supabaseClient
            .from('tenant_members')
            .select('role')
            .eq('tenant_id', tenantId)
            .eq('user_id', user.id)
            .maybeSingle();
        return data?.role || null;
    } catch { return null; }
}

// ── Save tenant config (admin) ───────────────────────────────────────────────

async function saveTenantConfig(updates) {
    if (!CURRENT_TENANT) return false;
    Object.assign(CURRENT_TENANT, updates);

    if (typeof supabaseClient !== 'undefined' && !CURRENT_TENANT.id.startsWith('demo-')) {
        const { error } = await supabaseClient
            .from('tenants')
            .update(updates)
            .eq('id', CURRENT_TENANT.id);
        if (error) { console.error('[Tenant] save error:', error.message); return false; }
    } else {
        // Demo mode: salva in localStorage
        _lsSet('demo_tenant_' + TENANT_SLUG, JSON.stringify(CURRENT_TENANT));
    }
    _applyTenantConfig(CURRENT_TENANT);
    return true;
}

// ── Utility ──────────────────────────────────────────────────────────────────

function _slugToName(slug) {
    return slug.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
}

function _darkenColor(hex, percent) {
    const num = parseInt(hex.replace('#', ''), 16);
    const r = Math.max(0, (num >> 16) - Math.round(2.55 * percent));
    const g = Math.max(0, ((num >> 8) & 0x00FF) - Math.round(2.55 * percent));
    const b = Math.max(0, (num & 0x0000FF) - Math.round(2.55 * percent));
    return '#' + (0x1000000 + r * 0x10000 + g * 0x100 + b).toString(16).slice(1);
}

// ── No tenant? Show landing ──────────────────────────────────────────────────

function showLandingPage() {
    // Carica la lista dei tenant demo per mostrare le attività disponibili
    const demoTenants = _lsGetJSON('demo_tenants', []);

    let tenantListHtml = '';
    if (demoTenants.length > 0) {
        tenantListHtml = `
            <h3 style="font-size:1.1rem;margin-bottom:0.75rem;color:#333;">Attività disponibili</h3>
            <div style="display:flex;flex-direction:column;gap:0.5rem;margin-bottom:1.5rem;">
                ${demoTenants.map(t => `
                    <a href="index.html#${t.slug}" style="display:flex;align-items:center;gap:0.75rem;padding:0.75rem 1rem;background:#fff;border-radius:10px;box-shadow:0 1px 4px rgba(0,0,0,0.06);text-decoration:none;color:inherit;transition:transform 0.15s;">
                        <div style="width:40px;height:40px;border-radius:50%;background:#4F46E5;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:1rem;flex-shrink:0;">${(t.name || 'T')[0].toUpperCase()}</div>
                        <div>
                            <div style="font-weight:600;font-size:0.95rem;">${_escHtml(t.name)}</div>
                            <div style="font-size:0.8rem;color:#888;">Prenota un appuntamento</div>
                        </div>
                        <div style="margin-left:auto;color:#bbb;font-size:1.2rem;">&#8250;</div>
                    </a>
                `).join('')}
            </div>
        `;
    }

    document.body.innerHTML = `
    <div style="min-height:100vh;background:linear-gradient(135deg, #eef2ff 0%, #f8f9fa 50%, #ede9fe 100%);font-family:system-ui,-apple-system,sans-serif;">
        <div style="max-width:500px;margin:0 auto;padding:2rem 1.5rem;">
            <div style="text-align:center;padding:3rem 0 2rem;">
                <div style="font-size:3.5rem;margin-bottom:0.75rem;">📅</div>
                <h1 style="font-size:1.8rem;font-weight:800;color:#1e1b4b;margin-bottom:0.5rem;">Prenota Facile</h1>
                <p style="color:#666;font-size:1rem;line-height:1.5;">Prenota appuntamenti in pochi click.<br>Semplice, veloce, dal tuo telefono.</p>
            </div>

            ${tenantListHtml}

            ${demoTenants.length === 0 ? `
                <div style="background:#fff;border-radius:12px;padding:2rem;box-shadow:0 2px 8px rgba(0,0,0,0.06);text-align:center;margin-bottom:1.5rem;">
                    <div style="font-size:2rem;margin-bottom:0.5rem;">🚀</div>
                    <p style="font-weight:600;margin-bottom:0.5rem;">Nessuna attività configurata</p>
                    <p style="color:#888;font-size:0.9rem;">Crea la prima attività dal pannello di amministrazione.</p>
                </div>
            ` : ''}

            <div style="text-align:center;">
                <a href="super-admin.html" style="display:inline-block;background:#1e1b4b;color:#fff;padding:0.7rem 1.5rem;border-radius:10px;text-decoration:none;font-weight:600;font-size:0.9rem;">
                    Pannello Super Admin
                </a>
            </div>

            <p style="text-align:center;margin-top:3rem;color:#aaa;font-size:0.75rem;">
                Powered by Prenota Facile &mdash; Sistema di prenotazione SaaS
            </p>
        </div>
    </div>`;
}
