"""Legend III: controlled byte changes against the monster tables (bank 0B: 4A19 12 bytes/id,
470D 4 bytes/id, 533D 9 bytes/id; names 0E:7533 8 bytes/id).

Each case builds a disposable ROM with the listed bytes changed, replays pre_battle.state (the
prologue battle: Diviner 0x46 x2 in entities 0-1, Sprite 0x4B x2 in entities 2-3), and compares
WRAM C000-DFFF with the unpatched run. A case passes when the enemy entities (D280-D47F) differ
exactly at the predicted offsets with the predicted values and nowhere else; WRAM outside the
entities and the staging slot D680 must not differ. Prints a summary; JSON in ffl3/build/.
usage: python tools/ffl3/controlled_change.py [OUT.json]   (run `python -m ffl3kster make-states`)"""
import json, os, sys, tempfile
sys.path.insert(0, "src")
from ffl3kster.emu import battle_from_state, ENTITY0, ENTITY_SIZE, STAGING
from ffl3kster.rom import bank_to_file
from ffl3kster.text import encode

ROM = "ffl3/input/original.gb"
ST = "ffl3/build/states/pre_battle.state"
OUT = sys.argv[1] if len(sys.argv) > 1 else "ffl3/build/controlled_change.json"
orig = open(ROM, "rb").read()
REC, CLS, ABL, NAM = (bank_to_file(0x0B, 0x4A19), bank_to_file(0x0B, 0x470D),
                      bank_to_file(0x0B, 0x533D), bank_to_file(0x0E, 0x7533))
DIV, SPR = 0x46, 0x4B
GROUP = {DIV: (0, 1), SPR: (2, 3)}


def rec(i, b): return REC + 12 * i + b
def cls(i, b): return CLS + 4 * i + b
def abl(i, b): return ABL + 9 * i + b
def tbl(addr, n): return list(orig[bank_to_file(0x0B, addr):bank_to_file(0x0B, addr) + n])


def ex(mid, **offs):
    """Expected entity bytes for the group of `mid`: {offset: value}."""
    return {mid: {int(k[1:], 16): v for k, v in offs.items()}}


CASES = [
    # label, patches [(file offset, value)], expected {group id: {entity offset: value}},
    # other WRAM expected to change {address: value} (None: none)
    ("Sprite b1 2D->7F (HP low byte)", [(rec(SPR, 1), 0x7F)], ex(SPR, o10=0x7F, o12=0x7F), None),
    ("Sprite b2 C0->C3 (HP high nibble -> 0x32D)", [(rec(SPR, 2), 0xC3)], ex(SPR, o11=3, o13=3), {0xCC73: 0xC3}),
    ("Sprite b2 C0->10 (469D index 12->1)", [(rec(SPR, 2), 0x10)],
     {SPR: dict(zip(range(0x59, 0x5D), tbl(0x469D + 4, 4)))}, {0xCC73: 0x10}),
    ("Sprite b3 31->55 (value 2 low byte)", [(rec(SPR, 3), 0x55)], ex(SPR, o14=0x55, o16=0x55), None),
    ("Sprite b4 F0->F2 (value 2 high nibble)", [(rec(SPR, 4), 0xF2)], ex(SPR, o15=2, o17=2), {0xCC74: 0xF2}),
    ("Sprite b4 F0->30 (46DD index 15->3)", [(rec(SPR, 4), 0x30)],
     {SPR: dict(zip(range(0x5D, 0x60), tbl(0x46DD + 9, 3)))}, {0xCC74: 0x30}),
    ("Sprite b5 03->11", [(rec(SPR, 5), 0x11)], ex(SPR, o18=0x11, o70=0x11), None),
    ("Sprite b6 03->22", [(rec(SPR, 6), 0x22)], ex(SPR, o19=0x22, o71=0x22), None),
    ("Sprite b7 07->33", [(rec(SPR, 7), 0x33)], ex(SPR, o1A=0x33, o72=0x33, o57=(0x33 + 1) // 2 + 0x4B), None),
    ("Sprite b8 09->44", [(rec(SPR, 8), 0x44)], ex(SPR, o1B=0x44, o73=0x44), None),
    # b9-11 reach +3D..+3F only for kind 4 (b0&7): otherwise 0B:7422 clears and recomputes them
    ("Sprite b9-11 changed, kind 3 (cleared by 7422)", [(rec(SPR, 9), 0x5A), (rec(SPR, 10), 0x6B),
                                                         (rec(SPR, 11), 0x7C)], {}, None),
    ("Sprite b0 03->04 (kind 4: b9-11 kept)", [(rec(SPR, 0), 0x04)], ex(SPR, o0D=4, o3D=2, o3E=9, o3F=5), None),
    ("Sprite kind 4 + b9-11 -> 5A 6B 7C (last byte)", [(rec(SPR, 0), 0x04), (rec(SPR, 9), 0x5A),
                                                       (rec(SPR, 10), 0x6B), (rec(SPR, 11), 0x7C)],
     ex(SPR, o0D=4, o3D=0x5A, o3E=0x6B, o3F=0x7C), None),
    ("Sprite b0 03->05 (first byte)", [(rec(SPR, 0), 0x05)], ex(SPR, o0D=0x05), None),
    ("Diviner b0 03->06 (first byte)", [(rec(DIV, 0), 0x06)], ex(DIV, o0D=0x06), None),
    ("Diviner b1 2D->7F (HP)", [(rec(DIV, 1), 0x7F)], ex(DIV, o10=0x7F, o12=0x7F), None),
    ("Diviner kind 4 + b11 06->66 (last byte)", [(rec(DIV, 0), 0x04), (rec(DIV, 11), 0x66)],
     ex(DIV, o0D=4, o3D=2, o3E=6, o3F=0x66), None),
    ("Sprite class b0 C1->C5 (+03)", [(cls(SPR, 0), 0xC5)], ex(SPR, o03=0x05, o57=(7 + 5) // 2 + 0x4B),
     {0xC996: 3, 0xC9D4: 12, 0xC9ED: 3}),     # battle values derived from +03 (meaning not known)
    ("Sprite class b0 C1->41 (+0F/+68)", [(cls(SPR, 0), 0x41)], ex(SPR, o0F=1, o68=1), None),
    ("Sprite class b1-3 -> 11 22 33", [(cls(SPR, 1), 0x11), (cls(SPR, 2), 0x22), (cls(SPR, 3), 0x33)],
     ex(SPR, o65=0x11, o66=0x22, o67=0x33), None),
    ("Sprite ability 1 1A->1B", [(abl(SPR, 1), 0x1B)], ex(SPR, o48=0x1B), None),
    ("Sprite name -> 'Spritz'", [(NAM + 8 * SPR + i, b) for i, b in enumerate(encode("Spritz", 8))],
     ex(SPR, o0A=encode("z")[0]), None),
] + [
    (f"CONTROL {n:#04x} all 12+4+9 bytes 0x77", [(rec(n, b), 0x77) for b in range(12)] +
     [(cls(n, b), 0x77) for b in range(4)] + [(abl(n, b), 0x77) for b in range(9)], {}, None)
    for n in (0x45, 0x47, 0x4A, 0x4C)
]
# RAM-poke cases: the loader's id (CC70) for group 1 replaced at 0B:4526 (Diviner's slots).
POKES = [
    ("poke group 1 id -> 0xBA (Chaos, below the boss line)", 0xBA),
    ("poke group 1 id -> 0xBB (Maitreya, boss: HP x16)", 0xBB),
]


def run(patches, override=None):
    rom = bytearray(orig)
    for o, v in patches:
        rom[o] = v
    fd, path = tempfile.mkstemp(suffix=".gb")
    os.write(fd, bytes(rom)); os.close(fd)
    try:
        return battle_from_state(path, ST, override)
    finally:
        os.remove(path)


def check(base, r, expect, wram_ok=None):
    problems, ent_lo, ent_hi = [], ENTITY0 - 0xC000, ENTITY0 - 0xC000 + 4 * ENTITY_SIZE
    for k in range(4):
        mid = base.entity(k).monster_id
        want = expect.get(mid, {})
        a, b = base.entity(k).raw, r.entity(k).raw
        for o in range(ENTITY_SIZE):
            if o in want and b[o] != want[o]:
                problems.append(f"e{k}+{o:02X}={b[o]:02X} want {want[o]:02X}")
            elif o not in want and a[o] != b[o]:
                problems.append(f"e{k}+{o:02X} {a[o]:02X}->{b[o]:02X} unexpected")
    stg = STAGING - 0xC000
    wram_ok = wram_ok or {}
    for a, v in wram_ok.items():
        if r.wram[a - 0xC000] != v:
            problems.append(f"{a:04X}={r.wram[a - 0xC000]:02X} want {v:02X}")
    other = [f"{0xC000 + i:04X}" for i in range(0x2000)
             if base.wram[i] != r.wram[i] and not ent_lo <= i < ent_hi and not stg <= i < stg + ENTITY_SIZE
             and 0xC000 + i not in wram_ok]
    return problems, other


base = run([])
assert base.menu and base.loads == 2 and [e.monster_id for e in base.enemies] == [DIV, DIV, SPR, SPR], base
res = {"baseline": [e.raw.hex(" ") for e in base.enemies], "cases": []}
ok_all = True
for label, patches, expect, wram_ok in CASES:
    r = run(patches)
    probs, other = check(base, r, expect, wram_ok)
    ok = r.menu and not probs and not other
    ok_all &= ok
    res["cases"].append({"label": label, "ok": ok, "patches": [(f"{o:#07x}", v) for o, v in patches],
                         "problems": probs, "other_wram": other})
    print(f"{'PASS' if ok else 'FAIL'} {label}" + ("" if ok else f": {probs[:8]} other={other[:8]}"))
for label, mid in POKES:
    r = run([], {0: mid})
    e = r.entity(0)
    recb = orig[rec(mid, 0):rec(mid, 0) + 12]
    hp = recb[1] | (recb[2] & 0x0F) << 8
    v2 = recb[3] | (recb[4] & 0x0F) << 8
    mul = 16 if mid >= 0xBB else 1
    # +14 (current value 2) is spent at battle start by these two (20 per use), so the max (+16)
    # is compared; +3D..+3F are kept because both are kind 4.
    want = {"id": mid, "hp": hp * mul, "max_hp": hp * mul, "v2_max": v2 * mul, "kind": recb[0] & 7,
            "stats": list(recb[5:9]), "b9_11": list(recb[9:12]),
            "name_bytes": orig[NAM + 8 * mid:NAM + 8 * mid + 8].hex()}
    got = {"id": e.monster_id, "hp": e.hp, "max_hp": e.max_hp, "v2_max": e.raw[0x16] | e.raw[0x17] << 8,
           "kind": e.raw[0x0D], "stats": list(e.raw[0x18:0x1C]), "b9_11": list(e.raw[0x3D:0x40]),
           "name_bytes": e.raw[5:13].hex()}
    ok = want == got
    ok_all &= ok
    res["cases"].append({"label": label, "ok": ok, "want": want, "got": got})
    print(f"{'PASS' if ok else 'FAIL'} {label}: {got} (record HP {hp}, x{mul})")
res["all_ok"] = ok_all
os.makedirs(os.path.dirname(OUT), exist_ok=True)
open(OUT, "w").write(json.dumps(res, indent=1))
print("ALL OK" if ok_all else "SOME FAILED")
