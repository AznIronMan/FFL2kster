"""Legend III recursive-descent disassembler (ROM ffl3/input/original.gb, output
ffl3/build/analysis/rd: bank_BB.asm, xref.json). Analysis aid; output stays local (ROM-derived).

Legend III conventions (from the ROM, 2026-10-13; docs/ffl3/ROM_MAP.md):
- rst $20 (00:38E1): select bank a and push the previous one (stack C0A0, depth C0B0, current
  C0B1); rst $28 (00:38FC): pop it back. `ld a,N` + rst $20 sets the bank context for 4000-7FFF.
- rst $18 (00:378A) + one inline byte x, a far call:
    bit 3 clear: the bank-0 routine 00:38C4[x & 7] with bank x >> 4 selected (if not 0);
    bit 3 set:   entry (x & F0) | 2 (x & 7) of the table at 00:3806 (lo) / 00:3807 (hi): bank
                 00:3802[hi >> 6], address (hi & 3F | 40) << 8 | lo.
- rst $30 (00:38D4): call the RAM trampoline C0B2 (jp set by the caller) with bank a: not followed.
- interrupts: vblank -> C0B9, STAT -> C0BC (RAM vectors; their handlers are found from where the
  code installs them, listed in tools/ffl3/disasm_entries.txt).
Usage: python tools/ffl3/disasm.py [BB:AAAA ...]"""
import json
import os
import sys

sys.path.insert(0, "tools")
from sm83dis import decode  # noqa: E402

rom = open("ffl3/input/original.gb", "rb").read()
BASE = [(0, 0x0100)] + [(0, v) for v in range(0, 0x40, 8)]
FAR_BANKS = [rom[0x3802 + i] for i in range(4)]


def off(bank, pc):
    return pc if pc < 0x4000 else bank * 0x4000 + pc - 0x4000


def rst18(x):
    """(bank, address, label) of the far call rst $18 with inline byte x."""
    if not x & 8:
        k = x & 7
        tgt = rom[0x38C4 + 2 * k] | rom[0x38C5 + 2 * k] << 8
        return (x >> 4, tgt, f"far0 {x >> 4:X}:{tgt:04X}")
    idx = (x & 0xF0) | 2 * (x & 7)
    hi, lo = rom[0x3807 + idx], rom[0x3806 + idx]
    bank = FAR_BANKS[hi >> 6]
    tgt = ((hi & 0x3F) | 0x40) << 8 | lo
    return (bank, tgt, f"farcall {bank:02X}:{tgt:04X}")


def crawl(entries):
    code, labels, xref = {}, {}, {}
    todo = [(b, p, True) for b, p in entries]
    while todo:
        bank, pc, is_func = todo.pop()
        if is_func:
            labels[(bank if pc >= 0x4000 else 0, pc)] = "F"
        ctx, last_lda = bank, None
        while pc < 0x8000:
            key = (ctx if pc >= 0x4000 else 0, pc)
            if key in code:
                break
            l, t, tg = decode(rom, ctx, pc)
            op = t.split()[0] if t else ""
            if t == "rst $18":
                x = rom[off(ctx, pc) + 1]
                bk, tgt, txt = rst18(x)
                code[key] = (2, f"rst $18 ; {txt} (x={x:02X})")
                if tgt < 0x4000:
                    todo.append((0, tgt, True))
                    xref.setdefault((0, tgt), set()).add(key)
                else:
                    todo.append((bk, tgt, True))
                    xref.setdefault((bk, tgt), set()).add(key)
                pc += 2
                last_lda = None
                continue
            code[key] = (l, t)
            if op == "rst":
                v = int(t.split("$")[1], 16)
                if v == 0x20 and last_lda is not None:
                    ctx = last_lda
                todo.append((0, v, True))
            if t.startswith("ld a,$") and len(t) == 8:
                last_lda = int(t[6:], 16)
            elif op not in ("rst", "push", "pop"):
                last_lda = None
            if tg is not None and tg < 0x8000:
                tb = ctx if tg >= 0x4000 else 0
                todo.append((tb, tg, op == "call"))
                xref.setdefault((tb, tg), set()).add(key)
            if t in ("ret", "reti", "jp hl") or (op in ("jp", "jr") and "," not in t):
                break
            pc += l
    return code, labels, xref


def main():
    extra = []
    if os.path.exists("tools/ffl3/disasm_entries.txt"):
        for line in open("tools/ffl3/disasm_entries.txt"):
            line = line.split("#")[0].strip()
            if line:
                b, a = line.split(":")
                extra.append((int(b, 16), int(a, 16)))
    extra += [(int(a.split(":")[0], 16), int(a.split(":")[1], 16)) for a in sys.argv[1:]]
    code, labels, xref = crawl(BASE + extra)
    for k in xref:
        labels.setdefault(k, "L")
    out = "ffl3/build/analysis/rd"
    os.makedirs(out, exist_ok=True)
    stats = {}
    for bk in sorted({b for b, _ in code}):
        lo, hi = (0, 0x4000) if bk == 0 else (0x4000, 0x8000)
        lines, pc, nbytes = [], lo, 0
        while pc < hi:
            k = (bk, pc)
            if k in code:
                if k in labels:
                    callers = sorted(xref.get(k, ()))
                    cs = " ".join(f"{b:02X}:{p:04X}" for b, p in callers[:8]) + (" ..." if len(callers) > 8 else "")
                    lines.append(f"\n{labels[k]}_{bk:02X}_{pc:04X}:{'  ; from ' + cs if cs else ''}")
                l, t = code[k]
                lines.append(f"  {pc:04X}  {t}")
                pc += l
                nbytes += l
            else:
                start = pc
                while pc < hi and (bk, pc) not in code and pc - start < 16:
                    pc += 1
                lines.append(f"  {start:04X}  db " + " ".join(f"{rom[off(bk, a)]:02x}" for a in range(start, pc)))
        open(f"{out}/bank_{bk:02X}.asm", "w").write("\n".join(lines) + "\n")
        stats[f"{bk:02X}"] = nbytes
    json.dump({f"{b:02X}:{p:04X}": sorted(f"{x:02X}:{y:04X}" for x, y in v) for (b, p), v in xref.items()},
              open(f"{out}/xref.json", "w"))
    print("code bytes by bank", stats, "functions", sum(1 for v in labels.values() if v == "F"))


if __name__ == "__main__":
    main()
