"""Re-record full traces (tools/trace_record.py) from their own trace.json: same state, hook,
pokes, marks, button plan and length. Used after a change in what the recorder captures.
Usage: python tools/rerecord.py NAME [NAME ...]"""
import json, os, subprocess, sys


def args_for(name):
    d = f"build/traces/{name}"
    t = json.load(open(f"{d}/trace.json"))
    a = ["python3", "tools/trace_record.py", name, t["state"], t["plan"], str(len(t["frames"]))]
    if t.get("hook") and t["hook"] != "00:1A43":
        a += ["--hook", t["hook"]]
    if t.get("pokes"):
        a += ["--poke", ",".join(t["pokes"])]
    if os.path.exists(f"{d}/marks.json"):
        at = sorted({m["at"] for m in json.load(open(f"{d}/marks.json"))["marks"]})
        if at:
            a += ["--mark", ",".join(at)]
    return a


if __name__ == "__main__":
    for n in sys.argv[1:]:
        r = subprocess.run(args_for(n), capture_output=True, text=True)
        print(n, (r.stdout.strip().splitlines() or [""])[-1][:100], r.stderr.strip().splitlines()[-1][:200] if r.returncode else "")
