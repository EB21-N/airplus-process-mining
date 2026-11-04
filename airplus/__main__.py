"""Point d'entree : python -m airplus [serve|analyze]"""
import argparse
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "vendor"))  # dependances pures Python livrees dans le ZIP


def main():
    ap = argparse.ArgumentParser(prog="airplus")
    sub = ap.add_subparsers(dest="cmd")
    s = sub.add_parser("serve"); s.add_argument("--port", type=int, default=8765); s.add_argument("--no-browser", action="store_true")
    a = sub.add_parser("analyze"); a.add_argument("--mes", required=True); a.add_argument("--plm", required=True); a.add_argument("--erp", required=True); a.add_argument("--out", required=True)
    args = ap.parse_args()
    if args.cmd == "analyze":
        from .engine import run_paths
        z, _, manifest, _ = run_paths(args.mes, args.plm, args.erp)
        with open(args.out, "wb") as f:
            f.write(z)
        print("ZIP :", args.out, "| empreinte :", manifest["content_sha256"], "| fuites :", manifest["pseudonymisation"]["fuites"])
        return
    from .server import serve
    serve(getattr(args, "port", 8765), not getattr(args, "no_browser", False))


if __name__ == "__main__":
    main()
