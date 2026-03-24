// Auth — Supabase Auth (versione generica, senza cert/assicurazione/codice fiscale)

window._currentUser = null;
let _isManualLogout = false;

// ── Phone normalization ──────────────────────────────────────────────────────
function normalizePhone(raw) {
    if (!raw) return '';
    let n = raw.replace(/[\s\-().]/g, '');
    if (n.startsWith('0039')) n = '+39' + n.slice(4);
    else if (n.startsWith('39') && n[0] !== '+') n = '+' + n;
    else if (n.startsWith('0')) n = '+39' + n.slice(1);
    else if (!n.startsWith('+')) n = '+39' + n;
    return n;
}

// ── Error mapping ────────────────────────────────────────────────────────────
function _authError(error) {
    const msg = error?.message || '';
    if (msg.includes('already registered')) return 'Email già registrata.';
    if (msg.includes('Invalid login credentials') || msg.includes('invalid_credentials')) return 'Email o password errata.';
    if (msg.includes('Email not confirmed')) return 'Controlla la tua email per confermare la registrazione.';
    if (msg.includes('Password should be at least')) return 'La password deve essere di almeno 6 caratteri.';
    if (msg.includes('User not found')) return 'Email non trovata.';
    return msg || 'Errore sconosciuto. Riprova.';
}

// ── Load profile ─────────────────────────────────────────────────────────────
async function _loadProfile(userId) {
    if (typeof supabaseClient === 'undefined') return false;
    const { data: profile, error } = await supabaseClient
        .from('profiles')
        .select('id, name, email, whatsapp, created_at')
        .eq('id', userId)
        .single();
    if (profile && !error) {
        window._currentUser = profile;
        if (profile.name) {
            const capitalized = profile.name.trim().replace(/\S+/g, w => w[0].toUpperCase() + w.slice(1).toLowerCase());
            if (capitalized !== profile.name) {
                supabaseClient.from('profiles').update({ name: capitalized }).eq('id', userId)
                    .then(() => { window._currentUser.name = capitalized; });
            }
        }
        return true;
    }
    if (error) console.error('[Auth] _loadProfile error:', error.message);
    return false;
}

// ── Init auth ────────────────────────────────────────────────────────────────
let _authListenerActive = false;
async function initAuth() {
    // Modalità demo: senza Supabase, simula un utente admin
    if (typeof supabaseClient === 'undefined') {
        window._currentUser = {
            id: 'demo-user',
            name: 'Utente Demo',
            email: 'demo@example.com',
            whatsapp: '+39 333 0000000',
        };
        sessionStorage.setItem('adminAuth', 'true');
        // Rewrite links after auth in multi-tenant mode
        if (typeof rewriteTenantLinks === 'function') rewriteTenantLinks();
        updateNavAuth();
        return null;
    }

    const session = await new Promise((resolve) => {
        let resolved = false;
        const { data: { subscription } } = supabaseClient.auth.onAuthStateChange((event, session) => {
            if (event === 'INITIAL_SESSION' && !resolved) {
                resolved = true; subscription.unsubscribe(); resolve(session);
            }
        });
        setTimeout(async () => {
            if (!resolved) {
                resolved = true; subscription.unsubscribe();
                const { data } = await supabaseClient.auth.getSession();
                if (data.session) { resolve(data.session); return; }
                try {
                    const { data: refreshed, error } = await supabaseClient.auth.refreshSession();
                    resolve(error ? null : refreshed.session);
                } catch { resolve(null); }
            }
        }, 6000);
    });

    if (session) {
        const ok = await _loadProfile(session.user.id);
        if (!ok && !window._currentUser) {
            const meta = session.user.user_metadata || {};
            window._currentUser = {
                id: session.user.id,
                email: session.user.email || meta.email || '',
                name: meta.full_name || meta.name || session.user.email || '',
                whatsapp: meta.whatsapp || '',
            };
        }
        if (session.user.app_metadata?.role === 'super_admin' || session.user.app_metadata?.role === 'admin') {
            sessionStorage.setItem('adminAuth', 'true');
        } else {
            // Check if user is admin of the current tenant
            const tenantId = typeof CURRENT_TENANT !== 'undefined' && CURRENT_TENANT ? CURRENT_TENANT.id : null;
            if (tenantId && !tenantId.startsWith('demo-')) {
                const role = typeof checkTenantRole === 'function' ? await checkTenantRole(tenantId) : null;
                if (role) sessionStorage.setItem('adminAuth', 'true');
                else sessionStorage.removeItem('adminAuth');

                // Auto-claim pending invites for this user
                try {
                    const { data: invites } = await supabaseClient.from('tenant_invites')
                        .select('tenant_id, role')
                        .eq('email', session.user.email.toLowerCase())
                        .eq('claimed', false);
                    for (const inv of invites || []) {
                        await supabaseClient.from('tenant_members').upsert({
                            tenant_id: inv.tenant_id, user_id: session.user.id, role: inv.role
                        });
                        await supabaseClient.from('tenant_invites').update({ claimed: true })
                            .eq('tenant_id', inv.tenant_id).eq('email', session.user.email.toLowerCase());
                    }
                    if (invites?.length && tenantId) {
                        const newRole = typeof checkTenantRole === 'function' ? await checkTenantRole(tenantId) : null;
                        if (newRole) sessionStorage.setItem('adminAuth', 'true');
                    }
                } catch (e) { console.warn('[Auth] invite claim error:', e); }
            } else {
                sessionStorage.removeItem('adminAuth');
            }
        }
    } else {
        window._currentUser = null;
        sessionStorage.removeItem('adminAuth');
    }
    localStorage.removeItem('adminAuthenticated');

    if (!_authListenerActive) {
        _authListenerActive = true;
        supabaseClient.auth.onAuthStateChange(async (event, session) => {
            if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
                if (session) {
                    await _loadProfile(session.user.id);
                    if (session.user.app_metadata?.role === 'admin') sessionStorage.setItem('adminAuth', 'true');
                }
            } else if (event === 'SIGNED_OUT') {
                if (_isManualLogout) {
                    window._currentUser = null;
                    sessionStorage.removeItem('adminAuth');
                } else {
                    console.warn('[Auth] SIGNED_OUT spurio — tentativo recupero');
                    (async () => {
                        try {
                            const { data: refreshed } = await supabaseClient.auth.refreshSession();
                            if (refreshed?.session) {
                                await _loadProfile(refreshed.session.user.id);
                                if (refreshed.session.user.app_metadata?.role === 'admin') sessionStorage.setItem('adminAuth', 'true');
                            } else {
                                window._currentUser = null;
                                sessionStorage.removeItem('adminAuth');
                            }
                        } catch {}
                        updateNavAuth();
                    })();
                    return;
                }
            }
            updateNavAuth();
        });
    }

    if (!window._visibilityAuthActive) {
        window._visibilityAuthActive = true;
        document.addEventListener('visibilitychange', async () => {
            if (document.hidden) return;
            await new Promise(r => setTimeout(r, 1000));
            try {
                const { data } = await supabaseClient.auth.getSession();
                if (data.session) await _loadProfile(data.session.user.id);
                else {
                    const { data: refreshed } = await supabaseClient.auth.refreshSession();
                    if (refreshed.session) await _loadProfile(refreshed.session.user.id);
                }
            } catch {}
            updateNavAuth();
        });
    }

    updateNavAuth();
    return session;
}

// ── Session accessors ────────────────────────────────────────────────────────
function getCurrentUser() { return window._currentUser; }

// ── Register ─────────────────────────────────────────────────────────────────
async function registerUser(name, email, whatsapp, password) {
    if (typeof supabaseClient === 'undefined') return { ok: false, error: 'Supabase non configurato.' };
    if (whatsapp) {
        const { data: taken } = await supabaseClient.rpc('is_whatsapp_taken', { phone: whatsapp });
        if (taken) return { ok: false, error: 'Questo numero di telefono è già associato a un altro account.' };
    }
    const capitalized = (name || '').trim().replace(/\S+/g, w => w[0].toUpperCase() + w.slice(1).toLowerCase());
    const { data, error } = await supabaseClient.auth.signUp({
        email, password,
        options: {
            emailRedirectTo: window.location.origin + '/login.html',
            data: { full_name: capitalized, whatsapp }
        }
    });
    if (error) return { ok: false, error: _authError(error) };
    if (!data.user?.id) return { ok: false, error: 'Errore durante la registrazione.' };
    return { ok: true };
}

// ── Login ────────────────────────────────────────────────────────────────────
async function loginWithPassword(email, password) {
    if (typeof supabaseClient === 'undefined') return { ok: false, error: 'Supabase non configurato.' };
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) return { ok: false, error: _authError(error) };
    await _loadProfile(data.user.id);
    return { ok: true };
}

// ── Logout ───────────────────────────────────────────────────────────────────
async function logoutUser() {
    _isManualLogout = true;
    window._currentUser = null;
    localStorage.removeItem('adminAuthenticated');
    sessionStorage.removeItem('adminAuth');
    if (typeof BookingStorage !== 'undefined') BookingStorage._cache = [];
    if (typeof CreditStorage !== 'undefined') CreditStorage._cache = {};
    if (typeof UserStorage !== 'undefined') UserStorage._cache = [];
    try {
        await Promise.race([
            supabaseClient.auth.signOut({ scope: 'local' }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000))
        ]);
    } catch {}
}

// ── Update profile ───────────────────────────────────────────────────────────
async function updateUserProfile(currentEmail, updates, newPassword) {
    const user = getCurrentUser();
    if (!user) return { ok: false, error: 'Non autenticato.' };
    if (typeof supabaseClient === 'undefined') {
        // Demo mode: aggiorna solo in memoria
        if (updates.name) window._currentUser.name = updates.name;
        if (updates.email) window._currentUser.email = updates.email;
        if (updates.whatsapp) window._currentUser.whatsapp = updates.whatsapp;
        return { ok: true };
    }

    const profileUpdate = {};
    let emailPendingConfirmation = false;

    if (updates.name !== undefined) profileUpdate.name = (updates.name || '').trim().replace(/\S+/g, w => w[0].toUpperCase() + w.slice(1).toLowerCase());
    if (updates.whatsapp !== undefined) {
        profileUpdate.whatsapp = updates.whatsapp;
        if (updates.whatsapp && updates.whatsapp !== (user.whatsapp || '')) {
            const { data: taken } = await supabaseClient.rpc('is_whatsapp_taken', { phone: updates.whatsapp, exclude_user_id: user.id });
            if (taken) return { ok: false, error: 'Questo numero è già associato a un altro account.' };
        }
    }
    if (updates.email !== undefined && updates.email.toLowerCase() === currentEmail.toLowerCase()) {
        profileUpdate.email = updates.email.toLowerCase();
    }

    if (Object.keys(profileUpdate).length > 0) {
        const upsertData = {
            id: user.id,
            name: user.name || updates.name || '',
            email: (user.email || updates.email || '').toLowerCase(),
            ...profileUpdate
        };
        const { error } = await supabaseClient.from('profiles').upsert(upsertData);
        if (error) return { ok: false, error: error.message };
    }

    if (updates.email && updates.email.toLowerCase() !== currentEmail.toLowerCase()) {
        const { error } = await supabaseClient.auth.updateUser({ email: updates.email });
        if (error) return { ok: false, error: error.message };
        emailPendingConfirmation = true;
    }

    if (newPassword) {
        const { error } = await supabaseClient.auth.updateUser({ password: newPassword });
        if (error) return { ok: false, error: error.message };
    }

    if (window._currentUser) Object.assign(window._currentUser, profileUpdate);
    await _loadProfile(user.id);
    return { ok: true, emailPendingConfirmation };
}

// ── Le mie prenotazioni ──────────────────────────────────────────────────────
function getUserBookings() {
    const user = getCurrentUser();
    if (!user) return { upcoming: [], past: [] };
    const allBookings = BookingStorage.getAllBookings();
    const today = _localDateStr();
    const myPhone = user.whatsapp ? normalizePhone(user.whatsapp) : '';

    const mine = allBookings.filter(b => {
        if (b.id?.startsWith('demo-')) return false;
        if (b.userId && user.id && b.userId === user.id) return true;
        if (!user.email || !b.email) return false;
        if (b.email.toLowerCase() !== user.email.toLowerCase()) return false;
        if (myPhone && b.whatsapp && normalizePhone(b.whatsapp) !== myPhone) return false;
        return true;
    });

    function isBookingPast(b) {
        if (b.date < today) return true;
        if (b.date > today) return false;
        const endTimeStr = b.time?.split(' - ')[1]?.trim();
        if (!endTimeStr) return false;
        const [h, m] = endTimeStr.split(':').map(Number);
        return new Date(`${b.date}T${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:00`) <= new Date();
    }

    return {
        upcoming: mine.filter(b => !isBookingPast(b)).sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time)),
        past: mine.filter(b => isBookingPast(b)).sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time))
    };
}

// ── Navbar ────────────────────────────────────────────────────────────────────
function updateNavAuth() {
    document.body.classList.add('auth-loaded');
    const user = getCurrentUser();
    const isAdmin = sessionStorage.getItem('adminAuth') === 'true';
    const loginLink = document.getElementById('navLoginLink');
    const userMenu = document.getElementById('navUserMenu');
    const userName = document.getElementById('navUserName');

    _removeDynamicNavLinks();

    if (user || isAdmin) {
        if (loginLink) loginLink.style.display = 'none';
        if (userMenu) userMenu.style.display = 'flex';
        if (userName) userName.textContent = user ? (user.name || user.email).split(' ')[0] : 'Admin';
        const _tu = typeof tenantUrl === 'function' ? tenantUrl : (p) => p;
        if (user) _injectNavLinkFirst(_tu('prenotazioni.html'), 'I miei appuntamenti', 'nav-prenotazioni-link');
        if (isAdmin) _injectNavLinkLast(_tu('admin.html'), 'Amministrazione', 'nav-admin-link');
        _injectSidebarLogout();
    } else {
        if (loginLink) loginLink.style.display = 'flex';
        if (userMenu) userMenu.style.display = 'none';
    }
}

function _injectNavLinkFirst(href, label, cssClass) {
    ['.nav-desktop-links', '.nav-sidebar-links'].forEach(sel => {
        const nav = document.querySelector(sel);
        if (!nav || nav.querySelector('.' + cssClass)) return;
        const li = document.createElement('li');
        li.setAttribute('data-nav-dynamic', '');
        li.innerHTML = `<a href="${href}" class="${cssClass}">${label}</a>`;
        nav.prepend(li);
    });
}

function _injectNavLinkLast(href, label, cssClass) {
    ['.nav-desktop-links', '.nav-sidebar-links'].forEach(sel => {
        const nav = document.querySelector(sel);
        if (!nav || nav.querySelector('.' + cssClass)) return;
        const li = document.createElement('li');
        li.setAttribute('data-nav-dynamic', '');
        li.innerHTML = `<a href="${href}" class="${cssClass}">${label}</a>`;
        nav.append(li);
    });
}

function _removeDynamicNavLinks() {
    document.querySelectorAll('[data-nav-dynamic]').forEach(el => el.remove());
    document.querySelectorAll('.nav-sidebar-logout-item').forEach(el => el.style.display = 'none');
}

function _injectSidebarLogout() {
    const sidebar = document.querySelector('.nav-sidebar-links');
    if (!sidebar) return;
    const existing = sidebar.querySelector('.nav-sidebar-logout');
    if (existing) {
        const li = existing.closest('.nav-sidebar-logout-item');
        li.style.display = ''; sidebar.append(li); return;
    }
    const li = document.createElement('li');
    li.className = 'nav-sidebar-logout-item';
    const btn = document.createElement('button');
    btn.className = 'nav-sidebar-logout';
    btn.textContent = 'Esci';
    btn.addEventListener('click', async () => { await logoutUser(); window.location.href = typeof tenantUrl === 'function' ? tenantUrl('index.html') : '/'; });
    li.appendChild(btn);
    sidebar.append(li);
}

function toggleNavMenu() {
    const sidebar = document.getElementById('navSidebar');
    const overlay = document.getElementById('navSidebarOverlay');
    if (!sidebar) return;
    const isOpen = sidebar.classList.toggle('open');
    if (overlay) overlay.classList.toggle('open', isOpen);
    document.body.classList.toggle('nav-open', isOpen);
}

function openProfileModal() {
    const user = getCurrentUser();
    if (!user) return;
    const modal = document.getElementById('profileModal');
    if (!modal) return;
    document.getElementById('profileUserName').textContent = user.name;
    renderProfileTab('upcoming');
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
}

function closeProfileModal() {
    const modal = document.getElementById('profileModal');
    if (modal) modal.style.display = 'none';
    document.body.style.overflow = '';
}

function renderProfileTab(tab) {
    const { upcoming, past } = getUserBookings();
    const list = tab === 'upcoming' ? upcoming : past;
    document.querySelectorAll('.profile-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    const container = document.getElementById('profileBookingsList');
    if (!container) return;
    if (!list.length) {
        container.innerHTML = `<p class="profile-empty">${tab === 'upcoming' ? 'Nessun appuntamento futuro.' : 'Nessun appuntamento passato.'}</p>`;
        return;
    }
    container.innerHTML = list.map(b => `
        <div class="profile-booking-card ${b.slotType}">
            <div class="profile-booking-date">${b.dateDisplay || b.date}</div>
            <div class="profile-booking-time">${b.time}</div>
            <div class="profile-booking-type">${(SLOT_NAMES && SLOT_NAMES[b.slotType]) || b.slotType}</div>
        </div>
    `).join('');
}

// ── Init on DOM ready ────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    const hamburger = document.getElementById('navHamburger');
    if (hamburger) hamburger.addEventListener('click', toggleNavMenu);
    const logoutBtn = document.getElementById('navLogoutBtn');
    if (logoutBtn) logoutBtn.addEventListener('click', async () => { await logoutUser(); window.location.href = '/'; });
    const profileBtn = document.getElementById('navUserName');
    if (profileBtn) {
        profileBtn.style.cursor = 'pointer';
        profileBtn.addEventListener('click', () => { window.location.href = 'prenotazioni.html'; });
    }
});
