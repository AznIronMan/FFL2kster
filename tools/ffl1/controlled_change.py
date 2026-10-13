"""Legend I: controlled byte changes against the monster table (06:6AE8, 9 bytes x 200) and the
area encounter table (06:6868, 5 bytes per area).

Each case builds a disposable ROM with the listed bytes changed, replays the same pre-battle save
state, and diffs WRAM C000-DFFF against the unpatched run. Prints JSON (kept in ffl1/build/).
usage: python tools/ffl1/controlled_change.py [OUT.json]
       (run `python -m ffl1kster make-states` first)"""
import json, os, sys, tempfile
sys.path.insert(0, "src")
from ffl1kster.emu import battle_from_state
from ffl1kster.rom import bank_to_file

ROM = "ffl1/input/original.gb"
ST = "ffl1/build/states/pre_battle.state"
OUT = sys.argv[1] if len(sys.argv) > 1 else "ffl1/build/controlled_change.json"
orig = open(ROM, "rb").read()
MON = bank_to_file(6, 0x6AE8)
AREA = bank_to_file(6, 0x6868)
direction = json.load(open("ffl1/build/states/states.json"))["pre_battle"]["direction"]


def mon(i, f): return MON + 9 * i + f
def area(i, f): return AREA + 5 * i + f


ASI, SKE = 155, 96
SKE_SWAP = [(area(19, 2), SKE)]  # area 19 group 3: ASIGARU -> SKELETON (formation 2 = one of group 3)
CASES = [
    # label, [(offset, value)], expectation (for the reader; the diff is the evidence)
    ("ASIGARU b2 05->0x11", [(mon(ASI, 2), 0x11)], "slot D087 = 0x11 only"),
    ("ASIGARU b3 06->0x22", [(mon(ASI, 3), 0x22)], "slot D088 = 0x22 only"),
    ("ASIGARU b4 08->0x33", [(mon(ASI, 4), 0x33)], "slot D089 = 0x33 only"),
    ("ASIGARU b5 03->0x44", [(mon(ASI, 5), 0x44)], "slot D08A = 0x44 only"),
    ("ASIGARU b1 00->03 (HP class 82)", [(mon(ASI, 1), 0x03)], "D083..D086 = 82 - rand(0..5)"),
    ("ASIGARU b1 00->15 (HP class 795)", [(mon(ASI, 1), 0x15)], "D083..D086 = 795 - rand(0..49)"),
    ("ASIGARU b0 00->08 (ability count 1->2)", [(mon(ASI, 0), 0x08)], "D08F/D097 = 2nd list entry"),
    ("ASIGARU b6 A1->11", [(mon(ASI, 6), 0x11)], "D08D changes (hi nibble index)"),
    ("ASIGARU b7/b8 ptr 7625->7321 (FLY's list)", [(mon(ASI, 7), 0x21), (mon(ASI, 8), 0x73)], "abilities = FLY's"),
    ("CONTROL GANG (154) all 9 bytes 0x77", [(mon(154, f), 0x77) for f in range(9)], "no change"),
    ("CONTROL SAMURAI (156) all 9 bytes 0x77", [(mon(156, f), 0x77) for f in range(9)], "no change"),
    ("AREA 19 group 3 id 9B->60 (SKELETON)", SKE_SWAP, "slot D09F = 0x60, SKELETON record"),
    ("SKELETON b2 via swap", SKE_SWAP + [(mon(SKE, 2), 0x55)], "D087 = 0x55"),
    ("SKELETON b1 via swap (class 5 = 126)", SKE_SWAP + [(mon(SKE, 1), 0x05)], "HP 126 - rand"),
    ("CONTROL via swap: RED BONE (97) all 0x77", SKE_SWAP + [(mon(97, f), 0x77) for f in range(9)], "same as swap only"),
    ("CONTROL via swap: WRESTLER?? no: CREATOR..: LICH? -> BEHOLDER (95) all 0x77", SKE_SWAP + [(mon(95, f), 0x77) for f in range(9)], "same as swap only"),
]


def run(patches):
    rom = bytearray(orig)
    for o, v in patches:
        rom[o] = v
    fd, path = tempfile.mkstemp(suffix=".gb")
    os.write(fd, bytes(rom)); os.close(fd)
    try:
        return battle_from_state(path, ST, direction)
    finally:
        os.remove(path)


base = run([])
swap_base = None
results = {"baseline": {"enemies": [(e.monster_id, e.hp, e.max_hp, e.stats, e.abilities) for e in base.enemies],
                        "slot4": base.slots[0x80:0xA0].hex(" ")}, "cases": []}
for label, patches, expect in CASES:
    r = run(patches)
    ref = base
    if patches[0] == SKE_SWAP[0] and len(patches) > 1:
        swap_base = swap_base or run(SKE_SWAP)
        ref = swap_base
    diff = [(f"{0xC000 + i:04X}", ref.wram[i], r.wram[i]) for i in range(0x2000) if ref.wram[i] != r.wram[i]]
    results["cases"].append({"label": label, "expect": expect, "loaded": r.loaded,
                             "patches": [(f"{o:#07x}", v) for o, v in patches],
                             "enemies": [(e.monster_id, e.hp, e.max_hp, e.stats, e.abilities) for e in r.enemies],
                             "wram_diff_vs": "swap" if ref is swap_base else "baseline", "wram_diff": diff})
open(OUT, "w").write(json.dumps(results, indent=1))
print(json.dumps(results["baseline"]))
for c in results["cases"]:
    print(f"- {c['label']}: loaded={c['loaded']} enemies={c['enemies']}")
    print(f"    diff ({c['wram_diff_vs']}): {c['wram_diff'][:24]}{' ...' if len(c['wram_diff']) > 24 else ''}")
