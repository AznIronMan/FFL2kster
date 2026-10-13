"""Print a range of the recursive disassembly: python tools/lst.py BB FROM TO (hex)."""
import sys
bk, lo, hi = sys.argv[1].upper(), int(sys.argv[2], 16), int(sys.argv[3], 16)
out = []
for line in open(f"ffl1/build/analysis/rd/bank_{bk}.asm"):
    s = line.rstrip("\n")
    if not s:
        continue
    if s.startswith("  "):
        a = int(s.split()[0], 16)
        if lo <= a < hi:
            out.append(s)
    elif out or True:
        a = int(s.split(":")[0].split("_")[2], 16)
        if lo <= a < hi:
            out.append(s)
print("\n".join(out))
