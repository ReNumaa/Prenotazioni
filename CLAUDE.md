# Sistema di Prenotazione Appuntamenti — SaaS Multi-Tenant

## Cos'è
SaaS multi-tenant per prenotazione appuntamenti. Un'unica app, un unico Supabase, ogni cliente (tenant) ha il suo spazio isolato.
Adatto a: parrucchieri, estetiste, studi medici, fisioterapisti, personal trainer, consulenti.

## Architettura Multi-Tenant
- **URL**: `index.html#barbiere-mario` — il tenant slug è nell'hash dell'URL
- **Dati**: ogni tabella ha `tenant_id`, RLS filtra automaticamente
- **Ruoli**: Super Admin (tu), Admin Tenant (il cliente), Utente (cliente finale)
- **Config**: nome, logo, colori, servizi, orari — tutto nella tabella `tenants`

## Stack tecnico
- **Frontend**: HTML5 + CSS3 + JavaScript vanilla (zero build tools)
- **Backend**: Supabase (PostgreSQL + Auth + Realtime + RLS)
- **Auth**: Supabase Auth + Google OAuth
- **PWA**: Service Worker + Web Push API
- **Hosting**: GitHub Pages (o qualsiasi hosting statico)

## Struttura file
```
├── index.html              → Calendario prenotazioni (+ landing page se no tenant)
├── login.html              → Login / Registrazione
├── prenotazioni.html       → "I miei appuntamenti" (utente)
├── admin.html              → Dashboard admin tenant (5 tab)
├── super-admin.html        → Gestione tutti i tenant (per te)
├── manifest.json / sw.js   → PWA
├── css/
│   ├── style.css           → Stili globali + servizi
│   ├── admin.css           → Stili admin + settings
│   ├── login.css / prenotazioni.css
├── js/
│   ├── supabase-client.js  → Config Supabase (credenziali)
│   ├── tenant.js           → Risoluzione tenant, branding, link rewriting
│   ├── data.js             → Storage tenant-aware (BookingStorage, etc.)
│   ├── auth.js             → Auth + navbar + profilo
│   ├── calendar.js         → Calendario settimanale
│   ├── booking.js          → Modal prenotazione
│   ├── admin.js            → Admin orchestrator
│   ├── admin-calendar.js   → Admin: prenotazioni giorno
│   ├── admin-clients.js    → Admin: lista clienti
│   ├── admin-schedule.js   → Admin: gestione orari
│   ├── admin-settings.js   → Admin: servizi + impostazioni → tabella tenants
│   ├── ui.js / push.js / pwa-install.js / sw-update.js
└── supabase/migrations/    → Schema DB multi-tenant
```

## URL routing
```
index.html#barbiere-mario           → calendario pubblico del barbiere
login.html#barbiere-mario           → login per quel tenant
prenotazioni.html#barbiere-mario    → i miei appuntamenti
admin.html#barbiere-mario           → admin del barbiere
super-admin.html                    → gestione tutti i tenant (solo per te)
index.html (senza hash)             → landing page
```

## Flusso nuovo tenant
1. Vai su `super-admin.html`
2. Inserisci nome, slug, email admin
3. Il tenant viene creato con servizi e orari di default
4. L'admin accede a `admin.html#suo-slug` e configura tutto dal pannello

## Modalità demo (senza Supabase)
Funziona tutto con localStorage. I tenant vengono salvati localmente.
Utile per demo ai clienti prima di configurare Supabase.

## Setup produzione
1. Crea progetto su supabase.com
2. Copia URL e anon key in `js/supabase-client.js`
3. Esegui `supabase/migrations/20260324000000_init.sql`
4. Imposta te stesso come super_admin:
   ```sql
   UPDATE auth.users SET raw_app_meta_data = raw_app_meta_data || '{"role":"super_admin"}' WHERE email = 'tua@email.com';
   ```
5. Abilita Google OAuth nelle impostazioni Auth di Supabase
6. Abilita Realtime sulle tabelle bookings, schedule_overrides, tenants
