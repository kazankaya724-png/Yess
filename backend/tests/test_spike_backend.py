"""SPIKE backend end-to-end tests covering auth, jobs lifecycle, admin, disputes, and privacy."""
import time
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import requests

from conftest import BASE_URL, auth_headers


# ------------------------------------------------------------------
# Health / Config
# ------------------------------------------------------------------
class TestConfig:
    def test_config(self, api):
        r = api.get(f"{BASE_URL}/api/config")
        assert r.status_code == 200
        data = r.json()
        assert "categories" in data and len(data["categories"]) >= 5
        assert data.get("commission_percent") == 10
        assert data.get("address_release_hours") == 24
        # radii
        assert "initial_radius_miles" in data or "radii" in data or "expanded_radius_miles" in data


# ------------------------------------------------------------------
# Auth
# ------------------------------------------------------------------
class TestAuth:
    def test_login_success(self, api):
        r = api.post(f"{BASE_URL}/api/auth/login",
                     json={"email": "jane@spike.app", "password": "Demo@123", "captcha_token": "v_test_123"})
        assert r.status_code == 200
        data = r.json()
        assert "token" in data and "user" in data
        assert data["user"]["email"] == "jane@spike.app"

    def test_login_missing_captcha(self, api):
        r = api.post(f"{BASE_URL}/api/auth/login",
                     json={"email": "jane@spike.app", "password": "Demo@123", "captcha_token": ""})
        assert r.status_code == 400

    def test_login_short_captcha(self, api):
        r = api.post(f"{BASE_URL}/api/auth/login",
                     json={"email": "jane@spike.app", "password": "Demo@123", "captcha_token": "abc"})
        assert r.status_code == 400

    def test_register_new_user(self, api):
        email = f"TEST_{uuid.uuid4().hex[:8]}@spike.app"
        r = api.post(f"{BASE_URL}/api/auth/register", json={
            "email": email, "phone": "+15551234567", "password": "Test@1234",
            "role": "customer", "accept_terms": True, "zip_code": "92105",
            "legal_name": "Test User"
        })
        assert r.status_code == 200, r.text
        assert "token" in r.json()
        assert r.json()["user"]["email"] == email

    def test_me(self, api, customer_token):
        r = api.get(f"{BASE_URL}/api/auth/me", headers=auth_headers(customer_token))
        assert r.status_code == 200
        assert r.json()["user"]["email"] == "jane@spike.app"

    def test_unauthenticated_jobs(self, api):
        r = api.get(f"{BASE_URL}/api/jobs")
        assert r.status_code == 401


# ------------------------------------------------------------------
# Job creation, listing, privacy
# ------------------------------------------------------------------
@pytest.fixture(scope="module")
def created_job(api, customer_token):
    """Create a tv_mounting job scheduled 30 days out — evidence required, address protected."""
    date_str = (datetime.now(timezone.utc) + timedelta(days=30)).date().isoformat()
    payload = {
        "title": "TEST Mount 65in TV",
        "category": "tv_mounting",
        "description": "Please mount TV on drywall with anchors.",
        "photos": [],
        "price": 150.0,
        "date": date_str,
        "start_time": "10:00",
        "end_time": "12:00",
        "zip_code": "92105",
        "exact_address": "123 Test St, San Diego, CA 92105",
        "urgency": "standard",
        "special_instructions": "",
        "required_skills": [],
    }
    r = api.post(f"{BASE_URL}/api/jobs", json=payload, headers=auth_headers(customer_token))
    assert r.status_code == 200, r.text
    j = r.json()["job"]
    assert j["status"] == "POSTED"
    assert j["exact_address"] == payload["exact_address"], "owner must see exact_address"
    return j


class TestJobsCreate:
    def test_create_returns_exact_address_to_owner(self, created_job):
        assert created_job["exact_address"].startswith("123 Test St")

    def test_customer_cannot_claim(self, api, customer_token, created_job):
        r = api.post(f"{BASE_URL}/api/jobs/{created_job['job_id']}/claim",
                     headers=auth_headers(customer_token))
        assert r.status_code == 403

    def test_available_jobs_hides_address(self, api, handyman_token, created_job):
        r = api.get(f"{BASE_URL}/api/jobs/available", headers=auth_headers(handyman_token))
        assert r.status_code == 200
        jobs = r.json()["jobs"]
        found = next((j for j in jobs if j["job_id"] == created_job["job_id"]), None)
        assert found is not None, "handyman should see job in available list"
        assert "exact_address" not in found, "exact_address must NOT be exposed to handyman before release"
        assert "distance_miles" in found
        assert found.get("zip_area", "").endswith("**")
        assert found.get("address_released") in (False, None) or found["address_released"] is False


# ------------------------------------------------------------------
# Claim → Book → Full lifecycle (evidence enforced)
# ------------------------------------------------------------------
class TestJobLifecycle:
    def test_claim_book_lifecycle(self, api, customer_token, handyman_token, handyman2_token, created_job):
        jid = created_job["job_id"]

        # Handyman claims
        r = api.post(f"{BASE_URL}/api/jobs/{jid}/claim", headers=auth_headers(handyman_token))
        assert r.status_code == 200, r.text
        assert r.json()["job"]["status"] == "CLAIMED"

        # Second handyman: 409 atomic
        r2 = api.post(f"{BASE_URL}/api/jobs/{jid}/claim", headers=auth_headers(handyman2_token))
        assert r2.status_code == 409

        # Customer books
        r = api.post(f"{BASE_URL}/api/jobs/{jid}/book", headers=auth_headers(customer_token))
        assert r.status_code == 200, r.text
        assert r.json()["job"]["status"] == "BOOKED"
        # Payment record was created
        pm = api.get(f"{BASE_URL}/api/payments/mine", headers=auth_headers(customer_token))
        assert pm.status_code == 200

        # On-way
        r = api.post(f"{BASE_URL}/api/jobs/{jid}/on-way", headers=auth_headers(handyman_token))
        assert r.status_code == 200

        # Arrive — address_release_at is 30d-24h future, so should be blocked (403)
        arr_payload = {"lat": 32.7157, "lng": -117.1611}
        r = api.post(f"{BASE_URL}/api/jobs/{jid}/arrive", json=arr_payload,
                     headers=auth_headers(handyman_token))
        # Because scheduled 30 days out, address hasn't released yet → expect 403
        assert r.status_code == 403, f"expected 403 (address not released), got {r.status_code}"

    def test_evidence_required(self, api, customer_token, handyman_token):
        """Test start rejected without before-photos and complete rejected without after-photos."""
        # Create an emergency tv_mounting job so address is released immediately
        payload = {
            "title": "TEST Emergency TV Mount",
            "category": "tv_mounting",
            "description": "Urgent",
            "photos": [], "price": 200.0,
            "date": datetime.now(timezone.utc).date().isoformat(),
            "start_time": "14:00", "end_time": "16:00",
            "zip_code": "92105",
            "exact_address": "456 Emergency Rd, San Diego, CA 92105",
            "urgency": "emergency",
            "special_instructions": "", "required_skills": [],
        }
        r = api.post(f"{BASE_URL}/api/jobs", json=payload, headers=auth_headers(customer_token))
        assert r.status_code == 200, r.text
        jid = r.json()["job"]["job_id"]

        # Claim & book
        assert api.post(f"{BASE_URL}/api/jobs/{jid}/claim", headers=auth_headers(handyman_token)).status_code == 200
        assert api.post(f"{BASE_URL}/api/jobs/{jid}/book", headers=auth_headers(customer_token)).status_code == 200
        assert api.post(f"{BASE_URL}/api/jobs/{jid}/on-way", headers=auth_headers(handyman_token)).status_code == 200

        # Verify handyman sees exact_address for emergency job (privacy check)
        gj = api.get(f"{BASE_URL}/api/jobs/{jid}", headers=auth_headers(handyman_token))
        assert gj.status_code == 200
        assert gj.json()["job"].get("exact_address", "").startswith("456 Emergency Rd"), \
            "emergency urgency should release address to booked handyman immediately"
        assert gj.json()["job"].get("address_released") is True

        # Arrive
        r = api.post(f"{BASE_URL}/api/jobs/{jid}/arrive",
                     json={"lat": 32.7157, "lng": -117.1611},
                     headers=auth_headers(handyman_token))
        assert r.status_code == 200, r.text

        # Start without before-photos → 400
        r = api.post(f"{BASE_URL}/api/jobs/{jid}/start", headers=auth_headers(handyman_token))
        assert r.status_code == 400, "start should require before-photos"

        # Upload before-photos
        r = api.post(f"{BASE_URL}/api/jobs/{jid}/photos",
                     json={"kind": "before", "photos": ["data:image/png;base64,AAAA"]},
                     headers=auth_headers(handyman_token))
        assert r.status_code == 200

        # Start OK
        r = api.post(f"{BASE_URL}/api/jobs/{jid}/start", headers=auth_headers(handyman_token))
        assert r.status_code == 200

        # Complete without after-photos → 400
        r = api.post(f"{BASE_URL}/api/jobs/{jid}/complete", headers=auth_headers(handyman_token))
        assert r.status_code == 400

        # Upload after-photos & complete
        api.post(f"{BASE_URL}/api/jobs/{jid}/photos",
                 json={"kind": "after", "photos": ["data:image/png;base64,BBBB"]},
                 headers=auth_headers(handyman_token))
        r = api.post(f"{BASE_URL}/api/jobs/{jid}/complete", headers=auth_headers(handyman_token))
        assert r.status_code == 200

        # Approve → PAYMENT_RELEASED, 10% commission
        r = api.post(f"{BASE_URL}/api/jobs/{jid}/approve", headers=auth_headers(customer_token))
        assert r.status_code == 200

        gj = api.get(f"{BASE_URL}/api/jobs/{jid}", headers=auth_headers(customer_token))
        assert gj.status_code == 200
        assert gj.json()["job"]["status"] == "PAYMENT_RELEASED"

        # Review after approval works
        rv = api.post(f"{BASE_URL}/api/jobs/{jid}/reviews",
                      json={"rating": 5, "categories": {"quality": 5}, "comment": "Great!"},
                      headers=auth_headers(customer_token))
        assert rv.status_code == 200, rv.text

        # Duplicate review → 400
        rv2 = api.post(f"{BASE_URL}/api/jobs/{jid}/reviews",
                       json={"rating": 4, "categories": {"quality": 4}, "comment": "again"},
                       headers=auth_headers(customer_token))
        assert rv2.status_code == 400

        # Return jid for downstream tests
        return jid


# ------------------------------------------------------------------
# Review before completion → 400
# ------------------------------------------------------------------
class TestReviewsGuard:
    def test_review_before_completion_400(self, api, customer_token, created_job):
        r = api.post(f"{BASE_URL}/api/jobs/{created_job['job_id']}/reviews",
                     json={"rating": 5, "categories": {}, "comment": "x"},
                     headers=auth_headers(customer_token))
        assert r.status_code == 400


# ------------------------------------------------------------------
# Off-platform message flag
# ------------------------------------------------------------------
class TestMessages:
    def test_chat_locked_until_release(self, api, customer_token, created_job):
        """Iteration 2: chat is blocked before T-24h (job is 30 days out)."""
        jid = created_job["job_id"]
        # After lifecycle test the job is CLAIMED+BOOKED but 30 days out — chat locked
        r = api.post(f"{BASE_URL}/api/jobs/{jid}/messages",
                     json={"body": "hello there"},
                     headers=auth_headers(customer_token))
        assert r.status_code == 400, r.text
        # Either not-yet-claimed or 24h-not-yet-reached — both are valid locked states
        assert ("24" in r.text) or ("before work time" in r.text.lower()) or ("claim" in r.text.lower())


# ------------------------------------------------------------------
# Dispute
# ------------------------------------------------------------------
class TestDispute:
    def test_open_dispute(self, api, customer_token, handyman_token):
        # Fresh job
        payload = {
            "title": "TEST Dispute Case", "category": "cleaning",
            "description": "test", "photos": [], "price": 80.0,
            "date": (datetime.now(timezone.utc) + timedelta(days=2)).date().isoformat(),
            "start_time": "09:00", "end_time": "11:00",
            "zip_code": "92037",
            "exact_address": "1 Beach Rd, La Jolla, CA 92037",
            "urgency": "standard", "special_instructions": "", "required_skills": [],
        }
        r = api.post(f"{BASE_URL}/api/jobs", json=payload, headers=auth_headers(customer_token))
        assert r.status_code == 200
        jid = r.json()["job"]["job_id"]

        # Open dispute as customer
        d = api.post(f"{BASE_URL}/api/jobs/{jid}/dispute",
                     json={"category": "no_show", "description": "Never came", "evidence": []},
                     headers=auth_headers(customer_token))
        assert d.status_code == 200
        assert d.json()["dispute"]["status"] == "OPEN"

        # Verify job status
        gj = api.get(f"{BASE_URL}/api/jobs/{jid}", headers=auth_headers(customer_token))
        assert gj.json()["job"]["status"] == "DISPUTED"


# ------------------------------------------------------------------
# Admin
# ------------------------------------------------------------------
class TestAdmin:
    def test_admin_stats(self, api, admin_token):
        r = api.get(f"{BASE_URL}/api/admin/stats", headers=auth_headers(admin_token))
        assert r.status_code == 200
        data = r.json()
        for k in ("users", "jobs", "revenue"):
            assert k in data

    def test_admin_suspend(self, api, admin_token):
        # Create a throwaway user then suspend
        email = f"TEST_susp_{uuid.uuid4().hex[:6]}@spike.app"
        rr = requests.post(f"{BASE_URL}/api/auth/register", json={
            "email": email, "phone": "+15550000000", "password": "Test@1234",
            "role": "customer", "accept_terms": True, "zip_code": "92105"
        })
        assert rr.status_code == 200
        uid = rr.json()["user"]["user_id"]

        s = api.post(f"{BASE_URL}/api/admin/users/{uid}/suspend",
                     json={"suspended": True},
                     headers=auth_headers(admin_token))
        assert s.status_code == 200

        # Login should now be forbidden
        li = requests.post(f"{BASE_URL}/api/auth/login",
                           json={"email": email, "password": "Test@1234", "captcha_token": "v_test_123"})
        assert li.status_code == 403
