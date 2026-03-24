// Push notification subscription management
// ⚠️ CONFIGURAZIONE: sostituire con la propria chiave VAPID pubblica
const VAPID_PUBLIC_KEY = 'YOUR_VAPID_PUBLIC_KEY_HERE';

function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

async function registerPushSubscription() {
    if (!('PushManager' in window) || !navigator.serviceWorker) return null;
    if (VAPID_PUBLIC_KEY === 'YOUR_VAPID_PUBLIC_KEY_HERE') return null; // Not configured
    const reg = await navigator.serviceWorker.ready;
    const appKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);

    try {
        let sub = await reg.pushManager.getSubscription();
        if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: appKey });
        await savePushSubscription(sub);
        return sub;
    } catch (e) {
        console.warn('[Push] Subscription failed:', e);
        return null;
    }
}

async function savePushSubscription(subscription) {
    const json = subscription.toJSON();
    let userId = null;
    if (typeof supabaseClient !== 'undefined') {
        try {
            const { data: { session } } = await supabaseClient.auth.getSession();
            userId = session?.user?.id ?? null;
        } catch {}
    }
    if (!userId) {
        const u = typeof getCurrentUser === 'function' ? getCurrentUser() : null;
        userId = u?.id ?? null;
    }
    if (typeof supabaseClient !== 'undefined' && userId) {
        await supabaseClient.from('push_subscriptions').upsert({
            user_id: userId, endpoint: json.endpoint,
            keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
        }, { onConflict: 'endpoint' }).then(({ error }) => {
            if (error) console.warn('[Push] Save error:', error.message);
        });
    }
    localStorage.setItem('push_subscription', JSON.stringify({
        endpoint: json.endpoint, saved_at: new Date().toISOString()
    }));
}

// iOS detection
function _isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}
function _isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}

async function promptPushPermission() {
    if (!('Notification' in window) || !('PushManager' in window)) return;
    if (VAPID_PUBLIC_KEY === 'YOUR_VAPID_PUBLIC_KEY_HERE') return;
    if (_isIOS() && !_isStandalone()) return;

    if (Notification.permission === 'granted') {
        await registerPushSubscription();
        return;
    }
    if (Notification.permission === 'denied') return;

    const existing = document.getElementById('pushBanner');
    if (existing) return;

    const banner = document.createElement('div');
    banner.id = 'pushBanner';
    banner.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);width:calc(100% - 32px);max-width:400px;background:#1e1b4b;color:#fff;border-radius:18px;padding:18px;z-index:9999;box-shadow:0 8px 32px rgba(0,0,0,0.4)';
    banner.innerHTML = `
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px">
            <span style="font-size:26px">🔔</span>
            <div>
                <div style="font-weight:700;font-size:15px;">Abilita notifiche</div>
                <div style="font-size:12px;color:#aaa;margin-top:4px;">Ricevi promemoria per i tuoi appuntamenti</div>
            </div>
        </div>
        <button id="pushBannerYes" style="width:100%;background:#4F46E5;color:#fff;border:none;padding:12px;border-radius:10px;cursor:pointer;font-weight:700;">Abilita</button>
    `;
    document.body.appendChild(banner);
    document.getElementById('pushBannerYes').addEventListener('click', async () => {
        banner.remove();
        const permission = await Notification.requestPermission();
        if (permission === 'granted') await registerPushSubscription();
    });
}

if ('Notification' in window && Notification.permission === 'granted') {
    navigator.serviceWorker?.ready.then(() => registerPushSubscription());
}
