# SPIKE — Product Requirements Document (MVP)

**Tagline:** Post it. Claim it. Get it done.

SPIKE is a local on-demand services marketplace (Airtasker × Wayfair Service Pro × Uber-style matching) connecting Customers who need work done with Verified Handymen who claim and complete jobs. Platform charges a 10% commission on completed jobs; registration is free for both sides.

## Roles
- **Customer**: posts jobs, tracks status, approves completion, rates, opens disputes.
- **Handyman**: verified providers who browse nearby jobs, claim, check-in via GPS, upload before/after photos, and get paid.
- **Admin**: seeded at `admin@spike.app / Admin@123` — reviews users, disputes, jobs, and platform stats.

## Core rules implemented (server-enforced)
- **Job state machine**: DRAFT → POSTED → MATCHING_30MI/60MI → CLAIMED → BOOKED → HANDYMAN_ON_WAY → ARRIVED → IN_PROGRESS → COMPLETED → CUSTOMER_APPROVED → PAYMENT_RELEASED. Every transition validated server-side and audited in `job_events`.
- **Atomic claim**: `find_one_and_update` prevents concurrent double-claim; only VERIFIED, non-suspended handymen in eligible categories can claim.
- **30 → 60 mile matching**: MongoDB 2dsphere `$near` query; config `INITIAL_RADIUS_MILES=30`, `EXPANDED_RADIUS_MILES=60`.
- **24-hour address protection**: `exact_address` and precise coordinates are stripped from every response until `now >= scheduled_start - ADDRESS_RELEASE_HOURS` (24h). Emergency jobs release immediately. Server-side, uses UTC.
- **Address masking**: handymen see only `zip_area` (e.g. `921**`), approximate coords, and `distance_miles`.
- **10% commission**: on `CUSTOMER_APPROVED`, `PaymentService.capture_and_release` splits into commission + payout records.
- **Before/after evidence**: high-risk categories require before-photos to `start` and after-photos to `complete`.
- **Additional work**: handyman requests, customer must approve before price increases.
- **Two-way ratings**: only after `CUSTOMER_APPROVED`/`PAYMENT_RELEASED`; duplicate ratings blocked.
- **Off-platform detection**: chat scans for cash/venmo/paypal/etc.; flags message and logs to `user_flags`.
- **Anti-bot**: login requires a captcha_token (client math challenge, length ≥ 6).
- **High-risk categories**: plumbing/electrical/hvac require `license_verified = true` on handyman before claim.
- **Provider abstractions (MOCKED)**: `IdentityVerificationService`, `PaymentService`, `PushNotificationService`, `MapProvider` all sit behind env-swappable interfaces.

## Frontend structure
- `(auth)/login` — email/password + Google OAuth + captcha
- `(auth)/register` — role toggle (customer/handyman), free registration
- `(customer)/{home,jobs,messages,payments,profile}` — bottom tab nav
- `(customer)/post-job` — 3-step wizard: details → schedule/address → review
- `(handyman)/{available,my-jobs,messages,earnings,profile}` — bottom tab nav
- `job/[id]` — shared timeline + chat with role-aware actions
- `admin` — stats, user suspension, job overview

## Design
- iOS-Native Clean personality; Deep Moss Green (`#2A4D3B`) brand; bone-white surfaces; stone greys. No blues or purples.
- Trust badges (ID VERIFIED, LICENSE VERIFIED, INSURANCE VERIFIED).
- Every screen respects safe-area insets; sticky FAB on customer home.

## Backend
- FastAPI + Motor (MongoDB, 2dsphere indexes on `jobs.approx_location` and `users.location`).
- JWT (7-day) for email/password; Emergent Google `session_token` also honored.
- CORS wide-open; all endpoints prefixed `/api`.

## Known MVP simplifications (documented, not hidden)
- Identity verification is a mock (`MOCK` provider) — auto-approves on `/verification/complete`. Swap by env var.
- Payments are mocked (no Stripe Connect yet) — the escrow, commission split, and payout records are real.
- Push notifications are stored to Mongo (`notifications` collection) instead of Firebase/APNs — real Firebase push added on deploy.
- Maps geocoding uses a small deterministic stub (`MapProvider.geocode_zip`).

## Configuration (env-tunable)
```
INITIAL_RADIUS_MILES=30
EXPANDED_RADIUS_MILES=60
MATCHING_TIMEOUT_SECONDS=900
ADDRESS_RELEASE_HOURS=24
ARRIVAL_RADIUS_FEET=300
PLATFORM_COMMISSION_PERCENT=10
DISPUTE_WINDOW_HOURS=48
IDENTITY_PROVIDER=MOCK    # swap for PERSONA/STRIPE_IDENTITY/VERIFF
PAYMENT_PROVIDER=MOCK     # swap for STRIPE_CONNECT
PUSH_PROVIDER=MOCK        # swap for FIREBASE
MAP_PROVIDER=MOCK         # swap for GOOGLE_MAPS/MAPBOX
```
