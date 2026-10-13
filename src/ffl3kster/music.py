"""Legend III music (bank 0F; docs/ffl3/FINDINGS.md, M7).

Driver (0F:4006, every vblank): when FFBA (requested song) differs from FFBB it starts song n
(1-20; 0 stops): four channel pointers from 0F:482F + 8(n - 1) (pulse 1, pulse 2, wave, noise),
tempo CB01 = 3C, accumulator CB00 = FF, every channel's duration counter 1 (0F:402D). Each frame
CB00 += CB01; on a carry every channel ticks twice (0F:41CE -> 41F9 x2). A tick decrements the
channel's counter; at 0 it reads bytes until a note:
  00-DF  note: low nibble -> duration (0F:41BE: 90 60 48 30 24 20 18 12 10 0C 09 08 06 04 03 02
         ticks), high nibble 0-B pitch (+ octave), C rest, D silence (0F:4408)
  E0-E7  octave (n & 7) * 12 notes;  E8-EF  octave shift (0F:4420)
  F0-FE  per-channel commands (tables 0F:4428/4448/4468/4488), operands in COMMANDS
  FF     end: the channel stops (CB05 = FF)
Commands: F1 jump; F2 / F9 loop on counter A / B (decrement, jump while not 0); F3 / FA set
counter A / B; FB jump if counter A equals the operand; F7 tempo (pulse 1 only); F0 / F4 table
pointers; F5 duty / F6 panning / ...; FE a channel set-up (several of the above at once).
"""

from __future__ import annotations

from . import rom as romlib

BANK = 0x0F
SONGS = 0x482F
SONG_COUNT = 20
DURATIONS = 0x41BE
CHANNELS = ("pulse1", "pulse2", "wave", "noise")
COMMAND_TABLES = (0x4428, 0x4448, 0x4468, 0x4488)
# handler address -> operand bytes (from the handlers, 0F:44A8-4615)
HANDLER_OPS = {0x44A8: 1, 0x44B0: 2, 0x44B5: 2, 0x44BA: 2, 0x44BF: 2, 0x44C4: 2, 0x44C9: 2,
               0x44D3: 1, 0x44D9: 1, 0x44DF: 1, 0x44E5: 1, 0x44EB: 1, 0x44F1: 1, 0x44F7: 1, 0x44FD: 1,
               0x4503: 2, 0x4508: 2, 0x450D: 2, 0x4512: 2, 0x4517: 2, 0x451C: 2, 0x4521: 2, 0x4526: 2,
               0x452F: 3, 0x4534: 3, 0x4539: 3, 0x453E: 3, 0x4548: 2, 0x454E: 1, 0x4556: 1, 0x4565: 1,
               0x456B: 2, 0x458F: 7, 0x459B: 1, 0x45AC: 6, 0x45B5: 1, 0x45CF: 6, 0x45D8: 1, 0x45E9: 1,
               0x4613: 1}
LOOP_A = {0x4503, 0x4508, 0x450D, 0x4512}
LOOP_B = {0x4517, 0x451C, 0x4521, 0x4526}
SET_A = {0x44D3, 0x44D9, 0x44DF, 0x44E5}
SET_B = {0x44EB, 0x44F1, 0x44F7, 0x44FD}
CMP_A = {0x452F, 0x4534, 0x4539, 0x453E}
JUMP, TEMPO, SETUP1 = 0x4548, 0x4565, 0x458F


def _p(addr: int) -> int:
    return romlib.bank_to_file(BANK, addr)


def _w(rom: bytes, addr: int) -> int:
    return rom[_p(addr)] | rom[_p(addr) + 1] << 8


def song_pointers(rom: bytes, n: int) -> list[int]:
    if not 1 <= n <= SONG_COUNT:
        raise ValueError(f"song {n} out of range 1..{SONG_COUNT}")
    return [_w(rom, SONGS + 8 * (n - 1) + 2 * c) for c in range(4)]


def handler(rom: bytes, ch: int, cmd: int) -> int:
    return _w(rom, COMMAND_TABLES[ch] + 2 * (cmd & 0x0F))


class Channel:
    def __init__(self, rom, ch, ptr):
        self.rom, self.ch, self.ptr = rom, ch, ptr
        self.stopped, self.count, self.a, self.b = False, 1, 0, 0

    def tick(self, song) -> None:
        if self.stopped:
            return
        self.count = (self.count - 1) & 0xFF
        if self.count:
            return
        rom = self.rom
        while True:
            c = rom[_p(self.ptr)]
            self.ptr += 1
            if c < 0xE0:
                self.count = rom[_p(DURATIONS) + (c & 0x0F)]
                return
            if c == 0xFF:
                self.stopped = True       # the stored pointer stays on the FF (0F:4217)
                self.ptr -= 1
                return
            if c < 0xF0:
                continue
            h = handler(rom, self.ch, c)
            if h == 0x4616:
                raise ValueError(f"channel {self.ch} command {c:02X} at 0F:{self.ptr - 1:04X} hangs the driver")
            ops = rom[_p(self.ptr):_p(self.ptr) + HANDLER_OPS[h]]
            if h == JUMP:
                self.ptr = ops[0] | ops[1] << 8
                continue
            if h in LOOP_A or h in LOOP_B:
                if h in LOOP_A:
                    self.a = (self.a - 1) & 0xFF
                    v = self.a
                else:
                    self.b = (self.b - 1) & 0xFF
                    v = self.b
                self.ptr = ops[0] | ops[1] << 8 if v else self.ptr + 2
                continue
            if h in CMP_A:
                self.ptr = ops[1] | ops[2] << 8 if ops[0] == self.a else self.ptr + 3
                continue
            if h in SET_A:
                self.a = ops[0]
            elif h in SET_B:
                self.b = ops[0]
            elif h == TEMPO or h == SETUP1:
                song.tempo = ops[0]
            self.ptr += len(ops)


class Song:
    """Frame-level model of the driver for one song: pointers after every frame."""
    def __init__(self, rom, n):
        self.tempo, self.acc = 0x3C, 0xFF
        self.channels = [Channel(rom, c, p) for c, p in enumerate(song_pointers(rom, n))]

    def frame(self) -> None:
        self.acc += self.tempo
        if self.acc > 0xFF:
            self.acc &= 0xFF
            for _ in range(2):
                for ch in self.channels:
                    ch.tick(self)

    def pointers(self) -> list[int]:
        return [c.ptr for c in self.channels]


def trace(rom: bytes, n: int, frames: int) -> list[list[int]]:
    s, out = Song(rom, n), []
    for _ in range(frames):
        s.frame()
        out.append(s.pointers())
    return out


def state(song: Song) -> tuple:
    return (song.acc, song.tempo) + tuple((c.ptr, c.count, c.a, c.b, c.stopped) for c in song.channels)


def loop(rom: bytes, n: int, limit: int = 60000) -> tuple[int, int]:
    """(first frame of the repeating part, period in frames) of the driver state, or (-1, -1)."""
    s, seen = Song(rom, n), {}
    for f in range(limit):
        s.frame()
        k = state(s)
        if k in seen:
            return seen[k], f - seen[k]
        seen[k] = f
    return -1, -1


def events(rom: bytes, n: int) -> list[list[dict]]:
    """Each channel's byte stream from its start, every reachable byte once (jumps followed)."""
    out = []
    for ch, start in enumerate(song_pointers(rom, n)):
        todo, seen, ev = [start], set(), []
        while todo:
            p = todo.pop()
            while p not in seen:
                seen.add(p)
                c = rom[_p(p)]
                if c < 0xE0:
                    ev.append({"at": p, "note": c >> 4, "length": rom[_p(DURATIONS) + (c & 0x0F)]})
                    p += 1
                    continue
                if c == 0xFF:
                    ev.append({"at": p, "end": True})
                    break
                if c < 0xF0:
                    ev.append({"at": p, "octave" if c < 0xE8 else "shift": c & 7})
                    p += 1
                    continue
                h = handler(rom, ch, c)
                ops = list(rom[_p(p + 1):_p(p + 1) + HANDLER_OPS[h]])
                ev.append({"at": p, "cmd": c, "ops": ops})
                if h == JUMP:
                    todo.append(ops[0] | ops[1] << 8)
                    break
                if h in LOOP_A or h in LOOP_B:
                    todo.append(ops[0] | ops[1] << 8)
                if h in CMP_A:
                    todo.append(ops[1] | ops[2] << 8)
                p += 1 + len(ops)
        out.append(sorted(ev, key=lambda e: e["at"]))
    return out


def export(rom: bytes) -> dict:
    return {"songs": [{"song": n, "pointers": [f"{p:04X}" for p in song_pointers(rom, n)],
                       "loop": dict(zip(("start_frame", "period_frames"), loop(rom, n))),
                       "channel_loops_ticks": {CHANNELS[c]: dict(zip(("start", "period"), channel_loop(rom, n, c)))
                                               for c in range(4)},
                       "channels": {CHANNELS[c]: e for c, e in enumerate(events(rom, n))}}
                      for n in range(1, SONG_COUNT + 1)]}


def channel_loop(rom: bytes, n: int, ch: int, limit: int = 200000) -> tuple[int, int]:
    """(first tick of the repeating part, period in ticks) of one channel, or (-1, 0) when it
    ends (FF). Tempo changes (F7, FE on pulse 1) do not affect ticks."""
    s = Song(rom, n)
    c, seen = s.channels[ch], {}
    for t in range(limit):
        c.tick(s)
        if c.stopped:
            return -1, 0
        k = (c.ptr, c.count, c.a, c.b)
        if k in seen:
            return seen[k], t - seen[k]
        seen[k] = t
    return -1, -1
