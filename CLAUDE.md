# Sistema di Prenotazione Appuntamenti — SaaS Multi-Tenant

## Cos'è
SaaS multi-tenant per prenotazione appuntamenti. Un'unica app, un unico Supabase, ogni cliente (tenant) ha il suo spazio isolato.
Adatto a: parrucchieri, estetiste, fisioterapisti, studi medici, personal trainer, consulenti, tatuatori, nutrizionisti.

Nato come fork semplificato del sistema palestra di Thomas Bresciani, trasformato in template SaaS generico.

## Demo live
- **Landing**: https://renumaa.github.io/Prenotazioni/
- **Super Admin**: https://renumaa.github.io/Prenotazioni/super-admin.html
- **Tenant esempio**: https://renumaa.github.io/Prenotazioni/index.html#SLUG

## Architettura Multi-Tenant
- **URL**: `pagina.html#slug-tenant` — il tenant slug è nell'hash dell'URL (funziona su GitHub Pages)
- **Dati**: ogni tabella ha `tenant_id`, RLS filtra automaticamente per tenant
- **Ruoli**: Super Admin (proprietario piattaforma), Admin Tenant (il cliente), Utente (cliente finale)
- **Config**: nome, logo, colori, servizi, orari, policy annullamento, notifiche — tutto nella tabella `tenants`
- **Realtime**: WebSocket Supabase filtrati per tenant_id, cross-device istantaneo

## Stack tecnico
| Layer | Tecnologia |
|-------|-----------|
| Frontend | HTML5 + CSS3 + JavaScript vanilla (zero npm, zero build) |
| Backend | Supabase (PostgreSQL + Auth + Realtime + RLS + Edge Functions) |
| Auth | Supabase Auth + Google OAuth |
| Pagamenti piattaforma | Stripe (checkout + webhook + billing portal) |
| PWA | Service Worker + Web Push API + manifest dinamico per tenant |
| Hosting | GitHub Pages (gratuito) |
| Email | Supabase Auth (inviti, conferme, reset) |
| Notifiche push | Web Push + VAPID + Edge Functions |

## Struttura file
```
├── index.html              → Calendario prenotazioni (+ landing page se no tenant)
├── login.html              → Login / Registrazione / Google OAuth / Reset password
├── prenotazioni.html       → "I miei appuntamenti" (utente, con annullamento 24h)
├── admin.html              → Dashboard admin tenant (5 tab)
├── super-admin.html        → Gestione tutti i tenant + inviti + billing status
├── privacy.html            → Informativa privacy e termini GDPR
├── manifest.json           → PWA manifest (statico, sovrascritto dinamicamente per tenant)
├── sw.js                   → Service Worker (cache v7, path relativi per GitHub Pages)
├── css/
│   ├── style.css           → Stili globali, navbar, calendario, auth buttons, responsive
│   ├── admin.css           → Admin dashboard, settings, schedule, clients, billing, logo upload
│   ├── login.css           → Pagina login/registrazione
│   └── prenotazioni.css    → Pagina prenotazioni utente
├── js/
│   ├── supabase-client.js  → Config Supabase (credenziali placeholder, demo mode se non configurato)
│   ├── tenant.js           → Risoluzione tenant, branding dinamico, manifest PWA, link rewriting, billing check
│   ├── data.js             → BookingStorage, CreditStorage, WeekTemplateStorage, UserStorage (tutti tenant-aware)
│   ├── auth.js             → Supabase Auth, profilo, navbar, demo mode, auto-claim inviti
│   ├── calendar.js         → Calendario settimanale (desktop + mobile, slot flessibili)
│   ├── booking.js          → Modal prenotazione, validazione, conferma con info tenant, notifica admin
│   ├── admin.js            → Admin orchestrator
│   ├── admin-calendar.js   → Admin: prenotazioni giorno + prenotazione manuale con dropdown clienti
│   ├── admin-clients.js    → Admin: CRUD clienti (registrati + manuali), ricerca, dettaglio espandibile
│   ├── admin-schedule.js   → Admin: gestione orari flessibile (15-120 min), import/copia/svuota settimana
│   ├── admin-settings.js   → Admin: impostazioni complete (info, logo upload, colori, orari, annullamento, pagamenti, notifiche, billing Stripe)
│   ├── ui.js               → Toast, loading, HTML escaping, localStorage helpers
│   ├── push.js             → Push notifications subscription + promemoria banner
│   ├── pwa-install.js      → Banner installazione PWA
│   └── sw-update.js        → Auto-update Service Worker
├── images/
│   ├── icon-192.png        → Icona PWA 192x192 (indigo con griglia calendario)
│   └── icon-512.png        → Icona PWA 512x512
└── supabase/
    ├── migrations/
    │   └── 20260324000000_init.sql  → Schema DB completo multi-tenant (tutte le tabelle, RLS, RPC, trigger)
    └── functions/
        ├── send-reminders/     → Cron: invia push promemoria (multi-orario dal tenant config)
        ├── notify-booking/     → Notifica admin su nuova prenotazione/annullamento
        ├── create-subscription/→ Crea sessione Stripe Checkout per abbonamento tenant
        ├── stripe-webhook/     → Gestisce eventi Stripe (pagamento, rinnovo, cancellazione)
        └── billing-portal/     → Apre Stripe Customer Portal per gestione carta/fatture
```

## URL routing
```
index.html (senza hash)             → landing page con lista tenant
index.html#barbiere-mario           → calendario pubblico del barbiere
login.html#barbiere-mario           → login/registrazione per quel tenant
prenotazioni.html#barbiere-mario    → i miei appuntamenti (con annullamento)
admin.html#barbiere-mario           → admin del barbiere (5 tab)
super-admin.html                    → gestione tutti i tenant (solo super_admin)
privacy.html                        → privacy policy
```

## Funzionalità per l'Admin Tenant (5 tab)

### Tab Prenotazioni
- Vista giornaliera con slot e prenotazioni
- Bottone [+] per prenotazione manuale su ogni slot
- Dropdown clienti esistenti + inserimento manuale
- Toggle pagato/non pagato (se gestione pagamenti attiva)
- Annullamento prenotazioni

### Tab Clienti
- Lista clienti (registrati + manuali) con ricerca
- Badge "registrato" (blu) / "manuale" (grigio)
- Click → dettaglio espandibile (note, contatti, storico appuntamenti)
- Aggiungi / Modifica / Elimina clienti manuali
- Clienti inseriti durante prenotazione manuale vengono salvati automaticamente

### Tab Orari
- Slot flessibili: ogni slot ha orario inizio, durata (15-120 min) e servizio indipendenti
- Aggiunta slot singolo con orario, durata e servizio
- Controllo sovrapposizioni
- "Genera slot automatici" (basato su impostazioni apertura/chiusura/durata/pausa)
- "Importa da template" per tutta la settimana
- "Copia settimana precedente"
- "Svuota settimana"
- Colore servizio visibile su ogni slot

### Tab Servizi
- CRUD servizi (nome, prezzo, posti per slot, colore)
- Minimo 1 servizio
- Colore personalizzabile con color picker
- Aggiornamento live delle costanti globali

### Tab Impostazioni
- **Abbonamento**: stato billing (trial/attivo/scaduto), bottone Stripe, portale gestione
- **Info generali**: nome, descrizione, telefono, email, indirizzo, Google Maps
- **Aspetto**: logo (upload drag & drop, resize 200px, base64), colore primario, colore header, anteprima live
- **Orari apertura**: apertura, chiusura, durata slot default, pausa pranzo, giorni chiusura
- **Annullamento**: ore minime (0-72h), messaggio policy personalizzabile
- **Gestione pagamenti**: toggle on/off (se off, nessun tracking pagamenti)
- **Notifiche**: toggle admin nuova prenotazione, toggle admin annullamento, promemoria multipli (15min, 30min, 1h, 2h, 4h, 6h, 12h, 24h, 48h, 72h)
- **Testo calendario**: durata mostrata, avviso post-prenotazione

## Flusso nuovo tenant
1. Super admin va su `super-admin.html`
2. Inserisce nome, slug, email admin
3. Il tenant viene creato con 30 giorni di trial
4. (Con Supabase) l'admin riceve email di invito → clicca il link → imposta password → accede al suo pannello
5. (In demo) l'admin accede direttamente da `admin.html#slug`
6. L'admin configura servizi, orari, branding dal suo pannello

## Flusso prenotazione cliente
1. Cliente visita `index.html#slug-tenant`
2. Vede il calendario con slot disponibili
3. Clicca uno slot → modal di prenotazione (richiede login)
4. Si registra / accede → prenota
5. Conferma con dettagli (servizio, data, ora, indirizzo, telefono)
6. Riceve push notification di conferma
7. Riceve promemoria automatici (configurati dall'admin: es. 24h + 1h prima)
8. Può annullare dalla pagina "I miei appuntamenti" (rispettando la policy dell'admin)

## Database (tutto su Supabase)
| Tabella | Contenuto |
|---------|-----------|
| `tenants` | Config completa tenant (info, branding, servizi, orari, notifiche, billing, clienti manuali, week templates) |
| `tenant_members` | Link utente → tenant con ruolo (owner, admin, staff) |
| `tenant_invites` | Inviti pendenti (auto-claim alla registrazione) |
| `profiles` | Profili utenti (globali, uno per utente) |
| `bookings` | Prenotazioni (con `tenant_id`) |
| `schedule_overrides` | Slot orari configurati per data (con `tenant_id`) |
| `credits` | Crediti/pagamenti clienti (con `tenant_id`) |
| `push_subscriptions` | Subscription push per device (con `tenant_id`) |

## Sicurezza
- RLS su tutte le tabelle (filtro per tenant_id e user_id)
- `is_super_admin()` → controlla `app_metadata.role = 'super_admin'`
- `is_tenant_admin(tenant_id)` → controlla `tenant_members`
- `book_slot_atomic` → prenotazione atomica con advisory lock (no race condition)
- `admin_update_booking` → verifica ruolo admin prima di modificare
- Inviti: email in `tenant_invites` + auto-claim via trigger `handle_new_user()`
- HTML escaping ovunque (`_escHtml`) per prevenire XSS
- CSP headers su tutte le pagine

## Modalità demo (senza Supabase)
- `supabase-client.js` rileva credenziali placeholder → `supabaseClient = undefined`
- `auth.js` crea utente demo auto-loggato come admin
- `tenant.js` salva tenant in localStorage
- Tutto funziona localmente per mostrare la demo ai potenziali clienti
- Dati non persistenti tra browser/dispositivi diversi

## Billing (Stripe)
- **Trial**: 30 giorni gratuiti alla creazione del tenant
- **Piano**: €19.90/mese via Stripe Checkout
- **Stati**: trial → active → past_due → cancelled → expired
- **Portale**: l'admin gestisce carta, fatture, disdetta da Stripe Customer Portal
- **Webhook**: aggiorna automaticamente `tenants.plan` + `tenants.active`
- **Tenant scaduto**: calendario pubblico mostra "Servizio sospeso" con telefono contatto
- **Super admin**: vede badge stato (Prova/Attivo/Ritardo/Cancellato) + giorni rimanenti trial

## Service Worker
- Cache name con versione (incrementare ad ogni deploy): `prenotazioni-vN`
- Path relativi (`./`) per funzionare su GitHub Pages subfolder
- Strategia: Network First per HTML, Stale-While-Revalidate per JS/CSS, Cache First per immagini
- `sw-update.js` rileva nuove versioni e ricarica automaticamente

## Da fare (quando hai il primo cliente)

### Obbligatorio (1 ora)
1. Creare progetto Supabase gratuito su supabase.com
2. Copiare URL + anon key in `js/supabase-client.js`
3. Eseguire `supabase/migrations/20260324000000_init.sql` nell'SQL Editor
4. Impostare super_admin: `UPDATE auth.users SET raw_app_meta_data = raw_app_meta_data || '{"role":"super_admin"}' WHERE email = 'tua@email.com';`
5. Comprare dominio (es. `prenotafacile.it`, ~€10/anno)
6. Configurare dominio personalizzato su GitHub Pages (Settings → Pages → Custom domain)

### Consigliato (30 min)
7. Abilitare Google OAuth in Supabase (Authentication → Providers → Google)
8. Generare chiavi VAPID: `npx web-push generate-vapid-keys` → salvare in env Supabase
9. Personalizzare template email Supabase (Authentication → Email Templates)
10. Configurare Stripe: creare prodotto €19.90/mese, salvare `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET` nelle env Supabase

### Opzionale (futuro)
11. Configurare Supabase Cron per `send-reminders` (ogni 15 minuti)
12. Aggiungere Brevo SMTP per email transazionali personalizzate
13. Analytics nel super-admin (prenotazioni per tenant, revenue, ecc.)
14. Possibilità per l'admin di caricare foto gallery
15. Integrazione Google Calendar (export .ics)

## Costi infrastruttura
| Servizio | Piano Free | Quando paghi |
|----------|-----------|-------------|
| Supabase | 2 progetti gratis, 500MB DB, 50K utenti | €25/mese se superi limiti |
| GitHub Pages | Gratuito per sempre | Mai |
| Dominio | ~€10/anno | Da subito |
| Stripe | 1.4% + €0.25 per transazione | Solo quando incassi |
| Brevo | 300 email/giorno gratis | €7/mese se ne servono di più |

**Margine**: con 10 clienti a €19.90/mese = €199/mese di ricavo, €0 di costi = 100% margine.
