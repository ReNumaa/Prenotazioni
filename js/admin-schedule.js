// ══════════════════════════════════════════════════════════════════════════════
// Schedule Manager — gestione orari settimanali flessibile
// Ogni slot ha orario inizio, fine e tipo servizio indipendenti
// ══════════════════════════════════════════════════════════════════════════════

let scheduleWeekOffset = 0;
let selectedScheduleDate = null;

function initScheduleManager() { renderScheduleManager(); }

function _getActiveTemplateName() {
    const templates = WeekTemplateStorage.getAll();
    const active = templates.find(t => t.id === WeekTemplateStorage.getActiveId());
    return active ? active.name : 'Standard';
}

function getScheduleWeekDates(offset = 0) {
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

// ── Generate default slots based on tenant config ────────────────────────────

function _generateDefaultSlots() {
    const t = typeof CURRENT_TENANT !== 'undefined' ? CURRENT_TENANT : {};
    const open = t.opening_time || '09:00';
    const close = t.closing_time || '19:00';
    const dur = t.slot_duration_min || 60;
    const breakStart = t.break_start || '';
    const breakEnd = t.break_end || '';
    const services = typeof getCustomServices === 'function' ? getCustomServices() : [];
    const firstType = services[0]?.id || 'servizio-1';

    const [oH, oM] = open.split(':').map(Number);
    const [cH, cM] = close.split(':').map(Number);
    const [bsH, bsM] = breakStart ? breakStart.split(':').map(Number) : [0, 0];
    const [beH, beM] = breakEnd ? breakEnd.split(':').map(Number) : [0, 0];
    const hasBreak = breakStart && breakEnd;

    const slots = [];
    let curH = oH, curM = oM;

    while (curH * 60 + curM + dur <= cH * 60 + cM) {
        const endMin = curH * 60 + curM + dur;
        const eH = Math.floor(endMin / 60), eM = endMin % 60;

        if (hasBreak) {
            const slotStart = curH * 60 + curM;
            const bStart = bsH * 60 + bsM;
            const bEnd = beH * 60 + beM;
            if (slotStart < bEnd && endMin > bStart) {
                curH = beH; curM = beM;
                continue;
            }
        }

        const time = `${String(curH).padStart(2,'0')}:${String(curM).padStart(2,'0')} - ${String(eH).padStart(2,'0')}:${String(eM).padStart(2,'0')}`;
        slots.push({ time, type: firstType });
        curH = eH; curM = eM;
    }

    return slots;
}

// ── Render schedule manager ──────────────────────────────────────────────────

function renderScheduleManager() {
    const manager = document.getElementById('scheduleManager');
    if (!manager) return;

    const weekDates = getScheduleWeekDates(scheduleWeekOffset);
    if (!selectedScheduleDate || !weekDates.find(d => d.formatted === selectedScheduleDate.formatted)) {
        selectedScheduleDate = weekDates[0];
    }

    const overrides = BookingStorage.getScheduleOverrides();
    const weekHasSlots = weekDates.some(d => overrides[d.formatted]?.length > 0);
    const first = weekDates[0].date;
    const last = weekDates[6].date;
    const monthNames = ['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic'];

    // Tenant config info
    const t = typeof CURRENT_TENANT !== 'undefined' ? CURRENT_TENANT : {};
    const durMin = t.slot_duration_min || 60;

    let html = `
        <div class="admin-calendar-controls" style="margin-bottom:0.75rem;">
            <button class="btn-control" onclick="changeScheduleWeek(-1)">&larr; Prec.</button>
            <h4>${first.getDate()}/${first.getMonth()+1} - ${last.getDate()}/${last.getMonth()+1}/${last.getFullYear()}</h4>
            <button class="btn-control" onclick="changeScheduleWeek(1)">Succ. &rarr;</button>
        </div>

        <div style="display:flex;gap:0.4rem;margin-bottom:1rem;flex-wrap:wrap;">
            <button class="btn-control" onclick="importWeekTemplate(${scheduleWeekOffset})" style="font-size:0.8rem;">
                Importa da template (${durMin} min)
            </button>
            ${weekHasSlots ? `<button class="btn-control" onclick="clearWeekSchedule(${scheduleWeekOffset})" style="font-size:0.8rem;color:#e74c3c;">Svuota settimana</button>` : ''}
            <button class="btn-control" onclick="copyPreviousWeek(${scheduleWeekOffset})" style="font-size:0.8rem;">
                Copia settimana precedente
            </button>
        </div>

        <div class="schedule-day-tabs">
    `;

    weekDates.forEach(d => {
        const isActive = selectedScheduleDate.formatted === d.formatted ? 'active' : '';
        const slots = overrides[d.formatted] || [];
        html += `<button class="schedule-day-tab ${isActive} ${slots.length ? 'has-slots' : ''}" onclick="selectScheduleDate('${d.formatted}','${d.dayName}')">
            <div class="admin-day-name">${d.dayName.substring(0,3)}</div>
            <div class="admin-day-date">${d.date.getDate()}</div>
            <div class="admin-day-count">${slots.length ? slots.length + ' slot' : monthNames[d.date.getMonth()]}</div>
        </button>`;
    });
    html += '</div><div id="scheduleDaySlots"></div>';

    manager.innerHTML = html;
    renderDaySlots();
}

// ── Render day slots (flexible) ──────────────────────────────────────────────

function renderDaySlots() {
    const container = document.getElementById('scheduleDaySlots');
    if (!container || !selectedScheduleDate) return;

    const overrides = BookingStorage.getScheduleOverrides();
    const daySlots = overrides[selectedScheduleDate.formatted] || [];
    const services = typeof getCustomServices === 'function' ? getCustomServices() : [];
    const serviceOptions = services.map(s => `<option value="${s.id}">${_escHtml(s.name)}</option>`).join('');

    let html = `<div style="display:flex;justify-content:space-between;align-items:center;margin:1rem 0 0.5rem;">
        <h4>${selectedScheduleDate.dayName} ${selectedScheduleDate.displayDate || ''}</h4>
        <span style="font-size:0.8rem;color:#888;">${daySlots.length} slot</span>
    </div>`;

    if (daySlots.length === 0) {
        html += `<div style="text-align:center;padding:1.5rem;color:#999;background:#f9fafb;border-radius:10px;margin-bottom:1rem;">
            <p>Nessun orario configurato.</p>
            <p style="font-size:0.85rem;margin-top:0.5rem;">Usa <strong>"Importa da template"</strong> per generare gli slot automaticamente,<br>oppure aggiungili uno per uno qui sotto.</p>
        </div>`;
    } else {
        daySlots.forEach((slot, idx) => {
            const tp = _parseSlotTime(slot.time);
            const durMins = tp ? (tp.endH * 60 + tp.endM) - (tp.startH * 60 + tp.startM) : 0;
            const serviceColor = services.find(s => s.id === slot.type)?.color || '#ccc';

            html += `<div class="sched-slot-row">
                <div class="sched-slot-color" style="background:${serviceColor};"></div>
                <div class="sched-slot-time">${slot.time}</div>
                <span class="sched-slot-dur">${durMins} min</span>
                <select class="sched-slot-select" onchange="changeSlotType('${selectedScheduleDate.formatted}','${slot.time}',this.value)">
                    ${services.map(s => `<option value="${s.id}" ${slot.type === s.id ? 'selected' : ''}>${_escHtml(s.name)}</option>`).join('')}
                </select>
                <button onclick="removeSlot('${selectedScheduleDate.formatted}','${slot.time}')" class="sched-slot-remove" title="Rimuovi">✕</button>
            </div>`;
        });
    }

    // Add custom slot
    const lastSlot = daySlots[daySlots.length - 1];
    let suggestedStart = '09:00';
    if (lastSlot) {
        const tp = _parseSlotTime(lastSlot.time);
        if (tp) suggestedStart = `${String(tp.endH).padStart(2,'0')}:${String(tp.endM).padStart(2,'0')}`;
    }

    html += `
    <div class="sched-add-section">
        <div class="sched-add-title">Aggiungi slot</div>
        <div class="sched-add-row">
            <div class="sched-add-field">
                <label>Inizio</label>
                <input type="time" id="addSlotStart" value="${suggestedStart}" class="settings-input">
            </div>
            <div class="sched-add-field">
                <label>Durata</label>
                <select id="addSlotDuration" class="settings-input">
                    <option value="15">15 min</option>
                    <option value="20">20 min</option>
                    <option value="30">30 min</option>
                    <option value="45">45 min</option>
                    <option value="60" selected>60 min</option>
                    <option value="90">90 min</option>
                    <option value="120">2 ore</option>
                </select>
            </div>
            <div class="sched-add-field" style="flex:1.5;">
                <label>Servizio</label>
                <select id="addSlotType" class="settings-input">${serviceOptions}</select>
            </div>
            <div class="sched-add-field" style="flex:0;">
                <label>&nbsp;</label>
                <button onclick="addCustomSlot()" class="settings-btn-primary" style="padding:0.5rem 1rem;white-space:nowrap;">+ Aggiungi</button>
            </div>
        </div>
        <button onclick="addMultipleSlots()" class="btn-control" style="margin-top:0.5rem;font-size:0.8rem;width:100%;">
            Genera slot automatici per questo giorno
        </button>
    </div>`;

    container.innerHTML = html;

    // Set default duration from tenant config
    const defDur = typeof CURRENT_TENANT !== 'undefined' && CURRENT_TENANT?.slot_duration_min ? CURRENT_TENANT.slot_duration_min : 60;
    const durSel = document.getElementById('addSlotDuration');
    if (durSel) durSel.value = String(defDur);
}

// ── Slot operations ──────────────────────────────────────────────────────────

function addCustomSlot() {
    const startInput = document.getElementById('addSlotStart');
    const durSelect = document.getElementById('addSlotDuration');
    const typeSelect = document.getElementById('addSlotType');
    if (!startInput?.value || !selectedScheduleDate) return;

    const [sH, sM] = startInput.value.split(':').map(Number);
    const dur = parseInt(durSelect?.value) || 60;
    const endMin = sH * 60 + sM + dur;
    const eH = Math.floor(endMin / 60), eM = endMin % 60;
    const time = `${String(sH).padStart(2,'0')}:${String(sM).padStart(2,'0')} - ${String(eH).padStart(2,'0')}:${String(eM).padStart(2,'0')}`;

    const overrides = BookingStorage.getScheduleOverrides();
    if (!overrides[selectedScheduleDate.formatted]) overrides[selectedScheduleDate.formatted] = [];

    // Check overlap
    const existing = overrides[selectedScheduleDate.formatted];
    const overlap = existing.find(s => {
        const tp = _parseSlotTime(s.time);
        if (!tp) return false;
        const exStart = tp.startH * 60 + tp.startM;
        const exEnd = tp.endH * 60 + tp.endM;
        return (sH * 60 + sM < exEnd && endMin > exStart);
    });
    if (overlap) {
        showToast(`Sovrapposizione con lo slot ${overlap.time}`, 'error');
        return;
    }

    existing.push({ time, type: typeSelect?.value || 'servizio-1' });
    existing.sort((a, b) => a.time.localeCompare(b.time));
    BookingStorage.saveScheduleOverrides(overrides, [selectedScheduleDate.formatted]);
    renderDaySlots();
}

function addMultipleSlots() {
    if (!selectedScheduleDate) return;
    const slots = _generateDefaultSlots();
    if (slots.length === 0) { showToast('Configura prima gli orari di apertura nelle Impostazioni.', 'info'); return; }

    const overrides = BookingStorage.getScheduleOverrides();
    const existing = overrides[selectedScheduleDate.formatted] || [];

    if (existing.length > 0) {
        if (!confirm(`Questo giorno ha già ${existing.length} slot. Vuoi sostituirli con ${slots.length} slot generati automaticamente?`)) return;
    }

    overrides[selectedScheduleDate.formatted] = slots;
    BookingStorage.saveScheduleOverrides(overrides, [selectedScheduleDate.formatted]);
    renderDaySlots();
    showToast(`${slots.length} slot generati!`, 'success');
}

function changeScheduleWeek(delta) {
    scheduleWeekOffset += delta;
    renderScheduleManager();
}

function selectScheduleDate(dateStr, dayName) {
    const weekDates = getScheduleWeekDates(scheduleWeekOffset);
    selectedScheduleDate = weekDates.find(d => d.formatted === dateStr) || weekDates[0];
    renderScheduleManager();
}

function importWeekTemplate(weekOffset) {
    const weekDates = getScheduleWeekDates(weekOffset);
    const overrides = BookingStorage.getScheduleOverrides();
    const closedDays = typeof CURRENT_TENANT !== 'undefined' && CURRENT_TENANT?.closed_days ? CURRENT_TENANT.closed_days : ['Domenica'];
    const dayNamesMap = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'];
    const defaultSlots = _generateDefaultSlots();
    const changedDates = [];

    weekDates.forEach(d => {
        const dayName = dayNamesMap[d.date.getDay()];
        if (closedDays.includes(dayName)) {
            overrides[d.formatted] = [];
        } else {
            overrides[d.formatted] = JSON.parse(JSON.stringify(defaultSlots));
        }
        changedDates.push(d.formatted);
    });

    BookingStorage.saveScheduleOverrides(overrides, changedDates);
    renderScheduleManager();
    showToast('Settimana importata!', 'success');
}

function copyPreviousWeek(weekOffset) {
    const prevDates = getScheduleWeekDates(weekOffset - 1);
    const currDates = getScheduleWeekDates(weekOffset);
    const overrides = BookingStorage.getScheduleOverrides();
    const changedDates = [];
    let copied = 0;

    currDates.forEach((d, i) => {
        const prevDate = prevDates[i];
        const prevSlots = overrides[prevDate.formatted] || [];
        if (prevSlots.length > 0) {
            overrides[d.formatted] = JSON.parse(JSON.stringify(prevSlots));
            changedDates.push(d.formatted);
            copied += prevSlots.length;
        }
    });

    if (copied === 0) { showToast('La settimana precedente è vuota.', 'info'); return; }
    BookingStorage.saveScheduleOverrides(overrides, changedDates);
    renderScheduleManager();
    showToast(`${copied} slot copiati dalla settimana precedente!`, 'success');
}

function clearWeekSchedule(weekOffset) {
    if (!confirm('Svuotare tutti gli orari di questa settimana?')) return;
    const weekDates = getScheduleWeekDates(weekOffset);
    const overrides = BookingStorage.getScheduleOverrides();
    const changedDates = [];
    weekDates.forEach(d => {
        if (overrides[d.formatted]) {
            overrides[d.formatted] = [];
            changedDates.push(d.formatted);
        }
    });
    BookingStorage.saveScheduleOverrides(overrides, changedDates);
    renderScheduleManager();
    showToast('Settimana svuotata', 'success');
}

function changeSlotType(dateStr, time, newType) {
    const overrides = BookingStorage.getScheduleOverrides();
    const slot = (overrides[dateStr] || []).find(s => s.time === time);
    if (slot) {
        slot.type = newType;
        BookingStorage.saveScheduleOverrides(overrides, [dateStr]);
        renderDaySlots();
    }
}

function removeSlot(dateStr, time) {
    const overrides = BookingStorage.getScheduleOverrides();
    overrides[dateStr] = (overrides[dateStr] || []).filter(s => s.time !== time);
    BookingStorage.saveScheduleOverrides(overrides, [dateStr]);
    renderDaySlots();
}
