/**
 * The per-order fee HavnLine actually takes on a given charge.
 *
 * No fee while the business is still on its free trial: the trial is
 * meant to be free, and without this the 3% was being collected on
 * every paid phone order from day one. The fee starts the moment the
 * subscription leaves "trialing".
 */
export function effectivePlatformFeeBps(business: {
  platform_fee_bps: number | null;
  subscription_status: string | null | undefined;
}): number | null {
  if (business.subscription_status === "trialing") return null;
  return business.platform_fee_bps;
}
