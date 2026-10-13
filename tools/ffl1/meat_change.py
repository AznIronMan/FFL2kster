"""Legend I meat tables: controlled changes (bank 02, read by 00:0D9C).
A CLIPPER hero (party creation option 5) on a ROM where ASIGARU always leaves meat (record b0 = 7)
fights the first battle, eats the meat, and the new monster id (party record +5) is compared with
the prediction from ffl1kster.schema.meat. HP is refilled each step (RAM, exploration convenience).
usage: python tools/ffl1/meat_change.py   (needs ffl1/build/states from make-states)"""
import os, sys, tempfile
sys.path.insert(0, "src")
from ffl1kster.emu import Emulator
from ffl1kster.schema import meat as MT, monsters as M

ROM = "ffl1/input/original.gb"
orig = open(ROM, "rb").read()


def clipper_world(e):
    e.load_state("ffl1/build/states/party_creation.state")
    for _ in range(4):
        e.press("down", wait=20)
    for k, w in (("a", 120), ("a", 60), ("start", 120)):
        e.press(k, wait=w)
    for _ in range(3):
        e.press("down", wait=56)


def eat(patches):
    r = bytearray(orig)
    r[M.record_offset(155)] = 7
    for o, v in patches:
        r[o] = v
    fd, p = tempfile.mkstemp(suffix=".gb")
    os.write(fd, bytes(r)); os.close(fd)
    try:
        with Emulator(p) as e:
            m = e.pb.memory
            clipper_world(e)
            seq = ["right", "right", "right", "left", "left", "left"]
            for i in range(300):
                m[0xCC06], m[0xCC07] = 0xE7, 3
                e.loader_hits.clear(); e.press(seq[i % 6])
                if e.loader_hits:
                    break
            for j in range(120):
                e.press("a", wait=40)
                if m[0xFF4A] == 144 and j > 20:
                    break
            return m[0xCC05], bytes(r)
    finally:
        os.remove(p)


B2 = lambda a: 0x8000 + a - 0x4000
CASES = [
    ("baseline (CLIPPER eats ASIGARU)", []),
    ("result [0][20] 11->5", [(MT.RESULTS + 29 * 0 + 20, 5)]),
    ("family-level [11][0] LIZARD->WOLF", [(MT.FAMILY_LEVELS + 16 * 11 + 0, 30)]),
    ("CONTROL result [0][21] -> 5", [(MT.RESULTS + 29 * 0 + 21, 5)]),
    ("ASIGARU level 0->9", [(MT.LEVELS + 155, 0xC9)]),
    ("ASIGARU family byte 0x1D->0x13 (family 20->10)", [(MT.FAMILY_BYTES + 155, 0x13)]),
]
if __name__ == "__main__":
    for label, pt in CASES:
        got, rom = eat(pt)
        want = MT.predict(rom, 18, 155)
        print(f"{label:48s} became {got:3d} {M.name(orig, got):9s} predicted {want} {'OK' if got == want else 'MISMATCH'}")
