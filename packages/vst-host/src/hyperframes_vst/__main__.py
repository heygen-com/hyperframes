import argparse
import sys

from .chain import PluginMissingError


def main() -> int:
    parser = argparse.ArgumentParser(prog="hyperframes-vst")
    sub = parser.add_subparsers(dest="command", required=True)

    p_bounce = sub.add_parser("bounce", help="Offline render a WAV through a chain")
    p_bounce.add_argument("--input", required=True)
    p_bounce.add_argument("--chain", required=True)
    p_bounce.add_argument("--output", required=True)

    p_probe = sub.add_parser("probe", help="Probe one bundle (may crash; run in subprocess)")
    p_probe.add_argument("path")

    p_scan = sub.add_parser("scan", help="Scan plugin dirs, print registry JSON")
    p_scan.add_argument("--dirs", nargs="*", default=None)
    p_scan.add_argument("--json", action="store_true")

    args = parser.parse_args()

    if args.command == "bounce":
        from .bounce import bounce_file

        try:
            bounce_file(args.input, args.chain, args.output)
        except PluginMissingError as exc:
            print(f"PLUGIN_MISSING {exc.plugin_name}", file=sys.stderr)
            return 3
        return 0

    if args.command == "probe":
        import json as _json

        from .scan import probe_bundle

        print(_json.dumps(probe_bundle(args.path)))
        return 0

    if args.command == "scan":
        import json as _json

        from .scan import default_plugin_dirs, scan_paths

        print(_json.dumps(scan_paths(args.dirs or default_plugin_dirs())))
        return 0

    return 2


if __name__ == "__main__":
    sys.exit(main())
