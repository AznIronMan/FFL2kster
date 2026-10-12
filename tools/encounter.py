"""Pace back and forth on the world map until a battle starts (screen mostly changes while
position stays put). Saves the pre-encounter state and the battle-start state.
encounter.py ROM STATE OUTPREFIX [maxsteps] [dir1,dir2]"""
import sys, io
import numpy as np
from pyboy import PyBoy
rom, state, out = sys.argv[1], sys.argv[2], sys.argv[3]
maxsteps = int(sys.argv[4]) if len(sys.argv) > 4 else 400
dirs = sys.argv[5].split(',') if len(sys.argv) > 5 else ['left', 'right']
pb = PyBoy(rom, window='null', sound_emulated=False); pb.set_emulation_speed(0)
pb.load_state(open(state, 'rb'))
pos = lambda: (pb.memory[0xC42C], pb.memory[0xC42D])
def scr():
    pb.tick(1, True); return np.array(pb.screen.ndarray)[:, :, 0].copy()
def snap():
    b = io.BytesIO(); pb.save_state(b); return b.getvalue()
for i in range(maxsteps):
    k = dirs[(i // 3) % len(dirs)]
    pre = snap(); s0 = scr(); p0 = pos()
    pb.button(k, 12); pb.tick(30, False)
    s1 = scr()
    if (s0 != s1).mean() > 0.6 and abs(pos()[0]-p0[0]) + abs(pos()[1]-p0[1]) <= 1:
        open(out + '_pre.state', 'wb').write(pre)
        pb.tick(1, True); pb.screen.image.save(out + '_0.png')
        for j, w in enumerate([60, 120, 240]):
            pb.tick(w, True); pb.screen.image.save(f'{out}_{j+1}.png')
        open(out + '_battle.state', 'wb').write(snap())
        print('encounter after', i, 'steps at', p0, 'dir', k); break
else:
    print('no encounter in', maxsteps)
