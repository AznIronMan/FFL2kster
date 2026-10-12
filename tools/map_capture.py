"""Capture every map by repurposing a first-town door as a teleporter.

The door at town (23,34) uses destination record 07:4054. For each unique map header, a
disposable ROM gets that record replaced by a representative destination record; walking
through the door loads the target map. Captured per map (build/maps/<hdr>.npz): header
fields C44E-C45A, 64x64 map buffer D000-DFFF, VRAM 8000-9FFF, OAM, LCDC/scroll, position,
and a screenshot PNG.
usage: map_capture.py ROM [first_index last_index]"""
import io, json, os, sys
import numpy as np
sys.path.insert(0, 'src')
from ffl2kster.emu import Emulator
from ffl2kster.states import _goto

ROM = sys.argv[1]
rom = open(ROM, 'rb').read()
DOOR_REC = 0x1C054
os.makedirs('build/maps', exist_ok=True)
recs = []
for i in range(511):
    o = 0x1C000 + 4 * i
    recs.append((i, rom[o] | rom[o + 1] << 8, rom[o:o + 4]))
by_hdr = {}
for i, p, raw in recs:
    by_hdr.setdefault(p, (i, raw))
hdrs = sorted(by_hdr)
if not os.path.exists('build/maps/door.state'):
    seen = [tuple(p) for p in json.load(open('build/shots/exp6_seen.json'))]
    with Emulator(ROM) as e:
        e.load_state('build/states/first_town.state'); _goto(e, seen, (23, 34))
        e.save_state('build/maps/door.state')
a, b = (int(sys.argv[2]), int(sys.argv[3])) if len(sys.argv) > 3 else (0, len(hdrs) - 1)
index = json.load(open('build/maps/index.json')) if os.path.exists('build/maps/index.json') else {}
for k in range(a, min(b, len(hdrs) - 1) + 1):
    h = hdrs[k]
    ri, raw = by_hdr[h]
    p = bytearray(rom); p[DOOR_REC:DOOR_REC + 4] = raw
    tmp = f'/tmp/mapcap_{os.getpid()}.gb'; open(tmp, 'wb').write(p)
    with Emulator(tmp) as e:
        e.load_state('build/maps/door.state'); pb = e.pb; m = pb.memory
        e.press('up'); pb.tick(180, False)
        loaded = (m[0xC44B] | m[0xC44C] << 8) == h
        np.savez_compressed(f'build/maps/{h:04x}.npz',
                            header=np.array(m[0xC44E:0xC45B], dtype=np.uint8),
                            map=np.array(m[0xD000:0xE000], dtype=np.uint8),
                            vram=np.array(m[0x8000:0xA000], dtype=np.uint8),
                            oam=np.array(m[0xFE00:0xFEA0], dtype=np.uint8),
                            regs=np.array([m[0xFF40], m[0xFF42], m[0xFF43], m[0xFF4A], m[0xFF4B], m[0xFF47], m[0xFF48]], dtype=np.uint8),
                            wram=np.array(m[0xC000:0xD000], dtype=np.uint8))
        e.screenshot().save(f'build/maps/{h:04x}.png')
        index[f'{h:04x}'] = {"record": ri, "record_bytes": raw.hex(), "loaded": loaded,
                             "position": e.position(), "header_fields": bytes(m[0xC44E:0xC45B]).hex()}
    os.remove(tmp)
json.dump(index, open('build/maps/index.json', 'w'), indent=1)
print('captured', len(index), 'of', len(hdrs), 'loaded ok:', sum(v['loaded'] for v in index.values()))
