"""Legend I: controlled changes against the item table (06:7700, 8 x 256) and the name entries'
default-uses byte. Three probes, all from save states made by `python -m ffl1kster make-states`:
- fight: pre-battle state, step into the 1x ASIGARU battle, press A; trace (enemy HP, hero HP);
- hero: party-creation state, create HUMAN M "A"; the party record CC00..CC1F;
- use: first-town state, put an item in hero slot 3 (CC13/CC14), use it from Abil; record diff.
usage: python tools/ffl1/item_change.py"""
import os, sys, tempfile
sys.path.insert(0, "src")
from ffl1kster.emu import Emulator
from ffl1kster.schema import items as I

ROM = "ffl1/input/original.gb"
ST = "ffl1/build/states/"
orig = open(ROM, "rb").read()


def rom_with(patches):
    r = bytearray(orig)
    for o, v in patches:
        r[o] = v
    fd, p = tempfile.mkstemp(suffix=".gb")
    os.write(fd, bytes(r)); os.close(fd)
    return p


def fight(patches, presses=30):
    p = rom_with(patches)
    try:
        with Emulator(p) as e:
            e.load_state(ST + "pre_battle.state")
            e.step_into_battle("right")
            m = e.pb.memory
            slot = bytes(m[0xD080:0xD0A0])
            tr = []
            for _ in range(presses):
                e.press("a", wait=40)
                t = (m[0xD083] | m[0xD084] << 8, m[0xD003] | m[0xD004] << 8)
                if not tr or tr[-1] != t:
                    tr.append(t)
            return slot, tr
    finally:
        os.remove(p)


def hero(patches):
    p = rom_with(patches)
    try:
        with Emulator(p) as e:
            e.load_state(ST + "party_creation.state")
            for k, w in (("a", 120), ("a", 60), ("start", 120)):
                e.press(k, wait=w)
            return bytes(e.pb.memory[0xCC00:0xCC20])
    finally:
        os.remove(p)


def use(patches, item):
    p = rom_with(patches)
    try:
        with Emulator(p) as e:
            e.load_state(ST + "first_town.state")
            m = e.pb.memory
            m[0xCC13], m[0xCC14] = item, 1
            b = bytes(m[0xCC00:0xCC20])
            for k in ("start", "a", "a", "down", "down", "a", "a", "a"):
                e.press(k, wait=60)
            return b, bytes(m[0xCC00:0xCC20])
    finally:
        os.remove(p)


def f(iid, field):
    return I.field_offset(iid, I.FIELD_BY_NAME[field])


if __name__ == "__main__":
    KAT, LONG, AXE, STRONG = 0x24, 0x21, 0x22, 0x0C
    for label, pt in [("baseline", []), ("KATANA uses 50->9", [(f(KAT, "uses"), 9)]),
                      ("CONTROL KATANA default_uses 50->9", [(f(KAT, "default_uses"), 9)]),
                      ("LONG power 3->30", [(f(LONG, "power"), 30)]),
                      ("CONTROL AXE power 4->40", [(f(AXE, "power"), 40)]),
                      ("KATANA power 6->30", [(f(KAT, "power"), 30)]),
                      ("KATANA handler 6->3", [(f(KAT, "handler"), 3)])]:
        slot, tr = fight(pt)
        print(f"fight  {label:36s} enemy uses(D096)={slot[0x16]:3d}  (enemyHP, heroHP): {tr}")
    for label, pt in [("baseline", []), ("LONG default_uses 50->7", [(f(LONG, "default_uses"), 7)]),
                      ("CONTROL LONG uses 50->9", [(f(LONG, "uses"), 9)])]:
        r = hero(pt)
        print(f"hero   {label:36s} slot items {r[0x0F:0x15].hex(' ')}")
    for label, pt, item in [("STRONG", [], STRONG), ("STRONG power 2->9", [(f(STRONG, "power"), 9)], STRONG),
                            ("STRONG param 0x14->0x50", [(f(STRONG, "param"), 0x50)], STRONG),
                            ("STRONG handler 0->5 (field use ignores it)", [(f(STRONG, "handler"), 5)], STRONG),
                            ("AGILITY", [], 0x0D), ("HP200", [], 0x0E)]:
        b, a = use(pt, item)
        print(f"use    {label:36s} Str {b[11]}->{a[11]} Def {b[12]}->{a[12]} Agl {b[13]}->{a[13]} "
              f"Mana {b[14]}->{a[14]} maxHP {b[8] | b[9] << 8}->{a[8] | a[9] << 8}")
