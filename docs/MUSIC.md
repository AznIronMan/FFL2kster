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

## Port: driver and synth

**Driver** (`port/packages/core/src/sound/`): every routine reachable from 0E:4000 and 0E:4003
(26 routines plus the three command tables) is ported one function per routine, with all state
at the original addresses (CB00-CBC7, FFB0-FFBD) and all sequence/envelope/vibrato/waveform/SFX
data read from the ROM at run time. Findings from the code (verified by the fixtures below):

- Channel blocks are 0x18 bytes at CB02 / CB1A / CB32 (initialised from 0E:4175); CB1A doubles
  as the pulse-1 SFX frame counter and CB4A is the noise SFX counter. The octave byte is
  octave×24 (a byte offset into the 0E:419A word table).
- Song requests (FFB0) and SFX requests (FFB2) are only handled while no SFX is playing on
  pulse 1. FFB0 = 0 runs the full init (0E:4048).
- FFB1 is a jingle request: CB00-CB61 are saved to CB62, song FFB1 plays, and when all three
  channels have ended (or FFB1 is cleared) the saved song is restored (0E:411D), including
  pulse 2's duty/volume, pulse 1 and the waveform (pointer kept in FFBA/BB).
- The modulation step (one channel per frame, FFB4) is skipped while the channel's last tick
  counter (FFB5-B7) is 0, i.e. right after a new note.
- Original quirks kept: the pulse note-on loads the envelope pointer instead of storing it
  (harmless), the end of song channel 1 silences pulse 2's NR23/24, and the list loop 0E:4916
  writes two bytes into the ROM area (MBC writes, no effect).
- `installSound(g)` sets `hooks.soundTick` (bank 0E selected around the call and the previous
  FF88 bank restored, as 00:16F9 does) and `hooks.soundInit` (bank 0E selected and left, as
  `ld a,$0E; rst $28; call $4003` at 00:0280 does).

**Verification (verified).** `tools/sound_capture.py` runs PyBoy with hooks on the driver's
entry/exit and on every `ldh [$10-$3F],a` / `ld [c],a` instruction, and records per driver call
the driver RAM before/after and the ordered register writes (build/sound/fixtures, gitignored).
`port/packages/core/test/sound.test.ts` replays them chained (the port's RAM carries over; only
bytes the game changed between calls are injected) and requires identical RAM (CB00-CBFF,
FFB0-FFBF) and identical write sequences: 80,581 driver calls and 117,040 register writes
identical, covering all 19 songs (2,230-4,430 frames each: every looping song past its loop
point, song 1 to its end, song 15 — 12,660 frames, no loop — for its first 4,430), all 57 SFX
over music and alone, overlapping SFX, a song request during an SFX, song changes and a stop
mid-song, the jingle (FFB1) with its restore and an early cancel, and the boot init. Paths not
reached by the recordings: the no-op command slots, an E5 duty change on channel 1 during an
SFX, envelope hold (0xFF) and envelope list loops.

**Synthesizer** (`port/packages/audio/src/apu.ts`): a DMG APU fed with time-stamped register
writes (pulse 1 with sweep, pulse 2, wave, noise 15/7-bit LFSR, lengths, envelopes, 512 Hz frame
sequencer, trigger and DAC semantics, NR50/51/52), rendering stereo Float32 at any rate. Each
sample is the exact average of the channel outputs over its span (box filter), followed by the
DMG high-pass filter. The web player feeds it from `Memory.onSoundWrite` and plays through an
AudioWorklet ring buffer (first key/click starts audio, M mutes).

**Synth vs PyBoy (probable: different filtering, same musical output).**
`port/packages/audio/test/apu.test.ts` renders the recorded writes of every song and of all
SFX in "digital" mode (PyBoy's unipolar sum of 4-bit channel outputs) and compares with PyBoy's
own 48 kHz buffer of the same run (APU powered off first so both start from the same state).
Exact samples differ (PyBoy point-samples; pulse duty positions depend on history), so the
metrics are: loudness (means of 4096-sample windows) correlation ≥ 0.95 and mean error ≤ 5 %;
median RMS ratio of 1024-sample windows in [0.9, 1.05]; median spectral cosine similarity of
1024-sample windows ≥ 0.9. Results over 20 recordings (≈ 17 minutes of audio): loudness
correlation 0.977-1.000, error 0.5-2.5 %, RMS ratio 0.943-0.996, spectral cosine 0.916-0.983.
