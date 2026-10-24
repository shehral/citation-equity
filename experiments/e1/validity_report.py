"""Calibration summary of an E1 versions.jsonl (editor.py output), for checking the editor
before the freeze: per arm, valid / invalid / not-applicable counts, the most common reasons,
the PREREG_E1 flag for more than 20% validity exclusions, and for ALL how often each step was
skipped (r3 amendment 9). Reasons are grouped with every number masked as N.

Run: python3 -I experiments/e1/validity_report.py <versions.jsonl> [--top 3] [--json report.json]
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common  # noqa: E402

FLAG_SHARE = 0.20  # PREREG_E1, Validity checks: an arm with more than 20% exclusions is flagged


def arm_order(arm: str) -> tuple:
    """Arms 1-14, then placebos by arm, then ALL and P_ALL."""
    if arm.isdigit():
        return (0, int(arm))
    if re.fullmatch(r"P\d+", arm):
        return (1, int(arm[1:]))
    return (2, ["ALL", "P_ALL"].index(arm) if arm in ("ALL", "P_ALL") else 2, arm)


def reasons(excluded_reason: str) -> list[str]:
    """The validator messages of an `invalid:` reason, numbers masked."""
    body = excluded_reason.removeprefix("invalid:").strip()
    return [re.sub(r"\d+(?:\.\d+)?", "N", part.strip()) for part in body.split(" | ") if part.strip()]


def summarize(rows: list[dict]) -> dict[str, dict]:
    per: dict[str, dict] = {}
    for r in rows:
        if r["arm"] == "original":
            continue
        s = per.setdefault(r["arm"], {"versions": 0, "valid": 0, "invalid": 0, "not_applicable": 0,
                                      "reasons": Counter(), "skipped_steps": Counter(), "with_skipped_steps": 0})
        s["versions"] += 1
        reason = r.get("excluded_reason") or ""
        if r["valid"]:
            s["valid"] += 1
        elif reason.startswith("not applicable"):
            s["not_applicable"] += 1
        else:
            s["invalid"] += 1
            s["reasons"].update(reasons(reason))
        skipped = r.get("skipped_steps") or []
        s["skipped_steps"].update(str(x["step"]) for x in skipped)
        s["with_skipped_steps"] += bool(skipped)
    out = {}
    for arm in sorted(per, key=arm_order):
        s = per[arm]
        judged = s["valid"] + s["invalid"]
        share = s["invalid"] / judged if judged else None
        out[arm] = {**s, "invalid_share": share, "flagged": share is not None and share > FLAG_SHARE,
                    "reasons": s["reasons"].most_common(),
                    "skipped_steps": dict(sorted(s["skipped_steps"].items(), key=lambda kv: arm_order(kv[0])))}
    return out


def render(summary: dict[str, dict], top: int) -> str:
    lines = []
    for arm, s in summary.items():
        share = "n/a" if s["invalid_share"] is None else f"{s['invalid_share']:.0%} invalid"
        flag = "  FLAGGED (over 20% invalid)" if s["flagged"] else ""
        versions = "1 version" if s["versions"] == 1 else f"{s['versions']} versions"
        lines.append(f"{arm}: {versions}; valid {s['valid']}, invalid {s['invalid']}, "
                     f"not applicable {s['not_applicable']} ({share}){flag}")
        for reason, n in s["reasons"][:top]:
            lines.append(f"    {n} x {reason}")
        if s["skipped_steps"]:
            steps = ", ".join(f"{k} x{v}" for k, v in s["skipped_steps"].items())
            lines.append(f"    skipped steps: {steps} ({s['with_skipped_steps']} versions with a skipped step)")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("versions", help="a versions.jsonl written by editor.py")
    ap.add_argument("--top", type=int, default=3, help="reasons shown per arm (default 3)")
    ap.add_argument("--json", help="also write the full summary as JSON here")
    args = ap.parse_args(argv)
    rows = common.read_jsonl(args.versions)
    summary = summarize(rows)
    print(render(summary, args.top))
    if args.json:
        Path(args.json).write_text(json.dumps({"versions": len(rows), "per_arm": summary}, indent=1) + "\n",
                                   encoding="utf-8")


if __name__ == "__main__":
    main()
