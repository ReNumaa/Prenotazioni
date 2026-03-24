// ══════════════════════════════════════════════════════════════════════════════
// Admin Calendar — vista prenotazioni + prenotazione manuale
// ══════════════════════════════════════════════════════════════════════════════

function setupAdminCalendar() { renderAdminCalendar(); }

function getAdminWeekDates(offset = 0) {
    const today = new Date();
    const dow = today.getDay();
    const diff = dow === 0 ? -6 : 1 - dow;
    const monday = new Date(today);
    monday.setDate(today.getDate() + diff + (offset * 7));
    const dayNames = ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica'];
    const dates = [];
    for (let i = 0; i < 7; i++) {
        const date = new Date(monday);
        date.setDate(monday.getDate() + i);
        dates.push({
            date, dayName: dayNames[i],
            formatted: `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`,
            displayDate: `${date.getDate()}/${date.getMonth()+1}`
        });
    }
    return dates;
}

function renderAdminCalendar() {
    const container = document.getElementById('adminCalendarContainer');
    if (!container) return;

    const weekDates = getAdminWeekDates(adminWeekOffset);
    const todayStr = _localDateStr();

    if (!selectedAdminDay || !weekDates.find(d => d.formatted === selectedAdminDay.formatted)) {
        selectedAdminDay = weekDates.find(d => d.formatted === todayStr) || weekDates[0];
    }

    const first = weekDates[0].date;
    const last = weekDates[6].date;

    let html = `
        <div class="admin-calendar-controls">
            <button class="btn-control" onclick="adminWeekOffset--; renderAdminCalendar();">&larr; Prec.</button>
            <h4>${first.getDate()}/${first.getMonth()+1} - ${last.getDate()}/${last.getMonth()+1}/${last.getFullYear()}</h4>
            <button class="btn-control" onclick="adminWeekOffset++; renderAdminCalendar();">Succ. &rarr;</button>
        </div>
        <div class="schedule-day-tabs">
    `;

    weekDates.forEach(d => {
        const isActive = selectedAdminDay.formatted === d.formatted ? 'active' : '';
        const overrides = BookingStorage.getScheduleOverrides();
        const slots = overrides[d.formatted] || [];
        const bookings = BookingStorage.getAllBookings().filter(b => b.date === d.formatted && b.status !== 'cancelled');
        html += `<button class="schedule-day-tab ${isActive} ${slots.length ? 'has-slots' : ''}" onclick="selectedAdminDay={formatted:'${d.formatted}',dayName:'${d.dayName}',displayDate:'${d.displayDate}',date:new Date('${d.formatted}')}; renderAdminCalendar();">
            <div class="admin-day-name">${d.dayName.substring(0,3)}</div>
            <div class="admin-day-date">${d.date.getDate()}</div>
            <div class="admin-day-count">${bookings.length} app.</div>
        </button>`;
    });
    html += '</div>';
    html += renderAdminDayDetail(selectedAdminDay);
    container.innerHTML = html;
}

function renderAdminDayDetail(day) {
    const overrides = BookingStorage.getScheduleOverrides();
    const daySlots = overrides[day.formatted] || [];
    const allBookings = BookingStorage.getAllBookings();

    if (daySlots.length === 0) {
        return `<div style="text-align:center;padding:2rem;color:#999;">Nessun orario configurato per ${day.dayName} ${day.displayDate || ''}</div>`;
    }

    let html = `<div class="admin-day-detail"><h4>${day.dayName} ${day.displayDate || ''}</h4>`;

    daySlots.forEach(slot => {
        const bookings = allBookings.filter(b => b.date === day.formatted && b.time === slot.time && b.status !== 'cancelled');
        const maxCap = BookingStorage.getEffectiveCapacity(day.formatted, slot.time, slot.type);
        const spotsTaken = bookings.filter(b => b.slotType === slot.type).length;
        const spotsLeft = maxCap - spotsTaken;

        html += `<div class="admin-slot-card ${slot.type}">
            <div class="admin-slot-header">
                <span class="admin-slot-time">${slot.time}</span>
                <span class="admin-slot-type">${SLOT_NAMES[slot.type] || slot.type}</span>
                <span class="admin-slot-count">${spotsTaken}/${maxCap}</span>
                ${spotsLeft > 0 ? `<button class="admin-add-booking-btn" onclick="openAdminBookingModal('${day.formatted}','${_escHtml(day.dayName)} ${_escHtml(day.displayDate)}','${slot.time}','${slot.type}')" title="Prenota manualmente">+</button>` : ''}
            </div>`;

        if (bookings.length > 0) {
            html += '<div class="admin-slot-bookings">';
            const _showPay = typeof isPaymentsEnabled === 'function' && isPaymentsEnabled();
            bookings.forEach(b => {
                html += `<div class="admin-booking-row">
                    <span class="admin-booking-name">${_escHtml(b.name)}</span>
                    <span class="admin-booking-contact">${_escHtml(b.whatsapp || b.email)}</span>
                    ${_showPay ? `<span class="admin-booking-status ${b.paid ? 'paid' : 'unpaid'}">${b.paid ? 'Pagato' : 'Da pagare'}</span>
                    <button class="admin-booking-action" onclick="toggleBookingPaid('${b.id}')">${b.paid ? '↩' : '€'}</button>` : ''}
                    <button class="admin-booking-action admin-booking-cancel" onclick="adminCancelBooking('${b.id}')">✕</button>
                </div>`;
            });
            html += '</div>';
        } else {
            html += `<div class="admin-slot-empty">Nessuna prenotazione ${spotsLeft > 0 ? '— <a href="javascript:void(0)" onclick="openAdminBookingModal(\''+day.formatted+'\',\''+_escHtml(day.dayName)+' '+_escHtml(day.displayDate)+'\',\''+slot.time+'\',\''+slot.type+'\')" style="color:var(--primary-cyan);">prenota manualmente</a>' : ''}</div>`;
        }

        html += '</div>';
    });

    html += '</div>';
    return html;
}

// ── Admin manual booking modal ───────────────────────────────────────────────

let _adminBookSlot = null;

function openAdminBookingModal(date, dateDisplay, time, slotType) {
    _adminBookSlot = { date, dateDisplay, time, slotType };

    // Build client dropdown from all known clients
    const clients = typeof _getAllClients === 'function' ? _getAllClients() : [];

    let modal = document.getElementById('adminBookingModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'adminBookingModal';
        modal.className = 'modal-overlay';
        modal.onclick = (e) => { if (e.target === modal) closeAdminBookingModal(); };
        document.body.appendChild(modal);
    }

    modal.innerHTML = `
        <div class="modal-box" style="max-width:480px;">
            <button class="modal-close" onclick="closeAdminBookingModal()">&#10005;</button>
            <h3 style="margin-bottom:0.5rem;">Prenotazione manuale</h3>
            <p style="color:#666;font-size:0.9rem;margin-bottom:1rem;">
                <strong>${SLOT_NAMES[slotType] || slotType}</strong> — ${dateDisplay} — ${time}
            </p>

            <div class="settings-field">
                <label>Seleziona cliente esistente</label>
                <select id="adminBookClientSelect" class="settings-input" onchange="_fillFromClientSelect()">
                    <option value="">— Seleziona o inserisci manualmente —</option>
                    ${clients.map((c, i) => `<option value="${i}">${_escHtml(c.name)} ${c.email ? '(' + _escHtml(c.email) + ')' : c.whatsapp ? '(' + _escHtml(c.whatsapp) + ')' : ''}</option>`).join('')}
                </select>
            </div>

            <div style="border-top:1px solid #eee;margin:0.75rem 0;padding-top:0.75rem;">
                <div class="settings-field">
                    <label>Nome *</label>
                    <input type="text" id="adminBookName" class="settings-input" placeholder="Mario Rossi">
                </div>
                <div class="settings-row">
                    <div class="settings-field" style="flex:1;">
                        <label>Email</label>
                        <input type="email" id="adminBookEmail" class="settings-input" placeholder="mario@email.com">
                    </div>
                    <div class="settings-field" style="flex:1;">
                        <label>Telefono</label>
                        <input type="tel" id="adminBookPhone" class="settings-input" placeholder="+39 333 1234567">
                    </div>
                </div>
                <div class="settings-field">
                    <label>Note (opzionale)</label>
                    <input type="text" id="adminBookNotes" class="settings-input" placeholder="Note...">
                </div>
            </div>

            <div id="adminBookError" class="login-error" style="display:none;"></div>
            <button onclick="confirmAdminBooking()" class="settings-btn-primary" style="width:100%;padding:0.8rem;font-size:0.95rem;">
                Conferma prenotazione
            </button>
        </div>
    `;

    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
}

function closeAdminBookingModal() {
    const modal = document.getElementById('adminBookingModal');
    if (modal) modal.style.display = 'none';
    document.body.style.overflow = '';
    _adminBookSlot = null;
}

function _fillFromClientSelect() {
    const sel = document.getElementById('adminBookClientSelect');
    const idx = parseInt(sel.value);
    if (isNaN(idx)) return;
    const clients = typeof _getAllClients === 'function' ? _getAllClients() : [];
    const c = clients[idx];
    if (!c) return;
    document.getElementById('adminBookName').value = c.name || '';
    document.getElementById('adminBookEmail').value = c.email || '';
    document.getElementById('adminBookPhone').value = c.whatsapp || '';
}

async function confirmAdminBooking() {
    if (!_adminBookSlot) return;
    const name = document.getElementById('adminBookName').value.trim();
    const email = document.getElementById('adminBookEmail').value.trim().toLowerCase();
    const phone = document.getElementById('adminBookPhone').value.trim();
    const notes = document.getElementById('adminBookNotes').value.trim();
    const errEl = document.getElementById('adminBookError');
    errEl.style.display = 'none';

    if (!name) { errEl.textContent = 'Il nome è obbligatorio.'; errEl.style.display = 'block'; return; }

    const booking = {
        name: name.replace(/\S+/g, w => w[0].toUpperCase() + w.slice(1).toLowerCase()),
        email: email || '',
        whatsapp: phone ? normalizePhone(phone) : '',
        notes: notes,
        date: _adminBookSlot.date,
        time: _adminBookSlot.time,
        slotType: _adminBookSlot.slotType,
        dateDisplay: _adminBookSlot.dateDisplay,
    };

    const result = await BookingStorage.saveBooking(booking);
    if (!result.ok) {
        if (result.error === 'slot_full') errEl.textContent = 'Slot pieno.';
        else errEl.textContent = 'Errore: ' + (result.error || 'riprova');
        errEl.style.display = 'block';
        return;
    }

    closeAdminBookingModal();
    showToast(`${name} prenotato!`, 'success');
    renderAdminCalendar();

    // Add to manual clients if not already known
    if (typeof _getManualClients === 'function' && typeof _saveManualClients === 'function') {
        const manual = _getManualClients();
        const allClients = typeof _getAllClients === 'function' ? _getAllClients() : [];
        const exists = allClients.some(c =>
            (email && c.email && c.email.toLowerCase() === email) ||
            (booking.whatsapp && c.whatsapp && normalizePhone(c.whatsapp) === booking.whatsapp)
        );
        if (!exists && (email || booking.whatsapp)) {
            manual.push({ name: booking.name, email: email, whatsapp: booking.whatsapp, notes: '' });
            _saveManualClients(manual);
        }
    }
}

// ── Existing functions ───────────────────────────────────────────────────────

function toggleBookingPaid(bookingId) {
    const all = BookingStorage.getAllBookings();
    const booking = all.find(b => b.id === bookingId);
    if (!booking) return;
    booking.paid = !booking.paid;
    booking.paidAt = booking.paid ? new Date().toISOString() : null;
    booking.paymentMethod = booking.paid ? 'contanti' : null;
    BookingStorage.replaceAllBookings(all);
    renderAdminCalendar();
    showToast(booking.paid ? 'Segnato come pagato' : 'Pagamento rimosso', 'success');
}

function adminCancelBooking(bookingId) {
    if (!confirm('Annullare questa prenotazione?')) return;
    BookingStorage.cancelDirectly(bookingId);
    renderAdminCalendar();
    showToast('Prenotazione annullata', 'success');
}
