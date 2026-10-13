# Architecture notes — the evening it all clicked (2026-10-12)

Plain-English record of the big revelations, so nobody has to re-derive them.

## 1. The port performs the ROM; it doesn't emulate it

- An emulator (PyBoy, the test harness) executes the ROM's Game Boy machine
  code, instruction by instruction. The port never touches machine code.
- The port imports the ROM's data tables plus its script/VM bytecode, and the
  TypeScript engine carries out the game itself — own renderer, own synth —
  verified frame-by-frame against the original.
- **ROM = the sheet music. App = the orchestra.** The app ships with zero
  game content (bring-your-own-ROM), which is also what makes static hosting
  clean.

## 2. The 256KB cage

- The ROM is 256 KiB (262,144 bytes, verified from the actual file) because
  it is a cartridge: no disk, no filesystem, 8KB RAM. Data is read through
  the MBC1 mapper in 16KB banks; the game's code addresses everything by
  bank number + offset.
- SQLite cannot exist on a Game Boy. On that hardware, the ROM *is* the
  filesystem.

## 3. The workshop and the two shippings

- SQLite is the infinite workshop: the canonical store, every field with
  bank/offset provenance.
- The patch compiler is the squeeze: SQLite → real, self-contained `.gb`
  (finite). Byte-identical when nothing changes; diff-reported when it does.
- The port's data package is the unbounded shipping: just files. No mapper,
  no banks, no 256KB anything.

## 4. Two targets, two physics

- `.gb` path: the 1990 code is the performer; we're the roadies. Bounded
  (MBC1 ≤ 2MB); every new bank needs ASM teaching the old code to reach it.
- Port path: our TypeScript engine is the performer. No cage. "Bigger than
  256KB" lives here — as a data package, never as a `.gb`.

## 5. Content vs plugins (the RMMZ question)

- New spells built from existing handlers/animations/SFX, new dungeons built
  from existing script ops = **data authoring**. No code. No plugin.
- Genuinely new behavior (new effect handlers, new systems) = **engine work**:
  ASM on the `.gb` path, new TypeScript handlers on the port path. That is
  the plugin/addon line, and it is where TOLkster's addon layer lives.

## 6. Asset packs (TOLkster-side, modern-only, never the `.gb` path)

- Audio: manifest maps track ID → file + loop points; per-track fallback to
  the synthesized original; OGG/Opus preferred (MP3 encoder padding breaks
  seamless loops).
- Graphics: manifest maps sprite/tile ID → PNG/WebP; grid-alignment and
  frame-inventory contracts; the engine keeps timing and flip attributes;
  unmapped frames fall back to the original. Bypass the GB tile format —
  don't convert into it.

## 7. Maps are just data

- Dimensions + tile grid + tileset reference + event list (bytecode scripts)
  + encounter table reference + music/palette metadata.
- Variants by story flag are native: 28 conditional maps were decoded and
  tested. One map ID, many contents, the flag selects. Non-destructive —
  better than overwriting.

## 8. The modder's three moves (`.gb` path only)

- Overwrite, dummy slots, expansion with repointing. A decade of WWE modding
  transfers 1:1. Whether dummy slots exist in FFL2's tables is answerable
  from the data (audit for unreferenced IDs).

## 9. Hotswap / indirection

- The engine never hardcodes content — it asks. Whoever controls the answer
  controls the game.
- Port: the data layer resolves IDs dynamically — by flags, scripts, mods,
  or procedural generators (endless tower floors, randomized arena
  formations). The 500-configuration table is the conditional-map system
  generalized.
- `.gb`: selection among pre-compiled variants; the pool is fixed at build
  time.
- Cost of the power: coherence. The editor's validator enforces referential
  integrity across configurations — the feature that makes hotswap safe.

## 10. The editor's jobs

- ID allocator (new maps/text/flags/formations never collide).
- Per-target budget view (ROM space + flag bits on `.gb`; unbounded on port;
  which strategy each addition uses: overwrite / dummy slot / new bank).
- Authoring forms (maps, warps, variants-by-flag, text, encounters).
- Validator (referential integrity; sanity warnings on unverified imports).
