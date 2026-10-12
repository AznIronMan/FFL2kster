"""Drive PyBoy with a step script, saving screenshots and an optional state.

Usage: emu_drive.py ROM [--load STATE] [--save STATE] [--shots PREFIX] STEPS...
Step syntax: BUTTON[xN][:WAIT]  e.g.  start:60  a x3:20  down:10  wait:300
Buttons: a b start select up down left right. 'wait:N' just ticks N frames.
A screenshot is written after every step that ends with '!' (e.g. a:60!).
"""
import argparse
from pyboy import PyBoy

ap = argparse.ArgumentParser()
ap.add_argument('rom'); ap.add_argument('--load'); ap.add_argument('--save')
ap.add_argument('--shots', default=None); ap.add_argument('--hold', type=int, default=4)
ap.add_argument('steps', nargs='*')
a = ap.parse_intermixed_args()
pb = PyBoy(a.rom, window='null', sound_emulated=False)
pb.set_emulation_speed(0)
if a.load:
    with open(a.load, 'rb') as f: pb.load_state(f)
else:
    pb.tick(240, False)
n = 0
for st in a.steps:
    shot = st.endswith('!'); st = st.rstrip('!')
    key, _, wait = st.partition(':'); wait = int(wait or 20)
    reps = 1
    if 'x' in key and key != 'x':
        key, r = key.split('x'); key = key.strip(); reps = int(r)
    for _ in range(reps):
        if key != 'wait':
            pb.button(key, a.hold); pb.tick(a.hold + 1, False)
        pb.tick(wait, shot)
    if shot and a.shots:
        pb.tick(1, True)
        pb.screen.image.save(f'{a.shots}_{n:02d}_{key}.png'); n += 1
if a.save:
    with open(a.save, 'wb') as f: pb.save_state(f)
print('frames', pb.frame_count)
pb.stop(save=False)
