# Music driver (bank 0E)

## Driver basics

**Song selection**

- A song is requested by writing FFB0. Handler 0E:409B; the current song is in FFB3; FFB2 is a
  sound effect.
- Song n (1–19): `0E:49F5 + 6(n−1)` holds 3 channel pointers. They are copied to the channel
  blocks CB00/CB18/CB30 (data pointers CB04/CB1C/CB34).
- **Hardware mapping (corrected, P0):** song channel 0 drives **pulse 2** (NR21–24), song
  channel 1 drives **pulse 1** (NR11–14) and song channel 2 drives **wave** (NR30–34).
  Pulse 1 is shared with sound effects, which pre-empt it. Noise is used only by sound
  effects.

**Timing (verified)**

- Every frame the driver does `CB00 += tempo` (tempo is CB01, set by command E7 on channel 1).
- Each carry runs the tick routine 0E:4281 **twice**.
- So frames = ticks · 256 / (2 · tempo).
- Observed in PyBoy, channel loop periods match exactly:
  - song 2: 3277/3277 frames;
  - song 7: 1404/1415/1404, which also shows that channels loop independently.
  - Test: `test_music_timing_matches_decoded_sequences`.

**Frequencies.** 0E:419A holds the NRx3/NRx4 words with bit 15 (trigger) set; the 11-bit value
gives Hz = 131072/(2048−x) (wave: 65536/(2048−x)). Index 0 = C2 (65.4 Hz), in equal-tempered
semitones.

## Sequence bytes (parsers 0E:4295 / 0E:44E0 / 0E:4660)

| Byte | Meaning |
|---|---|
| 00–CF | note. Hi nibble = duration index into 0E:4244: 96, 72, 48, 32, 36, 24, 16, 18, 12, 8, 6, 4, 3 ticks. Lo nibble: 0–13 = pitch (freq index = octave·12 + pitch), 0E = tie (no retrigger), 0F = rest |
| D0–D7 | set octave (b & 7) |
| D8–DF | relative octave: +1…+4 / −1…−4 (0E:47B5, in 12-step units) |
| E0 | ch1/2: envelope table ptr (2 bytes); wave: volume NR32 (1) |
| E1 | jump (2): the song loop point |
| E2 / E9 | loop: decrement counter 1/2 and jump while ≠ 0 (2) |
| E3 / EA | set loop counter 1/2 (1) |
| E4 | vibrato/pitch table ptr (2) |
| E5 | ch1/2 duty NRx1 (1); wave: none |
| E6 | panning via 0E:4648 / 0E:4778 (1) |
| E7 | ch1: tempo (1); ch2/wave: none |
| E8 | ch1/2: none; wave: waveform pointer (2, 16 bytes → wave RAM) |
| EB | jump if counter 1 == n (n, 2-byte address) |
| FF | end of channel |

All 19 songs decode with no invalid bytes. Where a song loops, every channel has the same total
length except songs 5, 6 and 7, whose channels loop independently.

## Exports

`ffl2kster music-export` writes `data/music/song_NN.mid` (type 1, 3 tracks, one pass to the
loop point, note timing and pitch exact) and `songs.json` (tempo, ticks/s, lengths, note counts).
Audio renders from `tools/music_capture.py` stay in `build/` and are not committed.

## Instruments (P0, verified via SFX register timing; envelope semantics from code)

Each channel steps its modulation lists every **3rd frame** (FFB4 rotates 0/1/2).

**Envelope (E0, pulse channels)**

- Entries are `[ticks, NRx2]`; the list restarts at every note-on (0E:47AC).
- A duration of 0xFF holds forever (0E:4821).
- A duration of 0 is followed by a loop pointer.
- 24 lists are used. Most are a single long step (99 ticks), so in practice they act as fixed
  NRx2 volume/decay settings.

**Vibrato (E4, all channels)**

- Entries are `[ticks, signed delta]`. The delta is added to the note's 11-bit frequency;
  0 + pointer loops.
- 5 lists are used.

**Waveforms (E8)**

- Each is 16 bytes, i.e. 32 4-bit samples.
- 5 are used.

**Sound effects (FFB2 = n, 1–57; 0E:4920/4949)**

- Each SFX has a pulse-1 stream at `0E:7AC5[n−1]` (steps `[frames, NR10..NR14]`) and a noise
  stream at `0E:7B37[n−1]` (steps `[frames, NR42, NR43]`, then NR44 = 0x80).
- Stream control bytes:
  - 0 = end;
  - `0xF0|k` = set loop count;
  - `0xEF lo hi` = loop.
- **Verified:** for SFX 1, 10 and 25 the per-frame NR12/NR42/NR43 values and their durations
  equal the decode (`test_sfx_register_timeline`).

`music-export` now also writes the instrument tables into `songs.json`, and a decoded `sfx.json`.

## Open
- Song names are known only for 5 (title, probable), 10 (town), 12 (world) and 17 (battle).
  Event-script `sound` events show where every song is used.
