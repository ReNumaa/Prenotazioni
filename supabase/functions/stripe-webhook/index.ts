// Edge Function: Stripe Webhook Handler
// Receives Stripe events and updates tenant billing status
// Endpoint: POST /functions/v1/stripe-webhook

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@14?target=deno'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2023-10-16' })
const endpointSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET')!

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

async function updateTenantPlan(tenantId: string, plan: string, subscriptionId?: string) {
  const updates: Record<string, any> = {
    plan,
    plan_updated_at: new Date().toISOString(),
    active: plan === 'active' || plan === 'trial',
  }
  if (subscriptionId) updates.stripe_subscription_id = subscriptionId

  const { error } = await supabase
    .from('tenants')
    .update(updates)
    .eq('id', tenantId)

  if (error) console.error(`Failed to update tenant ${tenantId}:`, error.message)
  else console.log(`Tenant ${tenantId} → plan: ${plan}`)
}

async function getTenantByCustomer(customerId: string): Promise<string | null> {
  const { data } = await supabase
    .from('tenants')
    .select('id')
    .eq('stripe_customer_id', customerId)
    .maybeSingle()
  return data?.id || null
}

async function getTenantBySubscription(subscriptionId: string): Promise<string | null> {
  const { data } = await supabase
    .from('tenants')
    .select('id')
    .eq('stripe_subscription_id', subscriptionId)
    .maybeSingle()
  return data?.id || null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*' } })
  }

  const body = await req.text()
  const sig = req.headers.get('stripe-signature')

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, sig!, endpointSecret)
  } catch (e: any) {
    console.error('Webhook signature verification failed:', e.message)
    return new Response(`Webhook Error: ${e.message}`, { status: 400 })
  }

  console.log('Stripe event:', event.type)

  try {
    switch (event.type) {
      // ── Subscription created/activated ──────────────────────────────
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        const tenantId = session.metadata?.tenant_id
        if (tenantId && session.subscription) {
          await updateTenantPlan(tenantId, 'active', session.subscription as string)
        }
        break
      }

      // ── Payment successful (renewal) ────────────────────────────────
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice
        const subId = invoice.subscription as string
        if (subId) {
          const tenantId = await getTenantBySubscription(subId)
          if (tenantId) await updateTenantPlan(tenantId, 'active')
        }
        break
      }

      // ── Payment failed ──────────────────────────────────────────────
      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice
        const subId = invoice.subscription as string
        if (subId) {
          const tenantId = await getTenantBySubscription(subId)
          if (tenantId) await updateTenantPlan(tenantId, 'past_due')
        }
        break
      }

      // ── Subscription cancelled ──────────────────────────────────────
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription
        const tenantId = sub.metadata?.tenant_id || await getTenantBySubscription(sub.id)
        if (tenantId) await updateTenantPlan(tenantId, 'cancelled')
        break
      }

      // ── Subscription updated (e.g., past_due → active after retry) ─
      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription
        const tenantId = sub.metadata?.tenant_id || await getTenantBySubscription(sub.id)
        if (tenantId) {
          const status = sub.status === 'active' ? 'active'
            : sub.status === 'past_due' ? 'past_due'
            : sub.status === 'canceled' ? 'cancelled'
            : 'expired'
          await updateTenantPlan(tenantId, status, sub.id)
        }
        break
      }
    }
  } catch (e: any) {
    console.error('Webhook handler error:', e)
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
