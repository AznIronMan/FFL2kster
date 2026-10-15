"""Legend III battery saves (.sav: the cartridge RAM from A000, 8 KiB or more).

    python tools/ffl3/sav.py info FILE              # the slots: valid copies, party, progress
    python tools/ffl3/sav.py state FILE SLOT NAME   # boot with FILE's RAM, Continue, load SLOT (0-2),
                                                    # into the field: ffl3/build/states/field_NAME.state

The format (docs/ffl3/ROM_MAP.md, 09:4DE8): slot k at A000 + 2D8 k and a second copy at + B60;
a copy is the magic C6 62 83, a 3-byte checksum (the sum of the 2D2 bytes, then the count of its
carries, 16 bits) and the 2D2 bytes the game keeps at C500-C7D1. A save file is the player's own
data: keep it in .private/saves (never committed); the state made from it stays in ffl3/build.
"""
import sys

sys.path.insert(0, "src")
from ffl3kster.text import decode  # noqa: E402

MAGIC = bytes((0xC6, 0x62, 0x83))
SIZE = 0x2D2


def checksum(b):
    a = de = 0
    for v in b:
        a += v
        if a > 0xFF:
            a &= 0xFF
            de = (de + 1) & 0xFFFF
    return bytes((a, de & 0xFF, de >> 8))


def copy_ok(ram, at):
    c = ram[at:at + 6 + SIZE]
    return len(c) == 6 + SIZE and c[:3] == MAGIC and c[3:6] == checksum(c[6:])


def slot(ram, k):
    """The game of slot k (the bytes for C500..) from its first valid copy, or None."""
    for at in (0x2D8 * k, 0x2D8 * k + 0xB60):
        if copy_ok(ram, at):
            return ram[at + 6:at + 6 + SIZE]
    return None


def flag(g, n):   # story flag n: C760 + n / 8, bit 7 - n % 8
    return bool(g[0x260 + n // 8] & (0x80 >> (n % 8)))


def describe(g):
    out = []
    for k in range(5):
        r = g[0x60 * k:0x60 * (k + 1)]
        if r[3] == 0xFF:
            out.append(f"  member {k}: (empty)")
            continue
        hp, hpmax = r[0x10] | r[0x11] << 8, r[0x12] | r[0x13] << 8
        skills = [f"{x:02X}" for x in r[0x48:0x50] if x != 0xFF]
        spells = sum(bin(x).count("1") for x in r[0x51:0x57])
        out.append(f"  member {k}: {decode(r[7:7 + 6]).strip():6} head {r[:7].hex(' ')} HP {hp}/{hpmax} "
                   f"stats {list(r[0x18:0x1C])} equip {r[0x40:0x48].hex(' ')} skills {skills or '-'} spells {spells}")
    gp = g[0x1E0] | g[0x1E1] << 8 | g[0x1E2] << 16
    out.append(f"  GP {gp}, vehicle C6E3 {g[0x1E3]:02X}, place C6E4 {g[0x1E4:0x1EE].hex(' ')}, "
               f"key items C6F8/9 {g[0x1F8]:08b} {g[0x1F9]:08b}")
    bag = [(g[0x1FF + 2 * i], g[0x200 + 2 * i]) for i in range(24)]
    out.append("  bag " + " ".join(f"{i:02X}x{n}" for i, n in bag if i not in (0, 0xFF)))
    fl = [n for n in range(256) if flag(g, n)]
    out.append(f"  story flags set ({len(fl)}): " + " ".join(f"{n:02X}" for n in fl))
    return "\n".join(out)


def read(path):
    ram = open(path, "rb").read()
    if len(ram) < 0x2000:
        raise SystemExit(f"{path}: {len(ram)} bytes, expected at least 8 KiB of cartridge RAM")
    return ram[:0x2000]


def info(path):
    ram = read(path)
    for k in range(3):
        a, b = copy_ok(ram, 0x2D8 * k), copy_ok(ram, 0x2D8 * k + 0xB60)
        g = slot(ram, k)
        print(f"slot {k}: copies {'ok' if a else 'bad'} / {'ok' if b else 'bad'}")
        if g:
            print(describe(g))


def state(path, k, name):
    """Boot with the file's RAM, Continue on the title, slot k loaded, the field reached (the
    field loop 00:0265, then 120 frames), the state saved."""
    from ffl3kster.emu import Emulator
    ram = read(path)
    if slot(ram, k) is None:
        raise SystemExit(f"slot {k} has no valid copy")
    # (only slot k kept valid: the other slots' magic cleared, so whichever the cursor loads is k)
    ram = bytearray(ram)
    for j in range(3):
        if j != k:
            for at in (0x2D8 * j, 0x2D8 * j + 0xB60):
                ram[at] = 0
    with Emulator("ffl3/input/original.gb") as e:
        pb = e.pb
        for i, v in enumerate(ram):
            pb.memory[0, 0xA000 + i] = v
        field = e.hook(0, 0x0265)

        def press(btn, n=3, after=20):
            pb.button_press(btn)
            for _ in range(n):
                pb.tick(1, False)
            pb.button_release(btn)
            for _ in range(after):
                pb.tick(1, False)
        for _ in range(63):   # the title (as cont1)
            pb.tick(1, False)
        press("a", after=80)  # Continue: the slot list
        for _ in range(4):    # A on the cursor's slot; an empty one is refused: down, A again
            press("a", after=30)
            for _ in range(600):
                pb.tick(1, False)
                if field:
                    break
            if field:
                break
            press("down")
        if not field:
            raise SystemExit("the field was not reached")
        for _ in range(120):
            pb.tick(1, False)
        out = f"ffl3/build/states/field_{name}.state"
        e.save_state(out)
        print(f"{out}: field at frame {field[0]}, C6E3 {pb.memory[0xC6E3]:02X}")


if __name__ == "__main__":
    if len(sys.argv) >= 3 and sys.argv[1] == "info":
        info(sys.argv[2])
    elif len(sys.argv) >= 5 and sys.argv[1] == "state":
        state(sys.argv[2], int(sys.argv[3]), sys.argv[4])
    else:
        raise SystemExit(__doc__)
