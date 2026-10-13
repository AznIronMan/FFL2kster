# Decisions

## 2026-10-11 — Project governance

- Local task ledger in gitignored `.tasks/` with `FFL2K-xxxx` ids, matching
  sibling project conventions.
- Private material (original archive, starter brief) in gitignored `.private/`.
- Git syncs to the public `AznIronMan/FFL2kster` repo (operator request,
  2026-10-11). ROMs, saves, states, and extracted game data are never committed;
  enforced by `.gitignore` plus a `.githooks/pre-commit` header-signature check.

## 2026-10-11 — Raw vs processed game data

- Raw ROM bytes (verbatim dumps/blobs) are never committed; the code and
  documented command to regenerate them from a user-supplied ROM are.
- Processed data (decoded tables, converted/remastered graphics and music,
  schemas) may be committed, including the canonical SQLite project database.

## 2026-10-11 — Tooling (milestone 1)

- **Where things run.** Development ran in a Linux VM (Ubuntu 22.04 aarch64, no sudo) with
  the project folder mounted. Python 3.10 venv: PyBoy 2.8.1, pytest, numpy, pillow.
  RGBDS could not be built there (no bison/sudo), so **RGBDS 1.0.4 was installed on the
  macOS host via Homebrew** and used for the disassembly round-trip. All project code is
  pure Python (≥3.10) and runs on macOS too.
- **mgbdis** (commit 95d951a) for the exploratory disassembly in `build/analysis/` (ignored).
- **PyBoy** is the only emulator used for automated tests. Emulicious/SameBoy were not
  needed for milestone 1. Nothing was substituted for them; they stay recommended for
  manual work.
- **The emulator always runs a temporary copy of the ROM** (`emu.Emulator`), because PyBoy
  can write `.ram` files next to the ROM. `input/original.gb` is never opened for writing.
- **Battle detection uses a code hook** (`0D:44F4`) instead of screen heuristics, which
  misfired twice during exploration.

## 2026-10-11 — Save states

- States are **generated, never committed** (`python -m ffl2kster make-states`). The input
  chain in `src/ffl2kster/states.py` was recorded during exploration and replays
  deterministically: cold boot → title → party creation → story → town exit → world map →
  first battle (~2 s). The acceptance test regenerates them from scratch for both ROMs.
- Test party: 4× Human M (named "AA"/"AAAA") plus guest Mr. S. This was an incidental
  result of input mashing. It is deterministic and fit for purpose.
- Encounters are step-deterministic: the first is always 3× Jaguar (id 120) after 14 steps.

## 2026-10-11 — Patch compiler

- Edits are semantic (`domain`, `id`, `field`, `value`). Only fields marked editable *and*
  verified can be written: enemy `hp`, `str`, `agl`, `mana`, `def`. `type`, the ability count
  and the ability pointer are readable but not editable, because changing them safely needs
  list relocation, which is out of scope.
- Every changed byte must carry a reason, or the build fails. Overlapping edits with
  different values are rejected.
- After any change the **global checksum is recomputed** (hardware ignores it, but emulators
  and tools check it). The header checksum is recomputed too; it only changes if header bytes
  change.
- Proof edit: **Jaguar (id 120) HP 45 → 200**. Reasons: first and deterministic enemy, HP
  field fully verified, harmless, observable in RAM (D50C) and in battle outcome. Enemy HP is
  not displayed on screen in this game, so the visual proof is the different battle text.

## 2026-10-11 — SQLite project store

- `project/ffl2kster.sqlite` holds `field_defs` (meaning, status, evidence), `enemies`
  (stable id, name, provenance), `enemy_fields` (original value + source offset/bank/address
  + status per field), `enemy_abilities`, a separate `edits` table, and an `enemy_effective`
  view. `build --db` takes its edits from the DB; tests check it matches the JSON build.
- `project.json` keeps the edit list as the human-readable fixture. `db-import` copies its edits
  into the DB, and `test_committed_db_is_current` fails if they diverge.
- The DB is **committed** (decoded, processed data per the raw-vs-processed policy). Raw
  record bytes are not stored. `meta.imported_at` makes the file non-byte-reproducible; its
  content is reproducible.
- Import builds in a temp file and copies into place. The `FFL2K_SQLITE_JOURNAL` env var
  (e.g. `MEMORY`) supports filesystems that forbid deleting SQLite's rollback journal, as
  happened on the sandbox mount. The default is SQLite's normal journaling.

## 2026-10-11 — Assumptions

- The supplied ROM is the only supported revision (hash-gated). Other revisions/regions
  are out of scope until explicitly added.
- The `type` meaning (human/mutant/monster/robot) is **probable**, not verified (superseded 2026-10-12: consumers found in the calc VM, see below): no code
  path that consumes it was traced in battle.
- The sandbox VM could not delete files, so empty `.gitkeep` files remain in `src/ffl2kster/`
  and `tests/`, plus a zero-byte `project/ffl2kster.sqlite-journal` (ignored). Both are harmless.

## 2026-10-12 — Calc VM and rules

- The bank-0C bytecode is named the **calc VM**; scripts are decompiled into a readable listing
  (left-to-right expressions, labels) rather than raw bytes. The listing and decoded tables are
  committed as processed data (data/battle/); the raw RNG table is *not* exported (read it with
  `rules.rng_byte`).
- Rules are labelled verified only when a controlled change or an exhaustive measurement agrees;
  everything else decoded from the VM is **probable**. Race/type codes: 0 human, 1 mutant,
  2 monster, 3 robot — now probable from consumers (script 9 requires 2 to eat; script 10 grows
  0/1; script 7 checks 3).
- `rules.py` mirrors the ROM's integer arithmetic and quirks (e.g. rand(lo = 0xFF) returns 0xFF),
  so the port can choose parity or a cleaned-up variant deliberately. (Corrected 2026-10-12:
  rand(0..0) returns 0, not a raw table byte — checked against the SM83 oracle.)

## 2026-10-12 — Port direction (user decisions)

- Platforms: single TypeScript web core; Tauri for Windows/macOS/Linux, Capacitor for iOS/Android,
  PWA for browsers.
- Fidelity: faithful core (original rules, RNG, 160×144, timing) with opt-in extras.
- Assets: the engine ships with no game content; an in-app importer converts the user's ROM
  (hash-checked) into the data package on first run.
- First milestone: vertical slice (import → title → party creation → first town → world map →
  battle → save/load).
- Consequence (proposed, docs/PORT_PLAN.md): interpret the original event-script and calc-VM
  bytecode at runtime over a WRAM-shaped state buffer; Python toolkit stays the reference and
  parity oracle.

## 2026-10-12 — P0 decisions

- Web is the first and only required target for now; mobile wrappers are optional later goals.
- The data package keeps bytecode/data **segments** (banks 00, 07–0F) next to the decoded JSON so the
  runtime interpreters (event scripts, calc VM, layouts, music) can run the original data. It is
  built and stored only on the player's device (IndexedDB), never bundled or uploaded; the app has
  a "remove game data" control.
- An SM83 interpreter (`ffl2kster.sm83`) is kept as a test oracle for ROM routines; it is never
  shipped. Layout drawing is re-implemented exactly (Python + TypeScript) and checked against it.
- The Python toolkit remains the reference; TypeScript ports are accepted only when golden tests
  show identical output (`port/packages/importer/test/golden.test.ts`).
- npm (workspaces) rather than pnpm; Node/npm tooling runs on the macOS host (native esbuild).

## 2026-10-12 — P1 decisions (vertical slice)

- Native port, not a runtime CPU emulator: each original routine is a TypeScript function (one per
  routine, original address in its doc comment) over the original memory map; banked routines
  are addressed `bank << 16 | address` and registered in `engine.extra` by the module that ports
  them. Waits are generators (`yield VSYNC` = rst $10).
- Frame model: the code segment runs at vblank, the STAT handlers (frame tick at LY = LYC = 0,
  raster handlers by C706 address) per line, the wait state is taken after the line-0 tick. CPU
  time inside a frame is not modelled. Consequences, handled in the parity harness and listed per
  trace: busy frames where the original spends frames without waiting (the trace's frame gaps;
  a busy frame gets the frame tick only if the original's sound counter FFB4 advanced in it — map
  loads run with the LCD off); tick-phase tolerances (state accepted just before the tick; blink
  timer C7C6/C7C7 and, per trace, joypad history / RNG counter re-phased when they are the only
  difference); a wait reached by code polling LY with interrupts off is compared at the frame's
  end; frames drawn while the original is mid-copy (tearing) listed explicitly.
- Parity is checked at every rst $10 (machine 8000-FFFF) and every frame's screen against PyBoy
  traces, with an ignore set: APU registers and sound-driver RAM (the driver itself is checked
  byte for byte per call with identical register writes, core/test/sound.test.ts), the SM83 stack
  CE00-CEFF and its saved pointer C0E1/C0E2 (battle), DIV/IF/STAT/LY/LYC, write-before-read
  scratch (C477-C47D, FF90-FF95), the derived sprite page CC00-CC9F and OAM.
- A soft reset is taken at the next frame (the port finishes the interrupted code segment); its
  RNG/joypad side effects are a documented re-phase in the load trace. Modelling the reset inside
  the frame was tried and matched worse (vector/handler state at the boot's first waits).
- The web player stretches key taps to at least 4 frames so a press shorter than a frame is not
  lost (the game detects buttons by edges over two samples).
- Sound: the driver runs in the engine (`installSound`); the APU synth is a separate pure-TS model
  fed with timestamped register writes; output via AudioWorklet (secure contexts only).

## 2026-10-12 — Project renamed: FFTOL — Tower of Legends (Geon)

- Naming scheme:
  - **FFTOL**: the project (local folder `FFTOL`, GitHub repository `AznIronMan/fftol`).
  - **Tower of Legends** (short **TOL**): full title. **F²**: logo mark (visual glyph only).
  - **FFL1kster / FFL2kster / FFL3kster**: per-game toolkits. FFL2kster is the existing Legend II
    toolkit (Python package `ffl2kster`, CLI, data package, web port). FFL1kster and FFL3kster
    are reserved names; nothing is created for them.
  - **TOLkster**: the future master engine of docs/END_GOAL.md; name reserved, nothing built.
- Caution kept with the title: an unrelated Steam platformer already uses "Tower Of Legends";
  fine for private use, a public or store release needs a distinguisher (not solved now).
- Renamed: the local folder (FFL2kster → FFTOL, same parent), the GitHub repository
  (FFL2kster → fftol; the old URL redirects) and the git remote; README title, intro and a new
  "Names" section; AGENTS.md project identity and upstream URL; the Python package description
  and the npm workspace description; port/README.md title; the web app's page title and heading
  ("Tower of Legends · Legend II"); the repository tree in docs/PORT_PLAN.md. Version 0.3.0.
- Deliberately not renamed (FFL2kster is the Legend II toolkit, and history keeps its names):
  the Python package/CLI `ffl2kster` and `src/ffl2kster`; `project/project.json` name and the
  SQLite store `project/ffl2kster.sqlite`; the build output `build/FFL2kster.gb` and its test
  copies; the npm scopes `@ffl2k/*` and workspace name `ffl2k-port`; the `FFL2K-xxxx` task ids;
  the PyBoy/toolkit internals; past changelog entries, DECISIONS/FINDINGS/PROGRESS entries,
  GOAL.md (Milestone 1) and milestone records; `.private/FFL2kster-Starter-Brief.md`; the
  claude.ai project named "FFL2kster" (renamed only by its owner in the app).

## 2026-10-12 — Direction note A: END_GOAL.md is the destination, not the course (Geon)

- docs/END_GOAL.md (combined trilogy engine on TOLkster, unified meat graph, Tower Run + Arena,
  editor over the data layer) changes no current priority. The active course stays
  docs/PORT_PLAN.md: the Legend II port phases (P1 vertical slice is complete as of this date;
  next is P2 full field).
- No end-goal work yet: no FFL1kster/FFL3kster pipelines, no TOLkster, no arena, tower run or
  editor GUI.
- Standing instruction: where current work can avoid Legend-II-only assumptions at no cost
  (data-driven over hardcoded), take the free option and record it here; where a genuine
  conflict exists, flag it in docs/FINDINGS.md rather than build something the capstone would
  have to tear out.

## 2026-10-12 — Direction note B: multi-region ROM variants (Geon)

- Geon will supply additional ROM variants (regions/languages, e.g. the Japanese SaGa releases)
  so players can import their own regional ROMs. No action until those ROMs arrive.
- The importer must not hardcode a single-SHA / single-variant assumption. It keeps a variant
  registry: per game, per region/revision — known hashes and layout-evidence status.
- A variant counts as supported only after it passes the same verification the US Legend II ROM
  passed (identity check, layout evidence, acceptance tests). Support for an unverified variant
  is never claimed. (Current single-hash gates are flagged in docs/FINDINGS.md.)

## 2026-10-12 — Direction note C: hosting model and unverified-import override (Geon)

Architecture guidance for the importer and the web app; not new feature work.

1. Web hosting: the web build may be statically hosted (GitHub Pages or a private server). The
   host serves code only. ROMs are imported client-side in the player's browser and never
   uploaded. Saves/states live in browser storage (IndexedDB) and must be exportable and
   importable as files, so players are not tied to one browser.
2. Hash verification with a manual override: hash checks identify known variants (the verified
   path). An unmatched hash is not a dead end: the player may choose which game/engine the ROM
   belongs to and import anyway in a clearly labelled **unverified** mode — extraction is
   best-effort with the chosen game's layout, sanity checks (file size, header/internal name)
   still warn, and the verified-path guarantees (parity, claimed support) do not apply.
   Rationale: uncommon dumps and revisions exist, and patched ROMs, fan translations and ROM
   hacks can never match a canonical hash — including this project's own FFL2kster-patched
   ROMs, which mod support depends on importing.

## 2026-10-12 — P2 decisions (full field)

- Ground-truth waits are taken where rst $10 returns (00:00E4, LY 0x90 after the vblank
  handler), no longer at the first wake from its halt (00:00DE): that first wake fell on whatever
  line the next interrupt came, which under raster handlers made the state depend on CPU time.
  The engine yields at the same point (after the frame's lines and the vblank handler). All
  traces were re-recorded; every earlier test kept passing, with fewer tolerances.
- Whole-game coverage comes from sweeps of lean PyBoy traces (tools/sweep.py, trace_lib.py;
  XOR-delta gzip, ~0.5 MB per 1,200 frames) replayed by parity/test/sweep.test.ts: every warp
  destination, every event script (story and field tables, run from the first town), every
  condition flipped once (branches), every placed script on its own map with its object's
  condition met (context), other placed events (shops, chests, sound, warps, specials), story
  battles with a strong party, and the ending through the new game's opening. 1,643 traces.
- Sweep tolerances, beyond the field-trace ones: screen differences shorter than 4 frames are
  reported, not failed (display writes and raster splits that land a line or a code segment's
  CPU time differently); joypad history re-phased when it is the only difference; and where the
  original itself breaks (detected from state: field sound test, script pointers into bank-0
  code or WRAM, invalid alternate destinations) the trace is compared up to that point.
- `Memory.romAt(bank, a)` reads as the CPU does with the bank mapped: from 8000 up it returns RAM
  (tables indexed past the end of a bank). STAT reads return bit 7 set, the enables as written,
  the coincidence flag and the mode (1 while the code runs at vblank in this model).
- Raster writes that land after a line's registers are taken (the closing curtain's long paths)
  are applied after the line (`Game.afterLine`), from PyBoy measurements. The diamond split's
  lower-half edge depends on the line's mode-3 length (sprites, SCX) and is left to the
  raster-edge tolerance.
- The layer swirl (00:36D6) is paced by a cycle model of its LY 0x90-0x97 write window (532
  cycles per written tile, 456 per skipped cell), fitted to PyBoy; it replaces a budget guess.
- Op coverage is counted in the engine (TextEngine/FieldEngine `coverage`) and aggregated by
  tools/sweep_coverage.py.

## 2026-10-12 — P3 decisions (full battle)

- Battle coverage comes from lean PyBoy traces that start at the battle main loop's entry
  (0D:4000, from build/states/pre_battle_id45.state) with the situation written there: party
  records (id, type, status, HP, stats, 8 items with uses), formation CFE0-CFEA, guest switch,
  MAGI held (C2DA), GP and the RNG stream counters. Each ends 30 frames after the far call's return
  (mark 00:0EF4; marks.bin holds the machine there). tools/battle_sweep.py modes: every
  battle-usable id (items, focus), every enemy id (enemies), one type per party (types), random
  parties and formations (random, mix) and enemies with boss or rare abilities (boss); replayed by
  parity/test/battle_sweep.test.ts through replayBattle. 2,152 traces.
- The battle's last button wait (0D:4152) compares the buttons with the value read on entry. The
  original reads it after however much CPU time the victory computation took (it can run past the
  next frame's joypad tick), the port at the start of its segment, so a button change around that
  point would make the exit frame depend on CPU time. The sweep plans switch to no buttons when the
  growth script starts (0D:4349), at the defeat (0D:4251) and at the escape (0D:4143), and to "12
  frames without buttons, then A" on entry to 0D:4152 (`trace_lib` plan switches). The port is not
  changed for this: in play it only decides which press leaves the battle screen.
- `replayBattle` option `pauses`: between two waits the original may compute for frames with the
  picture unchanged (the calc VM ran ~20 frames before the transformation wave of effect 44) where
  the port spends none. A differing frame may match a later trace frame of the same stretch when
  every skipped trace frame repeats the picture shown before; the delay ends at the next wait,
  where the machine is compared exactly. Only the original may pause, only on an unchanged picture.
- Battle sweeps share the field sweeps' screen rule (differences shorter than 4 frames reported,
  not failed) and joypad re-phasing (C770-C775, FF89/FF8A with the blink timer, when they are the
  only difference at a wait). A trace that ends before the battle returns is compared up to its
  last wait.
- Calc-VM statement coverage is collected in the port (`CalcVm.coverage`, COVERAGE=1) and
  aggregated by tools/vm_coverage.py (scripts, the 50 battle handlers, statements).
- The mutant-growth question is settled by controlled change (tools/mutant_growth.py): the stat
  pair address is 7F94 + 10·type + 2·stat. `rules.py` now models the one-byte stores of script 10
  and the low byte of max HP in the HP penalty (probe values in tests/test_rules.py).
- PyBoy 2.8.1 gives identical traces on the Linux VM and on macOS (checked byte for byte on a
  sweep trace), so long recordings and replays may run on whichever host is faster
  (build/.venv-mac, gitignored).

## 2026-10-12 — Direction note D: faithful first, then QoL options, then the tower/arena game

- Course unchanged: finish porting and mapping the original (PORT_PLAN P4-P6) before anything else.
- Quality-of-life changes (e.g. caps above 999 HP / 99 stats, wider number displays, fast text,
  battle speed) belong to the **QoL version**: each is an **opt-in option**, off by default, and the
  faithful game with every option off must still pass the full parity suite (P5 rule).
- The **tower/arena game** (docs/END_GOAL.md) is a **separate mode built on the same engine and
  data**, implemented after the ports; its own rules (e.g. stats beyond the original's one-byte
  fields) live in its data model, not in the faithful game's memory layout.
- The cap break (HP past 999, stats past 99) applies to **every combatant**: party, enemies,
  NPCs/guests and anything added later, with no fixed ceiling as the goal ("ideally infinite").
  Inside the original memory layout the ceiling is 65,535 HP and 255 per stat; going past that
  belongs to the remaster data model. Map: docs/CAPS.md.
- Findings that serve either (e.g. where the 999/99 caps and the number displays are checked)
  are recorded as they come up; no feature work for them ahead of the port.

## 2026-10-12 — P4 decisions (platforms)

- One web build, thin shells: Tauri 2 for Windows/macOS/Linux (`port/apps/desktop`, dialog + fs
  plugins, `withGlobalTauri`), Capacitor 8 for Android/iOS (`port/apps/mobile`, native projects
  committed, iOS on Swift Package Manager), and the web build itself as an installable PWA.
  `platform.ts` holds the only differences (file save/open, fullscreen); app identifier
  `llc.cnb.fftol`.
- Storage stays in IndexedDB on every target (the shells keep it in the app data directory); no
  native storage layer. The portable unit is the save: the raw 8 KiB battery RAM as `.sav`, the
  same bytes everywhere and the format Game Boy emulators use for this cartridge, so saves move
  between all six targets and to and from emulators. Export: download / save dialog / share sheet;
  import: the system picker, size-checked, then confirmed before replacing the device's save.
- Unverified import (direction note C) is implemented in the importer: a hash mismatch with at
  least 16 whole banks may be imported on request; size, internal name and cartridge RAM warn;
  the package records `verified: false` and the UI labels it. Smaller files are refused.
- Input: keyboard, every connected gamepad (W3C standard mapping), on-screen touch controls
  (multi-touch, sliding D-pad, shown by default on coarse pointers and in the mobile shells). All
  sources go through one per-frame sampler that holds a new press for 4 frames, so short taps
  are never lost. The game pauses while hidden (mobile lifecycle) and flushes saves first.
- The service worker caches only same-origin app files (shell + hashed assets); never ROMs or game
  data. The no-content check now allows only the app's own small icons among images.
- The app icon is original (`port/assets/make_icons.py`, simple shapes, no game content).
- Builds for all targets come from CI (`.github/workflows/platforms.yml`), which also covers what
  this Mac cannot build locally (no Rust toolchain; the iOS platform is not installed in Xcode).
  Signing needs the owner's credentials: macOS sign + notarize switch on with repository secrets;
  Windows signing, Android release signing and iOS device signing are documented, not configured
  (docs/PLATFORMS.md). Without them: unsigned desktop installers, a debug-signed APK, an iOS
  simulator build and an unsigned device app.

## 2026-10-12 — P5 decisions (extras)

- Two kinds of extras. Game options live in `Game.options` (fast text, cap break) and are read
  only at the points they change; with the defaults the engine takes exactly the original paths.
  Everything else is the player shell's (speed, auto-battle, display, input), which never writes
  game memory except the buttons it already feeds. `Game.ui` carries read-only hints from the
  port's code to the shell (battle command menus waiting; field loop frame).
- Speed extras run more game frames per display frame instead of shortening any routine, so a
  sped-up game is the same game; the audio is decimated to keep pace.
- Cap break (direction note D) patches four bytecode constants in a copy of bank 0C while on
  (only where the original bytes are found, so a mod that changed them keeps its own) and widens
  numbers only when they need it. Limits are chosen so values stay inside their storage: growth
  stops at max HP >= 9,785 (one step then stays <= 9,999), stats at 255, stat items at 253, HP
  items at 9,960. "Ideally infinite" stays with the remaster data model.
- Widescreen draws the margins from the game's own field state (map buffer, VRAM tiles, line
  registers) instead of the data package, so doors, layers and swirls stay consistent with the
  centre. Sprites are not invented in the margins.
- Mods are patches applied on the device (IPS from FFL2kster, BPS from other tools), never
  ROMs; the import keeps the base ROM (on the device, removed with the game data) so mods can be
  switched without choosing the ROM again. A modded package records its mods and base hash and is
  labelled; with no mod on it is verified again.
- Settings are per device (localStorage, wrapped in try/catch; defaults when unavailable).
- Correction to the P2 entry: the field sweeps are 1,643 cases but 1,637 recordings (6 context
  cases on maps the first-town warp cannot reach were never recorded); all 1,637 pass.

## 2026-10-12 — Direction note E: private use, no store submissions (Geon)

- The port stays private for now: no App Store, Play Store, Microsoft Store or Steam submissions.
  P6 keeps the hardening work and replaces store submissions with private distribution to the
  owner's own devices (PORT_PLAN updated).
- Targets for the private release (Geon): web (PWA), Windows 10/11+, macOS and Linux. Android
  and iOS are deferred: their Capacitor projects and CI builds stay, but P6 does not test or
  harden them.

## 2026-10-12 — P6 decisions (hardening, private release)

- Game Boy A/B layout by default (Geon: "for us old heads that played on the gameboy"): A is the
  right-hand button on the keyboard (X, K) and the gamepad (east face button: Xbox B, PlayStation
  circle), B the left/bottom one. Options → Controls → A/B layout switches to the Xbox layout. The
  settings key moved to v2 so earlier per-device settings (with the Xbox layout) are not carried
  over; nothing else was stored there.
- Mute is a remembered setting (M, the Sound button in the player bar, Options → Sound), added on
  request; it gates the audio output only, the sound driver keeps running so unmuting is in time.
- Audio latency presets (low 35-120 ms, normal 60-200 ms, safe 120-350 ms of buffered output) and
  a wake-up on the next input when the system suspends the audio device. Presentation only.
- Save safety: the battery RAM as it was when a session started is kept as a backup (once per
  session, before the first write) and can be swapped back from the Saves panel. Saves are still
  flushed before the page hides and before an error is shown.
- An engine error stops the game with a screen that offers copyable details for a bug report:
  version, browser, ROM hash, verified/mod flags, frame, bank, view position, options and the
  stack. No save or ROM bytes are included. Nothing is sent anywhere.
- Soak test (assumption, recorded): random input from field states across the game (a new sw_m
  start every 10 game minutes) for 10 game hours, heap measured after a forced collection. The
  first run, from one town only and without a collection, read the garbage collector's sawtooth
  as growth and stayed in one place; both were test faults, fixed by making the measurement and
  the walk stricter (it now also requires at least one battle).
- Release flow: pushing a `v*` tag builds every target with the Platforms workflow and creates a
  **draft** GitHub release with the web zip and the desktop installers. Drafts are visible only
  to repository collaborators; publishing is the owner's step after a smoke test on their own
  machines (docs/RELEASE.md). Builds stay unsigned (SmartScreen / Gatekeeper prompts are
  documented in docs/INSTALL.md).
- Packaging check: every installer (msi, exe, dmg/app, deb, rpm, AppImage) is listed in CI and
  fails on any ROM, save or state file; the web build passes the existing no-content check.
- Licence: none chosen. NOTICE.md says all rights are reserved until the owner adds one; the
  repository is public, so this is the owner's decision. Third-party notices are in
  THIRD_PARTY.md and the About page.

## 2026-10-12 — Legend I course (FFL1kster) and direction notes A–D restated (Geon)

Scope for this course: repeat the Legend II method on *The Final Fantasy Legend* (USA): data
milestones 1–7, then port phases P1–P5. docs/PORT_PLAN.md ("Legend I course") controls scope; P6
for Legend II and TOLkster are out of scope.

Direction notes recorded for this course (destination, not current scope):
- **A.** docs/END_GOAL.md is the destination, docs/PORT_PLAN.md the active course. END_GOAL now has
  the finalized naming (FFTOL / Tower of Legends; FFL1kster/FFL2kster/FFL3kster; TOLkster
  reserved) and an "Authoring model" section (docs/ARCHITECTURE_NOTES.md is its plain-English
  companion). No end-goal work in this course.
- **B.** Multi-region ROM support: a variant registry (docs/VARIANTS.md), never a single-SHA
  assumption; support is claimed per variant only after full verification. The FFL1 USA dump is
  registered as the Legend I reference.
- **C.** Unverified import: an unmatched hash is not a dead end — manual game/engine choice,
  clearly labelled unverified/best-effort mode, sanity checks warn. The web app keeps this
  behaviour; the Legend I import target will offer it too.
- **D.** Authoring model: content vs behaviour (new spells/dungeons from existing parts are data
  authoring; genuinely new behaviour is engine work); asset packs (audio manifest track ID → file +
  loop points, OGG/Opus; graphics manifest ID → PNG/WebP with grid and frame contracts; per-track /
  per-frame fallback; modern-only, never the `.gb` path); hotswap/indirection (the engine asks, the
  data layer answers; port resolvers may be procedural); editor duties to design toward (ID
  allocator, per-target budget view, referential-integrity validator). Nothing of this is built now;
  where current work can keep these seams open at no cost (data-driven over hardcoded, IDs
  namespaced per game), it does, and genuine conflicts go to docs/FINDINGS.md.

Decisions and assumptions for the Legend I work:
- Layout: Python package `src/ffl1kster` (own CLI, mirrors ffl2kster's commands), project at
  `ffl1/project/project.json` + `ffl1/project/ffl1kster.sqlite`, ROM at `ffl1/input/original.gb`
  (read-only, gitignored), outputs in `ffl1/build/` (gitignored), docs in `docs/ffl1/` plus
  `docs/FFL1_PROGRESS.md` and `docs/CROSS_GAME.md`, tests in `tests/ffl1/`, tools in `tools/ffl1/`.
- Shared code: game-independent modules of ffl2kster (cartridge header/checksums/bank math, byte
  patch/diff, project manifest, byte/relative search) are **imported unchanged** rather than copied
  or moved, so `src/ffl2kster` stays byte-for-byte as released (1.0.0). A shared package can absorb
  them later; moving them now would modify ffl2kster for no functional gain.
- Proof of non-interference: CI fails if `src/ffl2kster`, the Legend II tests, `data/` or `project/`
  differ from tag v1.0.0, and runs the full ROM-free suite. ROM-dependent tests (both games' no-op
  builds, emulator tests) cannot run in CI because no ROM may be uploaded; they run locally before
  every commit and their counts are recorded in docs/FFL1_PROGRESS.md.
- The Legend I SQLite store uses one generic layout (records / fields / edits) for every domain and
  records `game = FFL1` in meta and on every record (IDs namespaced per game, note D).
- Version: one version for the repository; each Legend I milestone is a minor bump.
- Versions: the repository version (pyproject.toml, README, app shells) moves with every change;
  `ffl1kster.__version__` follows it. `ffl2kster.__version__` stays at 1.0.0 because the Legend II
  toolkit itself is unchanged (and the CI guard keeps `src/ffl2kster` identical to v1.0.0).
- Legend I parity (port): the replay compares every frame wait's machine state and every screen.
  CPU time is not modelled (as for Legend II), so three counted rules cover its visible effects:
  joypad re-phase (the original's long field iterations read the joypad after the next frame's
  tick; the planner keeps plans edge-safe and the replay takes the joypad from the trace when it is
  the only difference), lateWrite (a frame whose top lines still show the previous picture) and
  splitTear (a frame after a busy stretch that the original finished during the display: old
  pixels above line L, the port's picture from L on, with the DMG window latch: a window that
  started at line 0 stays on for the frame when WY is moved below the current line). FF96–FF98
  (text row/column scratch) is excluded: set from the caller's registers before every text.

## 2026-10-12 — Legend I replay: rules for polled rasters, LCD switch-off and line-paced VRAM writes

- rasterRows: the original's polled per-line register loops (WX slide, SCX fall and wave, BGP
  stripes) are ported as line hooks: line ly takes the value the loop writes while LY = ly (for
  the write-then-wait loops of bank 07: entry ly + 1; for 07:79A5, which writes SCY in hblank,
  D900[k - 1]). As CPU time is not modelled, a frame whose differing lines (at most 8) each match
  the port's picture redrawn with a neighbouring line's registers is accepted and counted.
- LCD blank: PyBoy clears its screen when the LCD is switched off; the frame whose wait precedes
  the switch and the first frame after it is switched on are white in the trace. Accepted only
  when the trace frame is entirely white and the port switched the LCD off in that frame; counted.
- mixTear: while the 00:069F STAT handler is installed (C39E = 9F at line 0), the original writes
  VRAM line by line during the display, so a frame can mix the old and new pictures in any line
  order. Accepted when every pixel equals the port's new picture or one of the two old pictures
  (the port's previous frame, the trace's previous frame); counted. Unlike splitTear it needs no
  busy frame before it.
- Every rule is counted per trace and in the sweep totals; each was checked by a mutation that the
  rule must not absorb (wrong WX mapping, no window latch, a wrong fill value).

## 2026-10-12 — Legend I: frame-tick polling and the DIV seed

- A busy loop that polls state set by the frame tick (06:6293: FF8D) yields `TICK`: the frame
  clock draws line 0 (where the STAT handler runs the tick), resumes the code, then draws lines
  1-143 with what it set. Any frame wait the code then reaches ends that same frame; busy frames
  the replay inserts are counted from it.
- 00:0224 seeds C300-C37F from DIV (FF04). DIV depends on cycle-exact CPU time since power-on, so
  the replay copies these 128 bytes from the trace's next frame-wait snapshot (no random draw comes
  before it) and counts it (`seeds`); the player uses Math.random, which is as unpredictable to the
  player as the hardware value.

## 2026-10-13 — Legend I replay: late VRAM and register writes; residual frames

- lateRegs (counted): a frame whose top lines are drawn as before the step's writes (with the
  LCD registers as they were when the step began) and the rest as
  after, the line where the writes caught up old up to some pixel or mixed by 8-pixel tiles. This
  is lateWrite's case when the previous picture is not a valid "old" (an object moved in the same
  frame). Only the frames that fail every exact check reach it.
- Residual frames are kept as exact expectations ([frame, pixels]) in the sweep test rather than
  absorbed by a looser rule: today two half-written tile rows during busy stretches. A rule that
  accepts a pixel mixed bit by bit from old and new tile data would hide real tile errors.

## 2026-10-13 — Legend I replay: register stages and PyBoy's object order

- lateRegs generalised: the stages are the frame drawn with the LCD registers as at the step's
  start, after each register write of the step (Memory.onLcdWrite, diagnostics only), and the
  port's frame; each line must equal a stage, moving forward line by line (one line may mix two
  stages). It replaces the two-stage form; unit tests cover order, mixing and rejection.
- objOrder: a frame equal to the port's picture redrawn with PyBoy's object order is accepted
  and counted. This is a difference of the reference emulator from the DMG, not of the port; the
  player keeps the DMG behaviour (@ffl2k/render is unchanged).

## 2026-10-13 — Legend III course (FFL3kster) and direction notes A–D restated (Geon)

Scope: repeat the method on *Final Fantasy Legend III* (USA) — data milestones 1–7, then port
phases P1–P5 (docs/PORT_PLAN.md, "Legend III course"), started once the Legend I course had
reached its last listed step.

Direction notes carried into this course unchanged (destination, not current scope):
- **A.** docs/END_GOAL.md is the destination, docs/PORT_PLAN.md the active course.
- **B.** Variant registry, never a single-SHA assumption; the FFL3 USA dump (No-Intro hashes) is
  the Legend III reference; support is claimed per variant after full verification.
- **C.** Unverified import stays possible (manual game choice, labelled best-effort).
- **D.** Authoring model seams kept open where free: data-driven tables, IDs namespaced per game
  (`game = FFL3` in the SQLite store), conflicts recorded in docs/FINDINGS.md.

Decisions and assumptions:
- Layout mirrors Legend I: `src/ffl3kster` (own CLI), `ffl3/project/` (project.json + SQLite),
  `ffl3/input/original.gb` (read-only, gitignored), `ffl3/build/` and `ffl3/scratch/`
  (gitignored), `docs/ffl3/`, `docs/FFL3_PROGRESS.md`, `tests/ffl3/`, `tools/ffl3/`; port
  packages will be `@ffl3k/*`.
- Shared code: ffl2kster's game-independent modules are imported unchanged, as for Legend I.
  Nothing is imported from ffl1kster (Legend I specifics would leak); the few generic helpers
  that FFL1kster also re-wraps (project, build) are re-wrapped again.
- The Legend III monster data is three tables per id; each is its own edit domain (`monster`,
  `monster_class`, `monster_ability`) over one generic `Table` class, so the SQLite store stays one
  layout for every domain.
- Raw ROM bytes stay out of the repository: the SQLite store keeps decoded field values with
  provenance, not record hex dumps (the extractor's `raw` column is dropped on import).
- Version: one repository version; each Legend III milestone is a minor bump (1.21.0 = M1).

## 2026-10-13 — Legend III port P0 (`@ffl3k/importer`)

- The importer mirrors ffl3kster module by module (rom, text, tables, layout, music, gfx,
  package); the Python toolkit stays the reference and the golden test compares the TypeScript
  output with `ffl3/data` (records, maps, layouts, text, music) and with hashes from
  `tools/ffl3/golden_export.py` (font, 192 map tilesets, 194 monster pictures, 31 tile maps,
  every map buffer with no / all story flags). ROM-dependent tests skip without the ROM.
- Table field layouts are data (name, offset, encoding); meanings, status and evidence live once,
  in the Python schema, not duplicated in TypeScript.
- The data package keeps all 16 banks as segments (the engine reads original addresses), as for
  Legend I; it is built on the device and never leaves it.
- A Python behaviour the port exposed is fixed in Python first, with an emulator test, before the
  port is made to agree (map 11: patch rows past the map are dropped; the game writes them after
  the buffer).

## 2026-10-13 — Legend III port P1: runtime and parity rules

- `@ffl3k/core` follows `@ffl1k/core`'s design (ported routines as generators, original RAM
  addresses, no CPU emulation) with Legend III's own runtime: frame waits through FF95, the VRAM
  bracket's handler swap, and a line-by-line clock that takes interrupts as the hardware would
  (IF raised at LYC and line 144; vblank polls resume before the interrupt is taken).
- CPU time is not modelled. Legend III's VRAM copies (00:20FF) are paced by hblank and by the
  sound handler's length, so their duration cannot be derived without cycle-exact emulation of
  the driver; the replay therefore re-times each frame wait from the trace (busy frames spent
  before the wait sets FF95, with the interrupts running) — the same principle as Legend I's busy
  frames, applied at the wait's start.
- Parity rules (counted, each falsified with a mutation): wait states compared byte for byte
  except sound driver RAM (until the driver is ported), the stack, timing registers, rst $18's
  scratch, the dead bank stack slots, and CDCF's mode bits; screens equal, or in a busy frame
  every pixel new or old (tear), or in/just after a busy stretch equal to the port's picture with
  the original's objects of the previous frame (late OAM writes; the objects are compared at the
  next wait). Traces now also record the OAM per frame (oam.bin).
- 1.32.0: more CPU time is taken from the trace, by the same principle: the frame and line of
  each VRAM bracket entry (the port spends the time before it with the interrupts on, then
  disables them, switches the handlers and polls, as the original), and the end of each
  interrupt-time frame work 00:3557 (its hblank-paced copies; CDC5 held until then). In play,
  without a trace, both happen at once — the difference is at most a waterfall pixel. New counted
  screen rule: line tears (differences only on lines the original was still writing, showing an
  old picture; at most two half-written lines). OAM-only wait differences that a later wait shows
  equal again are counted as transient (the interrupts' sprite work saw a half-done copy). The
  replay requires every bracket entry and poll on time and every work matched by frame.
- 1.33.0: sync points — a short list of (bank, address) whose CPU arrival times the traces record
  (tools/ffl3/trace_lib.py POINTS); the port calls `Game.point` at the same place on every path,
  matched by count, and spends the time before it with the interrupts on. Points are added only
  where a replay shows the original's CPU time changing what an interrupt sees. Frames before a
  bracket entry or a point count as busy frames (tears allowed: every pixel new, old, or the
  port's objects over the last wait's VRAM).
- 1.34.0: the random generator's only time-dependent input, FF93, is taken from the trace at each
  draw (counted; in play the current FF93). The battle script is interpreted from ROM (the port
  ports the interpreter and the native routines, not the 2,376 statements); natives are registered
  by address and an unported one stops the replay with its address. Routines ported by
  sub-agents count as verified only where a replay reaches them.
- 1.35.0: the port's code is held while an interrupt handler's work (with its trace end) is still
  running — the original's code cannot run during a handler.
