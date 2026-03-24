// Admin dashboard — main orchestrator (simplified generic version)

let adminWeekOffset = 0;
let selectedAdminDay = null;

function initAdminCalendar() {
    if (typeof setupAdminCalendar === 'function') setupAdminCalendar();
}

function refreshAdminCalendar() {
    if (typeof renderAdminCalendar === 'function') renderAdminCalendar();
}
