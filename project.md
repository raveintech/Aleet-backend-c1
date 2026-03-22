Project Context
The Aleet platform is already partially built with both front-end and back-end in place.
A significant portion of the system is complete. The remaining work involves:
Completing unfinished functionality

Correcting incomplete or incorrect implementations

Aligning the system with defined operational logic

Preparing the platform for production launch

This is not a rebuild. All work must be completed within the existing codebase and infrastructure.

Execution Structure
The project is structured into 4 milestone phases with a target completion timeline of 4–6 weeks.

Phase 1 — Foundation & Access Control
Mobile & portal responsiveness

Twilio authentication & messaging

Driver profiles, onboarding, and SSN logic

Phase 2 — Driver Structure & Availability Engine
Driver tiers, eligibility, and priority

Availability & coverage logic

Booking rules & member enforcement

Phase 3 — Payments, Membership & Financial Logic
Checkout, payments, and pricing logic

Membership & subscription logic

Hour deduction & late-night pricing

Phase 4 — Guest Experience & Launch Polish
Locations, maps, and free routing

Guest profiles & trip details

Support communication, affiliates, investor page

ALEET — MVP COMPLETION
Type: Complete existing codebase (no rebuild)
Timeline: 4–6 weeks
Budget: $3,000 (4 milestones)

✅ WEEK 1 — FOUNDATION & ACCESS CONTROL
(Make the platform usable + secure before business logic)
Release: $750
Covers Sections:

1. Mobile & Portal Responsiveness  
   Fix clipped CTAs
   Fix vehicles not loading
   Confirm no UI blocks testing
   This must be done first or nothing else can be properly tested.

2. Twilio Authentication & Messaging
   Signup: phone → SMS code → password → email.

Login: phone or email + password.

Forgot password via email.

SMS only for:

Signup

Trip alerts

Promos

Reduce SMS usage to control costs.

Process should follow:
Guest Signs up… input number & email
Code is sent to guest phone
Guest inputs code
Prompt to set a password
Account made
Sign in process
Guest inputs phone number or email
Guest inputs password & is logged in
Forget password process
Guest chose forget password
Email used for account is send link to reset
Guest resets password.
This establishes an identity layer.

2. Driver Profiles, Onboarding & SSN Logic
   Move SSN to signup only

SSN required only if no for-hire license

Mask SSN by default

For hire License upload logic

Background check gate before portal access

Drivers see payout only (not guest/trip total)

End of Phase 1 Result: Users and drivers can sign up correctly. Security and roles work. No broken portals. No exposed SSN. No login chaos.

✅ Week 2 — DRIVER STRUCTURE & AVAILABILITY ENGINE
(Make the system operationally truthful)
Release: $750
Covers Sections: 3) Driver Tiers, Eligibility & Priority
Replace fake/generic tiers with:

S-Tier (No vehicle)

Pro (No For-Hire license but has car)

Diamond (has car & for-hire license)

Tie tiers to:

Eligibility

Priority

Pay structure

Restrict membership trips to Pro & Diamond

Ratings affect visibility only

This wires platform driver dispatch model.

4. Availability & Coverage Logic
   Implement:
   AQD

RB

CL

MCT

3-hour rule

7-day booking allowance

Same-day ON/OFF binary logic

Admin override

Guest messaging when allowed/not allowed

This is the core safety engine.

5. Booking Rules & Member Enforcement
   7-day for premium curated rides rule (those paid add on features)

3-hour non-member minimum (for standard rides not founder 30 or membership rides)

Member shorter window allowance

Enforce rules in UI AND backend

Members = no minimums
End of Phase 2 Result:
Guests never see bookings Aleet cannot fulfill.
Drivers are categorized correctly.
Booking rules are enforced automatically.

✅ WEEK 3 — PAYMENTS, MEMBERSHIP & FINANCIAL LOGIC
(Revenue engine + accounting integrity)
Release: $900
Covers Sections: 6) Checkout, Payments & Pricing Logic
Replace redirect Stripe with Stripe Elements (embedded)

Enable saved cards

Tap-to-book functionality

Adjustable $20 service fee per trips

Remove hard-coded add-ons, keep adjustable

This should use an easy checkout and should feel like ordering doordash. Just a one click to book process without thinking or inputting cards every time.
This fixes conversion friction.

7. Membership & Subscription Logic
   Rename Subscription → Free Membership

5 hrs/month billed quarterly

$89/hr locked

Late-night exclusion logic (12am-9am reverts back to standard prices set)

Clear savings display

8. Hour Deduction & Late-Night Pricing for memberships
   Deduct prepaid hours automatically

Track balances

Charge overages correctly

Apply 12am–9am pricing override

Ensure payout math aligns

End of Phase 3 Result:
Money flows correctly.
Hours are deducted correctly.
Drivers get paid correctly.
Tap-to-book works.
This is the most financially sensitive phase.

✅ WEEK 4 — GUEST EXPERIENCE & LAUNCH POLISH
(Customer-facing stability + support)
Release: $600
Covers Sections: 9) Locations, Maps & Free Routing
Google Places autocomplete

DC/MD/VA shown at the moment.

Admin region control to add or remove locations.

Map open via tap (drivers should be able to click locations in trip details to head to gps)

Free routing toggle

Prevents location chaos.

10. Guest Profiles & Trip Details
    Trip receipts

Saved cards visible

Driver info display

Clear cancellation logic

Completes guest dashboard.

12. Support Communication & QRs
    Connect Track desk, Refersion, Partnerstack etc. for affiliates to receive pay per ride

Live chat or AI

Phone visible only to:

Logged-in users

Active trips

Driver portals

Private investor page (no-index) A private portal page that displays uploaded financial documents & company goals, with a simple contact form for investors & partners accessible by direct link only, Aleet admin portal can upload docs for them to view showing cashflow Statements and information and on side investors, partners etc can fill out a easy form like shown to submit what they can offer and we can reach back via email/phone after received . www.aleet.app/teams
Footer link: Corporate & Investor Relations or Investor Relation & Governance (subtle)

Make discount code work for any guest account to use once to get rides for $89 an hour only once for first time trips on Aleet
Launch-level polish.

END OF WEEK 4 — ACCEPTANCE CHECK
MVP is considered complete when:
Drivers can onboard correctly

Guests can book and pay fully in-site

Membership hours deduct properly

Same-day availability is truthful

AWS runs lean with no unnecessary spend

General info on Aleet & how platform works
Driver Pay Structure (Aleet)

1. Percentage Split
   Driver payout is based on driver tier, not the trip type.
   Pro Drivers: 40% of the hourly trip rate

Diamond Drivers: 40% of the hourly trip rate

S-Level Drivers: 30% of the hourly trip rate

The trip type (Founder 30, Membership, or Regular booking) only determines the hourly price the percentage is applied to.

2. Booking Fee Handling
   The booking fee (ex: ~$34) depends on the driver tier.
   Pro & Diamond: driver keeps the booking fee

S-Level: company keeps the booking fee

3. Why S-Level Doesn’t Receive the Booking Fee
   S-Level drivers operate company-provided vehicles, so Aleet covers the main vehicle expenses.
   Keeping the booking fee helps offset fuel, maintenance, cleaning, and vehicle depreciation.

4. Why Pro & Diamond Keep the Booking Fee
   Pro and Diamond drivers use their own vehicles, so they receive the booking fee to support their operating costs.
   Even when a short trip uses little fuel, the booking fee from each ride accumulates over time, helping drivers cover gas, car washes, and maintenance across multiple trips.

Aleet: System Logic🧠
Notes on General information: (Internal Reference)
Purpose
This document explains how Aleet operates as a system, not just individual features.
It defines driver structure, booking access, pricing, payouts, and membership mechanics so the platform functions correctly, predictably, and profitably.
This is not UI guidance.
This is business logic that must be enforced in backend and admin controls.

1. Core Operating Model (High Level)
   Aleet is a pre-booked, curated private driver platform.
   Guests book trips in advance or same-day (when availability allows)

Drivers are assigned based on tier, eligibility, and availability

Pricing is fixed and transparent

Memberships are prepaid hours, not discounts or subscriptions

Driver payouts are calculated per completed trip, not at signup

2. Driver Structure & Tiers
   (Structural — Not Performance-Based)
   Driver tier is a static attribute that controls:
   Eligibility

Booking access

Priority

Pay logic
It is not determined by ratings.

Driver Tiers
S-Tier

No personal vehicle

Uses company vehicle only

Pro

Owns approved personal vehicle

Diamond

Owns vehicle

Holds valid for-hire license

3. Ratings (Stars)
   (Performance Only)
   Ratings:
   Do not change driver tier

Affect:

Visibility

Volume of trips

Retention
Ratings never override eligibility rules.

4. Booking Access by Tier
   Same-Day Trips
   Priority order:

Diamond

Select Pro (if enabled)

Advance Bookings
Priority order:

S-Tier

Pro / Diamond

Admin-Created Trips
Bypass availability logic entirely

Can be assigned to any tier manually

5. Pay Structure (Admin-Adjustable)
   Booking Fee — $34 (Adjustable)
   S-Tier: platform keeps fee

Pro / Diamond: driver keeps fee

Hourly Pay Splits
Membership — $89/hr
Pro / Diamond: 40%

S-Tier: not eligible
Founder 30 — $69/hr (Private)
Pro / Diamond: 40%

S-Tier: not eligible
Standard — $120–$220/hr (3-hour minimum)
S-Tier: 30% (no booking fee)

Pro / Diamond: 40% + $34 booking fee

Vehicle Cost Handling (S-Tier Only)
−$50 per trip charged to S-Tier driver

Company absorbs additional −$100 vehicle cost

Total vehicle expense managed internally

6. Upgrade Incentives
   Pro → Diamond via:

For-hire license

Approved vehicle leasing

Diamond unlocks:

Highest pay

Same-day priority

Maximum volume access

7. Membership Model (Critical)
   What Membership Is
   Membership = prepaid driving hours

Not a discount

Not a subscription perk

Hours are consumed as rides occur

Membership Terms
5 hours per month

Billed quarterly

$89/hr locked pricing

Card saved on file

Overages charged automatically at $89/hr

Late-Night Exception
⛔️Hours between 12am–9am revert to standard pricing

Not eligible for membership rate

Perks: no minimum time with bookings & $89 a hour for any vehicle type in one tap.

8. Membership Prepaid Hours & Driver Payout Reserve
   Financial Logic
   Because membership rides are fulfilled only by Pro & Diamond, Aleet reserves driver payout funds in advance.
   Example (Quarterly)
   5 hrs × 3 months = 15 hours

15 hrs × $89/hr = $1,335 prepaid

Driver payout reserve (40%) = $534

Company portion (60%) = $801

Why This Matters
Guarantees driver payment

Prevents cash-flow mismatches

Keeps accounting clean and predictable

Driver payouts are released only when trips are completed, but funds are already reserved.

9. Founder 30 Membership (Private)
   Same mechanics as standard membership

Rate: $69/hr

Private / invite-only

Not publicly visible

Same prepaid hour logic

Same payout rules
Perks: no minimum time with bookings & $89 a hour for any vehicle type in one tap.

Aleet — Guest Pricing:
Membership: $89/hr

Founder 30: $69/hr

Standard (non-member): $120–$220/hr

Aleet — Driver Pay Structure (Admin adjustable)
Core payout rules
Pro & Diamond: 40% of hourly rate

S-Tier: 30% of hourly rate

$34 booking fee (admin adjustable)

Pro & Diamond: keep it

S-Tier: platform keeps it

Vehicle cost (S-Tier only):

−$50 charged to driver (admin charges)

Company absorbs an additional −$100 (internally)

Aleet — Average Driver Pay
S-Tier (company vehicle)
Average: $27–$32/hour
Pro (own vehicle)
Average: $42–$48/hour
Diamond (own vehicle + for-hire license)
Average: $50–$60/hour

Sign up process:
Public Process:
Drivers sign up on Aleet and indicate whether they own a vehicle or not, which helps determine their initial tier. (S-level, Pro, Diamond)

They also specify whether they have a for-hire license. If they do not have one, they provide their SSN and consent. (Diamond Requirement)

Internal Process:
Aleet uses the authorized information and consent to arrange for the for-hire license on the driver’s behalf.

Aleet pays the licensing cost upfront, for example, $200, to the licensing authority or third party.

Over time, Aleet deducts this cost from the driver’s earnings as they complete trips on the platform.

Once the driver receives their for-hire license, it is uploaded to their profile, and they are also sent a copy by mail.
This ensures that drivers can move up in tiers as they become fully licensed, and the process is smooth and financially manageable for them.
