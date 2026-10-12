"""Bank-0C battle calculation VM ("calc VM") — disassembler.

Evidence: interpreter at 0C:4000 (statement dispatch table 0C:402D, expression dispatch 0C:4129),
operand loader 0C:4476, compare 00:03BC, RNG 00:043E. Script table 0C:4680 (11 entries) is run
from the battle flow at 0D:40E2…0D:434B via 0D:4361 (script n), and script 5 also from 00:3232.

Opcode byte: low 5 bits = op, high 3 bits = mode m.
Operand by mode: 0/1/2 = CF:[a] 1/2/3 bytes; 3/4 = byte/word at pointer word CF:[a];
5 = rand(0..imm8) (RNG stream 6); 6 = imm8; 7 = imm16.
Statements: 00 assign (target CF:[a] or, m>=5, absolute addr16; size by mode) + expression;
01 if <expression> (false → skip next statement); 02 goto a16; 03 native call 0C:a16;
04 set C1A0=imm8; 05 gosub a16; 06 return; 07 inc / 08 dec CF:[a] (m+1 bytes);
09 gosub [CF:a]; 1F end.
Expression ops (accumulator 24-bit, C1A5): 00 load, 01 mul (signed), 02 div (signed), 03 add,
04 sub, 05 and, 06 or, 07 nand, 08 xor, 09 not, 0A shr n, 0B shl n, 0C == 0D < 0E > 0F <= 10 >=
(in an if: save acc as left side, load right side), 11 sub saturating at 0, 12 rand(0..CF:[a])
(stream 5), 13 load absolute addr16 (mode = size/pointer), 1F end of expression.
"""
from __future__ import annotations

SCRIPT_TABLE = 0x30680  # 0C:4680
BANK = 0x0C
NSCRIPTS = 11
BATTLE_EFFECTS = (0x53E1, 50)  # item byte 3 → handler (script 5, battle: gosub [CF23*2 + 53E1])
FIELD_EFFECTS = (0x5445, 10)   # item byte 3 → handler (script 5, field: gosub [CF23*2 + 5445])
EXPR = {0x00: "", 0x01: "*", 0x02: "/", 0x03: "+", 0x04: "-", 0x05: "&", 0x06: "|", 0x07: "nand",
        0x08: "^", 0x09: "~", 0x0A: ">>", 0x0B: "<<", 0x0C: "==", 0x0D: "<", 0x0E: ">",
        0x0F: "<=", 0x10: ">=", 0x11: "-sat", 0x12: "rand", 0x13: "abs"}


def off(addr: int) -> int:
    return BANK * 0x4000 + addr - 0x4000 if addr >= 0x4000 else addr


def operand(rom: bytes, p: int, mode: int) -> tuple[str, int]:
    b = rom[p]
    if mode in (0, 1, 2):
        return f"CF{b:02X}" + ("" if mode == 0 else f".{mode + 1}"), 1
    if mode in (3, 4):
        return f"[CF{b:02X}]" + ("" if mode == 3 else ".2"), 1
    if mode == 5:
        return f"rand6(0..{b})", 1
    if mode == 6:
        return f"#{b}", 1
    v = b | rom[p + 1] << 8
    return (f"#${v:04X}" if v >= 0x1000 else f"#{v}"), 2


def _abs(rom: bytes, p: int, mode: int) -> str:
    a = rom[p] | rom[p + 1] << 8
    sz = {0: "", 1: ".2", 2: ".3", 3: "[ptr]", 4: "[ptr].2"}.get(mode, f".m{mode}")
    return f"({a:04X}{sz})"


CMP = {0x0C, 0x0D, 0x0E, 0x0F, 0x10, 0x13}


def expression(rom: bytes, p: int, cond: bool = False, first: str | None = None) -> tuple[str, int]:
    """Decode expression tokens from p up to and including 0x1F. In an `if` (cond=True) the
    comparison ops 0C-10 (and 13, which compares ==) start the right-hand side; elsewhere they
    simply load. `first` = already-decoded first operand (an if's statement byte carries it)."""
    parts = [first] if first is not None else []
    start = p
    while True:
        op = rom[p]; code, mode = op & 0x1F, op >> 5
        p += 1
        if code == 0x1F:
            break
        if code == 0x13:
            txt = _abs(rom, p, mode); p += 2
        elif code == 0x12:
            txt = f"rand5(0..CF{rom[p]:02X})"; p += 1
        else:
            txt, n = operand(rom, p, mode); p += n
        if not parts:
            parts.append(txt)
        elif code in CMP:
            parts.append((("==" if code == 0x13 else EXPR[code]) + " " if cond else "load ") + txt)
        elif code in (0x00, 0x12):
            parts.append(("load " if code == 0 else "load ") + txt)
        else:
            parts.append(f"{EXPR.get(code, '?%02X' % code)} {txt}")
    return " ".join(parts), p - start


def disasm(rom: bytes, entry: int, limit: int = 4000):
    """Linear disassembly from bank-0C address `entry`; returns list of (addr, text, targets)."""
    out = []
    p = off(entry)
    end = p + limit
    cond = False
    while p < end:
        was_cond, cond = cond, False
        a = 0x4000 + p % 0x4000
        op = rom[p]; code, mode = op & 0x1F, op >> 5
        if code == 0x1F:
            out.append((a, "end", [])); p += 1
            if not was_cond:
                break
            continue
        if code == 0x00:
            t = rom[p + 1]; q = p + 2
            if mode >= 5:
                tgt = f"({t | rom[p + 2] << 8:04X}).{mode - 4}"; q += 1
            elif mode >= 3:
                tgt = f"[CF{t:02X}]" + ("" if mode == 3 else ".2")
            else:
                tgt = f"CF{t:02X}" + ("" if mode == 0 else f".{mode + 1}")
            e, n = expression(rom, q)
            out.append((a, f"{tgt} = {e}", [])); p = q + n
        elif code == 0x01:
            if mode == 7 or mode < 5 or mode == 6 or mode == 5:
                f, n0 = operand(rom, p + 1, mode)
            e, n = expression(rom, p + 1 + n0, cond=True, first=f)
            out.append((a, f"if {e}:", [])); p += 1 + n0 + n
            cond = True
        elif code in (0x02, 0x03, 0x05):
            t = rom[p + 1] | rom[p + 2] << 8
            out.append((a, {2: "goto", 3: "native", 5: "gosub"}[code] + f" {t:04X}", [t] if code != 3 else []))
            p += 3
            if code == 2 and not was_cond:
                break
        elif code == 0x04:
            out.append((a, f"C1A0 = {rom[p + 1]}", [])); p += 2
        elif code == 0x06:
            out.append((a, "return", [])); p += 1
            if not was_cond:
                break
        elif code in (0x07, 0x08):
            out.append((a, ("inc" if code == 7 else "dec") + f" CF{rom[p + 1]:02X}.{mode + 1}", [])); p += 2
        elif code == 0x09:
            out.append((a, f"gosub [CF{rom[p + 1]:02X}]", [])); p += 2
        else:
            out.append((a, f"?? {op:02X}", [])); p += 1
            break
    return out


def scripts(rom: bytes) -> list[int]:
    return [rom[SCRIPT_TABLE + 2 * i] | rom[SCRIPT_TABLE + 2 * i + 1] << 8 for i in range(NSCRIPTS)]


def table(rom: bytes, base: int, n: int) -> list[int]:
    o = off(base)
    return [rom[o + 2 * i] | rom[o + 2 * i + 1] << 8 for i in range(n)]


def listing(rom: bytes) -> str:
    """Merged, address-sorted listing of all scripts and every reachable goto/gosub target."""
    labels = {a: f"script_{i}" for i, a in enumerate(scripts(rom))}
    for i, a in enumerate(table(rom, *BATTLE_EFFECTS)):
        labels.setdefault(a, f"effect_{i}")
    for i, a in enumerate(table(rom, *FIELD_EFFECTS)):
        labels.setdefault(a, f"field_effect_{i}")
    ins, todo = {}, list(labels)
    done = set()
    while todo:
        a = todo.pop()
        if a in done:
            continue
        done.add(a)
        for addr, txt, tg in disasm(rom, a):
            ins[addr] = txt
            for t in tg:
                labels.setdefault(t, f"L{t:04X}")
                todo.append(t)
    lines = []
    for addr in sorted(ins):
        if addr in labels:
            lines.append(f"\n{labels[addr]}:")
        txt = ins[addr]
        for t, name in labels.items():
            txt = txt.replace(f"goto {t:04X}", f"goto {name}").replace(f"gosub {t:04X}", f"gosub {name}")
        lines.append(f"  {addr:04X}  {txt}")
    return "\n".join(lines)


if __name__ == "__main__":
    import sys
    print(listing(open(sys.argv[1] if len(sys.argv) > 1 else "input/original.gb", "rb").read()))
