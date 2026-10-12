"""Controlled single-byte corruption tests for the enemy table.

For each (record, field, new value) build a disposable ROM with exactly one byte changed,
replay the same pre-battle save state, and diff all of WRAM (C000-DFFF) against the
unpatched run. Output is JSON for docs/FINDINGS.md.
usage: controlled_change.py ROM OUT.json   (run `python -m ffl2kster make-states` first)"""
import json, sys, tempfile, os
sys.path.insert(0, 'src')
from ffl2kster.emu import battle_from_state

ROM, OUT = sys.argv[1], sys.argv[2]
orig = open(ROM, 'rb').read()
BASE = 0x36F80
MANIFEST = json.load(open('build/states/states.json'))
CASES = [
    # (state, enemy id, record id, field offset, new value, label)
    ('build/states/pre_battle.state', 120, 120, 2, 0x63, 'Jaguar HP lo 45->99'),
    ('build/states/pre_battle.state', 120, 120, 3, 0x01, 'Jaguar HP hi 0->1 (HP 301)'),
    ('build/states/pre_battle.state', 120, 120, 4, 0x20, 'Jaguar stat0 6->32'),
    ('build/states/pre_battle.state', 120, 120, 5, 0x21, 'Jaguar stat1 5->33'),
    ('build/states/pre_battle.state', 120, 120, 6, 0x22, 'Jaguar stat2 3->34'),
    ('build/states/pre_battle.state', 120, 120, 7, 0x23, 'Jaguar stat3 5->35'),
    ('build/states/pre_battle.state', 120, 120, 0, 0x21, 'Jaguar byte0 0x20->0x21 (ability count 1->2)'),
    ('build/states/pre_battle.state', 120, 120, 1, 0x05, 'Jaguar byte1 0x00->0x05 (unknown)'),
    ('build/states/pre_battle.state', 120, 120, 8, 0x80, 'Jaguar ability ptr lo byte -> 0x80'),
    ('build/states/pre_battle.state', 120, 121, 2, 0x63, 'CONTROL: SabreCat HP lo (neighbour record)'),
    ('build/states/pre_battle.state', 120, 119, 9, 0x7A, 'CONTROL: Nike ptr hi (preceding record last byte)'),
    ('build/states/pre_battle_id45.state', 45, 45, 2, 0x63, 'Spider HP lo 45->99'),
    ('build/states/pre_battle_id45.state', 45, 45, 4, 0x30, 'Spider stat0 5->48'),
    ('build/states/pre_battle_id45.state', 45, 45, 7, 0x31, 'Spider stat3 5->49'),
    ('build/states/pre_battle_id45.state', 45, 46, 2, 0x63, 'CONTROL: P-Spider HP lo (neighbour record)'),
]
baselines = {}
results = []
tmpdir = tempfile.mkdtemp()
for state, eid, rid, fo, val, label in CASES:
    direction = MANIFEST[os.path.basename(state)[:-6]]['direction']
    if state not in baselines:
        baselines[state] = battle_from_state(ROM, state, direction)
    b = baselines[state]
    off = BASE + 10 * rid + fo
    rom = bytearray(orig); old = rom[off]; rom[off] = val
    p = os.path.join(tmpdir, 'test.gb'); open(p, 'wb').write(rom)
    s = battle_from_state(p, state, direction)
    diffs = [(0xC000 + i, b.wram[i], s.wram[i]) for i in range(len(b.wram)) if b.wram[i] != s.wram[i]]
    res = {'label': label, 'record': rid, 'field': fo, 'file_offset': f'{off:#07x}',
           'old': old, 'new': val, 'battle_loaded': s.loaded, 'enemy_id': s.enemy_id,
           'wram_diffs': [(f'{a:04X}', f'{x:02X}', f'{y:02X}') for a, x, y in diffs]}
    results.append(res)
    short = ', '.join(f'{a}:{x}->{y}' for a, x, y in res['wram_diffs'][:8])
    more = '' if len(diffs) <= 8 else f' (+{len(diffs)-8} more)'
    print(f'{label:52s} {off:#07x} diffs={len(diffs):3d} {short}{more}')
json.dump(results, open(OUT, 'w'), indent=1)
