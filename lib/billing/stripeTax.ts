import { getStripeClient } from "@/lib/billing/stripe";

/**
 * Real, live sales-tax calculation via Stripe Tax -- replaces the old
 * manually-entered tax_rate_bps percentage (see migration 023). A
 * phone order is always pickup (fulfillment_type is always "pickup"),
 * so the sale happens at the restaurant's own location -- there's no
 * customer shipping address to use, the restaurant's own address IS
 * the point of sale, used as both origin and destination.
 *
 * This calls Stripe's real Tax Calculation API (POST
 * /v1/tax/calculations), which looks up the actual combined
 * state+county+city rate for that address -- not a flat guess.
 *
 * IMPORTANT, and outside what code alone can fix: Stripe Tax has to be
 * turned on for the connected Stripe account (dashboard.stripe.com/
 * settings/tax) and needs at least one tax registration added for
 * wherever the business actually has to collect (normally just its
 * home state, at dashboard.stripe.com/tax/registrations). Without a
 * registration for the address below, Stripe returns a real,
 * successful calculation with $0 tax -- not an error -- so there's
 * nothing for this code to detect or warn about; that step genuinely
 * has to happen once in the Stripe dashboard itself.
 */

const businessAddressFieldsNote =
  "address_city/address_state/address_zip on the business (see Settings) must all be set for a real tax calculation.";

export interface TaxableBusinessAddress {
  address_city: string | null;
  address_state: string | null;
  address_zip: string | null;
}

/**
 * Returns the real tax to charge on subtotalCents, in cents. Fails
 * open (returns 0) on any missing config or API error rather than
 * ever blocking an order from being placed -- a Stripe Tax hiccup
 * should never be the reason a paying customer's order can't go
 * through; it just means that one order collects no tax and the
 * owner can see it logged below to catch a real misconfiguration.
 */
export async function calculateTaxCents(business: TaxableBusinessAddress, subtotalCents: number): Promise<number> {
  if (subtotalCents <= 0) return 0;

  const stripe = getStripeClient();
  if (!stripe) return 0;

  const { address_city: city, address_state: state, address_zip: postalCode } = business;
  if (!city || !state || !postalCode) {
    console.warn(`calculateTaxCents: skipping Stripe Tax -- ${businessAddressFieldsNote}`);
    return 0;
  }

  try {
    const calculation = await stripe.tax.calculations.create({
      currency: "usd",
      customer_details: {
        address: { city, state, postal_code: postalCode, country: "US" },
        // "shipping" is the closest fit Stripe's enum offers for a
        // pickup sale -- there's no "point_of_sale" option, and this
        // is the destination address regardless of label.
        address_source: "shipping",
      },
      line_items: [
        {
          amount: subtotalCents,
          reference: "order_subtotal",
          // General tangible-goods code (txcd_99999999). Stripe's tax
          // code list didn't expose a dedicated "prepared restaurant
          // food" code we could verify from here -- this is a safe,
          // generically-taxable default, but it's worth double
          // checking in Stripe's own tax code reference
          // (dashboard.stripe.com or docs.stripe.com/tax/tax-codes)
          // against your actual menu, especially if you ever sell
          // alcohol, which many states tax differently than food.
          tax_code: "txcd_99999999",
        },
      ],
    });

    return calculation.tax_amount_exclusive;
  } catch (err) {
    console.error("Stripe Tax calculation failed:", err);
    return 0;
  }
}
