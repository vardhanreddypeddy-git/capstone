"""
Reusable Flask authentication decorator using Clerk's official clerk-backend-api.
"""

import os
import logging
from datetime import datetime, timezone
from functools import wraps
import jwt
from flask import request, jsonify, g
from clerk_backend_api import authenticate_request, AuthenticateRequestOptions

logger = logging.getLogger(__name__)


def get_auth_options() -> AuthenticateRequestOptions:
    """
    Build AuthenticateRequestOptions from environment configuration.
    """
    secret_key = os.getenv("CLERK_SECRET_KEY", "").strip() or None
    jwt_key = os.getenv("CLERK_JWT_KEY", "").strip() or None
    if jwt_key and "\\n" in jwt_key:
        jwt_key = jwt_key.replace("\\n", "\n")

    # Parse comma-separated authorized parties (frontend origins)
    raw_azp = os.getenv("CLERK_AUTHORIZED_PARTIES")
    if raw_azp is not None:
        authorized_parties = [
            party.strip() for party in raw_azp.split(",") if party.strip()
        ]
        if not authorized_parties:
            authorized_parties = None
    else:
        authorized_parties = ["http://localhost:5173"]

    return AuthenticateRequestOptions(
        secret_key=secret_key,
        jwt_key=jwt_key,
        authorized_parties=authorized_parties,
        accepts_token=["session_token"]
    )


def require_auth(f):
    """
    Flask decorator to protect endpoints with Clerk session token verification.
    Rejects missing, expired, forged, or non-session tokens with HTTP 401.
    """
    @wraps(f)
    def decorated_function(*args, **kwargs):
        # Allow preflight CORS OPTIONS request without executing protected endpoint
        if request.method == "OPTIONS":
            return ("", 204)

        options = get_auth_options()

        # Safe temporary diagnostics: inspect server UTC timestamp and token timestamps
        server_now_utc = int(datetime.now(timezone.utc).timestamp())
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            raw_token = auth_header[7:].strip()
            try:
                unverified_claims = jwt.decode(raw_token, options={"verify_signature": False})
                t_iat = unverified_claims.get("iat")
                t_exp = unverified_claims.get("exp")
                skew = (t_exp - server_now_utc) if t_exp else None
                logger.info(
                    "[Auth Diagnostic] Server UTC timestamp: %d | Token: iat=%s, exp=%s | Server exp skew: %ss",
                    server_now_utc,
                    t_iat,
                    t_exp,
                    skew
                )
            except Exception as diag_err:
                logger.warning("[Auth Diagnostic] Failed to read token timestamps: %s", type(diag_err).__name__)

        try:
            request_state = authenticate_request(request, options)
        except Exception as auth_err:
            logger.error(
                "Authentication service verification error: %s",
                type(auth_err).__name__
            )
            return jsonify({
                "error": "Unauthorized",
                "message": "Authentication verification failed."
            }), 401, {"WWW-Authenticate": "Bearer"}

        if not request_state.is_authenticated:
            reason = getattr(request_state, "reason", None)
            reason_name = (
                getattr(reason, "name", None)
                or (str(reason) if reason else None)
                or "UNAUTHORIZED"
            )
            logger.warning(
                "Unauthenticated access attempt blocked. Reason: %s",
                reason_name
            )
            return jsonify({
                "error": "Unauthorized",
                "message": reason_name
            }), 401, {"WWW-Authenticate": "Bearer"}

        # Verify authenticated identity has a valid non-empty user ID in 'sub' claim
        user_id = (
            request_state.payload.get("sub")
            if request_state.payload else None
        )
        if not user_id or not isinstance(user_id, str) or not user_id.strip():
            logger.warning("Authenticated token missing valid 'sub' claim.")
            return jsonify({
                "error": "Unauthorized",
                "message": "INVALID_USER_ID"
            }), 401, {"WWW-Authenticate": "Bearer"}

        # Store authenticated identity in Flask request context
        g.auth_state = request_state
        g.user_id = user_id.strip()
        g.session_id = (
            request_state.payload.get("sid")
            if request_state.payload else None
        )

        return f(*args, **kwargs)

    return decorated_function
