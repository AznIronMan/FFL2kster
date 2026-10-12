"""Navigate to a target tile over a known passable set, waiting out NPCs.
nav.py ROM STATE SEEN.json TX TY OUTPREFIX [extra steps like right:3]"""
import sys, json, io
from collections import deque
from pyboy import PyBoy
rom, state, seenf, tx, ty, out = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4]), int(sys.argv[5]), sys.argv[6]
extra = sys.argv[7:]
seen = {tuple(p) for p in json.load(open(seenf))}
pb = PyBoy(rom, window='null', sound_emulated=False); pb.set_emulation_speed(0)
pb.load_state(open(state, 'rb'))
pos = lambda: (pb.memory[0xC42C], pb.memory[0xC42D])
D = {'up': (0, -1), 'down': (0, 1), 'left': (-1, 0), 'right': (1, 0)}
def bfs(a, b):
    q = deque([a]); par = {a: None}
    while q:
        c = q.popleft()
        if c == b: break
        for k, (dx, dy) in D.items():
            n = (c[0] + dx, c[1] + dy)
            if n in seen and n not in par: par[n] = (c, k); q.append(n)
    if b not in par: return None
    path = []; c = b
    while par[c]: c, k = par[c][0], par[c][1]; path.append(k)
    return path[::-1]
for attempt in range(40):
    if pos() == (tx, ty): break
    path = bfs(pos(), (tx, ty))
    if path is None: print('no path from', pos()); break
    for k in path:
        p = pos(); pb.button(k, 12); pb.tick(30, False)
        if pos() == p: pb.tick(60, False); break
print('at', pos())
for i, st in enumerate(extra):
    k, _, n = st.partition(':')
    for _ in range(int(n or 1)):
        pb.button(k, 12); pb.tick(30, False)
    pb.tick(90, True); pb.screen.image.save(f'{out}_x{i}.png'); print(st, '->', pos())
pb.tick(1, True); pb.screen.image.save(out + '.png')
open(out + '.state', 'wb').write((lambda b: (pb.save_state(b), b.getvalue())[1])(io.BytesIO()))
