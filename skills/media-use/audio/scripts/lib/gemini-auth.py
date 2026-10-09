"""Obtain Gemini OAuth headers without persisting credentials or tokens."""

import json
import os
import sys

# Keep the credential subprocess protocol UTF-8 on every platform.
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", errors=_stream.errors)


def authenticate():
    try:
        from google.auth.transport.requests import Request
        from google.oauth2 import service_account
    except ImportError:
        return {"error": "Service-account auth needs Python packages: pip install google-auth requests"}

    try:
        path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
        if path:
            with open(path, encoding="utf-8") as source:
                info = json.load(source)
        else:
            info = json.loads(os.environ["GCS_CREDS"])
        if info.get("type") != "service_account":
            return {"error": "Gemini requires service-account JSON, not user ADC credentials"}
        # Only exchange credentials with Google's OAuth server.
        info["token_uri"] = "https://oauth2.googleapis.com/token"
        credentials = service_account.Credentials.from_service_account_info(
            info,
            scopes=[
                "https://www.googleapis.com/auth/generative-language.retriever",
            ],
        )
        credentials.refresh(Request())
        project = (
            os.environ.get("GOOGLE_CLOUD_PROJECT")
            or os.environ.get("GCLOUD_PROJECT_ID")
            or info.get("project_id")
        )
        return {"token": credentials.token, "project": project}
    except Exception:
        # Library exceptions can contain credential data. Never forward them.
        return {"error": "Gemini service-account authentication failed; check credentials, permissions, and network access"}


if __name__ == "__main__":
    result = authenticate()
    print(json.dumps(result))
    sys.exit(1 if "error" in result else 0)
