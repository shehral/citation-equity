"""E4: answer E1's prompts with Gemini 3.8 Flash (experiments/PLAN_E4.md). Resumable; writes data/answers/gemini.jsonl
({key, answer, model_version, finish_reason, usage}) and a log. Key from $GEMINI_KEY_FILE (never printed).
Usage: python3 -I experiments/e4/run_gemini.py [--limit N] [--sleep S]
"""
import argparse, json, os, sys, time, urllib.request, urllib.error
from pathlib import Path
HERE=Path(__file__).resolve().parent; DATA=HERE/"data"; OUT=DATA/"answers"/"gemini.jsonl"; LOG=DATA/"run.log"
MODEL="gemini-3.8-flash"
def call(key, prompt, temperature):
    body={"contents":[{"parts":[{"text":prompt}]}],
          "generationConfig":{"temperature":temperature,"maxOutputTokens":2048,"thinkingConfig":{"thinkingLevel":"low"}}}
    req=urllib.request.Request(f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent",
        data=json.dumps(body).encode(), headers={"x-goog-api-key":key,"Content-Type":"application/json"})
    with urllib.request.urlopen(req, timeout=240) as r: return json.load(r)
def main():
    ap=argparse.ArgumentParser(); ap.add_argument("--limit",type=int,default=0); ap.add_argument("--sleep",type=float,default=1.0); a=ap.parse_args()
    key=open(os.environ["GEMINI_KEY_FILE"]).read().strip()
    done=set()
    if OUT.exists():
        for l in open(OUT): done.add(json.loads(l)["key"])
    todo=[json.loads(l) for l in open(DATA/"prompts.jsonl")]; todo=[p for p in todo if p["key"] not in done]
    if a.limit: todo=todo[:a.limit]
    log=open(LOG,"a"); log.write(f"{time.strftime('%F %T')} start todo={len(todo)} done={len(done)}\n"); log.flush()
    n=0; backoff=15
    with open(OUT,"a") as out:
        for p in todo:
            for attempt in range(8):
                try:
                    d=call(key,p["prompt"],p.get("temperature",0.5)); break
                except urllib.error.HTTPError as e:
                    code=e.code; msg=e.read()[:200].decode(errors="replace")
                    log.write(f"{time.strftime('%T')} {p['key']} http {code} {msg!r}\n"); log.flush()
                    if code==429: time.sleep(min(backoff*(2**attempt),900)); continue
                    if code in (500,502,503,504): time.sleep(min(backoff*(attempt+1),300)); continue
                    d=None; break
                except Exception as e:
                    log.write(f"{time.strftime('%T')} {p['key']} err {type(e).__name__} {str(e)[:120]}\n"); log.flush(); time.sleep(min(backoff*(attempt+1),300))
            else: d=None
            if not d: log.write(f"{time.strftime('%T')} {p['key']} GIVE UP\n"); log.flush(); continue
            c=(d.get("candidates") or [{}])[0]
            text="".join(part.get("text","") for part in c.get("content",{}).get("parts",[]) if not part.get("thought"))
            out.write(json.dumps({"key":p["key"],"answer":text,"model_version":d.get("modelVersion"),"finish_reason":c.get("finishReason"),
                                  "usage":d.get("usageMetadata",{})})+"\n"); out.flush()
            n+=1
            if n%25==0: log.write(f"{time.strftime('%T')} {n} answered this run\n"); log.flush()
            time.sleep(a.sleep)
    log.write(f"{time.strftime('%F %T')} end answered={n}\n"); log.close(); print("answered",n)
if __name__=="__main__": main()
