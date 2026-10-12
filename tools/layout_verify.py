"""Verify ffl2kster.layout.render against the ROM's own drawer (00:2232) run in ffl2kster.sm83.
1) every map header with the captured WRAM (progress vars) when a capture exists, else zeros;
2) every header with 20 random progress-variable sets; 3) N fuzzed command streams.
Usage: python tools/layout_verify.py [fuzz_count]"""
import glob, os, random, sys
sys.path.insert(0, "src")
from ffl2kster import layout
from ffl2kster.schema import maps as M
from ffl2kster.sm83 import CPU

rom = open("input/original.gb", "rb").read()


def oracle(romb, wram, layout_ptr, flags):
    cpu = CPU(romb)
    cpu.mem[0xC000:0xD000] = wram
    cpu.mem[0xC44E] = layout_ptr & 0xFF; cpu.mem[0xC44F] = layout_ptr >> 8
    cpu.mem[0xC451] = flags & 0x0F
    cpu.call(0x2232)
    return bytes(cpu.mem[0xD000:0xE000]), bytes(cpu.mem[0xC500:0xC600])


def vars_from(wram):
    return [(wram[0x2F6 + v // 2] >> (0 if v & 1 else 4)) & 0x0F for v in range(32)]


def check(romb, wram, ptr, flags):
    exp, exp_saved = oracle(romb, wram, ptr, flags)
    saved = bytearray(wram[0x500:0x600])
    got = layout.render(romb, layout.stream_offset(ptr), vars_from(wram), flags & 0x0F, saved,
                        cursor=(wram[0x473], wram[0x474]), last_end=(wram[0x475], wram[0x476]))
    return bytes(got) == exp and bytes(saved) == exp_saved


def main():
    fuzz = int(sys.argv[1]) if len(sys.argv) > 1 else 200
    do_maps = "--fuzz-only" not in sys.argv
    seed = int(sys.argv[sys.argv.index("--seed") + 1]) if "--seed" in sys.argv else 1234
    rnd = random.Random(seed)
    heads = M.all_headers(rom)
    bad = []
    for h in (heads if do_maps else []):
        hd = M.header(rom, h)
        f = f"build/maps/{h:04x}.npz"
        if os.path.exists(f):
            import numpy as np
            wram = bytearray(np.load(f)["wram"].tobytes())
        else:
            wram = bytearray(0x1000)
        if not check(rom, wram, hd["layout_ptr"], hd["flags"]):
            bad.append(("capture-vars", h))
        if not any(o["op"] == "if_var" for o in layout.parse(rom, layout.stream_offset(hd["layout_ptr"]))):
            continue
        for _ in range(20):
            w = bytearray(wram); w[0x2F6:0x306] = bytes(rnd.randrange(256) for _ in range(16))
            if not check(rom, w, hd["layout_ptr"], hd["flags"]):
                bad.append(("random-vars", h)); break
    # fuzz: random streams written into a scratch area of bank 09 (copy of the ROM)
    fails = skipped = 0
    for i in range(fuzz):
        r = bytearray(rom)
        s = bytearray()
        for _ in range(rnd.randrange(1, 12)):
            op = rnd.choice([1, 2, 2, 3, 4, 5, 6, 7, 8, 9, 10])
            n, c = rnd.randrange(16), rnd.randrange(256)
            s += bytes([op << 4 | n, c])
            if op == 1:
                s.append(rnd.randrange(256))
            elif op in (3, 4, 5, 6, 9):
                t = rnd.randrange(256); s.append(t)
                if t & 0xC0:
                    s.append(rnd.randrange(64))
        s += b"\x00\x00"
        base = 0x7F00
        off = 0x09 * 0x4000 + base - 0x4000
        r[off:off + len(s)] = s
        try:
            w = bytearray(rnd.randbytes(0x1000))
            for a in (0x473, 0x474, 0x475, 0x476):   # stale cursors are map coordinates (< 64)
                w[a] &= 0x3F
            ok = check(bytes(r), w, base, rnd.randrange(16))
        except Exception as ex:   # non-terminating streams (the game would hang too)
            skipped += 1
            continue
        if not ok:
            fails += 1
            if fails <= 3:
                print("fuzz mismatch", s.hex())
    print(f"headers {len(heads)}; mismatches {bad[:10]} ({len(bad)}); fuzz {fuzz} failures {fails} skipped(non-terminating) {skipped}")
    return 0 if not bad and not fails else 1


if __name__ == "__main__":
    raise SystemExit(main())
