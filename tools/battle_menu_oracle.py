"""SM83-oracle fixtures for the bank-1 battle routines that the battle traces do not reach
(port/packages/parity/test/battle_menus.test.ts): the FFA5 tile animation hooks 01:6DC5 and
01:6DF1, the wave step 01:6F49 and the scripted monster appearance 01:6E27 (text code 0x48),
run in src/ffl2kster/sm83.py on random inputs from the user's ROM.

Usage: python3 tools/battle_menu_oracle.py   -> build/routines/bm_oracle/cases.json (never committed)"""
import json, os, random, sys
sys.path.insert(0, "src")
from ffl2kster.sm83 import CPU

rom = open("input/original.gb", "rb").read()
rnd = random.Random(1990)
out = "build/routines/bm_oracle"
os.makedirs(out, exist_ok=True)
cases = []


def cpu():
    c = CPU(rom)
    c.bank = 1
    c.mem[0xFF88] = 1
    return c


def snap(c, addrs):
    return {f"{a:04X}": c.mem[a] for a in addrs}


# 01:6DF1 — counter FFA6 → pointers FFA7-FFAA
for n in range(24):
    c = cpu()
    c.mem[0xFFA6] = rnd.randrange(256) if n >= 16 else n
    inp = snap(c, [0xFFA6])
    c.call(0x6DF1)
    cases.append({"routine": "6DF1", "in": inp, "regs": {}, "out": snap(c, range(0xFFA6, 0xFFAB))})

# 01:6DC5 — rotate tile bytes (only from LY 0x90 on)
for n in range(32):
    c = cpu()
    p = rnd.choice([0x90E0, 0x91D0]) + 2 * rnd.randrange(8)
    q = rnd.choice([0x9000, 0x91C0]) + 2 * rnd.randrange(8)
    if n % 8 == 7:
        p = (p & 0xFF00) | 0xFF  # inc l wraps inside the page
    c.mem[0xFFA7], c.mem[0xFFA8], c.mem[0xFFA9], c.mem[0xFFAA] = p & 0xFF, p >> 8, q & 0xFF, q >> 8
    cells = sorted({p, (p & 0xFF00) | ((p + 1) & 0xFF), q, (q & 0xFF00) | ((q + 1) & 0xFF)})
    for a in cells:
        c.mem[a] = rnd.randrange(256)
    ly = rnd.choice([0x90, 0x91, 0x99, 0x10, 0x8F])
    c.ly = ly - 1  # the oracle's LY advances on each read
    inp = snap(c, [0xFFA7, 0xFFA8, 0xFFA9, 0xFFAA] + cells)
    c.call(0x6DC5)
    cases.append({"routine": "6DC5", "in": inp, "ly": ly, "regs": {}, "out": snap(c, cells)})

# 01:6F49 — wave step over FF90 lines (0 = 256), d = 0x11, e = 0x01
for n in range(24):
    c = cpu()
    c.mem[0xFF90] = [0, 1, 0x3F, 0x40][n] if n < 4 else rnd.randrange(256)
    for i in range(256):
        c.mem[0xC800 + i] = rnd.randrange(0x14)
        c.mem[0xC900 + i] = rnd.randrange(2)
    inp = snap(c, [0xFF90] + list(range(0xC800, 0xCA00)))
    c.d, c.e = 0x11, 0x01
    c.call(0x6F49)
    cases.append({"routine": "6F49", "in": inp, "regs": {"d": 0x11, "e": 0x01}, "out": snap(c, range(0xC800, 0xCA00))})


# 01:6E27 — monster appearance; farcalls stubbed: 0F:6092 nothing, 0D:5018 returns the tile
# source (A = bank, HL, BC); the frame tick 016E is a no-op here
def appear(b, cc, src):
    c = cpu()
    c.mem[0xFFFF] = 0x03
    calls = []

    def farcall(cpu_):
        ret = cpu_.rd16(cpu_.sp)
        lo, hi, bank = cpu_.rd(ret), cpu_.rd(ret + 1), cpu_.rd(ret + 2)
        cpu_.wr16(cpu_.sp, ret + 3)
        tgt = bank << 16 | hi << 8 | lo
        calls.append(f"{tgt:06X}")
        if tgt == 0x0D5018:
            cpu_.a, cpu_.h, cpu_.l, cpu_.b, cpu_.c = src[0], src[1] >> 8, src[1] & 0xFF, src[2] >> 8, src[2] & 0xFF
    c.b, c.c = b, cc
    c.ly = 0x90
    c.call(0x6E27, max_steps=50_000_000, traps={0x017D: farcall, 0x016E: lambda _: None})
    watch = list(range(0xC800, 0xCA00)) + list(range(0xD97D, 0xD986)) + [0xD921, 0xD922, 0xFF43, 0xFFFF, 0xFF0F] + list(range(0x9000, 0x9000 + src[2]))
    return {"routine": "6E27", "in": {}, "regs": {"b": b, "c": cc}, "src": list(src), "calls": calls, "out": snap(c, watch)}


cases.append(appear(0, 0x23, (0x0C, 0x5000, 0x0400)))
cases.append(appear(1, 0x51, (0x0C, 0x5400, 0x0200)))
cases.append(appear(0, 0x10, (0x0D, 0x6000, 0x0080)))
json.dump(cases, open(f"{out}/cases.json", "w"))
print(len(cases), "cases ->", out)
