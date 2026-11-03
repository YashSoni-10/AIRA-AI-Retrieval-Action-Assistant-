"""
Phase 1 Bug Regression Test.

Tests specifically for the bug where:
  - settings.JWT_SECRET is configured in .env
  - BUT protected endpoints returned HTTP 503
    ("Authentication service is not configured")

Root cause: JWT_SECRET was a plain class variable set via os.getenv() at
class-parse time. If the server started before JWT_SECRET was in the
environment, it was permanently "". Fixed by making JWT_SECRET a @property.
"""
import os
import sys
import pytest
import datetime
import jwt as pyjwt
from fastapi import HTTPException

from app.core.config import settings
from app.core.auth import verify_token_string, _decode_token


def test_jwt_secret_configuration():
    assert bool(settings.JWT_SECRET), "settings.JWT_SECRET must not be empty"
    assert len(settings.JWT_SECRET) >= 32, "settings.JWT_SECRET must be at least 32 characters"


def test_jwt_secret_property_live():
    original = os.environ.get("JWT_SECRET", "")
    test_value = "test_live_property_check_value_for_regression"
    try:
        os.environ["JWT_SECRET"] = test_value
        assert settings.JWT_SECRET == test_value, "settings.JWT_SECRET must reflect runtime os.environ value"
    finally:
        if original:
            os.environ["JWT_SECRET"] = original
        else:
            os.environ.pop("JWT_SECRET", None)
    assert settings.JWT_SECRET == original


def test_auth_dependency_empty_token_returns_401():
    with pytest.raises(HTTPException) as exc_info:
        verify_token_string("")
    assert exc_info.value.status_code == 401


def test_auth_dependency_garbage_token_returns_401():
    with pytest.raises(HTTPException) as exc_info:
        _decode_token("not.a.valid.jwt.token")
    assert exc_info.value.status_code == 401


def test_valid_jwt_accepted():
    secret = settings.JWT_SECRET
    payload = {
        "id": "test_user_phase1_regression",
        "iat": datetime.datetime.utcnow(),
        "exp": datetime.datetime.utcnow() + datetime.timedelta(hours=1),
    }
    valid_token = pyjwt.encode(payload, secret, algorithm="HS256")
    user_id = _decode_token(valid_token)
    assert user_id == "test_user_phase1_regression"


def test_expired_jwt_returns_401():
    secret = settings.JWT_SECRET
    expired_payload = {
        "id": "test_user",
        "iat": datetime.datetime(2020, 1, 1),
        "exp": datetime.datetime(2020, 1, 2),
    }
    expired_token = pyjwt.encode(expired_payload, secret, algorithm="HS256")
    with pytest.raises(HTTPException) as exc_info:
        _decode_token(expired_token)
    assert exc_info.value.status_code == 401


def test_wrong_secret_jwt_returns_401():
    payload = {
        "id": "test_user_phase1_regression",
        "iat": datetime.datetime.utcnow(),
        "exp": datetime.datetime.utcnow() + datetime.timedelta(hours=1),
    }
    wrong_token = pyjwt.encode(payload, "completelywrongsecretkeyfortestregressio", algorithm="HS256")
    with pytest.raises(HTTPException) as exc_info:
        _decode_token(wrong_token)
    assert exc_info.value.status_code == 401


def test_token_missing_id_field_returns_401():
    secret = settings.JWT_SECRET
    no_id_payload = {"sub": "test", "exp": datetime.datetime.utcnow() + datetime.timedelta(hours=1)}
    no_id_token = pyjwt.encode(no_id_payload, secret, algorithm="HS256")
    with pytest.raises(HTTPException) as exc_info:
        _decode_token(no_id_token)
    assert exc_info.value.status_code == 401


def test_bad_tokens_never_return_503():
    secret = settings.JWT_SECRET
    payload = {
        "id": "test_user_phase1_regression",
        "iat": datetime.datetime.utcnow(),
        "exp": datetime.datetime.utcnow() + datetime.timedelta(hours=1),
    }
    expired_token = pyjwt.encode({"id": "x", "exp": datetime.datetime(2020, 1, 1)}, secret, algorithm="HS256")
    wrong_token = pyjwt.encode(payload, "completelywrongsecretkeyfortestregressio", algorithm="HS256")
    no_id_token = pyjwt.encode({"sub": "test"}, secret, algorithm="HS256")

    bad_tokens = ["", "garbage", "x.y.z", expired_token, wrong_token, no_id_token]
    all_codes = []
    for tok in bad_tokens:
        try:
            if tok == "":
                verify_token_string(tok)
            else:
                _decode_token(tok)
            all_codes.append(200)
        except HTTPException as e:
            all_codes.append(e.status_code)

    assert 503 not in all_codes, "No bad token should return 503"
    assert 500 not in all_codes, "No bad token should return 500"
    assert all(c == 401 for c in all_codes), "All bad tokens must return 401"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
