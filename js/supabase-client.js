// Supabase client — shared across all pages
// ⚠️ CONFIGURAZIONE: sostituire con le credenziali del proprio progetto Supabase
const SUPABASE_URL = 'https://YOUR_PROJECT.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR_ANON_KEY';

// Se le credenziali non sono configurate, supabaseClient resta undefined
// e l'app funziona in modalità demo (solo localStorage)
let supabaseClient;
try {
    if (SUPABASE_URL.includes('YOUR_PROJECT') || SUPABASE_ANON_KEY === 'YOUR_ANON_KEY') {
        console.warn('[Supabase] Credenziali non configurate — modalità demo (localStorage)');
        supabaseClient = undefined;
    } else {
        supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    }
} catch (e) {
    console.warn('[Supabase] Errore creazione client:', e.message);
    supabaseClient = undefined;
}
