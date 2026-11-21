"""
Comprehensive security and integration tests for Clerk-protected Flask API.
Tests:
1. Public endpoint GET / (HTTP 200)
2. Missing token on POST /upload (HTTP 401 + WWW-Authenticate: Bearer + SESSION_TOKEN_MISSING)
3. Invalid / forged token on POST /upload (HTTP 401 + WWW-Authenticate: Bearer)
4. Expired token on POST /upload (HTTP 401 + WWW-Authenticate: Bearer)
5. Authenticated token without valid user ID (sub claim) returns HTTP 401 + INVALID_USER_ID
6. Token lacking authorized party (azp) rejected when CLERK_AUTHORIZED_PARTIES is enforced
7. CORS preflight OPTIONS /upload without executing protected endpoint logic
8. CORS preflight from authorized origin http://localhost:5173 (Allowed)
9. CORS preflight from unauthorized origin http://untrusted-site.com (Blocked)
10. Valid Clerk session token on POST /upload with real PDF (HTTP 200)
11. Scanned PDF processing with valid Clerk session token (HTTP 200)
"""

import os
import io
import time
import pytest
from unittest.mock import patch, MagicMock
from flask import Flask
from dotenv import load_dotenv

# Ensure backend directory is in path and env is loaded
backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
load_dotenv(os.path.join(backend_dir, ".env"))

import sys
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from app import app
from clerk_backend_api import Clerk


@pytest.fixture
def client():
    app.config["TESTING"] = True
    with app.test_client() as client:
        yield client


@pytest.fixture
def sample_pdf_content():
    """Reads a real sample PDF from uploads or creates a minimal valid PDF buffer."""
    sample_path = os.path.join(backend_dir, "uploads", "Report_-_ISHAMADEEHA260400080904.pdf")
    if os.path.exists(sample_path):
        with open(sample_path, "rb") as f:
            return f.read()
    else:
        # Minimal fallback PDF content
        return b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/MediaBox[0 0 612 792]>>endobj\nxref\n0 4\n0000000000 65535 f\n0000000010 00000 n\n0000000053 00000 n\n0000000102 00000 n\ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n149\n%%EOF\n"


@pytest.fixture
def scanned_pdf_content():
    """Reads a scanned document PDF for OCR testing."""
    sample_path = os.path.join(backend_dir, "uploads", "Scanned_Document_3.pdf")
    if os.path.exists(sample_path):
        with open(sample_path, "rb") as f:
            return f.read()
    return None


@pytest.fixture
def valid_session_token():
    """
    Creates a real, live Clerk session token using Clerk's official Backend API.
    """
    secret = os.getenv("CLERK_SECRET_KEY")
    if not secret:
        pytest.skip("CLERK_SECRET_KEY not found in environment.")

    clerk = Clerk(bearer_auth=secret)
    users = clerk.users.list()
    if not users:
        pytest.skip("No users found in Clerk application.")

    user_id = users[0].id
    sessions = clerk.sessions.list(user_id=user_id)
    if not sessions:
        # Create a session if none active
        session = clerk.sessions.create(user_id=user_id)
        session_id = session.id
    else:
        session_id = sessions[0].id

    # Create a fresh token valid for 1 hour (3600s)
    token_resp = clerk.sessions.create_token(
        session_id=session_id,
        expires_in_seconds=3600
    )
    return token_resp.jwt


# =========================================================================
# TEST 1: Public endpoint GET /
# =========================================================================
def test_public_endpoint_accessible(client):
    res = client.get("/")
    assert res.status_code == 200
    data = res.get_json()
    assert data.get("status") == "healthy"
    assert "backend is running" in data.get("message", "")


# =========================================================================
# TEST 2: Missing token returns HTTP 401 + WWW-Authenticate header
# =========================================================================
def test_upload_missing_token_returns_401(client, sample_pdf_content):
    data = {
        "file": (io.BytesIO(sample_pdf_content), "test_report.pdf"),
        "language": "en"
    }
    res = client.post(
        "/upload",
        data=data,
        content_type="multipart/form-data"
    )
    assert res.status_code == 401
    assert res.headers.get("WWW-Authenticate") == "Bearer"
    json_data = res.get_json()
    assert json_data.get("error") == "Unauthorized"
    # Documented reason.name for missing token
    assert json_data.get("message") == "SESSION_TOKEN_MISSING"


# =========================================================================
# TEST 3: Invalid token returns HTTP 401 + WWW-Authenticate header
# =========================================================================
def test_upload_invalid_token_returns_401(client, sample_pdf_content):
    data = {
        "file": (io.BytesIO(sample_pdf_content), "test_report.pdf"),
        "language": "en"
    }
    headers = {
        "Authorization": "Bearer invalid_forged_session_token_12345"
    }
    res = client.post(
        "/upload",
        data=data,
        headers=headers,
        content_type="multipart/form-data"
    )
    assert res.status_code == 401
    assert res.headers.get("WWW-Authenticate") == "Bearer"
    json_data = res.get_json()
    assert json_data.get("error") == "Unauthorized"
    assert json_data.get("message") is not None


# =========================================================================
# TEST 4: Expired token returns HTTP 401 + WWW-Authenticate header
# =========================================================================
def test_upload_expired_token_returns_401(client, sample_pdf_content):
    expired_jwt = (
        "eyJhbGciOiJSUzI1NiIsImtpZCI6Imluc18zTUduNnNtdXByTlVTWFdGeFNUUndoQnBmbzAifQ."
        "eyJleHAiOjE1MDAwMDAwMDAsImlhdCI6MTQ5OTk5MDAwMCwiaXNzIjoiaHR0cHM6Ly9leGFtcGxlLmNvbSIsInN1YiI6InVzZXJfMTIzIn0."
        "invalid_signature_block"
    )
    data = {
        "file": (io.BytesIO(sample_pdf_content), "test_report.pdf"),
        "language": "en"
    }
    headers = {
        "Authorization": f"Bearer {expired_jwt}"
    }
    res = client.post(
        "/upload",
        data=data,
        headers=headers,
        content_type="multipart/form-data"
    )
    assert res.status_code == 401
    assert res.headers.get("WWW-Authenticate") == "Bearer"
    json_data = res.get_json()
    assert json_data.get("error") == "Unauthorized"


# =========================================================================
# TEST 5: Authenticated request without valid user ID (sub claim) returns HTTP 401
# =========================================================================
def test_upload_missing_user_id_sub_claim_returns_401(client, sample_pdf_content):
    """
    Simulates a token that is authenticated but contains an empty or missing 'sub' claim.
    """
    mock_state = MagicMock()
    mock_state.is_authenticated = True
    mock_state.payload = {"sub": "", "sid": "sess_123"}

    with patch("auth.authenticate_request", return_value=mock_state):
        data = {
            "file": (io.BytesIO(sample_pdf_content), "test_report.pdf"),
            "language": "en"
        }
        headers = {"Authorization": "Bearer some_valid_format_token"}
        res = client.post(
            "/upload",
            data=data,
            headers=headers,
            content_type="multipart/form-data"
        )
        assert res.status_code == 401
        assert res.headers.get("WWW-Authenticate") == "Bearer"
        json_data = res.get_json()
        assert json_data.get("error") == "Unauthorized"
        assert json_data.get("message") == "INVALID_USER_ID"


# =========================================================================
# TEST 6: Token lacking authorized party (azp) is rejected when CLERK_AUTHORIZED_PARTIES is enforced
# =========================================================================
def test_upload_token_without_azp_rejected_when_azp_enforced(client, valid_session_token, sample_pdf_content):
    """
    When CLERK_AUTHORIZED_PARTIES is enforced, tokens without azp claim are rejected.
    """
    data = {
        "file": (io.BytesIO(sample_pdf_content), "authenticated_test_report.pdf"),
        "language": "en"
    }
    headers = {
        "Authorization": f"Bearer {valid_session_token}"
    }
    res = client.post(
        "/upload",
        data=data,
        headers=headers,
        content_type="multipart/form-data"
    )
    assert res.status_code == 401
    assert res.headers.get("WWW-Authenticate") == "Bearer"
    json_data = res.get_json()
    assert json_data.get("error") == "Unauthorized"
    assert json_data.get("message") == "TOKEN_INVALID_AUTHORIZED_PARTIES"


# =========================================================================
# TEST 7: CORS preflight does not execute protected endpoint logic
# =========================================================================
def test_options_preflight_does_not_execute_endpoint(client):
    """
    OPTIONS request must return preflight headers without triggering file validation
    or upload endpoint execution (which would return 400 if executed).
    """
    headers = {
        "Origin": "http://localhost:5173",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "Authorization, Content-Type"
    }
    res = client.options("/upload", headers=headers)
    assert res.status_code in (200, 204)
    # Ensure it did NOT run upload_report() and return a 400 error
    assert res.status_code != 400


# =========================================================================
# TEST 8: CORS preflight allows authorized origin
# =========================================================================
def test_cors_preflight_authorized_origin(client):
    headers = {
        "Origin": "http://localhost:5173",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "Authorization, Content-Type"
    }
    res = client.options("/upload", headers=headers)
    assert res.status_code in (200, 204)
    assert res.headers.get("Access-Control-Allow-Origin") == "http://localhost:5173"


# =========================================================================
# TEST 9: CORS preflight blocks unauthorized origin
# =========================================================================
def test_cors_preflight_unauthorized_origin(client):
    headers = {
        "Origin": "http://malicious-third-party-site.com",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "Authorization, Content-Type"
    }
    res = client.options("/upload", headers=headers)
    # Origin must not be reflected
    assert res.headers.get("Access-Control-Allow-Origin") != "http://malicious-third-party-site.com"


# =========================================================================
# TEST 10: Valid Clerk session token succeeds with PDF analysis
# =========================================================================
def test_authenticated_upload_and_analysis_succeeds(client, valid_session_token, sample_pdf_content, monkeypatch):
    monkeypatch.setenv("CLERK_AUTHORIZED_PARTIES", "")
    data = {
        "file": (io.BytesIO(sample_pdf_content), "authenticated_test_report.pdf"),
        "language": "en"
    }
    headers = {
        "Authorization": f"Bearer {valid_session_token}"
    }
    res = client.post(
        "/upload",
        data=data,
        headers=headers,
        content_type="multipart/form-data"
    )
    assert res.status_code == 200
    json_data = res.get_json()
    assert json_data.get("status") == "document_processed"
    assert "analysis" in json_data
    analysis = json_data["analysis"]
    assert "report_type" in analysis
    assert "biomarkers" in analysis
    assert "patterns" in analysis
    assert "concern_level" in analysis
    assert "knowledge" in analysis
    assert "doctor_questions" in analysis


# =========================================================================
# TEST 11: Scanned PDF OCR with valid Clerk session token succeeds
# =========================================================================
def test_authenticated_scanned_pdf_ocr_succeeds(client, valid_session_token, scanned_pdf_content, monkeypatch):
    if not scanned_pdf_content:
        pytest.skip("Scanned PDF sample not available for OCR test.")

    monkeypatch.setenv("CLERK_AUTHORIZED_PARTIES", "")
    data = {
        "file": (io.BytesIO(scanned_pdf_content), "authenticated_scanned_doc.pdf"),
        "language": "en"
    }
    headers = {
        "Authorization": f"Bearer {valid_session_token}"
    }
    res = client.post(
        "/upload",
        data=data,
        headers=headers,
        content_type="multipart/form-data"
    )
    assert res.status_code == 200
    json_data = res.get_json()
    assert json_data.get("status") == "document_processed"
    assert "analysis" in json_data
    assert len(json_data["analysis"]) > 0
