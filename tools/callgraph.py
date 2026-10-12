"""Static call graph from entry points (bank-0 + one switchable bank context): follows call/jp/jr/rst,
far calls via 00:04BF inline (lo, hi, bank) and far-call stub 017D. Reports reachable functions and byte
counts per bank. Usage: python tools/callgraph.py BB:AAAA [BB:AAAA ...]"""
import sys
sys.path.insert(0, "tools")
from sm83dis import decode
rom = open("input/original.gb", "rb").read()
RST = {0x00: 0x0000, 0x08: 0x0008, 0x10: 0x0010, 0x18: 0x0018, 0x20: 0x0020, 0x28: 0x0028, 0x30: 0x0030, 0x38: 0x0038}

def crawl(entries):
    seen = set(); funcs = set(); todo = list(entries); bytes_ = {}
    while todo:
        bank, pc = todo.pop()
        key = (bank if pc >= 0x4000 else 0, pc)
        if key in seen: continue
        while True:
            key = (bank if pc >= 0x4000 else 0, pc)
            if key in seen or pc >= 0x8000: break
            seen.add(key)
            l, t, tg = decode(rom, bank, pc)
            bytes_[key] = l
            op = t.split()[0] if t else ""
            if op == "rst":
                v = int(t.split("$")[1], 16)
                if v == 0x28: pass
                todo.append((bank, v))
            if tg is not None and tg < 0x8000:
                if op == "call" and tg in (0x04BF, 0x017D):
                    lo, hi, bk = rom[(pc + 3) if pc < 0x4000 else bank*0x4000+pc-0x4000+3 - 0], 0, 0
                    o = pc + 3 if pc < 0x4000 else bank * 0x4000 + pc - 0x4000 + 3
                    lo, hi, bk = rom[o], rom[o + 1], rom[o + 2]
                    todo.append((bk, lo | hi << 8)); funcs.add((bk, lo | hi << 8))
                    pc += 6; continue
                todo.append((bank, tg))
                if op == "call": funcs.add((bank if tg >= 0x4000 else 0, tg))
            if t in ("ret", "reti", "jp hl") or (op in ("jp", "jr") and "," not in t):
                break
            pc += l
    return funcs, bytes_

if __name__ == "__main__":
    ents = [(int(a.split(":")[0], 16), int(a.split(":")[1], 16)) for a in sys.argv[1:]]
    funcs, b = crawl(ents)
    from collections import Counter
    c = Counter()
    for (bk, pc), l in b.items(): c[bk] += l
    print("functions", len(funcs), "bytes by bank", {f"{k:02X}": v for k, v in sorted(c.items())}, "total", sum(c.values()))
