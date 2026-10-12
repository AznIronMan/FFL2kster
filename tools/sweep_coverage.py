"""Aggregate the op coverage written by port/packages/parity/test/sweep.test.ts (build/sweep/cov):
which script control codes (00-4D, table 00:13BE) and field event kinds (00-0E, F0 subcommands,
F1-FF) the replayed sweeps executed in the port, and which never ran.
Usage: python tools/sweep_coverage.py"""
import glob, json
from collections import Counter

text, field = Counter(), Counter()
for f in glob.glob("build/sweep/cov/*.json"):
    d = json.load(open(f))
    for k, v in d["text"].items():
        text[int(k)] += v
    for k, v in d["field"].items():
        field[k] += v
codes = set(range(0x4E))
miss = sorted(codes - set(text))
print(f"text control codes: {len(codes & set(text))}/{len(codes)} ran; never: {' '.join(f'{c:02X}' for c in miss)}")
extra = sorted(set(text) - codes)
if extra:
    print("re-dispatched outside 00-4D:", " ".join(f"{c:02X}" for c in extra))
kinds = [f"{k:02x}" for k in range(0x0F)] + [f"F0 {c:02x}" for c in range(0x19)] + [f"{k:x}" for k in range(0xF1, 0x100)]
print(f"field events: {sum(1 for k in kinds if field[k])}/{len(kinds)} ran; never: {' '.join(k for k in kinds if not field[k])}")
print("most frequent text codes:", " ".join(f"{c:02X}:{n}" for c, n in text.most_common(10)))
