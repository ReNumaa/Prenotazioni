// Edge Function: Create Stripe Checkout Session for tenant subscription
// Called from admin panel when admin clicks "Attiva abbonamento"

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@14?target=deno'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2023-10-16' })
const PRICE_ID = Deno.env.get('STRIPE_PRICE_ID')! // Monthly price (€19.90)

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

Deno.serve(async (req) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, content-type, x-client-info, apikey',
    'Content-Type': 'application/json',
  }

  if (req.method === 'OPTIONS') return new Response(null, { headers })

  try {
    const { tenant_id } = await req.json()
    if (!tenant_id) {
      return new Response(JSON.stringify({ error: 'missing tenant_id' }), { status: 400, headers })
    }

    // Get tenant info
    const { data: tenant, error: tErr } = await supabase
      .from('tenants')
      .select('id, name, email, stripe_customer_id')
      .eq('id', tenant_id)
      .single()

    if (tErr || !tenant) {
      return new Response(JSON.stringify({ error: 'tenant not found' }), { status: 404, headers })
    }

    // Get or create Stripe customer
    let customerId = tenant.stripe_customer_id
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: tenant.email || undefined,
        name: tenant.name,
        metadata: { tenant_id: tenant.id },
      })
      customerId = customer.id

      // Save customer ID to tenant
      await supabase.from('tenants')
        .update({ stripe_customer_id: customerId })
        .eq('id', tenant.id)
    }

    // Determine success/cancel URLs
    const origin = req.headers.get('origin') || 'https://prenotafacile.it'
    const successUrl = `${origin}/admin.html#${tenant_id}?billing=success`
    const cancelUrl = `${origin}/admin.html#${tenant_id}?billing=cancelled`

    // Create Checkout Session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: PRICE_ID, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      subscription_data: {
        metadata: { tenant_id: tenant.id },
        trial_period_days: tenant.plan === 'trial' ? undefined : undefined, // trial already managed by us
      },
      metadata: { tenant_id: tenant.id },
      locale: 'it',
      allow_promotion_codes: true,
    })

    return new Response(JSON.stringify({ url: session.url }), { headers })

  } catch (e: any) {
    console.error('create-subscription error:', e)
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers })
  }
})
