# SPIKE — Product Requirements Document (MVP)

**Tagline:** Post it. Claim it. Get it done.

SPIKE is a local on-demand services marketplace (Airtasker × Wayfair Service Pro × Uber-style matching) connecting Customers who need work done with Verified Handymen who claim and complete jobs. Platform charges a 10% commission on completed jobs; registration is free for both sides.

## Roles
- **Customer**: posts jobs, tracks status, approves completion, rates, opens disputes.
- **Handyman**: verified providers who browse nearby jobs, claim, check-in via GPS, upload before/after photos, and get paid direct via Stripe Connect.
- **Admin**: seeded at `admin@spike.app / Admin@123` — reviews users, disputes, jobs, platform stats, and the *only* role that sees commission numbers.

## Core rules implemented (server-enforced)
- **Job state machine** with strict server-side transitions and full audit trail (`job_events`).
- **Atomic claim** via `find_one_and_update` — only one handyman wins.
- **30 → 60 mile matching** via MongoDB 2dsphere `$near`.
- **24-hour address protection**: `exact_address` stripped from responses until `now >= scheduled_start - ADDRESS_RELEASE_HOURS`. Emergency jobs release immediately.
- **10% commission** withheld on payout; hidden from customer & handyman (admin-only field).
- **Payment (Stripe Connect)**: destination charges + `application_fee_amount = 10%`, capture-on-approve. Falls back to mocked ledger if Stripe key missing.
- **Photo evidence**: high-risk categories require before-photos before `/start` and after-photos before `/complete`. Photos uploaded via Emergent Object Storage (falls back to inline mongo when proxy unavailable).
- **Chat rules** (locked by default):
  - No messages until a handyman has claimed the job.
  - No messages until the 24-hour address-release window (chat unlocks alongside address). Emergency jobs unlock immediately.
  - Phone numbers, emails, and street addresses are auto-rejected at send time.
  - Off-platform payment keywords (cash/venmo/paypal/…) are flagged and logged.
  - The "Send message" icon only appears on the job page when chat is unlocked.
- **High-risk categories** (plumbing/electrical/hvac) require `license_verified` before claim.
- **Anti-bot**: professional "Press & hold to verify" gesture (1.2s hold with timing entropy) replaces any math/text puzzle. Copy/selection/context-menu disabled on the widget.
- **Two-way ratings**: only after `CUSTOMER_APPROVED`; duplicates blocked.
- **Job visibility**: completed / cancelled / disputed jobs are only visible to their customer, their assigned handyman, or admin.

## Frontend structure
- `(auth)/login`, `(auth)/register`
- `(customer)/{home,jobs,messages,payments,profile,post-job}` — modern bottom tabs with vector icons (home, clipboard-list, chat, credit-card, account).
- `(handyman)/{available,my-jobs,messages,earnings,profile}` — icons (radar, hammer-wrench, chat, cash, account).
- `(handyman)/available` renders an **animated radar** with 15/30/60 mile concentric rings and job pins; toggle between radar and list views.
- Animated **VerifiedBadge** component (pulse ring + shimmer) for ID VERIFIED / TRUSTED PRO / TOP RATED.
- Job detail shows a single **Current Status card** (color-coded, icon + friendly copy) — not a long step list.
- Photo upload row with camera + gallery buttons for job posts and before/after evidence.
- Handyman Profile has a Stripe Connect "Connect payouts" button (opens Stripe Express onboarding in a web browser).

## Backend
- FastAPI + Motor (MongoDB) with 2dsphere indexes on `jobs.approx_location` and `users.location`.
- JWT (7-day) for email/password; Emergent Google `session_token` also honored.
- Provider abstractions (identity, payments, push, maps, object-storage) — real Stripe Connect and real Emergent Object Storage integrated, with graceful mock fallbacks.

## Configuration (env-tunable)
```
INITIAL_RADIUS_MILES=30
EXPANDED_RADIUS_MILES=60
MATCHING_TIMEOUT_SECONDS=900
ADDRESS_RELEASE_HOURS=24
ARRIVAL_RADIUS_FEET=300
PLATFORM_COMMISSION_PERCENT=10
DISPUTE_WINDOW_HOURS=48
STRIPE_API_KEY=sk_test_emergent
EMERGENT_LLM_KEY=…   # unlocks Emergent Object Storage
```
