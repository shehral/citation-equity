"""Shared tables and JSONL helpers for the E1 measurement and analysis scripts (PREREG_E1.md r2)."""

from __future__ import annotations

import json
from pathlib import Path

# Judges (Measurement 2). Gemma-4-31B is the editor and never a judge. E1 uses JUDGE_ORDER only;
# qwen3.5-9b is E2b's second judge (experiments/PLAN_E2.md), where Qwen3.8-27B is the editor.
JUDGES = {"gemma-4-12b": "google/gemma-4-12B-it", "qwen3.8-27b": "Qwen/Qwen3.8-27B",
          "qwen3.5-9b": "Qwen/Qwen3.5-9B"}
JUDGE_ORDER = ["gemma-4-12b", "qwen3.8-27b"]  # the first is the primary judge
SEEDS = range(1, 9)

# Page sets. The timing smoke (r3 amendment 8) is held out of main and is never analyzed.
SETS = ["main", "replication", "smoke", "timing"]
TIMING = "timing"
# E3's new five-page and four-page queries (experiments/PLAN_E3.md); scored only when named.
E3_SETS = ["e3", "e3-four"]
N_SOURCES = 4

# Generation settings, fixed by the pre-registration.
TEMPERATURE = 0.5
MAX_MODEL_LEN = 32_768
TOKEN_LIMIT = 31_000

# Each arm's reference version for the primary contrast (the arms table, "Ref" column).
REF = {
    "1": "original", "2": "P2", "3": "P3", "4": "original", "5": "P5", "6": "P6", "7": "P7",
    "8": "P8", "9": "original", "10": "P10", "11": "original", "12": "P12", "13": "original",
    "14": "original", "ALL": "P_ALL",
}
ARMS = [str(a) for a in range(1, 15)] + ["ALL"]
PLACEBOS = ["P2", "P3", "P5", "P6", "P7", "P8", "P10", "P12", "P_ALL"]
# E2a's two deterministic versions of arm 9 (experiments/PLAN_E2.md): words without a heading, and a
# heading and sentence without the query's words. They belong to arm 9 for applicability and tier.
E2_ARMS = ["9W", "9P"]

FAMILY_A = [str(a) for a in range(2, 11)]
FAMILY_B = ["11", "12", "14"]
DESCRIPTIVE = ["1", "13"]
ALL_CONTRASTS = [("ALL", "P_ALL"), ("ALL", "original")]
# The replication set runs the text arms only; one Holm family over all of them.
REPLICATION_ARMS = ["5", "6", "7", "9", "11", "12", "14", "ALL"]

# Run plan tiers (the arms table, "Tier" column); a placebo runs in its arm's tier, the original in tier 1.
_ARM_TIER = {"1": 3, "2": 2, "3": 2, "4": 3, "5": 1, "6": 1, "7": 1, "8": 2, "9": 1, "10": 3,
             "11": 3, "12": 2, "13": 3, "14": 3, "ALL": 1}

ALPHA = 0.05
DELTA = 0.03
MIN_N = 30
MIN_VALID = 4

# The characters String.prototype.trim removes (ECMAScript WhiteSpace and LineTerminator).
JS_WHITESPACE = "\t\n\x0b\x0c\r \xa0\u1680" + "".join(chr(c) for c in range(0x2000, 0x200B)) + \
    "\u2028\u2029\u202f\u205f\u3000\ufeff"

CAVEAT = "Content check on a local model over a fixed page set. It does not predict live AI engines."


def parent_arm(arm: str) -> str:
    """The arm a version belongs to for applicability: P5 -> 5, P_ALL -> ALL, 9W and 9P -> 9,
    others unchanged."""
    if arm in E2_ARMS:
        return "9"
    if arm == "P_ALL":
        return "ALL"
    if arm.startswith("P") and arm[1:].isdigit():
        return arm[1:]
    return arm


def tier(arm: str) -> int:
    return 1 if arm == "original" else _ARM_TIER[parent_arm(arm)]


def read_jsonl(path: Path) -> list[dict]:
    """Rows of a JSONL file. Lines end at "\\n" only: str.splitlines would also split on U+2028."""
    rows = []
    for number, line in enumerate(Path(path).read_text(encoding="utf-8").split("\n"), start=1):
        line = line.removesuffix("\r")
        if not line.strip():
            continue
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError as err:
            raise ValueError(f"{path} line {number} is not valid JSON ({err.msg})") from err
    return rows


def write_jsonl(path: Path, rows: list[dict]) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows), encoding="utf-8")


def write_json(path: Path, value) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
