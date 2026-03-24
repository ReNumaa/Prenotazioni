// ══════════════════════════════════════════════════════════════════════════════
// Admin Settings — Impostazioni attività + servizi + orari + annullamento + notifiche
// Legge/scrive da CURRENT_TENANT (tenant.js) → tabella tenants su Supabase
// ══════════════════════════════════════════════════════════════════════════════

// ── Helpers ──────────────────────────────────────────────────────────────────

function _tenantVal(key, fallback) {
    if (typeof CURRENT_TENANT !== 'undefined' && CURRENT_TENANT && CURRENT_TENANT[key] !== undefined && CURRENT_TENANT[key] !== null)
        return CURRENT_TENANT[key];
    return fallback;
}

// ── Business Settings ────────────────────────────────────────────────────────

function getBusinessSettings() {
    return {
        name:           _tenantVal('name', ''),
        description:    _tenantVal('description', ''),
        phone:          _tenantVal('phone', ''),
        email:          _tenantVal('email', ''),
        address:        _tenantVal('address', ''),
        mapsUrl:        _tenantVal('maps_url', ''),
        logoUrl:        _tenantVal('logo_url', ''),
        primaryColor:   _tenantVal('primary_color', '#4F46E5'),
        slotDuration:   _tenantVal('slot_duration', '60 minuti'),
        bookingNotice:  _tenantVal('booking_notice', ''),
    };
}

async function saveBusinessSettings(settings) {
    await saveTenantConfig({
        name: settings.name, description: settings.description,
        phone: settings.phone, email: settings.email,
        address: settings.address, maps_url: settings.mapsUrl,
        logo_url: settings.logoUrl, primary_color: settings.primaryColor,
        slot_duration: settings.slotDuration, booking_notice: settings.bookingNotice,
    });
    document.title = settings.name ? settings.name + ' — Admin' : 'Amministrazione';
}

// ── Servizi ──────────────────────────────────────────────────────────────────

function getCustomServices() {
    const s = _tenantVal('services', null);
    if (s && Array.isArray(s)) return s;
    return Object.keys(SLOT_NAMES).map(key => ({
        id: key, name: SLOT_NAMES[key], price: SLOT_PRICES[key] || 0,
        capacity: SLOT_MAX_CAPACITY[key] || 1, color: SLOT_COLORS?.[key] || '#2ecc71', active: true,
    }));
}

async function saveCustomServices(services) {
    services.forEach(s => {
        SLOT_NAMES[s.id] = s.name;
        SLOT_PRICES[s.id] = s.price;
        SLOT_MAX_CAPACITY[s.id] = s.capacity;
        if (typeof SLOT_COLORS !== 'undefined') SLOT_COLORS[s.id] = s.color;
    });
    await saveTenantConfig({ services });
}

// ── Time Slot Generation ─────────────────────────────────────────────────────
// Genera gli slot orari dal tenant config e aggiorna TIME_SLOTS globale

function generateTimeSlotsFromConfig() {
    const open = _tenantVal('opening_time', '09:00');
    const close = _tenantVal('closing_time', '19:00');
    const durMin = _tenantVal('slot_duration_min', 60);
    const breakStart = _tenantVal('break_start', '');
    const breakEnd = _tenantVal('break_end', '');

    const [openH, openM] = open.split(':').map(Number);
    const [closeH, closeM] = close.split(':').map(Number);
    const [bsH, bsM] = breakStart ? breakStart.split(':').map(Number) : [0, 0];
    const [beH, beM] = breakEnd ? breakEnd.split(':').map(Number) : [0, 0];
    const hasBreak = breakStart && breakEnd;

    const slots = [];
    let curH = openH, curM = openM;

    while (curH * 60 + curM + durMin <= closeH * 60 + closeM) {
        const endMin = curH * 60 + curM + durMin;
        const eH = Math.floor(endMin / 60), eM = endMin % 60;

        // Salta slot che cadono nella pausa
        if (hasBreak) {
            const slotStart = curH * 60 + curM;
            const slotEnd = endMin;
            const bStart = bsH * 60 + bsM;
            const bEnd = beH * 60 + beM;
            if (slotStart < bEnd && slotEnd > bStart) {
                // Slot sovrapposto alla pausa — salta e avanza alla fine della pausa
                curH = beH; curM = beM;
                continue;
            }
        }

        const label = `${String(curH).padStart(2,'0')}:${String(curM).padStart(2,'0')} - ${String(eH).padStart(2,'0')}:${String(eM).padStart(2,'0')}`;
        slots.push(label);

        curH = eH; curM = eM;
    }

    return slots;
}

function applyTimeSlotsFromConfig() {
    const newSlots = generateTimeSlotsFromConfig();
    // Aggiorna la costante globale TIME_SLOTS
    TIME_SLOTS.length = 0;
    newSlots.forEach(s => TIME_SLOTS.push(s));

    // Aggiorna DEFAULT_WEEKLY_SCHEDULE con i nuovi slot
    const closedDays = _tenantVal('closed_days', ['Domenica']);
    const allDays = ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica'];
    const firstService = getCustomServices()[0]?.id || 'servizio-1';

    allDays.forEach(day => {
        if (closedDays.includes(day)) {
            DEFAULT_WEEKLY_SCHEDULE[day] = [];
        } else {
            DEFAULT_WEEKLY_SCHEDULE[day] = newSlots.map(t => ({ time: t, type: firstService }));
        }
    });
}

// ══════════════════════════════════════════════════════════════════════════════
// RENDER FUNCTIONS
// ══════════════════════════════════════════════════════════════════════════════

// ── Tab Servizi ──────────────────────────────────────────────────────────────

function renderServiziManager() {
    const container = document.getElementById('serviziManager');
    if (!container) return;
    const services = getCustomServices();

    let html = `
        <h3 style="margin-bottom:0.5rem;">Gestione Servizi</h3>
        <p style="color:#666;font-size:0.85rem;margin-bottom:1.5rem;">
            I clienti vedranno questi servizi nel calendario. Puoi modificare nome, prezzo, posti e colore.
        </p>
    `;

    services.forEach((s, i) => {
        html += `
        <div class="settings-card" style="margin-bottom:0.75rem;">
            <div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:0.75rem;">
                <input type="color" value="${_escHtml(s.color)}" onchange="updateServiceField(${i},'color',this.value)"
                       style="width:36px;height:36px;border:none;border-radius:8px;cursor:pointer;padding:0;">
                <input type="text" value="${_escHtml(s.name)}" onchange="updateServiceField(${i},'name',this.value)"
                       class="settings-input" style="flex:1;font-weight:600;" placeholder="Nome servizio">
            </div>
            <div style="display:flex;gap:0.75rem;flex-wrap:wrap;">
                <div class="settings-field-sm">
                    <label>Prezzo (&euro;)</label>
                    <input type="number" value="${s.price}" min="0" step="0.50"
                           onchange="updateServiceField(${i},'price',parseFloat(this.value)||0)" class="settings-input">
                </div>
                <div class="settings-field-sm">
                    <label>Posti per slot</label>
                    <input type="number" value="${s.capacity}" min="1" max="50"
                           onchange="updateServiceField(${i},'capacity',parseInt(this.value)||1)" class="settings-input">
                </div>
                <div style="display:flex;align-items:flex-end;">
                    <button onclick="removeService(${i})" class="settings-btn-danger">Elimina</button>
                </div>
            </div>
        </div>`;
    });

    html += `<button onclick="addService()" class="settings-btn-primary" style="margin-top:0.5rem;">+ Aggiungi servizio</button>`;
    container.innerHTML = html;
}

function updateServiceField(index, field, value) {
    const services = getCustomServices();
    if (services[index]) { services[index][field] = value; saveCustomServices(services); }
}

function addService() {
    const services = getCustomServices();
    const colors = ['#2ecc71', '#3498db', '#9b59b6', '#e74c3c', '#f39c12', '#1abc9c', '#e67e22'];
    const id = 'servizio-' + Date.now();
    services.push({ id, name: 'Nuovo Servizio', price: 20, capacity: 1, color: colors[services.length % colors.length], active: true });
    saveCustomServices(services);
    renderServiziManager();
}

function removeService(index) {
    const services = getCustomServices();
    if (services.length <= 1) { showToast('Devi avere almeno un servizio.', 'error'); return; }
    if (!confirm(`Eliminare "${services[index].name}"?`)) return;
    services.splice(index, 1);
    saveCustomServices(services);
    renderServiziManager();
}

// ── Tab Impostazioni ─────────────────────────────────────────────────────────

function renderSettingsPanel() {
    const container = document.getElementById('settingsPanel');
    if (!container) return;
    const biz = getBusinessSettings();

    // Valori orari/annullamento/notifiche
    const openTime = _tenantVal('opening_time', '09:00');
    const closeTime = _tenantVal('closing_time', '19:00');
    const slotDurMin = _tenantVal('slot_duration_min', 60);
    const breakStart = _tenantVal('break_start', '');
    const breakEnd = _tenantVal('break_end', '');
    const closedDays = _tenantVal('closed_days', ['Domenica']);
    const paymentsEnabled = _tenantVal('payments_enabled', false);
    const cancHours = _tenantVal('cancellation_hours', 24);
    const cancPolicy = _tenantVal('cancellation_policy', '');
    const notifyNewBooking = _tenantVal('notify_admin_new_booking', true);
    const notifyCancellation = _tenantVal('notify_admin_cancellation', true);
    const notifyReminder = _tenantVal('notify_client_reminder', true);
    const reminderTimes = _tenantVal('reminder_times', [24, 1]); // array di ore

    const allDays = ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica'];

    // Billing info
    const plan = _tenantVal('plan', 'trial');
    const trialEnds = _tenantVal('trial_ends_at', null);
    const billingHtml = _renderBillingCard(plan, trialEnds);

    container.innerHTML = `
        <h3 style="margin-bottom:1rem;">Impostazioni Attività</h3>

        ${billingHtml}

        <!-- Informazioni generali -->
        <div class="settings-card">
            <h4 class="settings-card-title">Informazioni generali</h4>
            <div class="settings-field">
                <label>Nome attività</label>
                <input type="text" id="bizName" value="${_escHtml(biz.name)}" class="settings-input" placeholder="Es. Studio Fisioterapia Rossi">
            </div>
            <div class="settings-field">
                <label>Descrizione</label>
                <textarea id="bizDescription" class="settings-input" rows="2" placeholder="Breve descrizione dell'attività">${_escHtml(biz.description)}</textarea>
            </div>
            <div class="settings-row">
                <div class="settings-field" style="flex:1;">
                    <label>Telefono</label>
                    <input type="tel" id="bizPhone" value="${_escHtml(biz.phone)}" class="settings-input" placeholder="+39 333 1234567">
                </div>
                <div class="settings-field" style="flex:1;">
                    <label>Email</label>
                    <input type="email" id="bizEmail" value="${_escHtml(biz.email)}" class="settings-input" placeholder="info@tuodominio.com">
                </div>
            </div>
            <div class="settings-field">
                <label>Indirizzo</label>
                <input type="text" id="bizAddress" value="${_escHtml(biz.address)}" class="settings-input" placeholder="Via Roma 1, Milano">
            </div>
            <div class="settings-field">
                <label>Link Google Maps</label>
                <input type="url" id="bizMapsUrl" value="${_escHtml(biz.mapsUrl)}" class="settings-input" placeholder="https://maps.app.goo.gl/...">
            </div>
        </div>

        <!-- Aspetto -->
        <div class="settings-card">
            <h4 class="settings-card-title">Aspetto</h4>
            <div class="settings-field">
                <label>Logo</label>
                <div class="logo-upload-area" id="logoUploadArea">
                    ${biz.logoUrl
                        ? `<img src="${_escHtml(biz.logoUrl)}" alt="Logo" class="logo-upload-preview" id="logoPreviewImg">`
                        : `<div class="logo-upload-placeholder" id="logoPlaceholder">
                            <span style="font-size:2rem;">📷</span>
                            <span>Clicca o trascina per caricare il logo</span>
                           </div>`
                    }
                    <input type="file" id="bizLogoFile" accept="image/*" style="display:none;" onchange="_handleLogoUpload(event)">
                    <input type="hidden" id="bizLogoUrl" value="${_escHtml(biz.logoUrl)}">
                </div>
                ${biz.logoUrl ? `<button onclick="_removeLogo()" style="margin-top:0.4rem;font-size:0.8rem;color:#e74c3c;background:none;border:none;cursor:pointer;">Rimuovi logo</button>` : ''}
            </div>
            <div class="settings-row" style="margin-top:0.5rem;">
                <div class="settings-field" style="flex:1;">
                    <label>Colore primario</label>
                    <p style="font-size:0.75rem;color:#888;margin:0.15rem 0 0.3rem;">Bottoni, link, badge</p>
                    <input type="color" id="bizPrimaryColor" value="${biz.primaryColor}" class="settings-color-input">
                </div>
                <div class="settings-field" style="flex:1;">
                    <label>Colore header</label>
                    <p style="font-size:0.75rem;color:#888;margin:0.15rem 0 0.3rem;">Navbar e barra superiore</p>
                    <input type="color" id="bizHeaderColor" value="${_tenantVal('header_color', '#1e1b4b')}" class="settings-color-input">
                </div>
            </div>
            <div style="margin-top:0.75rem;padding:0.6rem;border-radius:8px;display:flex;align-items:center;gap:0.75rem;" id="colorPreview">
                <div style="width:40px;height:40px;border-radius:8px;" id="previewHeader"></div>
                <div style="width:40px;height:40px;border-radius:8px;" id="previewPrimary"></div>
                <span style="font-size:0.8rem;color:#888;">Anteprima colori</span>
            </div>
            ${biz.logoUrl ? `<div style="margin-top:0.5rem;"><img src="${_escHtml(biz.logoUrl)}" alt="Logo" style="max-height:80px;border-radius:8px;border:1px solid #eee;"></div>` : ''}
        </div>

        <!-- Chi sono -->
        <div class="settings-card">
            <h4 class="settings-card-title">Chi sono / Presentazione</h4>
            <p style="font-size:0.8rem;color:#888;margin-bottom:0.75rem;">
                Questa sezione appare nella pagina pubblica sotto il calendario. Se lasci vuoto non viene mostrata.
            </p>
            <div class="settings-field">
                <label>Titolo sezione</label>
                <input type="text" id="bizAboutTitle" value="${_escHtml(_tenantVal('about_title', ''))}" class="settings-input" placeholder="Es. Chi sono, Il nostro studio, Su di noi...">
            </div>
            <div class="settings-field">
                <label>Testo di presentazione</label>
                <textarea id="bizAboutText" class="settings-input" rows="5" placeholder="Scrivi qualcosa su di te o sulla tua attività. Puoi andare a capo per creare paragrafi separati.">${_escHtml(_tenantVal('about_text', ''))}</textarea>
            </div>
            <div class="settings-field">
                <label>Foto</label>
                <div class="logo-upload-area" id="aboutImageUploadArea">
                    ${_tenantVal('about_image', '')
                        ? `<img src="${_escHtml(_tenantVal('about_image', ''))}" alt="About" class="logo-upload-preview" id="aboutPreviewImg">`
                        : `<div class="logo-upload-placeholder" id="aboutPlaceholder">
                            <span style="font-size:2rem;">📷</span>
                            <span>Carica una foto (opzionale)</span>
                           </div>`
                    }
                    <input type="file" id="bizAboutImageFile" accept="image/*" style="display:none;" onchange="_handleAboutImageUpload(event)">
                    <input type="hidden" id="bizAboutImage" value="${_escHtml(_tenantVal('about_image', ''))}">
                </div>
                ${_tenantVal('about_image', '') ? `<button onclick="_removeAboutImage()" style="margin-top:0.4rem;font-size:0.8rem;color:#e74c3c;background:none;border:none;cursor:pointer;">Rimuovi foto</button>` : ''}
            </div>
        </div>

        <!-- Orari di apertura -->
        <div class="settings-card">
            <h4 class="settings-card-title">Orari di apertura</h4>
            <div class="settings-row">
                <div class="settings-field" style="flex:1;">
                    <label>Apertura</label>
                    <input type="time" id="sOpenTime" value="${openTime}" class="settings-input">
                </div>
                <div class="settings-field" style="flex:1;">
                    <label>Chiusura</label>
                    <input type="time" id="sCloseTime" value="${closeTime}" class="settings-input">
                </div>
                <div class="settings-field" style="flex:1;">
                    <label>Durata slot (min)</label>
                    <select id="sSlotDuration" class="settings-input">
                        ${[15,20,30,45,60,90,120].map(m => `<option value="${m}" ${slotDurMin === m ? 'selected' : ''}>${m} min</option>`).join('')}
                    </select>
                </div>
            </div>
            <div class="settings-row" style="margin-top:0.5rem;">
                <div class="settings-field" style="flex:1;">
                    <label>Pausa pranzo — inizio (vuoto = nessuna)</label>
                    <input type="time" id="sBreakStart" value="${breakStart}" class="settings-input">
                </div>
                <div class="settings-field" style="flex:1;">
                    <label>Pausa pranzo — fine</label>
                    <input type="time" id="sBreakEnd" value="${breakEnd}" class="settings-input">
                </div>
            </div>
            <div class="settings-field" style="margin-top:0.75rem;">
                <label>Giorni di chiusura</label>
                <div style="display:flex;flex-wrap:wrap;gap:0.5rem;margin-top:0.3rem;">
                    ${allDays.map(d => `
                        <label style="display:flex;align-items:center;gap:0.3rem;font-size:0.85rem;cursor:pointer;padding:0.3rem 0.6rem;border:1px solid #ddd;border-radius:8px;${closedDays.includes(d)?'background:#fee2e2;border-color:#fca5a5;':''}">
                            <input type="checkbox" class="closed-day-cb" value="${d}" ${closedDays.includes(d) ? 'checked' : ''} style="accent-color:#e74c3c;">
                            ${d.substring(0, 3)}
                        </label>
                    `).join('')}
                </div>
            </div>
            <p style="font-size:0.8rem;color:#888;margin-top:0.75rem;">
                Gli slot vengono generati automaticamente in base a questi orari. Dopo aver salvato, vai su
                <strong>Gestione Orari</strong> e importa la settimana standard per applicare le modifiche.
            </p>
        </div>

        <!-- Annullamento -->
        <div class="settings-card">
            <h4 class="settings-card-title">Politica di annullamento</h4>
            <div class="settings-row">
                <div class="settings-field" style="flex:1;">
                    <label>Ore minime per annullare gratis</label>
                    <select id="sCancHours" class="settings-input">
                        ${[0,1,2,4,6,12,24,48,72].map(h => `<option value="${h}" ${cancHours === h ? 'selected' : ''}>${h === 0 ? 'Sempre annullabile' : h + ' ore prima'}</option>`).join('')}
                    </select>
                </div>
            </div>
            <div class="settings-field" style="margin-top:0.5rem;">
                <label>Messaggio politica di annullamento (visibile ai clienti)</label>
                <textarea id="sCancPolicy" class="settings-input" rows="2" placeholder="Es. Puoi annullare fino a 24 ore prima dell'appuntamento.">${_escHtml(cancPolicy)}</textarea>
            </div>
        </div>

        <!-- Pagamenti -->
        <div class="settings-card">
            <h4 class="settings-card-title">Gestione pagamenti</h4>
            <div class="settings-toggle-row" style="border:none;">
                <label class="settings-toggle-label">
                    <input type="checkbox" id="sPaymentsEnabled" ${paymentsEnabled ? 'checked' : ''} onchange="_togglePaymentsPreview(this.checked)">
                    <span>Abilita gestione pagamenti</span>
                </label>
                <p class="settings-toggle-desc">
                    Se attiva, puoi tracciare chi ha pagato e chi no direttamente dall'admin.
                    Se disattivata, i pagamenti non vengono mostrati — gestisci tutto di persona quando arrivano i clienti.
                </p>
            </div>
            <div id="paymentsPreview" style="${paymentsEnabled ? '' : 'display:none;'}margin-top:0.75rem;padding:0.75rem;background:#f0fdf4;border-radius:8px;border:1px solid #bbf7d0;">
                <p style="font-size:0.85rem;color:#166534;">
                    <strong>Attiva:</strong> nel calendario admin vedrai i bottoni &euro; per segnare pagato/non pagato su ogni prenotazione.
                    I prezzi dei servizi verranno mostrati anche ai clienti.
                </p>
            </div>
        </div>

        <!-- Notifiche -->
        <div class="settings-card">
            <h4 class="settings-card-title">Notifiche</h4>
            <p style="color:#666;font-size:0.85rem;margin-bottom:1rem;">
                Le notifiche push vengono inviate sul telefono dei clienti che hanno installato l'app.
                Richiedono Supabase e le chiavi VAPID configurate.
            </p>

            <div class="settings-toggle-row">
                <label class="settings-toggle-label">
                    <input type="checkbox" id="sNotifyNewBooking" ${notifyNewBooking ? 'checked' : ''}>
                    <span>Notifica admin — nuova prenotazione</span>
                </label>
                <p class="settings-toggle-desc">Ricevi una notifica quando un cliente prenota.</p>
            </div>

            <div class="settings-toggle-row">
                <label class="settings-toggle-label">
                    <input type="checkbox" id="sNotifyCancellation" ${notifyCancellation ? 'checked' : ''}>
                    <span>Notifica admin — annullamento</span>
                </label>
                <p class="settings-toggle-desc">Ricevi una notifica quando un cliente annulla.</p>
            </div>

            <div class="settings-toggle-row">
                <label class="settings-toggle-label">
                    <input type="checkbox" id="sNotifyReminder" ${notifyReminder ? 'checked' : ''} onchange="document.getElementById('reminderTimesSection').style.display=this.checked?'':'none'">
                    <span>Promemoria al cliente</span>
                </label>
                <p class="settings-toggle-desc">Il cliente riceve uno o più promemoria prima dell'appuntamento.</p>
            </div>

            <div id="reminderTimesSection" style="${notifyReminder ? '' : 'display:none;'}margin-top:0.75rem;">
                <label style="font-size:0.8rem;font-weight:600;color:#555;">Quando inviare i promemoria</label>
                <div id="reminderTimesList" style="margin-top:0.4rem;">
                    ${reminderTimes.map((h, i) => _renderReminderRow(h, i)).join('')}
                </div>
                <button onclick="addReminderTime()" class="settings-btn-primary" style="margin-top:0.5rem;font-size:0.8rem;padding:0.4rem 0.8rem;">
                    + Aggiungi promemoria
                </button>
            </div>
        </div>

        <!-- Durata e avviso (legacy, mostrati anche nel calendario) -->
        <div class="settings-card">
            <h4 class="settings-card-title">Testo calendario</h4>
            <div class="settings-field">
                <label>Durata appuntamento (testo mostrato nell'header)</label>
                <input type="text" id="bizSlotDuration" value="${_escHtml(biz.slotDuration)}" class="settings-input" placeholder="Es. 60 minuti">
            </div>
            <div class="settings-field">
                <label>Avviso dopo la prenotazione</label>
                <textarea id="bizBookingNotice" class="settings-input" rows="2" placeholder="Es. Ricordati di portare abbigliamento comodo...">${_escHtml(biz.bookingNotice)}</textarea>
            </div>
        </div>

        <button onclick="saveAllSettings()" class="settings-btn-primary" style="width:100%;margin-top:1rem;padding:0.9rem;font-size:1rem;">
            Salva tutte le impostazioni
        </button>
    `;

    // Init upload drag & drop
    _initLogoUpload();
    _initAboutImageUpload();
    // Color preview live
    _updateColorPreview();
    document.getElementById('bizPrimaryColor')?.addEventListener('input', _updateColorPreview);
    document.getElementById('bizHeaderColor')?.addEventListener('input', _updateColorPreview);
}

function _updateColorPreview() {
    const primary = document.getElementById('bizPrimaryColor')?.value || '#4F46E5';
    const header = document.getElementById('bizHeaderColor')?.value || '#1e1b4b';
    const ph = document.getElementById('previewHeader');
    const pp = document.getElementById('previewPrimary');
    if (ph) ph.style.background = header;
    if (pp) pp.style.background = primary;
}

// ── Billing card ─────────────────────────────────────────────────────────────

function _renderBillingCard(plan, trialEndsAt) {
    const now = new Date();
    const trialEnd = trialEndsAt ? new Date(trialEndsAt) : null;
    const daysLeft = trialEnd ? Math.max(0, Math.ceil((trialEnd - now) / (1000 * 60 * 60 * 24))) : 0;
    const isDemo = typeof CURRENT_TENANT !== 'undefined' && CURRENT_TENANT?.id?.startsWith('demo-');

    if (isDemo) {
        return `<div class="settings-card" style="border:2px solid #ddd;background:#f9fafb;">
            <h4 class="settings-card-title">Abbonamento</h4>
            <p style="color:#888;font-size:0.9rem;">Modalità demo — il billing si attiva con Supabase configurato.</p>
        </div>`;
    }

    const statusConfig = {
        trial: { label: 'Prova gratuita', color: '#3b82f6', bg: '#eff6ff', border: '#bfdbfe', icon: '🎁' },
        active: { label: 'Attivo', color: '#059669', bg: '#f0fdf4', border: '#bbf7d0', icon: '✓' },
        past_due: { label: 'Pagamento in ritardo', color: '#d97706', bg: '#fffbeb', border: '#fde68a', icon: '⚠' },
        cancelled: { label: 'Cancellato', color: '#dc2626', bg: '#fef2f2', border: '#fecaca', icon: '✕' },
        expired: { label: 'Scaduto', color: '#dc2626', bg: '#fef2f2', border: '#fecaca', icon: '✕' },
    };
    const s = statusConfig[plan] || statusConfig.trial;

    let actionHtml = '';
    if (plan === 'trial' || plan === 'expired' || plan === 'cancelled') {
        actionHtml = `
            <button onclick="startSubscription()" class="settings-btn-primary" style="margin-top:0.75rem;width:100%;padding:0.8rem;font-size:0.95rem;">
                ${plan === 'trial' ? 'Attiva abbonamento — €19,90/mese' : 'Riattiva abbonamento — €19,90/mese'}
            </button>`;
    } else if (plan === 'active' || plan === 'past_due') {
        actionHtml = `
            <button onclick="openBillingPortal()" class="settings-btn-primary" style="margin-top:0.75rem;background:#6366f1;">
                Gestisci abbonamento (carta, fatture, disdetta)
            </button>`;
    }

    let trialHtml = '';
    if (plan === 'trial' && daysLeft > 0) {
        const urgency = daysLeft <= 7 ? 'color:#d97706;font-weight:700;' : 'color:#555;';
        trialHtml = `<p style="font-size:0.9rem;${urgency}margin-top:0.5rem;">
            ${daysLeft <= 3
                ? `La prova scade tra <strong>${daysLeft} giorn${daysLeft === 1 ? 'o' : 'i'}</strong>! Attiva l'abbonamento per continuare.`
                : `Hai ancora <strong>${daysLeft} giorni</strong> di prova gratuita.`
            }
        </p>`;
    }

    return `
        <div class="settings-card" style="border:2px solid ${s.border};background:${s.bg};">
            <h4 class="settings-card-title" style="border-color:${s.border};">Abbonamento</h4>
            <div style="display:flex;align-items:center;gap:0.75rem;">
                <span style="font-size:1.5rem;">${s.icon}</span>
                <div>
                    <span style="font-size:1rem;font-weight:700;color:${s.color};">${s.label}</span>
                    ${plan === 'active' ? '<span style="font-size:0.8rem;color:#888;margin-left:0.5rem;">€19,90/mese</span>' : ''}
                </div>
            </div>
            ${trialHtml}
            ${actionHtml}
        </div>`;
}

async function startSubscription() {
    if (typeof SUPABASE_URL === 'undefined' || SUPABASE_URL.includes('YOUR_PROJECT')) {
        showToast('Configura Supabase per attivare i pagamenti.', 'info');
        return;
    }
    if (!CURRENT_TENANT?.id) return;

    const btn = document.querySelector('[onclick="startSubscription()"]');
    if (btn) { btn.disabled = true; btn.textContent = 'Reindirizzamento a Stripe...'; }

    try {
        const resp = await fetch(`${SUPABASE_URL}/functions/v1/create-subscription`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + SUPABASE_ANON_KEY },
            body: JSON.stringify({ tenant_id: CURRENT_TENANT.id }),
        });
        const data = await resp.json();
        if (data.url) {
            window.location.href = data.url;
        } else {
            showToast('Errore: ' + (data.error || 'risposta non valida'), 'error');
            if (btn) { btn.disabled = false; btn.textContent = 'Attiva abbonamento — €19,90/mese'; }
        }
    } catch (e) {
        showToast('Errore di connessione. Riprova.', 'error');
        if (btn) { btn.disabled = false; btn.textContent = 'Attiva abbonamento — €19,90/mese'; }
    }
}

async function openBillingPortal() {
    if (typeof SUPABASE_URL === 'undefined' || SUPABASE_URL.includes('YOUR_PROJECT')) return;
    if (!CURRENT_TENANT?.id) return;

    try {
        const resp = await fetch(`${SUPABASE_URL}/functions/v1/billing-portal`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + SUPABASE_ANON_KEY },
            body: JSON.stringify({ tenant_id: CURRENT_TENANT.id }),
        });
        const data = await resp.json();
        if (data.url) window.location.href = data.url;
        else showToast('Errore apertura portale billing.', 'error');
    } catch { showToast('Errore di connessione.', 'error'); }
}

// ── Logo upload ──────────────────────────────────────────────────────────────

function _initLogoUpload() {
    const area = document.getElementById('logoUploadArea');
    if (!area) return;

    // Click to upload
    area.addEventListener('click', (e) => {
        if (e.target.tagName === 'BUTTON') return;
        document.getElementById('bizLogoFile').click();
    });

    // Drag and drop
    area.addEventListener('dragover', (e) => { e.preventDefault(); area.classList.add('drag-over'); });
    area.addEventListener('dragleave', () => area.classList.remove('drag-over'));
    area.addEventListener('drop', (e) => {
        e.preventDefault();
        area.classList.remove('drag-over');
        const file = e.dataTransfer?.files?.[0];
        if (file && file.type.startsWith('image/')) _processLogoFile(file);
    });
}

function _handleLogoUpload(event) {
    const file = event.target.files?.[0];
    if (file) _processLogoFile(file);
}

function _processLogoFile(file) {
    if (file.size > 500 * 1024) {
        showToast('Immagine troppo grande (max 500 KB). Riduci le dimensioni.', 'error');
        return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
        const base64 = e.target.result;

        // Resize to max 200x200 for performance
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const maxSize = 200;
            let w = img.width, h = img.height;
            if (w > maxSize || h > maxSize) {
                if (w > h) { h = Math.round(h * maxSize / w); w = maxSize; }
                else { w = Math.round(w * maxSize / h); h = maxSize; }
            }
            canvas.width = w;
            canvas.height = h;
            canvas.getContext('2d').drawImage(img, 0, 0, w, h);
            const resized = canvas.toDataURL('image/png', 0.9);

            // Update UI
            document.getElementById('bizLogoUrl').value = resized;
            const area = document.getElementById('logoUploadArea');
            const placeholder = document.getElementById('logoPlaceholder');
            if (placeholder) placeholder.remove();
            let preview = document.getElementById('logoPreviewImg');
            if (!preview) {
                preview = document.createElement('img');
                preview.id = 'logoPreviewImg';
                preview.className = 'logo-upload-preview';
                area.insertBefore(preview, area.firstChild);
            }
            preview.src = resized;
            showToast('Logo caricato!', 'success');
        };
        img.src = base64;
    };
    reader.readAsDataURL(file);
}

function _removeLogo() {
    document.getElementById('bizLogoUrl').value = '';
    const area = document.getElementById('logoUploadArea');
    const preview = document.getElementById('logoPreviewImg');
    if (preview) preview.remove();
    let placeholder = document.getElementById('logoPlaceholder');
    if (!placeholder) {
        placeholder = document.createElement('div');
        placeholder.id = 'logoPlaceholder';
        placeholder.className = 'logo-upload-placeholder';
        placeholder.innerHTML = '<span style="font-size:2rem;">📷</span><span>Clicca o trascina per caricare il logo</span>';
        area.insertBefore(placeholder, area.firstChild);
    }
    // Remove the "Rimuovi logo" button
    const removeBtn = area.parentNode.querySelector('button[onclick="_removeLogo()"]');
    if (removeBtn) removeBtn.remove();
    showToast('Logo rimosso', 'success');
}

// ── About image upload ───────────────────────────────────────────────────────

function _initAboutImageUpload() {
    const area = document.getElementById('aboutImageUploadArea');
    if (!area) return;
    area.addEventListener('click', (e) => {
        if (e.target.tagName === 'BUTTON') return;
        document.getElementById('bizAboutImageFile').click();
    });
    area.addEventListener('dragover', (e) => { e.preventDefault(); area.classList.add('drag-over'); });
    area.addEventListener('dragleave', () => area.classList.remove('drag-over'));
    area.addEventListener('drop', (e) => {
        e.preventDefault(); area.classList.remove('drag-over');
        const file = e.dataTransfer?.files?.[0];
        if (file && file.type.startsWith('image/')) _processAboutImage(file);
    });
}

function _handleAboutImageUpload(event) {
    const file = event.target.files?.[0];
    if (file) _processAboutImage(file);
}

function _processAboutImage(file) {
    if (file.size > 800 * 1024) { showToast('Immagine troppo grande (max 800 KB).', 'error'); return; }
    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const maxSize = 400;
            let w = img.width, h = img.height;
            if (w > maxSize || h > maxSize) {
                if (w > h) { h = Math.round(h * maxSize / w); w = maxSize; }
                else { w = Math.round(w * maxSize / h); h = maxSize; }
            }
            canvas.width = w; canvas.height = h;
            canvas.getContext('2d').drawImage(img, 0, 0, w, h);
            const resized = canvas.toDataURL('image/jpeg', 0.85);
            document.getElementById('bizAboutImage').value = resized;
            const area = document.getElementById('aboutImageUploadArea');
            const placeholder = document.getElementById('aboutPlaceholder');
            if (placeholder) placeholder.remove();
            let preview = document.getElementById('aboutPreviewImg');
            if (!preview) {
                preview = document.createElement('img');
                preview.id = 'aboutPreviewImg';
                preview.className = 'logo-upload-preview';
                area.insertBefore(preview, area.firstChild);
            }
            preview.src = resized;
            showToast('Foto caricata!', 'success');
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

function _removeAboutImage() {
    document.getElementById('bizAboutImage').value = '';
    const preview = document.getElementById('aboutPreviewImg');
    if (preview) preview.remove();
    let placeholder = document.getElementById('aboutPlaceholder');
    if (!placeholder) {
        const area = document.getElementById('aboutImageUploadArea');
        placeholder = document.createElement('div');
        placeholder.id = 'aboutPlaceholder';
        placeholder.className = 'logo-upload-placeholder';
        placeholder.innerHTML = '<span style="font-size:2rem;">📷</span><span>Carica una foto (opzionale)</span>';
        area.insertBefore(placeholder, area.firstChild);
    }
    const removeBtn = document.querySelector('button[onclick="_removeAboutImage()"]');
    if (removeBtn) removeBtn.remove();
    showToast('Foto rimossa', 'success');
}

// ── Payments toggle helper ────────────────────────────────────────────────────

function _togglePaymentsPreview(enabled) {
    const el = document.getElementById('paymentsPreview');
    if (el) el.style.display = enabled ? '' : 'none';
}

function isPaymentsEnabled() {
    return _tenantVal('payments_enabled', false);
}

// ── Reminder helpers ─────────────────────────────────────────────────────────

const REMINDER_OPTIONS = [
    { value: 0.25, label: '15 minuti prima' },
    { value: 0.5,  label: '30 minuti prima' },
    { value: 1,    label: '1 ora prima' },
    { value: 2,    label: '2 ore prima' },
    { value: 3,    label: '3 ore prima' },
    { value: 4,    label: '4 ore prima' },
    { value: 6,    label: '6 ore prima' },
    { value: 12,   label: '12 ore prima' },
    { value: 24,   label: '24 ore prima (1 giorno)' },
    { value: 48,   label: '48 ore prima (2 giorni)' },
    { value: 72,   label: '72 ore prima (3 giorni)' },
];

function _renderReminderRow(hours, index) {
    const options = REMINDER_OPTIONS.map(o =>
        `<option value="${o.value}" ${hours === o.value ? 'selected' : ''}>${o.label}</option>`
    ).join('');
    return `<div class="reminder-row" style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.4rem;">
        <select class="reminder-select settings-input" style="flex:1;" data-index="${index}">${options}</select>
        <button onclick="removeReminderTime(${index})" class="settings-btn-danger" style="padding:0.3rem 0.5rem;font-size:0.75rem;">✕</button>
    </div>`;
}

function _getReminderTimesFromUI() {
    return [...document.querySelectorAll('.reminder-select')].map(s => parseFloat(s.value)).sort((a, b) => b - a);
}

function addReminderTime() {
    const list = document.getElementById('reminderTimesList');
    if (!list) return;
    const existing = _getReminderTimesFromUI();
    // Suggerisci un valore non ancora usato
    const available = REMINDER_OPTIONS.find(o => !existing.includes(o.value));
    const newVal = available ? available.value : 1;
    const newIndex = existing.length;
    list.insertAdjacentHTML('beforeend', _renderReminderRow(newVal, newIndex));
}

function removeReminderTime(index) {
    const list = document.getElementById('reminderTimesList');
    if (!list) return;
    const rows = list.querySelectorAll('.reminder-row');
    if (rows.length <= 1) { showToast('Serve almeno un promemoria.', 'error'); return; }
    rows[index]?.remove();
    // Re-index
    list.querySelectorAll('.reminder-row').forEach((row, i) => {
        const btn = row.querySelector('button');
        if (btn) btn.setAttribute('onclick', `removeReminderTime(${i})`);
        const sel = row.querySelector('select');
        if (sel) sel.setAttribute('data-index', i);
    });
}

async function saveAllSettings() {
    // Raccogli tutti i valori
    const closedDays = [...document.querySelectorAll('.closed-day-cb:checked')].map(cb => cb.value);

    const updates = {
        // Info generali
        name:          document.getElementById('bizName')?.value?.trim() || '',
        description:   document.getElementById('bizDescription')?.value?.trim() || '',
        phone:         document.getElementById('bizPhone')?.value?.trim() || '',
        email:         document.getElementById('bizEmail')?.value?.trim() || '',
        address:       document.getElementById('bizAddress')?.value?.trim() || '',
        maps_url:      document.getElementById('bizMapsUrl')?.value?.trim() || '',
        logo_url:      document.getElementById('bizLogoUrl')?.value?.trim() || '',
        primary_color: document.getElementById('bizPrimaryColor')?.value || '#4F46E5',
        header_color:  document.getElementById('bizHeaderColor')?.value || '#1e1b4b',
        // Chi sono
        about_title:   document.getElementById('bizAboutTitle')?.value?.trim() || '',
        about_text:    document.getElementById('bizAboutText')?.value?.trim() || '',
        about_image:   document.getElementById('bizAboutImage')?.value || '',
        // Orari
        opening_time:     document.getElementById('sOpenTime')?.value || '09:00',
        closing_time:     document.getElementById('sCloseTime')?.value || '19:00',
        slot_duration_min: parseInt(document.getElementById('sSlotDuration')?.value) || 60,
        break_start:      document.getElementById('sBreakStart')?.value || '',
        break_end:        document.getElementById('sBreakEnd')?.value || '',
        closed_days:      closedDays,
        // Pagamenti
        payments_enabled: document.getElementById('sPaymentsEnabled')?.checked ?? false,
        // Annullamento
        cancellation_hours: parseInt(document.getElementById('sCancHours')?.value) || 24,
        cancellation_policy: document.getElementById('sCancPolicy')?.value?.trim() || '',
        // Notifiche
        notify_admin_new_booking: document.getElementById('sNotifyNewBooking')?.checked ?? true,
        notify_admin_cancellation: document.getElementById('sNotifyCancellation')?.checked ?? true,
        notify_client_reminder: document.getElementById('sNotifyReminder')?.checked ?? true,
        reminder_times: _getReminderTimesFromUI(),
        // Testo calendario
        slot_duration:   document.getElementById('bizSlotDuration')?.value?.trim() || '60 minuti',
        booking_notice:  document.getElementById('bizBookingNotice')?.value?.trim() || '',
    };

    await saveTenantConfig(updates);

    // Rigenera gli slot orari in base ai nuovi parametri
    applyTimeSlotsFromConfig();

    showToast('Impostazioni salvate!', 'success');
    document.title = updates.name ? updates.name + ' — Admin' : 'Amministrazione';
}

// ── Carica servizi e slot dal tenant all'avvio ───────────────────────────────

(function _initFromTenant() {
    if (typeof CURRENT_TENANT !== 'undefined' && CURRENT_TENANT?.services) {
        CURRENT_TENANT.services.forEach(s => {
            SLOT_NAMES[s.id] = s.name;
            SLOT_PRICES[s.id] = s.price;
            SLOT_MAX_CAPACITY[s.id] = s.capacity;
            if (typeof SLOT_COLORS !== 'undefined') SLOT_COLORS[s.id] = s.color;
        });
    }
    // Genera gli slot orari dal tenant config
    if (typeof CURRENT_TENANT !== 'undefined' && CURRENT_TENANT?.opening_time) {
        applyTimeSlotsFromConfig();
    }
})();
