"""Music driver (bank 0E) sequence decoder and MIDI export.

Evidence (docs/MUSIC.md): song request FFB0 → 0E:409B; song n (1-19) → 3 channel pointers at
0E:49F5 + 6(n-1) (pulse 1, pulse 2, wave) copied to CB04/CB1C/CB34. Per frame CB00 += tempo
(CB01, set by command E7 on channel 1); each carry runs the tick routine 0E:4281 twice.
Channel bytes: < D0 note (hi nibble = duration index into 0E:4244, lo nibble = pitch 0-13,
0E = tie, 0F = rest); D0-D7 set octave; D8-DF relative octave (0E:47B5); E0-EB commands
(tables 0E:4358 / 0E:45AB / 0E:4706); FF end. Pitch → frequency register via 0E:419A.
"""
from __future__ import annotations

BANK = 0x0E
SONG_TABLE = 0x49F5
NSONGS = 19
DUR_TABLE = 0x4244
FREQ_TABLE = 0x419A
OCT_REL = 0x47B5
# command arg byte counts per channel (handlers listed in docs/MUSIC.md)
ARGS = [
    {0xE0: 2, 0xE1: 2, 0xE2: 2, 0xE3: 1, 0xE4: 2, 0xE5: 1, 0xE6: 1, 0xE7: 1, 0xE8: 0, 0xE9: 2, 0xEA: 1, 0xEB: 3},
    {0xE0: 2, 0xE1: 2, 0xE2: 2, 0xE3: 1, 0xE4: 2, 0xE5: 1, 0xE6: 1, 0xE7: 0, 0xE8: 0, 0xE9: 2, 0xEA: 1, 0xEB: 3},
    {0xE0: 1, 0xE1: 2, 0xE2: 2, 0xE3: 1, 0xE4: 2, 0xE5: 0, 0xE6: 1, 0xE7: 0, 0xE8: 2, 0xE9: 2, 0xEA: 1, 0xEB: 3},
]
CMD_NAMES = {0xE1: "jump", 0xE2: "loop1", 0xE3: "count1", 0xE4: "vibrato_ptr", 0xE6: "pan",
             0xE9: "loop2", 0xEA: "count2", 0xEB: "jump_if_count1", 0xE8: "nop"}
CH_CMD = [{0xE0: "envelope_ptr", 0xE5: "duty", 0xE7: "tempo"},
          {0xE0: "envelope_ptr", 0xE5: "duty"},
          {0xE0: "wave_volume", 0xE8: "wave_ptr"}]


def off(a: int) -> int:
    return BANK * 0x4000 + a - 0x4000


def b(rom, a):
    return rom[off(a)]


def song_pointers(rom: bytes, n: int) -> list[int]:
    o = off(SONG_TABLE + 6 * (n - 1))
    return [rom[o + 2 * i] | rom[o + 2 * i + 1] << 8 for i in range(3)]


def durations(rom: bytes) -> list[int]:
    return [b(rom, DUR_TABLE + i) for i in range(13)]


def freq_reg(rom: bytes, idx: int) -> int:
    """11-bit frequency register value (the table stores NRx3/NRx4 with the trigger bit 7 set)."""
    o = off(FREQ_TABLE + 2 * idx)
    return (rom[o] | rom[o + 1] << 8) & 0x7FF


def parse_channel(rom: bytes, ch: int, start: int, max_events: int = 20000) -> dict:
    """Linear walk with loop expansion; stops at FF or at the first backward/forward E1 jump
    (the song's loop point). Returns events and the loop target."""
    dur = durations(rom)
    pc, octave, events, loop_to = start, 0, [], None
    c1 = c2 = 0
    tick = 0
    steps = 0
    while steps < max_events:
        steps += 1
        op = b(rom, pc)
        if op < 0xD0:
            d = dur[op >> 4] if (op >> 4) < 13 else 0
            p = op & 0x0F
            if p == 0x0F:
                events.append({"t": tick, "type": "rest", "dur": d})
            elif p == 0x0E:
                events.append({"t": tick, "type": "tie", "dur": d})
            else:
                fi = octave // 2 + p
                events.append({"t": tick, "type": "note", "dur": d, "index": fi, "freq_reg": freq_reg(rom, fi)})
            tick += d
            pc += 1
        elif op < 0xD8:
            octave = (op & 7) * 24; pc += 1
        elif op < 0xE0:
            octave = (octave + b(rom, OCT_REL + (op & 7))) & 0xFF; pc += 1
        elif op == 0xFF:
            events.append({"t": tick, "type": "end"}); break
        elif op in ARGS[ch]:
            n = ARGS[ch][op]
            args = [b(rom, pc + 1 + i) for i in range(n)]
            nxt = pc + 1 + n
            if op == 0xE1:
                loop_to = args[0] | args[1] << 8
                events.append({"t": tick, "type": "loop", "to": loop_to, "at": pc}); break
            elif op == 0xE3:
                c1 = args[0]
            elif op == 0xEA:
                c2 = args[0]
            elif op in (0xE2, 0xE9):
                if op == 0xE2:
                    c1 = (c1 - 1) & 0xFF; again = c1 != 0
                else:
                    c2 = (c2 - 1) & 0xFF; again = c2 != 0
                if again:
                    nxt = args[0] | args[1] << 8
            elif op == 0xEB:
                if c1 == args[0]:
                    nxt = args[1] | args[2] << 8
            else:
                name = CH_CMD[ch].get(op) or CMD_NAMES.get(op, f"cmd_{op:02X}")
                events.append({"t": tick, "type": name, "args": args})
            pc = nxt
        else:
            raise ValueError(f"invalid byte {op:02X} at 0E:{pc:04X} (channel {ch})")
    end_pc = events[-1].get("at", pc) if events else pc
    return {"events": events, "loop_to": loop_to, "loop_at": end_pc, "length_ticks": tick}


def parse_song(rom: bytes, n: int) -> dict:
    return {"song": n, "channels": [parse_channel(rom, ch, p) for ch, p in enumerate(song_pointers(rom, n))]}


def tempo(song: dict) -> int | None:
    for e in song["channels"][0]["events"]:
        if e["type"] == "tempo":
            return e["args"][0]
    return None


def hz(freq_reg: int, wave: bool) -> float:
    return (65536 if wave else 131072) / (2048 - freq_reg)


def to_midi(song: dict, ticks_per_quarter: int = 24) -> bytes:
    """Type-1 MIDI, one track per channel, one pass through the song (to the loop point).
    Tempo: ticks/second = 2 * tempo/256 * 59.7275 (two driver ticks per accumulator carry)."""
    import math
    import struct
    t = tempo(song) or 0x40
    tps = 2 * t / 256 * 59.7275
    us_per_quarter = int(1_000_000 * ticks_per_quarter / tps)

    def vlq(v):
        out = [v & 0x7F]
        v >>= 7
        while v:
            out.insert(0, (v & 0x7F) | 0x80); v >>= 7
        return bytes(out)

    tracks = []
    for ch, c in enumerate(song["channels"]):
        ev = []
        if ch == 0:
            ev.append((0, b"\xff\x51\x03" + us_per_quarter.to_bytes(3, "big")))
        ev.append((0, bytes([0xC0 | ch, 80 if ch < 2 else 81])))
        cur = None
        for e in c["events"]:
            if e["type"] == "note":
                if cur is not None:
                    ev.append((e["t"], bytes([0x80 | ch, cur, 0])))
                f = hz(e["freq_reg"], ch == 2)
                cur = max(0, min(127, round(69 + 12 * math.log2(f / 440))))
                ev.append((e["t"], bytes([0x90 | ch, cur, 96])))
            elif e["type"] in ("rest", "end", "loop"):
                if cur is not None:
                    ev.append((e["t"], bytes([0x80 | ch, cur, 0]))); cur = None
        if cur is not None:
            ev.append((c["length_ticks"], bytes([0x80 | ch, cur, 0])))
        ev.sort(key=lambda x: x[0])
        data, last = bytearray(), 0
        for tk, msg in ev:
            data += vlq(tk - last) + msg; last = tk
        data += b"\x00\xff\x2f\x00"
        tracks.append(b"MTrk" + struct.pack(">I", len(data)) + bytes(data))
    return b"MThd" + struct.pack(">IHHH", 6, 1, len(tracks), ticks_per_quarter) + b"".join(tracks)


SONG_NAMES = {5: "title (probable)", 10: "town (observed)", 12: "world map (observed)",
              17: "battle (observed)"}


def add_commands(sub) -> None:
    import json
    import os
    from . import rom as romlib

    def cmd(a):
        rom = romlib.load_rom(a.rom)
        os.makedirs(a.out, exist_ok=True)
        summary = []
        for n in range(1, NSONGS + 1):
            s = parse_song(rom, n)
            with open(os.path.join(a.out, f"song_{n:02d}.mid"), "wb") as fh:
                fh.write(to_midi(s))
            t = tempo(s)
            summary.append({"song": n, "name": SONG_NAMES.get(n), "tempo": t,
                            "ticks_per_second": round(2 * t / 256 * 59.7275, 3),
                            "channels": [{"length_ticks": c["length_ticks"], "loops": c["loop_to"] is not None,
                                          "notes": sum(e["type"] == "note" for e in c["events"])}
                                         for c in s["channels"]]})
        with open(os.path.join(a.out, "songs.json"), "w") as fh:
            json.dump({"source_sha256": romlib.sha256(rom), "songs": summary,
                       "instruments": instruments(rom)}, fh, indent=1)
        with open(os.path.join(a.out, "sfx.json"), "w") as fh:
            json.dump({"source_sha256": romlib.sha256(rom), "sfx": sfx(rom)}, fh, indent=1)
        print(f"wrote {a.out}: {NSONGS} MIDI files + songs.json + sfx.json")
        return 0

    s = sub.add_parser("music-export", help="decode the 19 songs to MIDI + summary")
    s.add_argument("--rom", default="input/original.gb")
    s.add_argument("--out", default="data/music")
    s.set_defaults(fn=cmd)


# ---------------------------------------------------------------- instruments and SFX
# Per-channel modulation lists (each channel steps its lists every 3rd frame, FFB4 = 0/1/2):
#   (music "channel 1/2" drive hardware pulse 2 / pulse 1 is shared with SFX: see docs/MUSIC.md)
#   envelope (E0, pulse channels): entries [frames/3, NRx2 value]; a 0 entry is followed by a
#     pointer to continue from (loop). The list restarts at every note-on (0E:47AC).
#   vibrato (E4, all channels): entries [frames/3, signed delta added to the note's 11-bit
#     frequency]; 0 + pointer = loop.
#   waveform (E8, wave channel): 16 bytes copied to wave RAM (32 4-bit samples).
# SFX n (1-57, FFB2): pulse-1 stream at 0E:7AC5[n-1] (steps [frames, NR10..NR14]) and noise
#   stream at 0E:7B37[n-1] (steps [frames, NR42, NR43], NR44 = 0x80); a 0 duration ends the
#   stream, 0xF0|k sets a loop counter, 0xEF lo hi loops back while the counter runs
#   (0E:4920/4949). The pulse SFX stream pre-empts music channel 1 while active (CB1A).
SFX_PULSE = 0x7AC5
SFX_NOISE = 0x7B37
NSFX = 57


def _w(rom, a):
    return b(rom, a) | b(rom, a + 1) << 8


def mod_list(rom: bytes, ptr: int, signed: bool, limit: int = 64, hold_ff: bool = False) -> dict:
    """Decode a modulation list. Envelope lists (hold_ff) stop at a 0xFF duration, which the
    driver holds forever (0E:4821); a 0 duration is followed by a loop pointer."""
    steps, seen, p = [], {}, ptr
    while len(steps) < limit:
        if p in seen:
            break
        d = b(rom, p)
        if d == 0:
            tgt = _w(rom, p + 1)
            return {"ptr": ptr, "steps": steps, "loop_to": seen.get(tgt, tgt)}
        seen[p] = len(steps)
        v = b(rom, p + 1)
        steps.append([d, v - 256 if signed and v > 127 else v])
        if hold_ff and d == 0xFF:
            return {"ptr": ptr, "steps": steps, "loop_to": None, "hold": True}
        p += 2
    return {"ptr": ptr, "steps": steps, "loop_to": None}


def instruments(rom: bytes) -> dict:
    env, vib, wav = {}, {}, {}
    for n in range(1, NSONGS + 1):
        for ch, start in enumerate(song_pointers(rom, n)):
            for e in parse_channel(rom, ch, start)["events"]:
                if e["type"] == "envelope_ptr":
                    a = e["args"][0] | e["args"][1] << 8
                    env.setdefault(f"{a:04X}", mod_list(rom, a, False, hold_ff=True))
                elif e["type"] == "vibrato_ptr":
                    a = e["args"][0] | e["args"][1] << 8
                    vib.setdefault(f"{a:04X}", mod_list(rom, a, True))
                elif e["type"] == "wave_ptr":
                    a = e["args"][0] | e["args"][1] << 8
                    raw = [b(rom, a + i) for i in range(16)]
                    wav.setdefault(f"{a:04X}", [s for x in raw for s in (x >> 4, x & 15)])
    return {"envelopes": env, "vibratos": vib, "waveforms": wav}


def sfx_stream(rom: bytes, ptr: int, regs: int, limit: int = 256) -> list:
    out, p = [], ptr
    while len(out) < limit:
        d = b(rom, p)
        if d == 0:
            out.append({"end": True}); break
        if d == 0xEF:
            out.append({"loop_to": _w(rom, p + 1)}); p += 3; continue
        if d >= 0xF0:
            out.append({"loop_count": d & 0x0F}); p += 1; continue
        out.append({"frames": d, "regs": [b(rom, p + 1 + i) for i in range(regs)], "at": p}); p += 1 + regs
    return out


def sfx(rom: bytes) -> list[dict]:
    return [{"sfx": n, "pulse": sfx_stream(rom, _w(rom, SFX_PULSE + 2 * (n - 1)), 5),
             "noise": sfx_stream(rom, _w(rom, SFX_NOISE + 2 * (n - 1)), 2)}
            for n in range(1, NSFX + 1)]
