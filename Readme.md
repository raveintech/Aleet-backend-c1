Sprint 1: Guest Booking & Account Creation (Day 1)

Booking Start (Guest):

Region Selection: Implement the logic where guests must select a state/booking region. If not selected, lock the booking flow.

Phone Login: OTP or password login. On first-time login, automatically create an account in the background.

Booking Wizard:

Dates & Time: Validate single or multi-day selection. Default date = 7 days ahead. Ensure a minimum of 3 hours booking required.

Vehicle & Qty: Select vehicle type and quantity (1–5). Option for "Add Ride."

Stops/Timing/Add-ons: Allow users to input pickup → stops → drop-off; integrate "Free Routing" button to bypass route planning. Implement buffer for realistic time checks.

Route Validation: Ensure drive-time + 15 min buffer; trigger error for unrealistic timings, suggest fixes.

Manual Override: Admin only to allow override and internal flag for dispatch review.

Price Quote Logic:

Implement dynamic pricing based on regular vs. subscription models, including distance and add-ons (e.g., >20 miles = $2/mi).

Auto-Compare Box: Display regular total vs. subscription total with net savings for the guest.

Checkout Flow:

Implement card first → terms popup (scroll-to-accept) → checkbox → confirm & pay.

Upgrade & Save: Add "Upgrade & Save" option to apply membership discount at checkout.

Sprint 2: Subscription Comparison & Pricing (Day 2)

Subscription vs. Regular Pricing at Checkout:

Before checkout confirmation, display the pricing comparison between regular and subscription models based on selected trip details.

Include subscription fee and total savings, with an option for "Upgrade & Save with Subscription" leading to subscription page or activating the upgrade in checkout.

Logic:

Calculate total price using both regular and subscription pricing.

Add $449 quarterly membership fee if the guest selects subscription.

Store user status as “Subscriber” upon checkout (Stripe integration for billing).

Payment Integration:

Payment Gateway (Stripe): Implement Stripe for handling payments and adding subscription fees to the cart.

Ensure auto-add of membership to cart when subscription upgrade is selected.

Sprint 3: Booking Confirmation & Customer Portal (Day 3)

Booking Confirmation:

Instant Confirmation: Show booking summary on screen + send SMS/Email with booking ID.

Customer Portal:

Track upcoming/past trips, invoices, rebooking options via profile.

Show subscription status: active plan, hours remaining, upgrade options, etc.

Trip History: Show past bookings (vehicle, route, addons) and allow rebooking with minor edits (dates, vehicle count, stops).

Option to “Rebook This Ride” or “Edit & Rebook.”

Payment and Billing:

Implement the ability for guests to view and download invoices, update payment methods, and track pending charges or overages.

Auto Account Creation Flow:

Auto-create accounts when a guest enters their details (phone/email).

Send login credentials (temporary password or link) after payment.

Saved Information:

Store saved pickup/drop-off addresses, preferences, and customer notes (e.g., “Always prefers cold water”).

Notifications Center: Track trip confirmations, driver assignments, subscription renewals, etc.

Sprint 4: Dispatch & Driver Assignment (Day 4)

Auto Dispatch Logic:

Implement priority-based dispatch system (Diamond → Pro → S tier). Drivers get 2–3 min offer window.

First-Accept Wins: First driver to accept the trip is assigned; others get “No longer available” notification.

Standby Drivers: Notify 2–3 standby drivers if the primary cancels.

Manual Dispatch Fallback:

Admin manual assignment if no driver accepts the trip.

Driver Model:

Store driver details: name, vehicle, tier, availability, performance stats.

Track assignments and status (accepted, standby, cancelled).

Sprint 5: Pre-Trip & Trip Execution (Day 5)

Pre-Trip Details:

Driver: Full itinerary, add-ons, dress-code reminders, and pickup ETA.

Guest: Assigned driver details, vehicle info, contact info, countdown reminders.

Send trip confirmation with full details.

Edits Window:

Allow guests to make minor stop/time edits until policy cutoff (e.g., 2 hours before pickup).

Admin Approval: For changes after policy cutoff.

Trip Execution:

Driver's Responsibilities: Follow itinerary with validated buffers, adhere to attire and etiquette.

Guest Add-Ons: Ensure delivery of free comforts and VIP services.

Sprint 6: Close-Out & Billing (Day 6)

Trip Billing:

Finalizing Hours: Calculate trip duration per vehicle, including multi-vehicle rides.

Pricing: Apply regular or discounted rates based on user subscription status.

Invoice Generation: Send breakdown of total cost via email/SMS and make it available in the customer portal.

Additional Fees:

Apply distance fees and VIP add-ons to the final bill.

Damage/Violation Fees: Handle smoking/pet violations, etc. Automatically charge card on file.

Cancellations:

Implement cancellation policy: full refund within 24 hours, non-refundable after that.

Sprint 7: Special Pricing & Subscription Lifecycle (Day 7)

Late-Night Pricing & Multi-Day Logic:

Implement special pricing rules for late-night window (11 PM–9 AM). Subscription discount doesn’t apply here.

Standby Rate for Subscribers: Implement reduced standby rates for multi-day subscribers who request on-call service overnight.

Subscription Lifecycle Management:

Plan Pricing: Implement $449/month subscription (billed quarterly). Calculate hours included (5 hours/month vs 5 hours/booking).

Renewals & Overages: Implement auto-renewal with Stripe and allow users to track used hours and next billing date.

Revenue Split & Payouts:

Implement revenue split logic:

Regular Booking: Driver gets 30% of the base fare, company gets 70%.

Subscription Booking: Driver gets 40% of the base fare, company gets 60%.

Driver Payouts: Track weekly payouts, tips, and license deductions.

Edge Case & Safeguard Handling:

No Driver Found: Notify guest and admin, offer rebooking or manual assignment.

Overlapping Stops: Prevent overlapping stops and allow admin override.

Chargebacks: Implement payment finality clause and account suspension on multiple chargebacks.

Admin & Driver Portal APIs Overview

Admin Portal APIs:

Bookings API: Manage, assign, and override bookings.

Driver Management API: Manage drivers (approve, deactivate, assign tiers).

Payment & Billing API: Handle revenue splits, payouts, and invoice management.

Reports API: Track revenue, bookings, driver performance, and other key metrics.

User Management API: Manage guest and driver profiles, including subscription and trip history.

Driver Portal APIs:

Trip Management API: View and manage assigned trips, earnings, and schedule.

Profile Management API: Update personal info, availability, and performance stats.

Payouts API: Track weekly earnings, tips, deductions, and payouts.

Document Verification API: Verify and update driver documents and licenses.