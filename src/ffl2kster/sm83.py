"""Minimal SM83 (Game Boy CPU) interpreter for running isolated ROM routines as an oracle.

No PPU/APU/timers/interrupt delivery: ``call(addr)`` runs until the routine returns to a
sentinel. Memory: MBC1 ROM banking (writes to 0x2000-0x3FFF select the bank), VRAM, SRAM,
WRAM (+echo), I/O and HRAM as plain bytes. Used to validate re-implementations of ROM logic
(e.g. the map layout drawer 00:2253) bit-exactly; never needed at runtime by the port.
"""
from __future__ import annotations


class Halt(Exception):
    pass


class CPU:
    R8 = ["b", "c", "d", "e", "h", "l", None, "a"]

    def __init__(self, rom: bytes):
        self.rom = rom
        self.bank = 1
        self.mem = bytearray(0x10000)
        self.a = self.b = self.c = self.d = self.e = self.h = self.l = 0
        self.fz = self.fn = self.fh = self.fc = 0
        self.sp = 0xFFFE  # HRAM: keeps the stack clear of WRAM buffers routines may fill
        self.pc = 0
        self.ime = 0
        self.steps = 0

    # ------------------------------------------------------------- memory
    def rd(self, a: int) -> int:
        a &= 0xFFFF
        if a < 0x4000:
            return self.rom[a]
        if a < 0x8000:
            return self.rom[self.bank * 0x4000 + a - 0x4000]
        if 0xE000 <= a < 0xFE00:
            a -= 0x2000
        if a == 0xFF44:  # LY: advance on every read so "wait for line N" loops terminate
            self.ly = (getattr(self, "ly", 0) + 1) % 154
            return self.ly
        return self.mem[a]

    def wr(self, a: int, v: int) -> None:
        a &= 0xFFFF
        v &= 0xFF
        if a < 0x8000:
            if 0x2000 <= a < 0x4000:
                self.bank = (v & 0x1F) or 1
            return
        if 0xE000 <= a < 0xFE00:
            a -= 0x2000
        self.mem[a] = v

    def rd16(self, a): return self.rd(a) | self.rd(a + 1) << 8
    def wr16(self, a, v): self.wr(a, v & 0xFF); self.wr(a + 1, v >> 8)

    def fetch(self):
        v = self.rd(self.pc); self.pc = (self.pc + 1) & 0xFFFF; return v

    def fetch16(self):
        v = self.rd16(self.pc); self.pc = (self.pc + 2) & 0xFFFF; return v

    def push(self, v):
        self.sp = (self.sp - 2) & 0xFFFF; self.wr16(self.sp, v)

    def pop(self):
        v = self.rd16(self.sp); self.sp = (self.sp + 2) & 0xFFFF; return v

    # ------------------------------------------------------------- registers
    @property
    def f(self):
        return self.fz << 7 | self.fn << 6 | self.fh << 5 | self.fc << 4

    @f.setter
    def f(self, v):
        self.fz, self.fn, self.fh, self.fc = v >> 7 & 1, v >> 6 & 1, v >> 5 & 1, v >> 4 & 1

    def g16(self, n):  # bc de hl sp
        if n == 0: return self.b << 8 | self.c
        if n == 1: return self.d << 8 | self.e
        if n == 2: return self.h << 8 | self.l
        return self.sp

    def s16(self, n, v):
        v &= 0xFFFF
        if n == 0: self.b, self.c = v >> 8, v & 0xFF
        elif n == 1: self.d, self.e = v >> 8, v & 0xFF
        elif n == 2: self.h, self.l = v >> 8, v & 0xFF
        else: self.sp = v

    def g8(self, i):
        if i == 6: return self.rd(self.h << 8 | self.l)
        return getattr(self, self.R8[i])

    def s8(self, i, v):
        v &= 0xFF
        if i == 6: self.wr(self.h << 8 | self.l, v)
        else: setattr(self, self.R8[i], v)

    def cond(self, cc):
        return (not self.fz, self.fz, not self.fc, self.fc)[cc]

    # ------------------------------------------------------------- ALU
    def alu(self, op, v):
        a = self.a
        if op in (0, 1):  # add, adc
            c = self.fc if op == 1 else 0
            r = a + v + c
            self.fh = int((a & 0xF) + (v & 0xF) + c > 0xF); self.fc = int(r > 0xFF); self.fn = 0
            self.a = r & 0xFF; self.fz = int(self.a == 0)
        elif op in (2, 3, 7):  # sub, sbc, cp
            c = self.fc if op == 3 else 0
            r = a - v - c
            self.fh = int((a & 0xF) - (v & 0xF) - c < 0); self.fc = int(r < 0); self.fn = 1
            self.fz = int(r & 0xFF == 0)
            if op != 7: self.a = r & 0xFF
        elif op == 4:
            self.a = a & v; self.fz = int(self.a == 0); self.fn = 0; self.fh = 1; self.fc = 0
        elif op == 5:
            self.a = a ^ v; self.fz = int(self.a == 0); self.fn = self.fh = self.fc = 0
        elif op == 6:
            self.a = a | v; self.fz = int(self.a == 0); self.fn = self.fh = self.fc = 0

    def cb(self):
        op = self.fetch(); r = op & 7; x = op >> 6; y = (op >> 3) & 7
        v = self.g8(r)
        if x == 0:
            if y == 0: c = v >> 7; v = (v << 1 | c) & 0xFF
            elif y == 1: c = v & 1; v = (v >> 1) | c << 7
            elif y == 2: c = v >> 7; v = (v << 1 | self.fc) & 0xFF
            elif y == 3: c = v & 1; v = (v >> 1) | self.fc << 7
            elif y == 4: c = v >> 7; v = (v << 1) & 0xFF
            elif y == 5: c = v & 1; v = (v >> 1) | (v & 0x80)
            elif y == 6: c = 0; v = ((v & 0xF) << 4) | (v >> 4)
            else: c = v & 1; v >>= 1
            self.fz = int(v == 0); self.fn = self.fh = 0; self.fc = c
            self.s8(r, v)
        elif x == 1:
            self.fz = int(not (v >> y) & 1); self.fn = 0; self.fh = 1
        elif x == 2:
            self.s8(r, v & ~(1 << y))
        else:
            self.s8(r, v | (1 << y))

    # ------------------------------------------------------------- execute
    def step(self):
        self.steps += 1
        op = self.fetch()
        x, y, z = op >> 6, (op >> 3) & 7, op & 7
        if x == 1:
            if op == 0x76:
                return  # HALT: no interrupts are modelled; treat as a no-op
            self.s8(y, self.g8(z)); return
        if x == 2:
            self.alu(y, self.g8(z)); return
        if op == 0x00: return
        if op == 0x08: self.wr16(self.fetch16(), self.sp); return
        if op == 0x10: self.fetch(); raise Halt("stop")
        if op == 0x18:
            d = self.fetch(); self.pc = (self.pc + (d - 256 if d > 127 else d)) & 0xFFFF; return
        if op in (0x20, 0x28, 0x30, 0x38):
            d = self.fetch()
            if self.cond((op >> 3) & 3): self.pc = (self.pc + (d - 256 if d > 127 else d)) & 0xFFFF
            return
        if x == 0 and z == 1:
            p = y >> 1
            if y & 1 == 0: self.s16(p, self.fetch16())
            else:
                hl = self.g16(2); v = self.g16(p); r = hl + v
                self.fn = 0; self.fh = int((hl & 0xFFF) + (v & 0xFFF) > 0xFFF); self.fc = int(r > 0xFFFF)
                self.s16(2, r)
            return
        if x == 0 and z == 2:
            hl = self.g16(2)
            addr = (self.g16(0), self.g16(1), hl, hl)[y >> 1]
            if y & 1 == 0: self.wr(addr, self.a)
            else: self.a = self.rd(addr)
            if y >> 1 == 2: self.s16(2, hl + 1)
            elif y >> 1 == 3: self.s16(2, hl - 1)
            return
        if x == 0 and z == 3:
            p = y >> 1; self.s16(p, self.g16(p) + (1 if y & 1 == 0 else -1)); return
        if x == 0 and z in (4, 5):
            v = self.g8(y); r = (v + (1 if z == 4 else -1)) & 0xFF
            self.fz = int(r == 0); self.fn = int(z == 5)
            self.fh = int((v & 0xF) == 0xF) if z == 4 else int((v & 0xF) == 0)
            self.s8(y, r); return
        if x == 0 and z == 6:
            self.s8(y, self.fetch()); return
        if x == 0 and z == 7:
            a = self.a
            if y == 0: c = a >> 7; self.a = (a << 1 | c) & 0xFF; self.fc = c; self.fz = self.fn = self.fh = 0
            elif y == 1: c = a & 1; self.a = (a >> 1) | c << 7; self.fc = c; self.fz = self.fn = self.fh = 0
            elif y == 2: c = a >> 7; self.a = (a << 1 | self.fc) & 0xFF; self.fc = c; self.fz = self.fn = self.fh = 0
            elif y == 3: c = a & 1; self.a = (a >> 1) | self.fc << 7; self.fc = c; self.fz = self.fn = self.fh = 0
            elif y == 4:  # daa
                if not self.fn:
                    if self.fc or a > 0x99: a += 0x60; self.fc = 1
                    if self.fh or (a & 0xF) > 9: a += 6
                else:
                    if self.fc: a -= 0x60
                    if self.fh: a -= 6
                self.a = a & 0xFF; self.fz = int(self.a == 0); self.fh = 0
            elif y == 5: self.a = a ^ 0xFF; self.fn = self.fh = 1
            elif y == 6: self.fc = 1; self.fn = self.fh = 0
            else: self.fc ^= 1; self.fn = self.fh = 0
            return
        # x == 3
        if op in (0xC0, 0xC8, 0xD0, 0xD8):
            if self.cond(y): self.pc = self.pop()
            return
        if op == 0xC9: self.pc = self.pop(); return
        if op == 0xD9: self.pc = self.pop(); self.ime = 1; return
        if op in (0xC1, 0xD1, 0xE1, 0xF1):
            v = self.pop(); p = (op >> 4) - 0xC
            if p == 3: self.a, self.f = v >> 8, v & 0xF0
            else: self.s16(p, v)
            return
        if op in (0xC5, 0xD5, 0xE5, 0xF5):
            p = (op >> 4) - 0xC
            self.push((self.a << 8 | self.f) if p == 3 else self.g16(p)); return
        if op in (0xC2, 0xCA, 0xD2, 0xDA):
            t = self.fetch16()
            if self.cond(y): self.pc = t
            return
        if op == 0xC3: self.pc = self.fetch16(); return
        if op in (0xC4, 0xCC, 0xD4, 0xDC):
            t = self.fetch16()
            if self.cond(y): self.push(self.pc); self.pc = t
            return
        if op == 0xCD: t = self.fetch16(); self.push(self.pc); self.pc = t; return
        if z == 6: self.alu(y, self.fetch()); return
        if z == 7: self.push(self.pc); self.pc = y * 8; return
        if op == 0xCB: self.cb(); return
        if op == 0xE0: self.wr(0xFF00 + self.fetch(), self.a); return
        if op == 0xF0: self.a = self.rd(0xFF00 + self.fetch()); return
        if op == 0xE2: self.wr(0xFF00 + self.c, self.a); return
        if op == 0xF2: self.a = self.rd(0xFF00 + self.c); return
        if op == 0xEA: self.wr(self.fetch16(), self.a); return
        if op == 0xFA: self.a = self.rd(self.fetch16()); return
        if op in (0xE8, 0xF8):
            d = self.fetch(); s = d - 256 if d > 127 else d; sp = self.sp
            r = (sp + s) & 0xFFFF
            self.fz = self.fn = 0; self.fh = int((sp & 0xF) + (d & 0xF) > 0xF); self.fc = int((sp & 0xFF) + d > 0xFF)
            if op == 0xE8: self.sp = r
            else: self.s16(2, r)
            return
        if op == 0xE9: self.pc = self.g16(2); return
        if op == 0xF9: self.sp = self.g16(2); return
        if op == 0xF3: self.ime = 0; return
        if op == 0xFB: self.ime = 1; return
        raise Halt(f"illegal opcode {op:02X} at {self.pc - 1:04X}")

    def call(self, addr: int, max_steps: int = 3_000_000, traps: dict | None = None) -> int:
        """Run the routine at ``addr`` (bank 0 or current bank) until it returns.
        traps: {address: callback(cpu)} — when PC reaches a trapped address the callback runs and
        the CPU returns to the caller (used to stub presentation routines such as rst $20)."""
        sentinel = 0xFF00  # I/O address, never executed by real code
        self.push(sentinel)
        self.pc = addr
        n = 0
        while self.pc != sentinel:
            if traps and self.pc in traps:
                traps[self.pc](self)
                self.pc = self.pop()
                continue
            self.step(); n += 1
            if n > max_steps:
                raise Halt(f"step limit at {self.pc:04X}")
        return n
