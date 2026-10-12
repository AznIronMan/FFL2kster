"""Function dumper: disassemble from bank:addr following local branches (within +-0x200) until
all paths end in ret/jp; prints in address order. Usage: python tools/fdump.py BB:AAAA [...]"""
import sys
sys.path.insert(0, "tools")
from sm83dis import decode
rom = open("input/original.gb", "rb").read()
for arg in sys.argv[1:]:
    b, a = arg.split(":")
    bank, start = int(b, 16), int(a, 16)
    seen, todo, out = set(), [start], {}
    while todo:
        pc = todo.pop()
        while pc not in seen and abs(pc - start) < 0x300:
            seen.add(pc)
            l, t, tg = decode(rom, bank, pc)
            out[pc] = t
            if tg is not None and t.split()[0] in ("jr", "jp") and abs(tg - start) < 0x300:
                todo.append(tg)
            if t in ("ret", "reti") or (t.startswith(("jp ", "jr ")) and "," not in t) or t == "jp hl":
                break
            pc += l
    print(f"== {bank:02X}:{start:04X}")
    print("; ".join(f"{k:04X} {out[k]}" for k in sorted(out)))
