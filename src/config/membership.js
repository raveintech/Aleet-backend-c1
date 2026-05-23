/**
 * Canonical Membership plan definition.
 *
 * Single source of truth: subscription checkout, webhook activation, benefit
 * listing, and the prepaid-hour ledger all import from here. Adding a new
 * plan ("Founder 30" etc.) is a new entry in `PLANS`, not a new constant in
 * a new controller.
 *
 * Stripe integration:
 *   - `stripePriceId` is the Stripe Price ID for the *recurring* product
 *     (quarterly billing). When set, the checkout uses `mode: 'subscription'`
 *     so Stripe handles renewal automatically.
 *   - When `stripePriceId` is unset (dev environments), checkout falls back
 *     to `mode: 'payment'` for a one-shot charge and emits a structured
 *     warning. Production deployments MUST configure the env var.
 */

/**
 * Cents-naming convention (priceCents, monthlyDisplayCents):
 *   All monetary fields exposed by this module are integer cents so arithmetic
 *   stays exact and Stripe consumes them directly. The display layer converts
 *   to dollars (cents / 100). Do not introduce dollar-typed fields here.
 */
const MEMBERSHIP_PLAN = Object.freeze({
  name: 'Membership',
  hoursIncluded: 5,
  // $1,347 charged quarterly (advertised as $449/month). Used as a fallback
  // unit_amount only when no recurring Stripe Price is configured.
  priceCents: 134700,
  // Per-month list price advertised to the customer (display only).
  monthlyDisplayCents: 44900,
  billingCycle: 'quarterly',
  cycleDays: 90,
  // 10% off member rate. Persisted on `user.subscriptionDetails.discountRate`
  // for the legacy pricing path; not used once PRICING_OVERAGE is on.
  discountRate: 0.9,
  // Recurring Stripe Price ID — set in env. When present, checkout uses
  // subscription mode and Stripe owns the renewal schedule.
  stripePriceId: process.env.STRIPE_MEMBERSHIP_PRICE_ID || null,
});

const FOUNDER_30_PLAN = Object.freeze({
  name: 'Founder 30',
  hoursIncluded: 30,
  priceCents: 0, // not modeled in MVP
  monthlyDisplayCents: 0,
  billingCycle: 'quarterly',
  cycleDays: 90,
  stripePriceId: process.env.STRIPE_FOUNDER_30_PRICE_ID || null,
});

const PLANS = Object.freeze({
  Membership: MEMBERSHIP_PLAN,
  'Founder 30': FOUNDER_30_PLAN,
});

module.exports = { MEMBERSHIP_PLAN, FOUNDER_30_PLAN, PLANS };
