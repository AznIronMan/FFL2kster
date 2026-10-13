"""Legend I music sequences (sound driver in bank 07; docs/ffl1/FINDINGS.md, M7).

Song table 07:462F: 6 bytes per song = three channel pointers (pulse 1, pulse 2, wave), loaded
into the channel structs CE00/CE20/CE40 by 07:4059 when FFE0 != FFE1. Each tick (07:44BC ->
07:44DC per channel) reads commands until a note:
  00-DF  note: high nibble = pitch (0-11 within the octave; 12+ = rest), low nibble = duration
         index into 07:4403 (60 48 30 24 20 18 12 10 0C 09 08 06 04 03 02 ticks)
  E0 xx  tempo (FFEA)              E1-EF  channel byte +0B = low nibble
  F0-F4  octave (+05) = low nibble F5 xx  channel byte +18
  F7 xx  envelope: top 2 bits pick the slot (+0C/+0F/+12/+15), low 6 bits its id
  F8 xx  wave pattern 07:69BD + 256*(xx>>4) + 16*(xx&15) -> FF30
  F9-FB  loop counter (+06) = 1-3  FC lo hi  repeat: jump while the counter is not zero
  FD lo hi  jump when the counter is zero (else continue)   FE lo hi  jump   FF  end
Timing (07:4030, per frame): CEC2 += tempo; one tick each time it passes 60, so a loop of T
ticks lasts T * 60 / tempo frames on average.
"""

from __future__ import annotations

from . import rom as romlib

BANK = 0x07
SONGS = romlib.bank_to_file(BANK, 0x462F)
SONG_COUNT = 18                      # 07:462F-469A; the first channel data starts at 07:469B
DURATIONS = romlib.bank_to_file(BANK, 0x4403)
ARGS = {0xE0: 1, 0xF5: 1, 0xF7: 1, 0xF8: 1, 0xFC: 2, 0xFD: 2, 0xFE: 2}


def durations(rom: bytes) -> list[int]:
    return list(rom[DURATIONS:DURATIONS + 15])


def song_pointers(rom: bytes, song: int) -> list[int]:
    o = SONGS + 6 * song
    return [rom[o + 2 * k] | rom[o + 2 * k + 1] << 8 for k in range(3)]


def decode_channel(rom: bytes, ptr: int, max_events: int = 20000) -> dict:
    """Follow one channel: events in play order until it ends or revisits a jump target with the
    same loop state (the loop point). Returns events, loop start index and tick counts."""
    dur = durations(rom)
    events, seen = [], {}
    counter = 0
    tempo = None
    pc = ptr
    for _ in range(max_events):
        key = (pc, counter)
        if key in seen:
            loop_at = seen[key]
            ticks = [e.get("ticks", 0) for e in events]
            return {"events": events, "loop": loop_at, "intro_ticks": sum(ticks[:loop_at]),
                    "loop_ticks": sum(ticks[loop_at:]), "tempo": tempo, "end": False}
        seen[key] = len(events)
        o = romlib.bank_to_file(BANK, pc)
        b = rom[o]
        if b < 0xE0:
            events.append({"pc": pc, "op": "note", "pitch": b >> 4, "ticks": dur[b & 15]})
            pc += 1
        elif b == 0xFF:
            events.append({"pc": pc, "op": "end"})
            ticks = [e.get("ticks", 0) for e in events]
            return {"events": events, "loop": None, "intro_ticks": sum(ticks), "loop_ticks": 0,
                    "tempo": tempo, "end": True}
        else:
            n = ARGS.get(b, 0)
            arg = rom[o + 1:o + 1 + n]
            ev = {"pc": pc, "op": f"{b:02X}", "args": arg.hex()}
            events.append(ev)
            pc += 1 + n
            if b == 0xE0:
                tempo = tempo or arg[0]
            elif 0xF9 <= b <= 0xFB:
                counter = b - 0xF8
            elif b == 0xFC:
                if counter:
                    counter -= 1
                    pc = arg[0] | arg[1] << 8
            elif b == 0xFD:
                if counter == 0:
                    pc = arg[0] | arg[1] << 8
            elif b == 0xFE:
                pc = arg[0] | arg[1] << 8
    raise ValueError("channel did not loop or end")


def song(rom: bytes, s: int) -> dict:
    chans = [decode_channel(rom, p) for p in song_pointers(rom, s)]
    tempo = next((c["tempo"] for c in chans if c["tempo"]), None)
    return {"id": s, "pointers": song_pointers(rom, s), "tempo": tempo, "channels": chans}
