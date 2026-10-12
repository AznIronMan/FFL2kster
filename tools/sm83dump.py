"""Quick linear disassembly: python tools/sm83dump.py BB:AAAA:N [...] (bank:addr:count, hex)."""
import sys
sys.path.insert(0, "tools")
from sm83dis import decode
rom = open("input/original.gb", "rb").read()
for a in sys.argv[1:]:
    b, ad, n = a.split(":")
    bank, addr = int(b, 16), int(ad, 16)
    for _ in range(int(n)):
        l, t, _ = decode(rom, bank, addr)
        print(f"{bank:02X}:{addr:04X} {t}")
        addr += l
    print("--")
