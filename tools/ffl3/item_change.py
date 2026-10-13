"""Legend III: controlled byte changes against the item tables (bank 09: weapons 55C4 7 x 72,
monster skills 57BC 6 x 110) in the prologue battle.

Load cases: a hook on 09:5D82 (after the record loader 09:5D87 has copied 7 bytes into CEDB) logs
(CE25 mode, CE26 id, CEDB..CEE1) for every load while A is pressed 60 times from battle.state.
A case passes when the first load of the target id differs exactly at the predicted CEDB offsets
and the first load of every other id is unchanged. Damage cases compare the HP of the four enemies
(D290 + 0x80k) and the party (D010 + 0x80k) after each of 95 presses.
usage: python tools/ffl3/item_change.py [OUT.json]   (run `python -m ffl3kster make-states`)"""
import json, os, sys, tempfile
sys.path.insert(0, "src")
from ffl3kster.emu import Emulator
from ffl3kster.rom import bank_to_file

ROM = "ffl3/input/original.gb"
ST = "ffl3/build/states/battle.state"
OUT = sys.argv[1] if len(sys.argv) > 1 else "ffl3/build/item_change.json"
orig = open(ROM, "rb").read()
WPN, SKL = bank_to_file(9, 0x55C4), bank_to_file(9, 0x57BC)
def w(i, b): return WPN + 7 * (i - 0x30) + b
def s(i, b): return SKL + 6 * i + b
LONG, BATTLE, BRONZE, DIVE, KICK = 0x30, 0x4B, 0x51, 0x1A, 0x13

LOADS = [
    # label, patches, {(mode, id): {CEDB offset: value}}
    ("Long b0 90->91 (first byte)", [(w(LONG, 0), 0x91)], {(0, LONG): {0: 0x91}}),
    ("Long b6 01->7F (last byte)", [(w(LONG, 6), 0x7F)], {(0, LONG): {6: 0x7F}}),
    ("Battle 4B b0 90->91", [(w(BATTLE, 0), 0x91)], {(0, BATTLE): {0: 0x91}}),
    ("Battle 4B b6 01->7F", [(w(BATTLE, 6), 0x7F)], {(0, BATTLE): {6: 0x7F}}),
    ("Bronze 51 b3 8D->8E", [(w(BRONZE, 3), 0x8E)], {(0, BRONZE): {3: 0x8E}}),
    ("CONTROL weapons 31 4A 4C 50 52 all 0x77",
     [(w(i, b), 0x77) for i in (0x31, 0x4A, 0x4C, 0x50, 0x52) for b in range(7)], {}),
    ("Dive skill b0 00->01 (first byte)", [(s(DIVE, 0), 0x01)], {(1, DIVE): {0: 0x01}}),
    ("Dive skill b5 81->82 (last byte)", [(s(DIVE, 5), 0x82)], {(1, DIVE): {5: 0x82}}),
    ("Kick skill b0 00->01", [(s(KICK, 0), 0x01)], {(1, KICK): {0: 0x01}}),
    ("Kick skill b5 81->82", [(s(KICK, 5), 0x82)], {(1, KICK): {5: 0x82}}),
    # the loader always copies 7 bytes: the 7th of a 6-byte record is the next record's first byte
    ("skill 1B b0 -> 0x77 (seen as Dive's 7th byte)", [(s(0x1B, 0), 0x77)], {(1, DIVE): {6: 0x77}}),
    ("skill 14 b0 -> 0x77 (seen as Kick's 7th byte)", [(s(0x14, 0), 0x77)], {(1, KICK): {6: 0x77}}),
    ("CONTROL skills 12 19 all 0x77, 14 1B b1-b5 0x77",
     [(s(i, b), 0x77) for i in (0x12, 0x19) for b in range(6)] +
     [(s(i, b), 0x77) for i in (0x14, 0x1B) for b in range(1, 6)], {}),
]
DAMAGE = [
    # label, patches, {press: (enemy HP, party HP)} expected in the patched trace
    ("Long power 0A->01 (Arthur, press 70)", [(w(LONG, 1), 0x01)], {70: ([0, 2, 45, 45], [50, 40, 26, 130])}),
    ("Battle 4B power 07->60 (Curtis, press 45)", [(w(BATTLE, 1), 0x60)], {45: ([0, 0, 45, 45], [50, 40, 26, 130])}),
    ("Bronze 51 power 06->60 (Gloria, press 54)", [(w(BRONZE, 1), 0x60)], {54: ([0, 0, 45, 45], [50, 40, 26, 130])}),
    ("Dive skill power 08->20 (Sprite on Gloria, press 28)", [(s(DIVE, 1), 0x20)], {28: ([0, 45, 45, 45], [50, 40, 0, 130])}),
]
BASE_DAMAGE = {17: [0, 45, 45, 45], 28: [0, 45, 45, 45], 45: [0, 31, 45, 45], 54: [0, 20, 45, 45], 70: [0, 0, 45, 45]}


def patched(patches):
    rom = bytearray(orig)
    for o, v in patches:
        rom[o] = v
    fd, path = tempfile.mkstemp(suffix=".gb")
    os.write(fd, bytes(rom)); os.close(fd)
    return path


def play(patches, presses):
    path = patched(patches)
    try:
        with Emulator(path) as e:
            e.load_state(ST)
            pb, m = e.pb, e.pb.memory
            loads = {}
            def cb(_):
                loads.setdefault((m[0xCE25], m[0xCE26]), bytes(m[0xCEDB:0xCEE2]))
            pb.hook_register(9, 0x5D82, cb, None)
            hp = []
            for _ in range(presses):
                e.press("a", wait=40)
                hp.append(([m[0xD290 + 0x80 * k] | m[0xD291 + 0x80 * k] << 8 for k in range(4)],
                           [m[0xD010 + 0x80 * k] | m[0xD011 + 0x80 * k] << 8 for k in range(4)]))
            return loads, hp
    finally:
        os.remove(path)


base_loads, base_hp = play([], 95)
assert set(base_loads) == {(0, LONG), (0, BATTLE), (0, BRONZE), (0, 0x46), (1, DIVE), (1, KICK)}, base_loads
assert all(base_hp[p][0] == v for p, v in BASE_DAMAGE.items()), base_hp
res = {"baseline": {f"{k[0]}:{k[1]:02X}": v.hex(" ") for k, v in base_loads.items()}, "cases": []}
ok_all = True
for label, patches, expect in LOADS:
    loads, _ = play(patches, 60)
    probs = []
    if set(loads) != set(base_loads):
        probs.append(f"load set {sorted(loads)}")
    for key, a in base_loads.items():
        b = loads.get(key, b"")
        want = expect.get(key, {})
        for i in range(7):
            if i in want and (len(b) <= i or b[i] != want[i]):
                probs.append(f"{key} CEDB+{i} want {want[i]:02X}")
            elif i not in want and len(b) > i and a[i] != b[i]:
                probs.append(f"{key} CEDB+{i} {a[i]:02X}->{b[i]:02X} unexpected")
    ok = not probs
    ok_all &= ok
    res["cases"].append({"label": label, "ok": ok, "problems": probs})
    print(f"{'PASS' if ok else 'FAIL'} {label}" + ("" if ok else f": {probs[:6]}"))
for label, patches, expect in DAMAGE:
    _, hp = play(patches, 95)
    probs = [f"press {p}: {hp[p]} want {v}" for p, v in expect.items() if hp[p] != v]
    first = min(expect)
    if hp[:first] != base_hp[:first]:
        probs.append("differs before the predicted press")
    ok = not probs
    ok_all &= ok
    res["cases"].append({"label": label, "ok": ok, "problems": probs,
                         "at": {p: hp[p] for p in expect}, "baseline_at": {p: base_hp[p] for p in expect}})
    print(f"{'PASS' if ok else 'FAIL'} {label}: {[hp[p] for p in expect]} (baseline {[base_hp[p] for p in expect]})")
res["all_ok"] = ok_all
os.makedirs(os.path.dirname(OUT), exist_ok=True)
open(OUT, "w").write(json.dumps(res, indent=1))
print("ALL OK" if ok_all else "SOME FAILED")
