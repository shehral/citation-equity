"""A fake editor backend for E5's local smoke run and tests (no model): it answers each E5 job the
way a cooperative editor would, so the q_L, 12K and P12K paths run end to end and are validated.

- q_L: one numbered question line made from the keyword ("1. What is <k>?").
- 12 and 12K: the missing key words of the prompt's question, as the question writes them, added
  at the end of the title span (else the first span).
- P12 and P12K: each span's first two words swapped (same words, same key terms, same count).
- anything else: the spans unchanged (E1's FakeBackend behaviour).
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "e1"))

import common  # noqa: E402
import editor  # noqa: E402

_MISSING = re.compile(r"^Missing key words \(word stems\): (.*)$", re.M)
_QUESTION = re.compile(r"^Question the page is read for: (.*)$", re.M)


def _swap_first_two(text: str) -> str:
    m = re.match(r"^(\W*)(\w+)(\W+)(\w+)", text)
    return text if not m else f"{m.group(1)}{m.group(4)}{m.group(3)}{m.group(2)}{text[m.end():]}"


class FakeE5Backend:
    def __init__(self):
        self.calls: list[dict] = []

    def generate(self, jobs: list[dict], **sampling) -> list[tuple[str, str]]:
        out = []
        for j in jobs:
            self.calls.append({"key": j["key"], "arm": j["arm"], "sampling": sampling})
            arm = j["arm"]
            if arm == "q_L":
                out.append((f"1. What is {j['keyword']}?", "stop"))
            elif arm in ("12", "12K"):
                stems = [s.strip() for s in _MISSING.search(j["prompt"]).group(1).split(",")]
                question = _QUESTION.search(j["prompt"]).group(1)
                forms = editor.term_forms(common.content_terms(question), question)
                words = " ".join(forms.get(s, s) for s in stems)
                target = next((s for s in j["spans"] if s["id"] == "title"), j["spans"][0])
                out.append((json.dumps({target["id"]: f"{target['text'].rstrip()} {words}"}), "stop"))
            elif arm in ("P12", "P12K"):
                out.append((json.dumps({s["id"]: _swap_first_two(s["text"]) for s in j["spans"]}), "stop"))
            else:
                out.append((json.dumps({s["id"]: s["text"] for s in j["spans"]}), "stop"))
        return out
