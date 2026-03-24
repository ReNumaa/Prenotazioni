// ══════════════════════════════════════════════════════════════════════════════
// Admin Clients — gestione clienti completa (CRUD + prenotazione manuale)
// I clienti manuali vengono salvati in localStorage (demo) o nel tenant config
// ══════════════════════════════════════════════════════════════════════════════

// ── Manual clients storage ───────────────────────────────────────────────────

function _getManualClients() {
    // Leggi dal tenant (Supabase) se disponibile
    if (typeof CURRENT_TENANT !== 'undefined' && CURRENT_TENANT?.manual_clients) {
        return CURRENT_TENANT.manual_clients;
    }
    // Fallback localStorage demo
    const slug = typeof TENANT_SLUG !== 'undefined' ? TENANT_SLUG : '';
    return _lsGetJSON('manual_clients_' + slug, []);
}

function _saveManualClients(clients) {
    // Salva nel tenant (Supabase)
    if (typeof saveTenantConfig === 'function') {
        saveTenantConfig({ manual_clients: clients });
    }
    // Fallback localStorage demo
    const slug = typeof TENANT_SLUG !== 'undefined' ? TENANT_SLUG : '';
    _lsSet('manual_clients_' + slug, JSON.stringify(clients));
}

// ── Get all clients (registered + manual + from bookings) ────────────────────

function _getAllClients() {
    const manual = _getManualClients();
    const fromStorage = UserStorage.getAll();

    // Merge: manual clients first, then registered, dedup by email/phone
    const seen = new Set();
    const result = [];

    const _add = (c, source) => {
        const key = (c.email || '').toLowerCase() || normalizePhone(c.whatsapp || '') || c.name;
        if (seen.has(key)) return;
        seen.add(key);
        result.push({ ...c, _source: source });
    };

    manual.forEach(c => _add(c, 'manual'));
    fromStorage.forEach(c => _add(c, 'registered'));

    return result.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

// ── Render client list ───────────────────────────────────────────────────────

function renderClientList() {
    const container = document.getElementById('clientList');
    if (!container) return;

    const query = (document.getElementById('clientSearch')?.value || '').toLowerCase().trim();
    let clients = _getAllClients();

    if (query) {
        clients = clients.filter(c =>
            (c.name || '').toLowerCase().includes(query) ||
            (c.email || '').toLowerCase().includes(query) ||
            (c.whatsapp || '').includes(query) ||
            (c.notes || '').toLowerCase().includes(query)
        );
    }

    if (clients.length === 0) {
        container.innerHTML = `<p style="text-align:center;color:#999;padding:2rem;">
            ${query ? 'Nessun cliente trovato.' : 'Nessun cliente. Clicca "+ Aggiungi" per inserirne uno.'}
        </p>`;
        return;
    }

    container.innerHTML = clients.map((c, i) => {
        const initial = (c.name || 'U')[0].toUpperCase();
        const bookings = BookingStorage.getAllBookings().filter(b =>
            b.status !== 'cancelled' &&
            ((b.email && c.email && b.email.toLowerCase() === c.email.toLowerCase()) ||
             (b.whatsapp && c.whatsapp && normalizePhone(b.whatsapp) === normalizePhone(c.whatsapp)))
        );
        const bookingCount = bookings.length;
        const isManual = c._source === 'manual';
        const badge = isManual
            ? '<span style="font-size:0.65rem;padding:0.1rem 0.3rem;border-radius:4px;background:#f3f4f6;color:#888;margin-left:0.3rem;">manuale</span>'
            : '<span style="font-size:0.65rem;padding:0.1rem 0.3rem;border-radius:4px;background:#eff6ff;color:#3b82f6;margin-left:0.3rem;">registrato</span>';

        return `<div class="admin-client-card" style="cursor:pointer;" onclick="toggleClientDetail(${i})">
            <div class="admin-client-avatar">${initial}</div>
            <div class="admin-client-info">
                <div class="admin-client-name">${_escHtml(c.name)}${badge}</div>
                <div class="admin-client-detail">
                    ${c.email ? _escHtml(c.email) : '<span style="color:#ccc;">no email</span>'}
                    ${c.whatsapp ? ' · ' + _escHtml(c.whatsapp) : ''}
                </div>
            </div>
            <div class="admin-client-stats">${bookingCount} app.</div>
        </div>
        <div id="clientDetail-${i}" class="client-detail-panel" style="display:none;">
            ${c.notes ? `<p style="font-size:0.85rem;color:#666;margin-bottom:0.5rem;"><em>${_escHtml(c.notes)}</em></p>` : ''}
            <div style="display:flex;gap:0.4rem;flex-wrap:wrap;">
                <button onclick="editClient(${i}); event.stopPropagation();" class="settings-btn-primary" style="font-size:0.8rem;padding:0.35rem 0.7rem;">Modifica</button>
                ${c.whatsapp ? `<a href="tel:${_escHtml(c.whatsapp)}" onclick="event.stopPropagation();" class="settings-btn-primary" style="font-size:0.8rem;padding:0.35rem 0.7rem;background:#059669;text-decoration:none;">Chiama</a>` : ''}
                ${isManual ? `<button onclick="deleteClient(${i}); event.stopPropagation();" class="settings-btn-danger" style="font-size:0.8rem;">Elimina</button>` : ''}
            </div>
            ${bookingCount > 0 ? `
                <div style="margin-top:0.75rem;">
                    <p style="font-size:0.8rem;font-weight:600;color:#555;margin-bottom:0.3rem;">Ultimi appuntamenti:</p>
                    ${bookings.slice(0, 5).map(b => `
                        <div style="font-size:0.8rem;color:#666;padding:0.2rem 0;">${b.date} · ${b.time} · ${SLOT_NAMES[b.slotType] || b.slotType}</div>
                    `).join('')}
                </div>
            ` : ''}
        </div>`;
    }).join('');
}

let _openClientIdx = -1;
function toggleClientDetail(index) {
    const el = document.getElementById('clientDetail-' + index);
    if (!el) return;
    if (_openClientIdx === index) {
        el.style.display = 'none';
        _openClientIdx = -1;
    } else {
        // Close previous
        if (_openClientIdx >= 0) {
            const prev = document.getElementById('clientDetail-' + _openClientIdx);
            if (prev) prev.style.display = 'none';
        }
        el.style.display = 'block';
        _openClientIdx = index;
    }
}

// ── Client modal (add/edit) ──────────────────────────────────────────────────

function openClientModal(editData, editIndex) {
    document.getElementById('clientModalTitle').textContent = editData ? 'Modifica cliente' : 'Nuovo cliente';
    document.getElementById('clientEditIndex').value = editIndex ?? -1;
    document.getElementById('clientName').value = editData?.name || '';
    document.getElementById('clientEmail').value = editData?.email || '';
    document.getElementById('clientPhone').value = editData?.whatsapp || '';
    document.getElementById('clientNotes').value = editData?.notes || '';
    document.getElementById('clientFormError').style.display = 'none';
    document.getElementById('clientModal').style.display = 'flex';
    document.body.style.overflow = 'hidden';
    document.getElementById('clientName').focus();
}

function closeClientModal() {
    document.getElementById('clientModal').style.display = 'none';
    document.body.style.overflow = '';
}

function saveClient(e) {
    e.preventDefault();
    const name = document.getElementById('clientName').value.trim();
    const email = document.getElementById('clientEmail').value.trim().toLowerCase();
    const phone = document.getElementById('clientPhone').value.trim();
    const notes = document.getElementById('clientNotes').value.trim();
    const editIndex = parseInt(document.getElementById('clientEditIndex').value);
    const errEl = document.getElementById('clientFormError');

    if (!name) { errEl.textContent = 'Il nome è obbligatorio.'; errEl.style.display = 'block'; return; }
    if (!email && !phone) { errEl.textContent = 'Inserisci almeno email o telefono.'; errEl.style.display = 'block'; return; }

    const client = {
        name: name.replace(/\S+/g, w => w[0].toUpperCase() + w.slice(1).toLowerCase()),
        email: email || '',
        whatsapp: phone ? normalizePhone(phone) : '',
        notes: notes || '',
    };

    const manual = _getManualClients();

    if (editIndex >= 0 && editIndex < manual.length) {
        // Edit existing
        manual[editIndex] = { ...manual[editIndex], ...client };
    } else {
        // Check duplicate
        const allClients = _getAllClients();
        const dup = allClients.find(c =>
            (email && c.email && c.email.toLowerCase() === email) ||
            (client.whatsapp && c.whatsapp && normalizePhone(c.whatsapp) === client.whatsapp)
        );
        if (dup) { errEl.textContent = 'Un cliente con questa email o telefono esiste già.'; errEl.style.display = 'block'; return; }
        manual.push(client);
    }

    _saveManualClients(manual);
    closeClientModal();
    showToast(editIndex >= 0 ? 'Cliente aggiornato!' : 'Cliente aggiunto!', 'success');
    renderClientList();
}

function editClient(allClientsIndex) {
    const clients = _getAllClients();
    const client = clients[allClientsIndex];
    if (!client) return;

    if (client._source === 'manual') {
        // Find index in manual array
        const manual = _getManualClients();
        const manualIdx = manual.findIndex(c =>
            c.name === client.name &&
            (c.email || '') === (client.email || '') &&
            (c.whatsapp || '') === (client.whatsapp || '')
        );
        openClientModal(client, manualIdx >= 0 ? manualIdx : -1);
    } else {
        // Registered user — edit as manual (creates a manual override)
        openClientModal(client, -1);
    }
}

function deleteClient(allClientsIndex) {
    const clients = _getAllClients();
    const client = clients[allClientsIndex];
    if (!client || client._source !== 'manual') return;
    if (!confirm(`Eliminare ${client.name}?`)) return;

    const manual = _getManualClients();
    const manualIdx = manual.findIndex(c =>
        c.name === client.name &&
        (c.email || '') === (client.email || '') &&
        (c.whatsapp || '') === (client.whatsapp || '')
    );
    if (manualIdx >= 0) {
        manual.splice(manualIdx, 1);
        _saveManualClients(manual);
        showToast('Cliente eliminato.', 'success');
        _openClientIdx = -1;
        renderClientList();
    }
}
