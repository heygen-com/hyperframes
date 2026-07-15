import json
import sys

from hyperframes_vst.scan import scan_paths


def make_probe_script(tmp_path, body: str) -> list[str]:
    script = tmp_path / "probe.py"
    script.write_text(body)
    return [sys.executable, str(script)]


def test_scan_collects_names_from_probe(tmp_path):
    bundle = tmp_path / "Fake.vst3"
    bundle.mkdir()
    probe = make_probe_script(
        tmp_path, "import json,sys; print(json.dumps([{'name': 'FakePlugin'}]))"
    )
    result = scan_paths([str(tmp_path)], probe_cmd=probe)
    assert result == [{"path": str(bundle), "name": "FakePlugin", "format": "vst3"}]


def test_scan_survives_crashing_probe(tmp_path):
    (tmp_path / "Bad.vst3").mkdir()
    good = tmp_path / "Good.vst3"
    good.mkdir()
    probe = make_probe_script(
        tmp_path,
        "import json,sys\n"
        "if 'Bad' in sys.argv[1]: import os; os.abort()\n"
        "print(json.dumps([{'name': 'GoodPlugin'}]))",
    )
    result = scan_paths([str(tmp_path)], probe_cmd=probe)
    assert [r["name"] for r in result] == ["GoodPlugin"]


def test_scan_ignores_missing_dirs(tmp_path):
    assert scan_paths([str(tmp_path / "nope")]) == []
