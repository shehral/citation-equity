"""Answer a bench prompts file in one vLLM offline batch (experiments/README.md).

Input: the JSONL that `ce bench --export-prompts` writes, one PromptLine per line
(key, model, seed, temperature, numCtx, prompt, packId, draftId, queryId, run).
Output: one AnswerLine per prompt, {"key", "answer", "model"}, for `ce bench --answers`.

Each prompt is sent as a single user message through the model's chat template (as the
bench's Ollama adapter does) with its own seed and temperature. max_model_len is the largest
numCtx in the file. The prompts file must have been exported for --model, because the model
id is part of every answer's key.

Thinking is off by default (enable_thinking=False in the chat template), because a reasoning
trace carries [n] markers that would be scored as citations; --thinking turns it on. The bench
also strips a leading <think>...</think> block before scoring, so a trace that slips through
does not count.

Usage: python batch_generate.py --prompts p.jsonl --model <hf id> --out answers.jsonl
       [--thinking] [--tp N] [--max-tokens N]
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

FIELDS = {
    "key": str,
    "model": str,
    "seed": int,
    "temperature": (int, float),
    "numCtx": int,
    "prompt": str,
    "packId": str,
    "draftId": str,
    "queryId": str,
    "run": int,
}


def read_prompts(text: str) -> list[dict]:
    """PromptLine dicts from JSONL; blank lines skipped; errors name the line.

    Lines end at "\\n" only (a trailing "\\r" is dropped). str.splitlines would also break
    on U+0085, U+2028 and U+2029, which JSON.stringify leaves raw inside strings.
    """
    prompts = []
    for number, line in enumerate(text.split("\n"), start=1):
        line = line.removesuffix("\r")
        if not line.strip():
            continue
        try:
            value = json.loads(line)
        except json.JSONDecodeError as err:
            raise ValueError(f"prompts line {number} is not valid JSON ({err.msg})") from err
        if not isinstance(value, dict):
            raise ValueError(f"prompts line {number} is not a JSON object")
        for field, kind in FIELDS.items():
            # bool is an int in Python; a JSON true is never a valid seed or temperature.
            if not isinstance(value.get(field), kind) or isinstance(value.get(field), bool):
                raise ValueError(f"prompts line {number}: field {field!r} is missing or has the wrong type")
        prompts.append(value)
    if not prompts:
        raise ValueError("the prompts file has no prompts")
    return prompts


def check_model(prompts: list[dict], model: str) -> None:
    """Refuses a file exported for another model: its keys would never match."""
    models = sorted({p["model"] for p in prompts})
    if models != [model]:
        raise ValueError(
            f"the prompts file was exported for model {', '.join(models)}, not {model}; "
            f"re-export with: ce bench ... --model {model} --export-prompts <file>"
        )


def max_model_len(prompts: list[dict]) -> int:
    return max(p["numCtx"] for p in prompts)


def chat_messages(prompts: list[dict]) -> list[list[dict]]:
    return [[{"role": "user", "content": p["prompt"]}] for p in prompts]


def sampling_args(prompts: list[dict], max_tokens: int) -> list[dict]:
    """Keyword arguments for one vLLM SamplingParams per prompt."""
    return [{"temperature": float(p["temperature"]), "seed": p["seed"], "max_tokens": max_tokens} for p in prompts]


def answer_lines(prompts: list[dict], answers: list[str], model: str) -> str:
    """AnswerLine JSONL, one line per prompt, in the prompts' order."""
    if len(answers) != len(prompts):
        raise ValueError(f"{len(answers)} answers for {len(prompts)} prompts")
    return "".join(
        json.dumps({"key": p["key"], "answer": a, "model": model}, ensure_ascii=False) + "\n"
        for p, a in zip(prompts, answers)
    )


def chat_kwargs(thinking: bool) -> dict:
    """Extra llm.chat arguments: thinking off unless asked for (templates without the flag ignore it)."""
    return {} if thinking else {"chat_template_kwargs": {"enable_thinking": False}}


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--prompts", required=True)
    ap.add_argument("--model", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--thinking", dest="thinking", action="store_true",
                    help="let a reasoning model think first (off by default)")
    ap.add_argument("--no-thinking", dest="thinking", action="store_false",
                    help="pass enable_thinking=False to the chat template (the default; kept for old commands)")
    ap.set_defaults(thinking=False)
    ap.add_argument("--tp", type=int, default=1, help="tensor-parallel GPUs")
    ap.add_argument("--max-tokens", type=int, default=1024, help="new tokens per answer")
    return ap.parse_args(argv)


def main(argv: list[str] | None = None) -> None:
    args = parse_args(argv)

    try:
        prompts = read_prompts(Path(args.prompts).read_text(encoding="utf-8"))
        check_model(prompts, args.model)
    except ValueError as err:
        sys.exit(f"batch_generate: {err}")
    except OSError as err:
        sys.exit(f"batch_generate: cannot read the prompts file {args.prompts} ({err.strerror or err})")

    t0 = time.time()
    from vllm import LLM, SamplingParams  # imported here so the checks above run without a GPU

    llm = LLM(model=args.model, max_model_len=max_model_len(prompts), gpu_memory_utilization=0.88, seed=1,
              enforce_eager=True, tensor_parallel_size=args.tp)
    t_load = time.time() - t0
    params = [SamplingParams(**kw) for kw in sampling_args(prompts, args.max_tokens)]
    kwargs = chat_kwargs(args.thinking)
    t1 = time.time()
    outs = llm.chat(chat_messages(prompts), params, **kwargs)
    t_gen = time.time() - t1

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(answer_lines(prompts, [o.outputs[0].text for o in outs], args.model), encoding="utf-8")
    truncated = sum(1 for o in outs if o.outputs[0].finish_reason == "length")
    print(json.dumps({"model": args.model, "prompts": len(prompts), "max_model_len": max_model_len(prompts),
                      "answers_cut_at_max_tokens": truncated, "load_seconds": round(t_load, 1),
                      "generate_seconds": round(t_gen, 1), "out": str(out)}, indent=1))


if __name__ == "__main__":
    main()
