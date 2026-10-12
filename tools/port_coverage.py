"""Port coverage: which original routines (functions found by tools/disasm.py's recursive
descent from the known entry points) are named in the TypeScript port's doc comments or
address tables. A routine counts as ported when its address appears as `BB:AAAA` (or `00:AAAA`
for bank 0) in port/packages/core/src, or as an entry key `0xBBAAAA` registered there.
Prints unported functions per bank with their code size (bytes up to the next function).
Usage: python tools/port_coverage.py [BANK ...]   (analysis aid; reads input/original.gb)"""
import os, re, sys
sys.path.insert(0, "tools")
import disasm


def ts_addresses(root="port/packages/core/src"):
    seen = set()
    for dp, _, fs in os.walk(root):
        for f in fs:
            if not f.endswith(".ts"):
                continue
            s = open(os.path.join(dp, f)).read()
            for b, a in re.findall(r"\b([0-9A-Fa-f]{2}):([0-9A-Fa-f]{4})\b", s):
                b, a = int(b, 16), int(a, 16)
                seen.add((b if a >= 0x4000 else 0, a))
            for v in re.findall(r"\b0x([0-9a-fA-F]{5,6})\b", s):
                v = int(v, 16)
                if v >> 16 and (v & 0xFFFF) >= 0x4000:
                    seen.add((v >> 16, v & 0xFFFF))
    return seen


def main():
    extra = []
    for line in open("tools/disasm_entries.txt"):
        line = line.split("#")[0].strip()
        if line:
            b, a = line.split(":")
            extra.append((int(b, 16), int(a, 16)))
    code, labels, xref = disasm.crawl(disasm.BASE + extra)
    funcs = sorted(k for k, v in labels.items() if v == "F")
    ported = ts_addresses()
    only = {int(x, 16) for x in sys.argv[1:]}
    by_bank = {}
    for i, k in enumerate(funcs):
        # size: code bytes from k until the next function in the same bank
        b, p = k
        size, q = 0, p
        nxt = next((f[1] for f in funcs[i + 1:] if f[0] == b), 0x8000 if b else 0x4000)
        while q < nxt:
            if (b, q) in code:
                size += code[(b, q)][0]
                q += code[(b, q)][0]
            else:
                q += 1
        by_bank.setdefault(b, []).append((p, size, k in ported))
    for b in sorted(by_bank):
        if only and b not in only:
            continue
        rows = by_bank[b]
        un = [(p, s) for p, s, ok in rows if not ok]
        tot = sum(s for _, s, _ in rows)
        print(f"bank {b:02X}: {len(rows)} functions, {tot} bytes; unported {len(un)} functions, {sum(s for _, s in un)} bytes")
        if only:
            print("   " + " ".join(f"{p:04X}({s})" for p, s in un))


if __name__ == "__main__":
    main()
