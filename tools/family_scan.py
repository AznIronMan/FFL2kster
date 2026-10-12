"""Search for fixed-stride tables whose byte columns increase within 5-member monster families.
Hypothesis basis: monster names at 0x3EEC0 come in families of 5 with rising strength."""
import sys
import numpy as np

d = np.frombuffer(open(sys.argv[1], 'rb').read(), dtype=np.uint8).astype(np.int16)
N = int(sys.argv[2]) if len(sys.argv) > 2 else 150
pairs = [r for r in range(N - 1) if r % 5 != 4]
res = []
for s in range(2, 41):
    span = N * s
    L = len(d) - span
    inc = (d[s:s + L + (N - 1) * s] > d[:L + (N - 1) * s]).astype(np.int16)
    score = np.zeros(L, dtype=np.int16)
    for r in pairs:
        score += inc[r * s:r * s + L]
    top = np.argsort(score)[-3:][::-1]
    for p in top:
        res.append((int(score[p]), s, int(p)))
res.sort(reverse=True)
print(f"pairs tested per column: {len(pairs)}")
for sc, s, p in res[:25]:
    print(f"score {sc:3d}/{len(pairs)}  stride {s:2d}  start {p:#07x} bank {p//0x4000:02X}:{(p%0x4000)+(0x4000 if p>=0x4000 else 0):04X}")
