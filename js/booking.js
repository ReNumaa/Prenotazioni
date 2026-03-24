// Booking form / modal — versione generica (senza cert/insurance/debt/bonus)

let _confirmedBooking = null;

function initBookingForm() {
    const form = document.getElementById('bookingForm');
    form.addEventListener('submit', handleBookingSubmit);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeBookingModal(); });

    // Swipe-down to close
    const box = document.getElementById('bookingModal').querySelector('.modal-box');
    let startY = 0, swipeActive = false;
    box.addEventListener('touchstart', e => {
        const boxTop = box.getBoundingClientRect().top;
        swipeActive = (e.touches[0].clientY - boxTop) < 40;
        if (swipeActive) { startY = e.touches[0].clientY; box.style.transition = 'none'; }
    }, { passive: true });
    box.addEventListener('touchmove', e => {
        if (!swipeActive) return;
        const dy = e.touches[0].clientY - startY;
        if (dy > 0) box.style.transform = `translateY(${dy}px)`;
    }, { passive: true });
    box.addEventListener('touchend', e => {
        if (!swipeActive) return;
        const dy = e.changedTouches[0].clientY - startY;
        box.style.transition = '';
        if (dy > 80) { box.style.transform = `translateY(100%)`; setTimeout(closeBookingModal, 200); }
        else box.style.transform = '';
        swipeActive = false;
    });
}

function openBookingModal(dateInfo, timeSlot, slotType, remainingSpots) {
    const badge = document.getElementById('modalSlotTypeBadge');
    badge.textContent = SLOT_NAMES[slotType];
    badge.className = `modal-slot-badge ${slotType}`;

    document.getElementById('modalSlotDay').textContent = `${dateInfo.dayName} ${dateInfo.displayDate}`;
    document.getElementById('modalSlotTime').textContent = `${timeSlot}`;

    const spotsEl = document.getElementById('modalSlotSpots');
    spotsEl.textContent = `${remainingSpots} ${remainingSpots === 1 ? 'disponibile' : 'disponibili'}`;
    spotsEl.className = `modal-spots ${spotsColorClass(remainingSpots)}`;

    document.getElementById('bookingForm').reset();
    document.getElementById('confirmationMessage').style.display = 'none';
    document.getElementById('modalSlotInfo').style.display = '';

    const user = typeof getCurrentUser === 'function' ? getCurrentUser() : null;
    const loginPrompt = document.getElementById('loginPrompt');

    if (!user) {
        loginPrompt.style.display = 'block';
        document.getElementById('bookingForm').style.display = 'none';
    } else {
        loginPrompt.style.display = 'none';
        document.getElementById('bookingForm').style.display = 'flex';
        document.getElementById('name').value = user.name || '';
        document.getElementById('email').value = user.email || '';
        document.getElementById('whatsapp').value = user.whatsapp || '';
        const userFields = document.getElementById('bookingUserFields');
        if (userFields) userFields.style.display = 'none';
    }

    const _submitBtn = document.querySelector('#bookingForm button[type="submit"]');
    if (_submitBtn) { _submitBtn.disabled = false; setLoading(_submitBtn, false); }

    document.getElementById('bookingModal').style.display = 'flex';
    document.body.style.overflow = 'hidden';
}

function closeBookingModal() {
    const box = document.getElementById('bookingModal').querySelector('.modal-box');
    box.style.transform = ''; box.style.transition = '';
    document.getElementById('bookingModal').style.display = 'none';
    document.getElementById('modalSlotInfo').style.display = '';
    document.body.style.overflow = '';
    selectedSlot = null;
}

function handleModalOverlayClick(e) {
    if (e.target === document.getElementById('bookingModal')) closeBookingModal();
}

async function handleBookingSubmit(e) {
    e.preventDefault();
    const submitBtn = e.target.querySelector('button[type="submit"]');
    if (submitBtn.disabled) return;
    submitBtn.disabled = true;

    const _slowTimer = setTimeout(() => showToast('Connessione lenta, attendi...', 'warning', 8000), 15000);
    const _safetyTimer = setTimeout(() => {
        setLoading(submitBtn, false); submitBtn.disabled = false;
        showToast('La richiesta sta impiegando troppo. Riprova.', 'error');
    }, 50000);

    try {
        if (!selectedSlot) { showToast('Seleziona uno slot dal calendario.', 'error'); return; }

        // Controlla che la lezione non sia già iniziata da 30+ min
        const _slotTp = _parseSlotTime(selectedSlot.time);
        if (_slotTp) {
            const _lessonStart = new Date(selectedSlot.date);
            _lessonStart.setHours(_slotTp.startH, _slotTp.startM, 0, 0);
            if ((new Date() - _lessonStart) > 30 * 60 * 1000) {
                showToast('Non puoi prenotare: l\'appuntamento è già iniziato.', 'error');
                closeBookingModal(); return;
            }
        }

        const formData = {
            name: document.getElementById('name').value.trim().replace(/\S+/g, w => w[0].toUpperCase() + w.slice(1).toLowerCase()),
            email: document.getElementById('email').value.trim().toLowerCase(),
            whatsapp: normalizePhone(document.getElementById('whatsapp').value.trim()),
            notes: document.getElementById('notes').value.trim()
        };

        if (!formData.name || !formData.email || !formData.whatsapp) {
            showToast('Compila tutti i campi obbligatori.', 'error'); return;
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
            showToast('Inserisci un indirizzo email valido.', 'error'); return;
        }
        if (!/[\d\s+()-]{10,}/.test(formData.whatsapp)) {
            showToast('Inserisci un numero di telefono valido.', 'error'); return;
        }

        // Posti disponibili
        const remainingSpots = BookingStorage.getRemainingSpots(selectedSlot.date, selectedSlot.time, selectedSlot.slotType);
        if (remainingSpots <= 0) {
            showToast('Slot completo. Seleziona un altro orario.', 'error');
            renderCalendar(); return;
        }

        // Duplicati
        const _dupUser = typeof getCurrentUser === 'function' ? getCurrentUser() : null;
        if (_dupUser?.id && typeof supabaseClient !== 'undefined') {
            try {
                const { data: _dupRows } = await supabaseClient.from('bookings').select('id')
                    .eq('user_id', _dupUser.id).eq('date', selectedSlot.date).eq('time', selectedSlot.time)
                    .not('status', 'in', '("cancelled")').limit(1);
                if (_dupRows?.length > 0) { showToast('Hai già una prenotazione per questo orario.', 'error'); return; }
            } catch { /* fallback locale */ }
        }

        setLoading(submitBtn, true, 'Prenotazione in corso...');

        const booking = {
            ...formData,
            date: selectedSlot.date, time: selectedSlot.time,
            slotType: selectedSlot.slotType, dateDisplay: selectedSlot.dateDisplay
        };

        const result = await BookingStorage.saveBooking(booking);
        if (!result.ok) {
            if (result.error === 'slot_full') showToast('Slot non più disponibile.', 'error');
            else if (result.error === 'too_late') showToast('Appuntamento già iniziato.', 'error');
            else showToast('Errore durante la prenotazione. Riprova.', 'error');
            return;
        }

        showConfirmation(result.booking);
        notificaPrenotazione(result.booking);
        _notifyAdminNewBooking(result.booking);
        document.getElementById('bookingForm').reset();
        renderCalendar();
        if (typeof renderMobileSlots === 'function' && selectedMobileDay) renderMobileSlots(selectedMobileDay);
        selectedSlot = null;
    } catch (err) {
        console.error('[Booking] errore:', err);
        showToast('Errore durante la prenotazione. Riprova.', 'error');
    } finally {
        clearTimeout(_slowTimer); clearTimeout(_safetyTimer);
        setLoading(submitBtn, false); submitBtn.disabled = false;
    }
}

function showConfirmation(booking) {
    _confirmedBooking = booking;
    document.getElementById('bookingForm').style.display = 'none';
    document.getElementById('modalSlotInfo').style.display = 'none';
    const tenant = typeof CURRENT_TENANT !== 'undefined' ? CURRENT_TENANT : null;
    const bizName = tenant?.name || 'Appuntamento';
    const bizPhone = tenant?.phone || '';
    const bizAddress = tenant?.address || '';
    const bookingNotice = tenant?.booking_notice || '';
    const div = document.getElementById('confirmationMessage');
    div.innerHTML = `
        <div style="text-align:center;padding:0.5rem 0;">
            <div style="font-size:2.5rem;margin-bottom:0.5rem;">&#10003;</div>
            <h3 style="color:#059669;margin-bottom:1rem;">Prenotazione Confermata!</h3>
        </div>
        <div style="background:#f8fdf9;border-radius:10px;padding:1rem;margin-bottom:1rem;">
            <p style="font-weight:700;font-size:1.05rem;margin-bottom:0.5rem;">${_escHtml(booking.name)}</p>
            <div style="display:flex;flex-direction:column;gap:0.4rem;font-size:0.9rem;color:#555;">
                <div><strong>Servizio:</strong> ${SLOT_NAMES[booking.slotType] || booking.slotType}</div>
                <div><strong>Data:</strong> ${booking.dateDisplay}</div>
                <div><strong>Orario:</strong> ${booking.time}</div>
                ${bizAddress ? `<div><strong>Dove:</strong> ${_escHtml(bizAddress)}</div>` : ''}
            </div>
        </div>
        ${bookingNotice ? `<p style="color:#888;font-size:0.8rem;line-height:1.5;margin-bottom:0.75rem;">${_escHtml(bookingNotice)}</p>` : ''}
        ${bizPhone ? `<p style="font-size:0.85rem;color:#666;">Per modifiche o domande: <a href="tel:${_escHtml(bizPhone)}" style="color:var(--primary-cyan);font-weight:600;">${_escHtml(bizPhone)}</a></p>` : ''}
    `;
    div.style.display = 'block';
}

async function notificaPrenotazione(booking) {
    if (!('Notification' in window) || !navigator.serviceWorker) return;
    let permission = Notification.permission;
    if (permission === 'denied') return;
    if (permission === 'default') permission = await Notification.requestPermission();
    if (permission !== 'granted') return;
    if (typeof registerPushSubscription === 'function') registerPushSubscription();
    const reg = await navigator.serviceWorker.ready;
    reg.showNotification('Prenotazione confermata', {
        body: `${SLOT_NAMES[booking.slotType]} - ${booking.dateDisplay} - ${booking.time}`,
        icon: '/images/icon-192.png',
        tag: 'prenotazione-' + booking.id,
    });
}

// Notify admin via Edge Function (fire-and-forget)
async function _notifyAdminNewBooking(booking) {
    if (typeof SUPABASE_URL === 'undefined' || SUPABASE_URL.includes('YOUR_PROJECT')) return;
    if (typeof CURRENT_TENANT === 'undefined' || !CURRENT_TENANT?.id) return;
    try {
        await fetch(`${SUPABASE_URL}/functions/v1/notify-booking`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + SUPABASE_ANON_KEY },
            body: JSON.stringify({
                tenant_id: CURRENT_TENANT.id,
                type: 'new_booking',
                client_name: booking.name || '',
                date_display: booking.dateDisplay || booking.date || '',
                time: booking.time || '',
                service_name: SLOT_NAMES[booking.slotType] || booking.slotType || '',
            }),
        });
    } catch (e) { console.warn('[Push] notifyAdmin error:', e); }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initBookingForm);
else initBookingForm();
