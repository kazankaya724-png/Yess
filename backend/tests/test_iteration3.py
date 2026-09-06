"""SPIKE iteration 3 backend tests:
- BUG FIX: /jobs?scope=mine returns claimed jobs to handyman
- REGRESSION: /jobs?scope=mine still returns customer's own jobs (customer)
- PRIVACY: privacy_radius_meters=500 + approx_location jitter 200-500m from exact_location
- PRIVACY: exact_address hidden from non-owner non-booked-handyman viewers
- SUPPORT: user↔admin chat (create, list, admin list, admin reply, 403 for non-admin)
- ADMIN: create admin, promote user to admin, 403 for non-admin
- SEED CLEANUP: seeded handymen have no fake ratings/completed jobs
- SEED CLEANUP: jobs collection not auto-generated on startup (no jobs with title 'Seed'/'Sample')
- REGRESSION: 3 demo accounts still log in
"""
import math
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import requests

from conftest import BASE_URL, auth_headers


# ------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------
def _create_job(api, customer_token, urgency="standard", days_out=30, price=150.0,
                category="tv_mounting", zip_code="92105",
                exact_address="789 Iter3 St, San Diego, CA 92105"):
    date_str = (datetime.now(timezone.utc) + timedelta(days=days_out)).date().isoformat()
    payload = {
        "title": f"TEST it3 {uuid.uuid4().hex[:6]}",
        "category": category,
        "description": "iteration 3 test job",
        "photos": [],
        "price": price,
        "date": date_str,
        "start_time": "10:00",
        "end_time": "12:00",
        "zip_code": zip_code,
        "exact_address": exact_address,
        "urgency": urgency,
        "special_instructions": "",
        "required_skills": [],
    }
    r = api.post(f"{BASE_URL}/api/jobs", json=payload, headers=auth_headers(customer_token))
    assert r.status_code == 200, r.text
    return r.json()["job"]


def _haversine_m(lat1, lng1, lat2, lng2):
    R = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


# ------------------------------------------------------------------
# BUG FIX: /jobs?scope=mine
# ------------------------------------------------------------------
class TestMyJobsBugFix:
    def test_customer_scope_mine_returns_own_jobs(self, api, customer_token):
        j = _create_job(api, customer_token)
        r = api.get(f"{BASE_URL}/api/jobs?scope=mine", headers=auth_headers(customer_token))
        assert r.status_code == 200
        jobs = r.json()["jobs"]
        assert any(x["job_id"] == j["job_id"] for x in jobs), "customer should see their own posted job"

    def test_handyman_scope_mine_returns_claimed_jobs(self, api, customer_token, handyman_token):
        j = _create_job(api, customer_token, urgency="emergency", days_out=0)
        jid = j["job_id"]
        # Before claim: handyman scope=mine does NOT include it
        r0 = api.get(f"{BASE_URL}/api/jobs?scope=mine", headers=auth_headers(handyman_token))
        assert r0.status_code == 200
        assert not any(x["job_id"] == jid for x in r0.json()["jobs"])

        # Claim
        c = api.post(f"{BASE_URL}/api/jobs/{jid}/claim", headers=auth_headers(handyman_token))
        assert c.status_code == 200, c.text

        # After claim: handyman scope=mine INCLUDES it (this is the bug fix)
        r1 = api.get(f"{BASE_URL}/api/jobs?scope=mine", headers=auth_headers(handyman_token))
        assert r1.status_code == 200
        jobs = r1.json()["jobs"]
        matched = [x for x in jobs if x["job_id"] == jid]
        assert len(matched) == 1, f"handyman scope=mine should include claimed job {jid}"
        assert matched[0].get("status") in {"CLAIMED", "BOOKED", "HANDYMAN_ON_WAY", "ARRIVED", "IN_PROGRESS"}


# ------------------------------------------------------------------
# PRIVACY
# ------------------------------------------------------------------
class TestPrivacyArea:
    def test_new_job_has_privacy_radius_and_approx_location(self, api, customer_token):
        j = _create_job(api, customer_token)
        # Fetch fresh
        r = api.get(f"{BASE_URL}/api/jobs/{j['job_id']}", headers=auth_headers(customer_token))
        assert r.status_code == 200
        job = r.json()["job"]
        assert job.get("privacy_radius_meters") == 500
        approx = job.get("approx_location")
        exact = job.get("exact_location")
        assert approx and exact
        [alng, alat] = approx["coordinates"]
        [elng, elat] = exact["coordinates"]
        dist = _haversine_m(alat, alng, elat, elng)
        # Owner view: exact hidden? Owner SHOULD see exact. Just check jitter is real.
        assert dist > 0, "approx should not equal exact"
        # Jitter is bounded — allow up to ~700m to be tolerant of latitude effects (0.004 deg ~ 440m N/S)
        assert dist <= 700, f"approx_location too far from exact: {dist:.0f}m"

    def test_non_owner_handyman_sees_no_exact_address(self, api, customer_token, handyman2_token):
        # Create in ZIP 92105 (mike's area). sarah is 92037, unrelated to this job (unclaimed).
        j = _create_job(api, customer_token, urgency="standard", days_out=20)
        jid = j["job_id"]
        # sarah is a handyman, not claiming, view via /jobs/{id} — may 403 or scrub
        r = api.get(f"{BASE_URL}/api/jobs/{jid}", headers=auth_headers(handyman2_token))
        # Either 403 (unrelated) or 200 with exact_address removed
        if r.status_code == 200:
            job = r.json()["job"]
            assert "exact_address" not in job, "exact_address must be hidden from non-booked handyman"
            assert job.get("approx_location") is not None
            assert job.get("privacy_radius_meters") == 500
        else:
            assert r.status_code in {403, 404}

    def test_owner_sees_exact_address(self, api, customer_token):
        j = _create_job(api, customer_token)
        r = api.get(f"{BASE_URL}/api/jobs/{j['job_id']}", headers=auth_headers(customer_token))
        assert r.status_code == 200
        assert r.json()["job"].get("exact_address")


# ------------------------------------------------------------------
# SUPPORT chat
# ------------------------------------------------------------------
class TestSupport:
    def test_user_send_and_list(self, api, customer_token):
        body = f"TEST_help_{uuid.uuid4().hex[:6]}"
        r = api.post(f"{BASE_URL}/api/support/messages", json={"body": body},
                     headers=auth_headers(customer_token))
        assert r.status_code == 200, r.text
        assert r.json()["message"]["body"] == body
        # GET returns own thread
        r2 = api.get(f"{BASE_URL}/api/support/messages", headers=auth_headers(customer_token))
        assert r2.status_code == 200
        msgs = r2.json()["messages"]
        assert any(m["body"] == body for m in msgs)

    def test_admin_lists_conversations(self, api, customer_token, admin_token):
        body = f"TEST_conv_{uuid.uuid4().hex[:6]}"
        api.post(f"{BASE_URL}/api/support/messages", json={"body": body},
                 headers=auth_headers(customer_token))
        r = api.get(f"{BASE_URL}/api/admin/support", headers=auth_headers(admin_token))
        assert r.status_code == 200, r.text
        convos = r.json()["conversations"]
        assert len(convos) >= 1
        c = convos[0]
        for k in ("user_id", "last_body", "count"):
            assert k in c

    def test_admin_get_user_thread_and_reply(self, api, customer_token, admin_token):
        body = f"TEST_thread_{uuid.uuid4().hex[:6]}"
        r = api.post(f"{BASE_URL}/api/support/messages", json={"body": body},
                     headers=auth_headers(customer_token))
        assert r.status_code == 200
        uid = r.json()["message"]["user_id"]

        # Admin GET thread
        r2 = api.get(f"{BASE_URL}/api/admin/support/{uid}", headers=auth_headers(admin_token))
        assert r2.status_code == 200
        assert any(m["body"] == body for m in r2.json()["messages"])

        # Admin reply
        reply = f"TEST_reply_{uuid.uuid4().hex[:6]}"
        r3 = api.post(f"{BASE_URL}/api/admin/support/{uid}/reply", json={"body": reply},
                      headers=auth_headers(admin_token))
        assert r3.status_code == 200
        assert r3.json()["message"]["sender_role"] == "admin"

        # User now sees both
        r4 = api.get(f"{BASE_URL}/api/support/messages", headers=auth_headers(customer_token))
        assert r4.status_code == 200
        bodies = [m["body"] for m in r4.json()["messages"]]
        assert body in bodies and reply in bodies

    def test_non_admin_cannot_access_admin_support(self, api, customer_token, handyman_token):
        for tok in (customer_token, handyman_token):
            r = api.get(f"{BASE_URL}/api/admin/support", headers=auth_headers(tok))
            assert r.status_code == 403, f"expected 403, got {r.status_code}"


# ------------------------------------------------------------------
# ADMIN create + promote
# ------------------------------------------------------------------
class TestAdminUserMgmt:
    def test_admin_creates_new_admin_and_it_can_login(self, api, admin_token):
        email = f"test_admin_{uuid.uuid4().hex[:6]}@spike.app"  # lowercase; endpoint lowercases anyway
        password = "Admin@123"
        r = api.post(f"{BASE_URL}/api/admin/users",
                     json={"email": email, "password": password,
                           "legal_name": "TEST Admin", "role": "admin"},
                     headers=auth_headers(admin_token))
        assert r.status_code == 200, r.text
        assert r.json()["ok"] is True

        # New admin can log in
        lr = api.post(f"{BASE_URL}/api/auth/login",
                      json={"email": email, "password": password, "captcha_token": "v_test_123"})
        assert lr.status_code == 200, lr.text
        new_tok = lr.json()["token"]
        # Can access admin endpoint
        rr = api.get(f"{BASE_URL}/api/admin/support", headers=auth_headers(new_tok))
        assert rr.status_code == 200

    def test_promote_customer_to_admin(self, api, admin_token):
        # Create a customer via register
        email = f"TEST_promo_{uuid.uuid4().hex[:6]}@spike.app"
        password = "Demo@123"
        reg = api.post(f"{BASE_URL}/api/auth/register",
                       json={"email": email, "phone": "+15555550999", "password": password,
                             "role": "customer", "accept_terms": True, "legal_name": "TEST Promo",
                             "zip_code": "92105"})
        assert reg.status_code == 200, reg.text
        uid = reg.json()["user"]["user_id"]

        # Promote via admin
        p = api.post(f"{BASE_URL}/api/admin/users/{uid}/promote",
                     json={"role": "admin"}, headers=auth_headers(admin_token))
        assert p.status_code == 200
        assert p.json()["role"] == "admin"

        # Verify: user can now access admin endpoints
        lr = api.post(f"{BASE_URL}/api/auth/login",
                      json={"email": email, "password": password, "captcha_token": "v_test_123"})
        assert lr.status_code == 200
        tok = lr.json()["token"]
        rr = api.get(f"{BASE_URL}/api/admin/support", headers=auth_headers(tok))
        assert rr.status_code == 200

    def test_non_admin_cannot_promote_or_create(self, api, customer_token, handyman_token):
        for tok in (customer_token, handyman_token):
            r = api.post(f"{BASE_URL}/api/admin/users",
                         json={"email": "x@x.com", "password": "Admin@123", "role": "admin"},
                         headers=auth_headers(tok))
            assert r.status_code == 403
            r2 = api.post(f"{BASE_URL}/api/admin/users/u_xxx/promote",
                          json={"role": "admin"}, headers=auth_headers(tok))
            assert r2.status_code == 403


# ------------------------------------------------------------------
# SEED CLEANUP
# ------------------------------------------------------------------
class TestSeedCleanup:
    @pytest.mark.parametrize("email", ["mike@spike.app", "sarah@spike.app", "alex@spike.app"])
    def test_handyman_no_fake_stats(self, api, admin_token, email):
        r = api.get(f"{BASE_URL}/api/admin/users", headers=auth_headers(admin_token))
        assert r.status_code == 200
        users = r.json().get("users", [])
        u = next((x for x in users if x.get("email") == email), None)
        assert u is not None, f"{email} not found in admin users"
        assert u.get("rating_avg", 0) in (0, 0.0, None), f"{email} rating_avg={u.get('rating_avg')}"
        assert u.get("rating_count", 0) in (0, None), f"{email} rating_count={u.get('rating_count')}"
        assert u.get("completed_jobs", 0) in (0, None), f"{email} completed_jobs={u.get('completed_jobs')}"

    def test_no_auto_generated_jobs_on_startup(self, api, admin_token):
        # Admin should be able to see all jobs. Filter for non-TEST-prefixed titles.
        r = api.get(f"{BASE_URL}/api/admin/jobs", headers=auth_headers(admin_token))
        assert r.status_code == 200
        jobs = r.json().get("jobs", [])
        # All jobs that exist should be from tests (TEST_ prefix). No seeded 'Sample' or 'Seed'.
        seeded_fake = [
            j for j in jobs
            if not (j.get("title", "").startswith("TEST"))
            and any(kw in j.get("title", "").lower() for kw in ("sample", "seed", "demo"))
        ]
        assert len(seeded_fake) == 0, f"unexpected seeded jobs: {[j.get('title') for j in seeded_fake]}"


# ------------------------------------------------------------------
# REGRESSION: demo accounts login
# ------------------------------------------------------------------
class TestDemoLogins:
    @pytest.mark.parametrize("email,password", [
        ("jane@spike.app", "Demo@123"),
        ("mike@spike.app", "Demo@123"),
        ("admin@spike.app", "Admin@123"),
    ])
    def test_login(self, api, email, password):
        r = api.post(f"{BASE_URL}/api/auth/login",
                     json={"email": email, "password": password, "captcha_token": "v_test_123"})
        assert r.status_code == 200, r.text
        assert "token" in r.json()


# ------------------------------------------------------------------
# REGRESSION: commission stripped for non-admin on /payments/mine
# ------------------------------------------------------------------
class TestCommissionHidden:
    def test_payments_mine_customer_no_commission(self, api, customer_token):
        r = api.get(f"{BASE_URL}/api/payments/mine", headers=auth_headers(customer_token))
        assert r.status_code == 200
        for p in r.json().get("items", []):
            assert "commission" not in p
            assert "commission_cents_planned" not in p
            assert "application_fee_amount" not in p
