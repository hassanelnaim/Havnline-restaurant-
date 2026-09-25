import Stripe from "stripe";

export const OPERATIONAL_SUBSCRIPTION_STATUSES = ["active", "trialing", "past_due"];

let cachedClient: Stripe | null = null;

export function getStripeClient(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  if (!cachedClient) {
    cachedClient = new Stripe(key, { apiVersion: "2024-06-20" });
  }
  return cachedClient;
}

const TRIAL_PERIOD_DAYS = parseInt(process.env.TRIAL_PERIOD_DAYS || "7", 10);

export async function createCheckoutSession(input: {
  businessId: string;
  businessName: string;
  customerEmail: string;
  existingStripeCustomerId: string | null;
  successUrl: string;
  cancelUrl: string;
}): Promise<{ url: string | null; error?: string }> {
  const stripe = getStripeClient();
  const priceId = process.env.STRIPE_PRICE_ID;
  if (!stripe || !priceId) {
    return { url: null, error: "Billing is not configured yet." };
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      customer: input.existingStripeCustomerId || undefined,
      customer_email: input.existingStripeCustomerId ? undefined : input.customerEmail,
      client_reference_id: input.businessId,
      subscription_data: {
        trial_period_days: TRIAL_PERIOD_DAYS,
        metadata: { business_id: input.businessId, business_name: input.businessName },
      },
      metadata: { business_id: input.businessId },
    });
    return { url: session.url };
  } catch (err) {
    console.error("Stripe checkout session creation failed:", err);
    const message = err instanceof Stripe.errors.StripeError ? err.message : "Could not start checkout.";
    return { url: null, error: message };
  }
}

export async function createBillingPortalSession(customerId: string, returnUrl: string): Promise<{ url: string | null; error?: string }> {
  const stripe = getStripeClient();
  if (!stripe) return { url: null, error: "Billing is not configured yet." };

  try {
    const session = await stripe.billingPortal.sessions.create({ customer: customerId, return_url: returnUrl });
    return { url: session.url };
  } catch (err) {
    console.error("Stripe billing portal session failed:", err);
    const message = err instanceof Stripe.errors.StripeError ? err.message : "Could not open billing portal.";
    return { url: null, error: message };
  }
}
