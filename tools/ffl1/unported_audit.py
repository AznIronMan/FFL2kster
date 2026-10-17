"""Legend I: the audit behind the port's not-ported branches (docs/ffl1/FINDINGS.md, 1.62.0).

The port raises NotPortedBattle for the screen effect 07:7A0E and for an effect number outside the
table 07:7AD5. This walks the game's own data to show which screen effects any item can start:

- an item's effect byte (+6, table 06:7700) high nibble picks a screen script (07:7BA0) of effect
  numbers (07:77AF), its low nibble a sprite script (07:7C00) whose kind-0 commands are effect
  numbers too (07:6EA8); 07:6E0F is the only caller (06:5E06 with the item's +6);
- the sprite scripts are walked with the command lengths of 07:6EA8 / 6ED5 / 711A / 6F1E, and the
  walk is checked by its framing: every script ends where the next begins.

Also the item FC (battle handler 47 = 06:5098): no monster's ability list and no shop holds it;
06:5A37 gives it to a monster as an action when none of its abilities is usable.

Usage: python tools/ffl1/unported_audit.py [ffl1/input/original.gb]
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src"))

ITEMS = 0x6 * 0x4000 + 0x7700 - 0x4000  # 06:7700, 256 x 8
HANDLERS = 0x6 * 0x4000 + 0x403A - 0x4000  # 06:403A, 49 words
EFFECTS, SCREEN_SCRIPTS, SPRITE_SCRIPTS = 0x7AD5, 0x7BA0, 0x7C00  # bank 07


def _b7(rom: bytes, a: int) -> int:
    return rom[0x7 * 0x4000 + a - 0x4000]


def _w7(rom: bytes, a: int) -> int:
    return _b7(rom, a) | _b7(rom, a + 1) << 8


def effect_table(rom: bytes, n: int = 9) -> dict[int, int]:
    """07:7AD5: effect number e (1-based) -> routine address."""
    return {e: _w7(rom, EFFECTS + 2 * (e - 1)) for e in range(1, n + 1)}


def screen_script(rom: bytes, n: int) -> list[int]:
    """07:7BA0 script n (1-15): effect numbers up to the 0 (07:77AF)."""
    p, out = _w7(rom, SCREEN_SCRIPTS + 2 * (n - 1)), []
    while _b7(rom, p):
        out.append(_b7(rom, p))
        p += 1
    return out


def _frame_end(rom: bytes, p: int) -> int:
    """07:711A: a count, then that many (index, tile) pairs."""
    return p + 1 + 2 * _b7(rom, p)


def sprite_script(rom: bytes, n: int) -> tuple[list[int], int, int]:
    """07:7C00 script n: (effect numbers of its kind-0 commands, start, end)."""
    start = hl = _w7(rom, SPRITE_SCRIPTS + 2 * (n - 1))
    effects: list[int] = []
    while (a := _b7(rom, hl)):
        cmds, hl, end = (a & 0x0F) + 1, hl + 1, None
        p = hl
        for j in range(cmds):
            c = _b7(rom, p)
            p += 1
            k = c >> 6
            if k == 0:  # 6EB9: jp 07:77D1, screen effect c
                effects.append(c)
            elif k in (1, 3):  # 6ED5 / 6EC2: one sprite frame
                p = _frame_end(rom, p)
            else:  # 6F1E: the paths take the rest of the block
                q = p - 1
                for _ in range(cmds - j):
                    q += 1
                    cnt = _b7(rom, q) or 256
                    q += 1 + 2 * cnt
                end = q
                break
        hl = end if end is not None else p
    return effects, start, hl


def xrefs(rom: bytes, target: int) -> dict[str, list[str]]:
    """Every call / jp (any condition) to target in banks 00 and 07, and every little-endian word
    equal to it in bank 07 (jump tables)."""
    import re
    ops = (0xCD, 0xC4, 0xCC, 0xD4, 0xDC, 0xC3, 0xC2, 0xCA, 0xD2, 0xDA)
    lo, hi = target & 0xFF, target >> 8
    out: dict[str, list[str]] = {"calls": [], "words": []}
    for bank in (0x00, 0x07):
        seg, org = rom[bank * 0x4000:(bank + 1) * 0x4000], 0x4000 if bank else 0
        for op in ops:
            out["calls"] += [f"{bank:02X}:{m.start() + org:04X}" for m in re.finditer(re.escape(bytes([op, lo, hi])), seg)]
    seg = rom[0x7 * 0x4000:0x8 * 0x4000]
    out["words"] = [f"07:{m.start() + 0x4000:04X}" for m in re.finditer(re.escape(bytes([lo, hi])), seg)
                    if not (m.start() and seg[m.start() - 1] in ops)]
    return out


def item_effect_bytes(rom: bytes) -> list[int]:
    return [rom[ITEMS + 8 * i + 6] for i in range(256)]


def audit(rom: bytes) -> dict:
    from ffl1kster.schema import monsters as M
    from ffl1kster.schema import maps as MP

    eff = effect_table(rom)
    fx = item_effect_bytes(rom)
    his = sorted({b >> 4 for b in fx} - {0})
    los = sorted({b & 0x0F for b in fx} - {0})
    screens = {n: screen_script(rom, n) for n in range(1, 16)}
    sprites = {n: sprite_script(rom, n) for n in range(1, 16)}
    framing = all(sprites[n][2] + 1 == sprites[n + 1][1] for n in range(1, 15))
    reachable: set[int] = set()
    for n in his:
        reachable |= set(screens[n])
    for n in los:
        reachable |= set(sprites[n][0])
    handlers = [rom[HANDLERS + 2 * i] | rom[HANDLERS + 2 * i + 1] << 8 for i in range(49)]
    fc_items = [i for i in range(256) if rom[ITEMS + 8 * i + 2] == 47]
    monsters = M.extract(rom)
    shops = [MP.shop(rom, s) for s in range(len(MP.extract(rom)["shops"]))]
    return {
        "effects": eff,
        "item_screen_scripts": his,
        "item_sprite_scripts": los,
        "screen_scripts": screens,
        "sprite_script_effects": {n: v[0] for n, v in sprites.items()},
        "sprite_framing_contiguous": framing,
        "sprite_end": sprites[15][2],
        "reachable_effects": sorted(reachable),
        "scripts_with_effect_8": [n for n, s in screens.items() if 8 in s]
                                  + [f"sprite {n}" for n, v in sprites.items() if 8 in v[0]],
        "xrefs": {f"07:{t:04X}": xrefs(rom, t) for t in (0x6E0F, 0x77AF, 0x77D1, 0x7A0E)},
        "handler_47": handlers[47],
        "handler_47_items": fc_items,
        "monsters_holding_fc": [m["name"] for m in monsters if 0xFC in m["abilities"]],
        "shops_with_fc": [s for s, items in enumerate(shops) if 0xFC in items],
    }


def main(argv: list[str]) -> int:
    rom = Path(argv[1] if len(argv) > 1 else ROOT / "ffl1/input/original.gb").read_bytes()
    a = audit(rom)
    print("effect table 07:7AD5:", {e: f"07:{v:04X}" for e, v in a["effects"].items()})
    print("screen scripts the items select (+6 high nibble):", a["item_screen_scripts"])
    print("sprite scripts the items select (+6 low nibble):", a["item_sprite_scripts"])
    for n, s in a["screen_scripts"].items():
        print(f"  screen script {n:2}: effects {s}")
    for n, s in a["sprite_script_effects"].items():
        print(f"  sprite script {n:2}: effects {s}")
    print("sprite scripts framed back to back:", a["sprite_framing_contiguous"], f"(last ends 07:{a['sprite_end']:04X})")
    print("effects any item can start:", a["reachable_effects"])
    print("scripts holding effect 8 (07:7A0E):", a["scripts_with_effect_8"])
    for t, x in a["xrefs"].items():
        print(f"references to {t}: calls/jumps {x['calls']}, words {x['words']}")
    print(f"handler 47 = 06:{a['handler_47']:04X}, items with handler 47:", [f"{i:02X}" for i in a["handler_47_items"]])
    print("monsters holding item FC:", a["monsters_holding_fc"], "shops selling FC:", a["shops_with_fc"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
