// Edge Function: Create Stripe Billing Portal session
// Allows tenant admin to manage their subscription (update card, cancel, view invoices)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@14?target=deno'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2023-10-16' })

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

    const { data: tenant } = await supabase
      .from('tenants')
      .select('stripe_customer_id')
      .eq('id', tenant_id)
      .single()

    if (!tenant?.stripe_customer_id) {
      return new Response(JSON.stringify({ error: 'No billing account found' }), { status: 404, headers })
    }

    const origin = req.headers.get('origin') || 'https://prenotafacile.it'
    const session = await stripe.billingPortal.sessions.create({
      customer: tenant.stripe_customer_id,
      return_url: `${origin}/admin.html#${tenant_id}`,
    })

    return new Response(JSON.stringify({ url: session.url }), { headers })
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers })
  }
})
