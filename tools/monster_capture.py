"""Capture each monster's battle graphic by patching formation 20 (first world-map battle) to
that id and walking into the battle from world.state. Saves the enemy area (top 72 px) as PNG
plus the VRAM at battle start: build/monsters/<id>.png / .npz
usage: monster_capture.py ROM [first last]"""
import os, sys
import numpy as np
sys.path.insert(0, 'src')
from ffl2kster.emu import Emulator
ROM = sys.argv[1]
a, b = (int(sys.argv[2]), int(sys.argv[3])) if len(sys.argv) > 3 else (0, 255)
rom = open(ROM, 'rb').read()
os.makedirs('build/monsters', exist_ok=True)
for mid in range(a, b + 1):
    p = bytearray(rom); p[0x36C70 + 5 * 20] = mid
    tmp = f'/tmp/moncap_{os.getpid()}.gb'; open(tmp, 'wb').write(p)
    with Emulator(tmp) as e:
        e.load_state('build/states/world.state')
        for i in range(40):
            e.hook_hits.clear(); e.press(['up', 'down'][(i // 3) % 2])
            if e.hook_hits: break
        e.pb.tick(240, False)
        img = e.screenshot()
        img.crop((0, 0, 160, 72)).save(f'build/monsters/{mid:03d}.png')
        m = e.pb.memory
        np.savez_compressed(f'build/monsters/{mid:03d}.npz', vram=np.array(m[0x8000:0xA000], np.uint8),
                            block=np.array(m[0xD500:0xD520], np.uint8),
                            regs=np.array([m[0xFF40], m[0xFF47], m[0xFF48], m[0xFF49]], np.uint8))
    os.remove(tmp)
print('done', a, b)
