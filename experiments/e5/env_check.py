"""E5's environment check (experiments/PLAN_E5.md, "One run"): before the jobs, log the vLLM, torch
and transformers versions, each model's snapshot revision in the Hugging Face cache, the sampling
settings and the GPU type, and compare them with E1's records (e1_env_reference.json). Every
mismatch is printed as a MISMATCH line; with --strict the exit code is 1 when there is one.

Run it on Explorer with the jobs' Python and cache, on a GPU node for the GPU line (in an
interactive job, or as the first step of a job), and keep its JSON output with the E5 logs:
  . ./local.env && HF_HOME=$HF_HOME $CE_PYTHON -I $CE_ROOT/code/e5/env_check.py \
      --batches $CE_ROOT/e5/batches --json $CE_ROOT/e5/env_check.json

Settings are read from the code that runs (batch_generate.py, generate.sbatch, editor.py) and,
with --batches, from every E5 batch file (temperature, numCtx, seed range, model per judge).
"""

from __future__ import annotations

import argparse
import importlib.metadata
import json
import os
import re
import subprocess
import sys
from pathlib import Path

sys.dont_write_bytecode = True
E5 = Path(__file__).resolve().parent
CODE = E5.parent  # experiments/ locally, $CE_ROOT/code on the cluster
REFERENCE = E5 / "e1_env_reference.json"
PACKAGES = ["vllm", "torch", "transformers", "tokenizers", "huggingface_hub", "flashinfer-python", "triton"]
JUDGE_MODELS = {"gemma-4-12b": "google/gemma-4-12B-it", "qwen3.8-27b": "Qwen/Qwen3.8-27B"}


def package_versions() -> dict:
    out = {"python": ".".join(map(str, sys.version_info[:3]))}
    for name in PACKAGES:
        try:
            out[name] = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            out[name] = None
    return out


def model_revisions(hf_home: str | None, models) -> dict:
    """{model: (refs/main revision, snapshot folder exists)} from the cache."""
    out = {}
    for model in models:
        if not hf_home:
            out[model] = {"revision": None, "snapshot": False, "note": "HF_HOME is not set"}
            continue
        base = Path(hf_home) / "hub" / f"models--{model.replace('/', '--')}"
        ref = base / "refs" / "main"
        rev = ref.read_text(encoding="utf-8").strip() if ref.exists() else None
        out[model] = {"revision": rev, "snapshot": bool(rev) and (base / "snapshots" / rev / "config.json").exists(),
                      "cache": str(base)}
    return out


def gpus() -> list[str]:
    try:
        proc = subprocess.run(["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"], capture_output=True,
                              text=True, timeout=30)
    except (OSError, subprocess.TimeoutExpired):
        return []
    return [line.strip().removeprefix("NVIDIA ").replace(" ", "-") for line in proc.stdout.splitlines() if line.strip()]


def _grep(path: Path, pattern: str):
    if not path.exists():
        return None
    m = re.search(pattern, path.read_text(encoding="utf-8"))
    return m.group(1) if m else None


def code_settings(code: Path) -> dict:
    """The sampling settings as the code that runs on the cluster sets them."""
    bg, gen, ed = code / "batch_generate.py", code / "e1" / "generate.sbatch", code / "e1" / "editor.py"
    if not bg.exists():  # locally batch_generate.py is in experiments/explorer
        bg = code / "explorer" / "batch_generate.py"
    num = lambda s: None if s is None else float(s) if "." in s else int(s)  # noqa: E731
    return {
        "judges": {
            "max_tokens": num(_grep(gen, r"--max-tokens (\d+)")),
            "thinking": False if _grep(gen, r"(--no-thinking)") else None,
            "gpu_memory_utilization": num(_grep(bg, r"gpu_memory_utilization=([0-9.]+)")),
            "enforce_eager": True if _grep(bg, r"(enforce_eager=True)") else None,
            "llm_seed": num(_grep(bg, r"gpu_memory_utilization=[0-9.]+, seed=(\d+)")),
        },
        "editor": {
            "temperature": num(_grep(ed, r"def generate\(self, jobs: list\[dict\], temperature: float = ([0-9.]+)")),
            "max_tokens": num(_grep(ed, r"MAX_NEW_TOKENS = (\d+)")),
            "max_model_len": num(_grep(ed, r'"--max-model-len", type=int, default=(\d+)')),
            "max_attempts": num(_grep(ed, r"MAX_ATTEMPTS = (\d+)")),
            "gpu_memory_utilization": num(_grep(ed, r"gpu_memory_utilization=([0-9.]+), seed=1")),
        },
        "q_L": {"temperature": num(_grep(ed, r"TOOL_TEMPERATURE = ([0-9.]+)")),
                "seed": num(_grep(ed, r"TOOL_SEED = (\d+)"))},
    }


def batch_settings(folder: Path) -> dict:
    """Per E5 batch file: temperatures, numCtx, seeds and models found."""
    out = {}
    for path in sorted(folder.glob("e5-*.prompts.jsonl")):
        temps, ctx, seeds, models = set(), set(), set(), set()
        with path.open(encoding="utf-8") as f:
            for line in f:
                if line.strip():
                    p = json.loads(line)
                    temps.add(p["temperature"])
                    ctx.add(p["numCtx"])
                    seeds.add(p["seed"])
                    models.add(p["model"])
        out[path.name] = {"temperature": sorted(temps), "numCtx": sorted(ctx), "seeds": sorted(seeds),
                          "models": sorted(models)}
    return out


def compare(found: dict, ref: dict) -> list[str]:
    bad = []
    for name, want in ref["packages"].items():
        got = found["packages"].get(name)
        if got != want:
            bad.append(f"package {name}: {got} here, {want} in E1")
    for model, want in ref["models"].items():
        got = found["models"].get(model, {})
        if got.get("revision") != want:
            bad.append(f"model {model}: revision {got.get('revision')} here, {want} in E1")
        elif not got.get("snapshot"):
            bad.append(f"model {model}: revision {want} has no snapshot with config.json in the cache")
    for role in ("judges", "editor", "q_L"):
        for k, got in found["settings"][role].items():
            want = ref["sampling"][role].get(k)
            if want is not None and got != want:
                bad.append(f"setting {role}.{k}: {got} here, {want} in E1")
    for name, s in found.get("batches", {}).items():
        m = re.match(r"^e5-[^.]+\.(.+)\.tier", name)  # e5-<set>.<judge>.tier<k>; judges hold dots
        judge = m.group(1) if m else None
        want_model = JUDGE_MODELS.get(judge)
        if s["temperature"] != [ref["sampling"]["judges"]["temperature"]]:
            bad.append(f"batch {name}: temperatures {s['temperature']}")
        if s["numCtx"] != [ref["sampling"]["judges"]["max_model_len"]]:
            bad.append(f"batch {name}: numCtx {s['numCtx']}")
        if s["seeds"] != ref["sampling"]["judges"]["seeds"]:
            bad.append(f"batch {name}: seeds {s['seeds']}")
        if s["models"] != [want_model]:
            bad.append(f"batch {name}: models {s['models']}, expected {want_model}")
    if found["gpus"]:
        allowed = {g for gs in ref["gpus"].values() for g in gs}
        for g in found["gpus"]:
            if g not in allowed:
                bad.append(f"GPU {g}: not one E1 used ({sorted(allowed)})")
        if found.get("for_model"):
            used = ref["gpus"].get(found["for_model"], [])
            if not any(g in used for g in found["gpus"]):
                bad.append(f"GPU {found['gpus']}: E1 ran {found['for_model']} on {used}")
    else:
        bad.append("GPU: none visible (run on a GPU node to log the GPU type)")
    return bad


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--batches", help="folder of E5 batch files to check")
    ap.add_argument("--model", help="the model this GPU will run, to compare the GPU type with E1's for it")
    ap.add_argument("--json", help="write the findings here")
    ap.add_argument("--strict", action="store_true", help="exit 1 on any mismatch")
    args = ap.parse_args(argv)
    ref = json.loads(REFERENCE.read_text(encoding="utf-8"))
    found = {
        "packages": package_versions(),
        "models": model_revisions(os.environ.get("HF_HOME"), list(ref["models"])),
        "settings": code_settings(CODE),
        "gpus": gpus(),
        "for_model": args.model,
        "hf_home": os.environ.get("HF_HOME"),
    }
    if args.batches:
        found["batches"] = batch_settings(Path(args.batches))
    found["mismatches"] = compare(found, ref)
    print(json.dumps({k: v for k, v in found.items() if k != "mismatches"}, indent=1))
    for line in found["mismatches"]:
        print(f"MISMATCH {line}")
    print(f"env_check: {len(found['mismatches'])} mismatch(es) with E1's records")
    if args.json:
        Path(args.json).write_text(json.dumps(found, indent=1) + "\n", encoding="utf-8")
    sys.exit(1 if args.strict and found["mismatches"] else 0)


if __name__ == "__main__":
    main()
