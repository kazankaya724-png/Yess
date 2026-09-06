import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get("EXPO_BACKEND_URL")
if not BASE_URL:
    # Try to read from frontend/.env
    try:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("EXPO_PUBLIC_BACKEND_URL"):
                    BASE_URL = line.split("=", 1)[1].strip().strip('"')
                    break
    except Exception:
        pass
BASE_URL = (BASE_URL or "").rstrip("/")
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL must be set"


@pytest.fixture(scope="session")
def base_url():
    return BASE_URL


@pytest.fixture(scope="session")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _login(api, email, password):
    r = api.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password, "captcha_token": "v_test_123"})
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="session")
def customer_token(api):
    return _login(api, "jane@spike.app", "Demo@123")


@pytest.fixture(scope="session")
def handyman_token(api):
    return _login(api, "mike@spike.app", "Demo@123")


@pytest.fixture(scope="session")
def handyman2_token(api):
    return _login(api, "sarah@spike.app", "Demo@123")


@pytest.fixture(scope="session")
def admin_token(api):
    return _login(api, "admin@spike.app", "Admin@123")


def auth_headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
