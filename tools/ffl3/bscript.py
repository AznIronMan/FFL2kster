"""Legend III battle script lister (the bytecode run by 0C:4000; docs/ffl3/ROM_MAP.md "Battle
script"): walks the script from its entry points (bank 0C) and prints every statement, and the
native routines (opcode 03), call/jump targets and tables it reaches. Output local (ROM-derived):
ffl3/build/analysis/bscript.txt. `natives()` is used by tools/ffl3/disasm.py as extra entries.

    python tools/ffl3/bscript.py [BB:AAAA ...]    # default entry 0C:4A2D (0B:4037's battle)

Statement = opcode (low 5 bits) + operand type (top 3 bits) + bytes:
  00 v [hi] expr   assign: target C9v (types 0-2: 1-3 bytes; 3-4 through the pointer at C9v;
                   5-7: the absolute address hi:v), expression terms up to 1F
  01 expr          condition (the next statement is skipped when false)
  02 lo hi         goto       03 lo hi  native call      04 x  (no effect)
  05 lo hi         gosub      06        return           07 v / 08 v  increment / decrement
  09 v / 0A v      gosub / goto through the word at C9v
  0B v n           assign the byte n            0C   gosub 0C:40CE[type]   0D  goto 0C:40DE[type]
  0E-1E            an accumulator statement (expression code + 0E) and the expression after it
Expression term = code (low 5 bits: 00 load, 01 mul, 02 div, 03 add, 04 sub, 05 and, 06 or,
07 nand, 08 xor, 09 not, 0A shr, 0B shl, 0C-10 compare = < > <= >=, 11 sub (floor 0),
12 random below C9v, 13 load from the absolute address, 1F end) + operand (type 0-4: C9v; 5:
random below n; 6: byte n; 7: word; code 13: type + lo hi).
"""
import sys

rom = open("ffl3/input/original.gb", "rb").read()
BANK = 0x0C


def rd(a):
    return rom[a] if a < 0x4000 else rom[BANK * 0x4000 + a - 0x4000]


def rd16(a):
    return rd(a) | rd(a + 1) << 8


OPS = ["assign", "cond", "goto", "native", "nop2", "gosub", "return", "inc", "dec", "gosub*", "goto*",
       "setb", "gosubT", "gotoT"]
CODES = {0: "load", 1: "mul", 2: "div", 3: "add", 4: "sub", 5: "and", 6: "or", 7: "nand", 8: "xor", 9: "not",
         0x0A: "shr", 0x0B: "shl", 0x0C: "==", 0x0D: "<", 0x0E: ">", 0x0F: "<=", 0x10: ">=", 0x11: "subf",
         0x12: "rnd", 0x13: "load@", 0x1F: "end"}


def operand(p):
    b = rd(p)
    t = b >> 5
    if t == 7:
        return f"#{rd16(p + 1):04X}", 3
    if t == 6:
        return f"#{rd(p + 1):02X}", 2
    if t == 5:
        return f"rnd({rd(p + 1):02X})", 2
    return (f"C9{rd(p + 1):02X}" if t < 3 else f"[C9{rd(p + 1):02X}]") + f".{t % 3 + 1}", 2


def expression(p, first=None):
    """Terms from p (or the statement's own byte for 01/0E-1E) up to 1F; returns text, next p."""
    out = []
    while True:
        code = rd(p) & 0x1F if first is None else first
        name = CODES.get(code, f"?{code:02X}")
        first = None
        if code == 0x1F:
            out.append("end")
            return " ".join(out), p + 1
        if code == 0x12:
            out.append(f"rnd(C9{rd(p + 1):02X})")
            p += 2
        elif code == 0x13:
            out.append(f"load@{rd16(p + 1):04X}.{rd(p) >> 5}")
            p += 3
        else:
            o, n = operand(p)
            out.append(f"{name} {o}")
            p += n


def skip_len(p):
    """The address after the statement at p (as 0C:407C skips it)."""
    b = rd(p)
    op, t = b & 0x1F, b >> 5
    if op == 0x1F or op == 0x06 or op in (0x0B, 0x0C, 0x0D):
        return p + 1
    if op in (0x02, 0x03, 0x05):
        return p + 3
    if op in (0x04, 0x07, 0x08, 0x09, 0x0A):
        return p + 2
    if op == 0x00:
        p += 2 if t < 5 else 3
    elif op != 0x01:
        raise ValueError(f"skip of opcode {op:02X} at 0C:{p:04X} (0C:437C has no entry)")
    while True:                                      # 0C:43A5: terms up to 1F
        c = rd(p)
        if c & 0x1F == 0x1F:
            return p + 1
        p += 3 if (c & 0x1F == 0x13 or c >> 5 == 7) else 2


def walk(entries):
    lines, natives, seen, todo = {}, set(), set(), list(entries)
    while todo:
        p = todo.pop()
        cond = False
        while p not in seen and 0x4000 <= p < 0x8000:
            seen.add(p)
            if cond:                                 # the statement after a condition may be skipped
                todo.append(skip_len(p))
            cond = False
            b = rd(p)
            op, t = b & 0x1F, b >> 5
            if op == 0x1F:
                lines[p] = "end"
                break
            if op in (0x00, 0x0B):
                v = rd(p + 1)
                tgt = (f"{rd(p + 2):02X}{v:02X}.{t - 4}" if t >= 5 else
                       f"C9{v:02X}.{t + 1}" if t < 3 else f"[C9{v:02X}].{t - 2}")
                q = p + (3 if t >= 5 else 2)
                if op == 0x0B:
                    lines[p] = f"{tgt} = #{rd(q):02X}"
                    p = q + 1
                else:
                    e, p2 = expression(q)
                    lines[p] = f"{tgt} = {e}"
                    p = p2
            elif op == 0x01:
                e, p2 = expression(p, 0x00)
                lines[p] = f"if {e}"
                p = p2
                cond = True
            elif op in (0x02, 0x03, 0x05):
                a = rd16(p + 1)
                lines[p] = f"{OPS[op]} {BANK if a >= 0x4000 else 0:02X}:{a:04X}"
                if op == 0x03:
                    natives.add((BANK if a >= 0x4000 else 0, a))
                else:
                    todo.append(a)
                if op == 0x02:
                    break
                p += 3
            elif op == 0x04:
                lines[p] = f"nop {rd(p + 1):02X}"
                p += 2
            elif op == 0x06:
                lines[p] = "return"
                break
            elif op in (0x07, 0x08, 0x09, 0x0A):
                lines[p] = f"{OPS[op]} C9{rd(p + 1):02X}.{t + 1}"
                p += 2
                if op == 0x0A:
                    break
            elif op in (0x0C, 0x0D):
                a = rd16((0x40CE if op == 0x0C else 0x40DE) + 2 * t)
                lines[p] = f"{OPS[op]}[{t}] -> 0C:{a:04X}"
                todo.append(a)
                p += 1
                if op == 0x0D:
                    break
            else:
                e, p2 = expression(p, op - 0x0E)
                lines[p] = f"acc {e}"
                p = p2
    return lines, natives


def natives(entries=((0x4A2D),)):
    return sorted(walk(list(entries))[1])


def main():
    entries = [int(a.split(":")[1], 16) for a in sys.argv[1:]] or [0x4A2D]
    lines, nat = walk(entries)
    out = [f"0C:{p:04X}  {t}" for p, t in sorted(lines.items())]
    out.append("natives: " + " ".join(f"{b:02X}:{a:04X}" for b, a in sorted(nat)))
    import os
    os.makedirs("ffl3/build/analysis", exist_ok=True)
    open("ffl3/build/analysis/bscript.txt", "w").write("\n".join(out) + "\n")
    print(len(lines), "statements;", len(nat), "natives")


if __name__ == "__main__":
    main()
