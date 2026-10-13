# Port plan

Status: approved 2026-10-12; **P0 complete** (see the P0 report in docs/PROGRESS.md). Web is the
first target; iOS/Android are optional later goals. Inputs: docs/PORT_READINESS.md.

## Decisions

| Topic | Decision |
|---|---|
| Platforms | One web codebase, **web first**. Desktop (Windows, macOS, Linux) via **Tauri** later; iOS and Android via **Capacitor** are optional ("hopeful, not required"). |
| Stack | TypeScript, Vite, Canvas2D/WebGL, WebAudio (AudioWorklet), npm workspaces. |
| Fidelity | **Faithful core, optional extras.** Original rules, RNG, 160×144 look and timing by default. Enhancements are opt-in toggles. |
| Assets | **The engine ships with no game content.** On first run the player picks their own ROM. An in-app importer checks its SHA-256 and builds the data package locally (IndexedDB on web, app data folder in wrappers). |
| First milestone | **Vertical slice:** ROM import → title → party creation → first town → world map → random battle → save/load. |

## Architecture

**The ROM-import decision shapes the design.** Because the player's ROM is always present, the
game's own bytecode is available at runtime as data:

- the event scripts (field/story text tables);
- the calc-VM battle, growth and meat scripts.

The engine therefore **interprets both bytecodes** instead of hand-porting hundreds of scripts.
That is option C from PORT_READINESS:

- **Faithful by construction:** the original logic runs unchanged.
- **Extras are thin layers:** fast text, auto-battle and similar features sit on top of the
  interpreters.
- **Parity is testable:** the same scripts run in PyBoy.

### State model

Battle and party state live in a **WRAM-shaped byte buffer** (C000–DFFF layout) with typed views
on top. Because the calc VM addresses CF00, D000+256·g, D900, C2xx and so on directly, this layout
lets it run unchanged. It also makes PyBoy traces directly comparable and leaves the door open to
importing original `.sav` files later. Field and UI state stay ordinary TypeScript objects.

### Packages

| Package | Responsibility | Depends on |
|---|---|---|
| `@ffl2k/importer` | TypeScript port of the Python exporters: ROM → data package (JSON, tile atlases, sequences, bytecode blobs); hash gate; versioned package format | — |
| `@ffl2k/core` | Deterministic, headless engine: tick clock (59.7275 Hz), RNG streams (00:043E model), WRAM-shaped state, calc-VM interpreter, event-script interpreter, field rules (movement, collision, triggers, encounters), battle flow, saves | importer types |
| `@ffl2k/render` | 160×144 framebuffer from metatiles/sprites/windows; integer scaling; palettes; optional widescreen field view | core |
| `@ffl2k/audio` | Game Boy APU-style synth (2 pulse + wave + noise) in an AudioWorklet, driven by the decoded music sequences and SFX | importer data |
| `@ffl2k/ui` | Original-style windows, menus and text renderer (font + DTE already decoded); input mapping for keyboard, gamepad and touch overlay | core, render |
| `apps/web` | Vite PWA: offline cache, ROM file picker, IndexedDB storage | all |
| `apps/desktop` | Tauri 2 shell: native file dialog, app-data storage, window/fullscreen | web build |
| `apps/mobile` | Capacitor shell: Files/Documents import, touch controls, lifecycle (pause/resume, audio session) | web build |

The Python toolkit (`src/ffl2kster`) stays the **reference implementation and research bench**:

- Golden tests compare the TypeScript importer's output with `data/` from `export-all`.
- PyBoy scenario traces are the parity oracle for `@ffl2k/core`.

### Parity strategy

1. **Importer golden tests:** for every exported file, TypeScript output = Python output.
   These run locally with the user's ROM. In CI they are skipped, as the Python ROM tests are.
2. **VM unit parity:** the calc-VM and event interpreters reproduce the Python decoders and
   `rules.py` across all scripts.
3. **Scenario parity:** PyBoy produces traces from fixed states and inputs (battle message
   streams, HP/GP/inventory after N turns, map transitions). `@ffl2k/core` must reproduce them
   exactly, using the same RNG counters.
4. **Visual parity:** screenshots against PyBoy frames on the existing states, with a
   per-pixel tolerance.

## Phases

| Phase | Goal | Main work | Exit criteria | Size |
|---|---|---|---|---|
| **P0 Foundations** | Everything the importer needs, plus a scaffold | Decode the importer gaps (below); `port/` npm-workspace scaffold; lint/typecheck/Vitest CI on GitHub; importer for tables, text and events with golden tests | TypeScript importer reproduces `monsters/items/encounters/text/events/battle` JSON exactly; CI green without a ROM | M |
| **P1 Vertical slice** | Playable first hour | Importer (maps, graphics, music); renderer; script interpreter (ops used by the slice); field movement, collision, NPC talk, shop, inn; title and party creation; encounters; battle with Fight/Run, weapon and basic spell effects through the calc VM, rewards and meat; music synth; save/load (JSON); web build | Scenario parity for the first town and the Asigaru/Jaguar battles; runs in Chrome, Safari and Firefox | L |
| **P2 Full field** | All 212 maps and story progression | All event kinds (including F0–FF), all script ops, MAGI, fixed battles, vehicles and movement modes, progress variables and flags | A story playthrough with no blockers; script-op coverage 100% | L |
| **P3 Full battle** | All rules | All 50 effect handlers via the VM; statuses, AI, growth, mutants, robots, equipment; parity suite over many seeds | Battle parity suite green; mutant-growth question settled | M |
| **P4 Platforms** | Shipping shells | Tauri desktop (sign and notarize), Capacitor iOS/Android, PWA install, touch controls, per-platform ROM import and save storage, controller support | Installable builds on all six targets; saves portable between them | M |
| **P5 Extras** | Opt-in enhancements | Widescreen field, fast text, battle speed, auto-battle, rebinding, palettes, accessibility, run-time mods from FFL2kster-patched ROMs | Each extra toggleable; core parity unaffected when off | M |
| **P6 Release** | Hardening (private use; no store submissions, 2026-10-12) | Performance on low-end mobile, audio latency, legal notices, no-content packaging checks, private distribution to the owner's devices | Release checklist complete | S–M |

### P0: importer gaps to close

These parts of the current data package were captured from the emulator rather than read from
the ROM, so the importer cannot rebuild them yet:

1. **Map layout command format** (00:2253, banks 08/09). Today the 212 layouts come from emulator
   captures. Exit: Python decoder output equals all 212 captured buffers.
2. **Tileset graphics sources** (00:1F55, header byte 2 → tile data). Today the sheets are VRAM
   captures. Exit: decoded tiles equal the captured VRAM for every map.
3. **Monster battle-graphics pointers** (banks 05/06, family art). Today the art comes from
   formation-patch captures. Exit: decoded art equals all 256 captures.
4. **Music envelopes, vibrato, wave tables and the SFX table** (bank 0E). These are needed for an
   accurate synth.
5. **Window/frame tiles and the remaining UI graphics.**

The UI tiles in item 5 are probably uncompressed and found the same way as the font.

## Repository layout

```text
FFTOL/
  src/ffl2kster, tools/, tests/   Python reference toolkit (unchanged)
  data/                           processed package (reference/golden output)
  port/
    package.json                  npm workspaces
    packages/importer, core, render, audio, ui
    apps/web, apps/desktop (Tauri), apps/mobile (Capacitor)
    test/parity/                  scenario traces (generated locally, gitignored when ROM-derived)
```

Port releases never contain `data/` or any ROM-derived file. A CI check fails if a build
artifact contains known asset hashes.

## Risks

| Risk | Mitigation |
|---|---|
| **Trademarks:** the game's name and logos | No original title or branding in app names, icons or store listings; neutral app name; "requires your own ROM" wording. |
| **App-store review** of apps that load user-supplied game files | Ship as a generic engine with a file importer (the pattern emulators use). Review current Apple/Google rules before P4. Keep the PWA as a fallback channel. |
| **Map layout format** turns out complex | Fallback: the importer runs the layout drawer through a minimal SM83 interpreter. Its scope is small: one routine, one bank. |
| **Audio fidelity and latency** (mobile) | AudioWorklet synth; render-ahead buffers; WAV captures as reference. |
| **Hand-porting cost** | Avoided by interpreting the original bytecode. Only the 30-odd native call sites (`rst $20` messages and similar) need TypeScript implementations. |
| **iOS file import** | Use the Files app document picker. Store the derived package in app sandbox storage, never the ROM itself unless the user opts in. |

## Toolchain prerequisites (on this Mac)

| Tool | Status |
|---|---|
| Node 24 / npm 11 | present |
| Rust (rustup) | needed for Tauri in P4 |
| Xcode | needed for iOS and for macOS signing |
| Android Studio + JDK 17 | needed for Android |

P0–P1 need Node only.

## Legend I course (FFL1kster), started 2026-10-12

The proven Legend II pipeline repeated on *The Final Fantasy Legend* (USA, `ffl1/input/original.gb`,
SHA-256 `e5b1d116…0d906`). Nothing is assumed from Legend II: every address, record format,
routine, encoding and checksum behaviour is re-derived from this ROM; where it shares structure
with Legend II that is shown with evidence (docs/CROSS_GAME.md). Checklist: docs/FFL1_PROGRESS.md.

| Phase | Goal | Exit criteria |
|---|---|---|
| **M1** | One verified monster-data slice | No-op build byte-identical; record format evidenced (boundaries on ≥2 records, neighbour controls); patch compiler + SQLite; PyBoy acceptance |
| **M2–M7** | Items/abilities and growth, text, encounters/drops, maps/events, graphics, music | Each domain evidenced to the M1 standard; `export-all` reproduces the Legend I data package |
| **P0** | Importer + scaffold for the Legend I import target | TypeScript importer reproduces the Python package; CI green |
| **P1** | Vertical slice: title → hero creation → first town (guild) → world → battle → save/load | Web player loads the Legend I data package and plays the slice; scenario parity |
| **P2** | Full field | Field parity sweeps recorded with counts |
| **P3** | Full battle | Battle parity sweeps recorded with counts |
| **P4** | Platforms | The Legend I target in the existing shells; MBC2 saves portable |
| **P5** | Extras | Opt-in extras for Legend I; parity unaffected when off |

Rules: `src/ffl2kster`, its tests, `data/`, `project/` and the `@ffl2k/*` port packages are not
modified except to factor genuinely shared harness code; the FFL2kster suite and its
byte-identical no-op build stay green (CI guard against v1.0.0). Stop and report if a blocker
survives three different approaches, a tool or permission is missing, or continuing needs scope
expansion. Out of scope: Legend II P6, TOLkster.

## Legend III course (FFL3kster), started 2026-10-13

The same pipeline on *Final Fantasy Legend III* (USA, `ffl3/input/original.gb`, SHA-256
`5ed87f65…73fc1d`), with the same rules: nothing is assumed from Legend I or II; shared structure
is shown with evidence (docs/CROSS_GAME.md). Checklist: docs/FFL3_PROGRESS.md.

| Phase | Goal | Exit criteria |
|---|---|---|
| **M1** | One verified monster-data slice | As for Legend I |
| **M2–M7** | Items/abilities and growth, text, encounters/drops, maps/events, graphics, music | Each domain evidenced to the M1 standard; `export-all` reproduces the Legend III data package |
| **P0–P5** | Importer, vertical slice, full field, full battle, platforms, extras (`@ffl3k/*`) | As for Legend I, with Legend III's own scenarios |

Rules as for Legend I; in addition `src/ffl1kster`, its tests and the `@ffl1k/*` packages are not
modified by the Legend III work (only `ffl1kster.__version__` follows the repository version).
