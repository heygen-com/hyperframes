"""Credential-boundary tests; stub Google's transport, never use real secrets."""

import importlib.util
import json
import os
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location("gemini_auth", Path(__file__).with_name("gemini-auth.py"))
auth = importlib.util.module_from_spec(spec)
spec.loader.exec_module(auth)


class AuthenticationTests(unittest.TestCase):
    def setUp(self):
        self.info = {"type": "service_account", "project_id": "account-project", "token_uri": "https://untrusted.invalid/token"}
        self.credentials = Mock(token="fixture-token")
        self.factory = Mock(return_value=self.credentials)
        self.request = Mock(return_value=object())
        transport = types.ModuleType("google.auth.transport.requests")
        transport.Request = self.request
        oauth = types.ModuleType("google.oauth2")
        oauth.service_account = types.SimpleNamespace(Credentials=types.SimpleNamespace(from_service_account_info=self.factory))
        modules = {name: types.ModuleType(name) for name in ("google", "google.auth", "google.auth.transport")}
        modules.update({"google.auth.transport.requests": transport, "google.oauth2": oauth})
        self.addCleanup(patch.stopall)
        patch.dict("sys.modules", modules).start()
        patch.dict(os.environ, {"GCS_CREDS": json.dumps(self.info)}, clear=True).start()

    def test_scope_endpoint_and_refresh(self):
        self.assertEqual(auth.authenticate(), {"token": "fixture-token", "project": "account-project"})
        info = self.factory.call_args.args[0]
        self.assertEqual(info["token_uri"], "https://oauth2.googleapis.com/token")
        self.assertEqual(self.factory.call_args.kwargs["scopes"], ["https://www.googleapis.com/auth/generative-language.retriever"])
        self.credentials.refresh.assert_called_once_with(self.request.return_value)

    def test_file_takes_precedence_over_json_environment(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "service.json"
            path.write_text(json.dumps({**self.info, "project_id": "file-project"}))
            os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = str(path)
            os.environ["GCS_CREDS"] = "invalid-json"
            self.assertEqual(auth.authenticate()["project"], "file-project")

    def test_quota_project_precedence(self):
        os.environ["GCLOUD_PROJECT_ID"] = "alias-project"
        self.assertEqual(auth.authenticate()["project"], "alias-project")
        os.environ["GOOGLE_CLOUD_PROJECT"] = "explicit-project"
        self.assertEqual(auth.authenticate()["project"], "explicit-project")

    def test_user_adc_is_rejected_before_exchange(self):
        os.environ["GCS_CREDS"] = json.dumps({"type": "authorized_user"})
        self.assertIn("service-account JSON", auth.authenticate()["error"])
        self.factory.assert_not_called()

    def test_invalid_json_or_missing_file_does_not_fall_back(self):
        os.environ["GCS_CREDS"] = "private-invalid-json"
        self.assertIn("error", auth.authenticate())
        os.environ["GCS_CREDS"] = json.dumps(self.info)
        os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = "/missing/service-account-fixture.json"
        self.assertIn("error", auth.authenticate())
        self.factory.assert_not_called()

    def test_library_errors_are_redacted(self):
        for boundary in (self.factory, self.credentials.refresh):
            with self.subTest(boundary=boundary):
                boundary.side_effect = RuntimeError("private-key-and-token")
                result = auth.authenticate()
                self.assertIn("error", result)
                self.assertNotIn("private-key-and-token", json.dumps(result))
                boundary.side_effect = None

    def test_missing_dependency_has_actionable_error(self):
        with patch.dict("sys.modules", {"google.auth.transport.requests": None}):
            self.assertIn("pip install google-auth requests", auth.authenticate()["error"])
        self.factory.assert_not_called()


if __name__ == "__main__":
    unittest.main()
