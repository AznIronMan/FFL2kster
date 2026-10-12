"""Recursive-descent disassembly with labels and cross references (analysis aid, output stays in build/).

Follows call/jp/jr/rst, far calls through 00:04BF / 00:017D (inline lo, hi, bank) and tracks the
switchable bank: `ld a,N` followed by `rst $28` (00:04B1 bank select) changes the bank context for
later 4000-7FFF targets in the same flow. Extra entry points (jump tables found by hand) can be given
as BB:AAAA arguments or in tools/disasm_entries.txt (one per line, '#' comments).
Writes build/analysis/rd/bank_BB.asm and build/analysis/rd/xref.json.
Usage: python tools/disasm.py [BB:AAAA ...]"""
import json, os, sys
sys.path.insert(0, "tools")
from sm83dis import decode

rom = open("input/original.gb", "rb").read()
FAR = (0x04BF, 0x017D)
BASE = [(0, 0x0100), (0, 0x0200), (0, 0x16DF), (0, 0x16F9)] + [(0, 0x0150 + 3 * i) for i in range(51)] \
    + [(0, v) for v in range(0, 0x40, 8)]


def off(bank, pc):
    return pc if pc < 0x4000 else bank * 0x4000 + pc - 0x4000


def crawl(entries):
    code = {}           # (bank, pc) -> (len, text)
    labels = {}         # (bank, pc) -> 'F' or 'L'
    xref = {}           # target -> set of callers
    todo = [(b, p, True) for b, p in entries]
    while todo:
        bank, pc, is_func = todo.pop()
        b = bank if pc >= 0x4000 else 0
        if is_func:
            labels[(b, pc)] = "F"
        ctx = bank
        last_lda = None
        while pc < 0x8000:
            key = (ctx if pc >= 0x4000 else 0, pc)
            if key in code:
                break
            l, t, tg = decode(rom, ctx, pc)
            code[key] = (l, t)
            op = t.split()[0] if t else ""
            if op == "rst":
                v = int(t.split("$")[1], 16)
                if v == 0x28 and last_lda is not None:
                    ctx = last_lda
                todo.append((0, v, True))
            if t.startswith("ld a,$") and len(t) == 8:
                last_lda = int(t[6:], 16)
            elif op not in ("rst", "push", "pop"):
                last_lda = None
            if tg is not None and tg < 0x8000:
                tb = ctx if tg >= 0x4000 else 0
                if op == "call" and tg in FAR:
                    o = off(ctx, pc) + 3
                    lo, hi, bk = rom[o], rom[o + 1], rom[o + 2]
                    tgt = lo | hi << 8
                    todo.append((bk, tgt, True))
                    xref.setdefault((bk if tgt >= 0x4000 else 0, tgt), set()).add(key)
                    code[key] = (l + 3, f"farcall {bk:02X}:{tgt:04X}")
                    pc += l + 3
                    continue
                todo.append((tb, tg, op == "call"))
                xref.setdefault((tb, tg), set()).add(key)
            if t in ("ret", "reti", "jp hl") or (op in ("jp", "jr") and "," not in t):
                break
            pc += l
    return code, labels, xref


def main():
    extra = []
    if os.path.exists("tools/disasm_entries.txt"):
        for line in open("tools/disasm_entries.txt"):
            line = line.split("#")[0].strip()
            if line:
                b, a = line.split(":")
                extra.append((int(b, 16), int(a, 16)))
    extra += [(int(a.split(":")[0], 16), int(a.split(":")[1], 16)) for a in sys.argv[1:]]
    code, labels, xref = crawl(BASE + extra)
    for k in xref:
        labels.setdefault(k, "L")
    out = "build/analysis/rd"
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
