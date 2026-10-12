# Music driver (bank 0E)

## Driver basics

**Song selection**

- A song is requested by writing FFB0. Handler 0E:409B; the current song is in FFB3; FFB2 is a
  sound effect.
- Song n (1–19): `0E:49F5 + 6(n−1)` holds 3 channel pointers (pulse 1, pulse 2, wave). They are
  copied to the channel blocks CB00/CB18/CB30 (data pointers CB04/CB1C/CB34). Noise is not
  used by songs.

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

## Open

- Envelope tables (E0) and vibrato tables (E4) are not decoded, so MIDI instruments are generic.
  Decode them for timbre-exact remastering.
- Sound effects (FFB2) use a separate table.
- Song names are known only for 5 (title, probable), 10 (town), 12 (world) and 17 (battle).
  Event-script `sound` events show where every song is used.
