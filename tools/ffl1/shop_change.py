"""Legend I shops: controlled changes against the shop inventories (05:7D10, 10 item ids per shop,
FF = empty) and the prices (05:7E10, 3-byte BCD per item id).
The first town's weapon shop (event command 4, parameter 0x16) is reached from first_town.state by
walking to (29,18) (collision from the map buffer and the attribute table, see the M5 findings);
GP is set to 99999 in RAM (CC8D-CC8F, BCD) so the purchase goes through; then A buys slot 0.
usage: python tools/ffl1/shop_change.py"""
import os, sys, tempfile
sys.path.insert(0, "src"); sys.path.insert(0, "ffl1/scratch")
from ffl1kster.emu import Emulator
from ffl1kster.rom import bank_to_file

ROM = "ffl1/input/original.gb"
orig = open(ROM, "rb").read()
INV, PRICES = bank_to_file(5, 0x7D10), bank_to_file(5, 0x7E10)
SHOP = 0x16


def buy(patches):
    from ffl1kster.navigate import goto
    r = bytearray(orig)
    for o, v in patches:
        r[o] = v
    fd, p = tempfile.mkstemp(suffix=".gb")
    os.write(fd, bytes(r)); os.close(fd)
    try:
        with Emulator(p) as e:
            m = e.pb.memory
            e.load_state("ffl1/build/states/first_town.state")
            assert goto(e, (29, 18))
            m[0xCC8D], m[0xCC8E], m[0xCC8F] = 0x09, 0x99, 0x99
            for k in ("up", "a", "a"):
                e.press(k, hold=6, wait=150)
            gp = int(f"{m[0xCC8D]:02x}{m[0xCC8E]:02x}{m[0xCC8F]:02x}")
            text = " ".join(x.strip(" ·") for x in e.screen_text() if "You get" in x or "You" in x)
            bag = bytes(m[0xCC7D:0xCC8D])
            return 99999 - gp, text, bag
    finally:
        os.remove(p)


if __name__ == "__main__":
    for label, pt in [("baseline", []),
                      ("price of LONG (0x21) 000132 -> 000177", [(PRICES + 3 * 0x21 + 2, 0x77)]),
                      ("CONTROL price of AXE (0x22) -> 000177", [(PRICES + 3 * 0x22 + 2, 0x77)]),
                      ("shop 0x16 slot 0 LONG -> KATANA (0x24)", [(INV + 10 * SHOP, 0x24)])]:
        cost, text, bag = buy(pt)
        print(f"{label:42s} paid {cost:5d}  bag {bag.hex(' ')}  | {text}")
