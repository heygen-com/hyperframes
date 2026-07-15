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

    args = parser.parse_args()

    if args.command == "bounce":
        from .bounce import bounce_file

        try:
            bounce_file(args.input, args.chain, args.output)
        except PluginMissingError as exc:
            print(f"PLUGIN_MISSING {exc.plugin_name}", file=sys.stderr)
            return 3
        return 0
    return 2


if __name__ == "__main__":
    sys.exit(main())
