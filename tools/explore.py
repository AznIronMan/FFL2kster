"""DFS-walk a map in PyBoy until the player position jumps (map transition) or a battle-like
screen change occurs. Position bytes C42C (X) / C42D (Y) are 'probable' (step-diff evidence)."""
import sys, time, io
from pyboy import PyBoy
rom, state, out = sys.argv[1], sys.argv[2], sys.argv[3]
budget = float(sys.argv[4]) if len(sys.argv) > 4 else 150
order = sys.argv[5].split(',') if len(sys.argv) > 5 else ['down', 'left', 'right', 'up']
pb = PyBoy(rom, window='null', sound_emulated=False); pb.set_emulation_speed(0)
pb.load_state(open(state, 'rb'))
pos = lambda: (pb.memory[0xC42C], pb.memory[0xC42D])
D = {'up': (0, -1), 'down': (0, 1), 'left': (-1, 0), 'right': (1, 0)}
REV = {'up': 'down', 'down': 'up', 'left': 'right', 'right': 'left'}
def move(k):
    pb.button(k, 12); pb.tick(30, False); return pos()
t0 = time.time(); seen = {pos()}; path = []; jumps = []
maxj = int(sys.argv[6]) if len(sys.argv) > 6 else 12
import numpy as np
def scr():
    pb.tick(1, True); return np.array(pb.screen.ndarray)[:, :, 0].copy()
def frac(a, b): return float((a != b).mean())
def snap():
    b = io.BytesIO(); pb.save_state(b); return b.getvalue()
def dfs():
    here = pos(); entry = snap()
    for k in order:
        if time.time() - t0 > budget: return 'timeout'
        tgt = (here[0] + D[k][0], here[1] + D[k][1])
        if tgt in seen: continue
        before = snap(); scr0 = scr()
        new = move(k)
        changed = False
        if new == here:
            pb.tick(70, False); new = move(k)
        if new == here:
            pb.tick(90, False)
            changed = frac(scr0, scr()) > 0.5 or pos() != here
            if not changed: continue
            new = pos()
        if changed or abs(new[0]-here[0]) + abs(new[1]-here[1]) > 1:
            pb.tick(60, True); i = len(jumps)
            pb.screen.image.save(f'{out}_jump{i}.png')
            open(f'{out}_jump{i}.state', 'wb').write(snap())
            jumps.append((here, k, new, list(path) + [k]))
            seen.add(tgt)
            pb.load_state(io.BytesIO(before))
            if len(jumps) >= maxj: return 'enough'
            continue
        seen.add(new); path.append(k)
        r = dfs()
        if r: return r
        pb.load_state(io.BytesIO(entry)); path.pop()
    return None
r = dfs()
pb.tick(60, True); pb.screen.image.save(out + '.png')
open(out + '.state', 'wb').write(snap())
print('result', r, 'visited', len(seen), 'secs', round(time.time() - t0))
for j, (h, k, n, p) in enumerate(jumps): print(j, h, k, '->', n, 'steps', len(p))

# ASCII map of visited tiles (ASCII)
xs=[x for x,y in seen]; ys=[y for x,y in seen]
J={h for h,k,n,p in jumps}
for y in range(min(ys)-1,max(ys)+2):
    print(f"{y:3d} "+''.join('J' if (x,y) in J else ('.' if (x,y) in seen else ' ') for x in range(min(xs)-1,max(xs)+2)))
print('x from',min(xs)-1)

import json
json.dump(sorted(seen), open(out + '_seen.json', 'w'))
