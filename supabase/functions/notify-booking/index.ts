// Edge Function: Notify admin when a new booking is made or cancelled
// Called from the client after a successful booking/cancellation

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY')!
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')!
const VAPID_EMAIL = Deno.env.get('VAPID_EMAIL') || 'mailto:noreply@example.com'

webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)

interface NotifyRequest {
  tenant_id: string
  type: 'new_booking' | 'cancellation'
  client_name: string
  date_display: string
  time: string
  service_name: string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' },
    })
  }

  try {
    const body: NotifyRequest = await req.json()
    const { tenant_id, type, client_name, date_display, time, service_name } = body

    if (!tenant_id) {
      return new Response(JSON.stringify({ ok: false, error: 'missing tenant_id' }), { status: 400 })
    }

    // Check tenant notification settings
    const { data: tenant } = await supabase
      .from('tenants')
      .select('name, notify_admin_new_booking, notify_admin_cancellation')
      .eq('id', tenant_id)
      .single()

    if (!tenant) {
      return new Response(JSON.stringify({ ok: false, error: 'tenant not found' }), { status: 404 })
    }

    // Check if this notification type is enabled
    if (type === 'new_booking' && !tenant.notify_admin_new_booking) {
      return new Response(JSON.stringify({ ok: true, sent: 0, reason: 'disabled' }))
    }
    if (type === 'cancellation' && !tenant.notify_admin_cancellation) {
      return new Response(JSON.stringify({ ok: true, sent: 0, reason: 'disabled' }))
    }

    // Get admin push subscriptions (admins of this tenant)
    const { data: members } = await supabase
      .from('tenant_members')
      .select('user_id')
      .eq('tenant_id', tenant_id)

    if (!members?.length) {
      return new Response(JSON.stringify({ ok: true, sent: 0, reason: 'no admins' }))
    }

    const adminIds = members.map(m => m.user_id)
    const { data: subs } = await supabase
      .from('push_subscriptions')
      .select('endpoint, keys')
      .eq('tenant_id', tenant_id)
      .in('user_id', adminIds)

    if (!subs?.length) {
      return new Response(JSON.stringify({ ok: true, sent: 0, reason: 'no push subs' }))
    }

    const isNew = type === 'new_booking'
    const payload = JSON.stringify({
      title: isNew ? 'Nuova prenotazione' : 'Annullamento',
      body: isNew
        ? `${client_name} ha prenotato ${service_name} — ${date_display} ${time}`
        : `${client_name} ha annullato ${service_name} — ${date_display} ${time}`,
      tag: `admin-${type}-${Date.now()}`,
      url: `/admin.html#${tenant_id}`,
    })

    let sent = 0
    for (const sub of subs) {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, payload)
        sent++
      } catch (e: any) {
        if (e.statusCode === 410 || e.statusCode === 404) {
          await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
        }
      }
    }

    return new Response(JSON.stringify({ ok: true, sent }), {
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
    })
  } catch (e: any) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), {
      status: 500,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
    })
  }
})
