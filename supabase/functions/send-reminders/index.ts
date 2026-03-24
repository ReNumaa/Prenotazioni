// Edge Function: Send push reminders for upcoming appointments
// Runs on a cron schedule (e.g., every 15 minutes)
// Checks each tenant's reminder_times config and sends push to matching bookings

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

Deno.serve(async () => {
  try {
    // Get all active tenants with reminders enabled
    const { data: tenants, error: tErr } = await supabase
      .from('tenants')
      .select('id, name, notify_client_reminder, reminder_times')
      .eq('active', true)
      .eq('notify_client_reminder', true)

    if (tErr || !tenants?.length) {
      return new Response(JSON.stringify({ ok: true, sent: 0, reason: 'no tenants' }))
    }

    const now = new Date()
    let totalSent = 0

    for (const tenant of tenants) {
      const reminderTimes: number[] = tenant.reminder_times || [24, 1]

      for (const hoursBeforeF of reminderTimes) {
        const hoursBefore = Number(hoursBeforeF)
        // Find bookings starting in exactly `hoursBefore` hours (±15 min window)
        const targetStart = new Date(now.getTime() + hoursBefore * 60 * 60 * 1000 - 7.5 * 60 * 1000)
        const targetEnd = new Date(now.getTime() + hoursBefore * 60 * 60 * 1000 + 7.5 * 60 * 1000)

        const targetDateStart = targetStart.toISOString().split('T')[0]
        const targetDateEnd = targetEnd.toISOString().split('T')[0]

        // Get confirmed bookings for this tenant in the time window
        const { data: bookings } = await supabase
          .from('bookings')
          .select('id, user_id, date, time, slot_type, name')
          .eq('tenant_id', tenant.id)
          .eq('status', 'confirmed')
          .gte('date', targetDateStart)
          .lte('date', targetDateEnd)

        if (!bookings?.length) continue

        for (const booking of bookings) {
          // Parse booking start time
          const [startTime] = booking.time.split(' - ')
          const [h, m] = startTime.trim().split(':').map(Number)
          const bookingStart = new Date(`${booking.date}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`)

          // Check if booking is within the reminder window
          if (bookingStart < targetStart || bookingStart > targetEnd) continue

          // Check we haven't already sent this reminder
          const reminderKey = `reminder_${booking.id}_${hoursBefore}h`

          // Get push subscription for this user
          if (!booking.user_id) continue
          const { data: subs } = await supabase
            .from('push_subscriptions')
            .select('endpoint, keys')
            .eq('user_id', booking.user_id)
            .eq('tenant_id', tenant.id)

          if (!subs?.length) continue

          const label = hoursBefore >= 24
            ? `${Math.round(hoursBefore / 24)} giorno/i`
            : hoursBefore >= 1
              ? `${hoursBefore} ora/e`
              : `${Math.round(hoursBefore * 60)} minuti`

          const payload = JSON.stringify({
            title: `Promemoria — ${tenant.name}`,
            body: `Il tuo appuntamento è tra ${label}: ${booking.time}`,
            tag: reminderKey,
            url: `/prenotazioni.html#${tenant.id}`,
          })

          for (const sub of subs) {
            try {
              await webpush.sendNotification({
                endpoint: sub.endpoint,
                keys: sub.keys,
              }, payload)
              totalSent++
            } catch (e: any) {
              // If subscription is expired, remove it
              if (e.statusCode === 410 || e.statusCode === 404) {
                await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
              }
              console.error('Push error:', e.message)
            }
          }
        }
      }
    }

    return new Response(JSON.stringify({ ok: true, sent: totalSent }))
  } catch (e: any) {
    console.error('send-reminders error:', e)
    return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500 })
  }
})
