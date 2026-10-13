# End Goal — the combined trilogy engine

Status: designated by Geon 2026-10-12 as the overall project's end goal.
This is a destination document, NOT current scope. Current work remains the
Legend II port phases in docs/PORT_PLAN.md. Every stage below must be
shippable on its own; the end goal is assembled last, from proven parts.

Project name: **FFTOL** (full title: **Tower of Legends**). Per-game
toolkits: FFL1kster / FFL2kster / FFL3kster. Master engine (this document's
subject): **TOLkster** — name reserved, nothing built yet.

## The picture

- Three faithful ports (Legend I, II, III), playable natively and on the web,
  built on the ROM-import model: the engine ships with no game content;
  players supply their own ROMs and the importer builds each data package.
- Regional/language ROM variants are in scope: players may import their own
  regional ROMs (e.g. the Japanese SaGa releases). A variant counts as
  supported only after it passes the same verification the US Legend II ROM
  passed; the importer keeps a variant registry rather than assuming one
  canonical hash per game. Geon will supply the variant ROMs over time.
- Import trust tiers: a known hash takes the verified path. An unknown hash
  is NOT a dead end — the player may manually select the game/engine and
  import best-effort in a clearly labeled unverified mode (size/header
  sanity checks still warn; guarantees don't apply). This is load-bearing,
  not a courtesy: FFL2kster-patched ROMs, fan translations and ROM hacks
  can never match a canonical hash, and the project's own mod support
  depends on importing them.
- Web hosting model: static hosting (GitHub Pages or a private server)
  serves code only. ROMs are imported client-side and never uploaded to
  the host. Saves/states live in the player's browser storage (IndexedDB)
  and are exportable/importable as files.
- One original game on the same data-driven engine: a combined arena / tower
  experience assembled from all three games' systems, creatures and forms.
- An editor that is the same SQLite / data-package layer with a GUI face.

The faithful ports are preservation. The arena/tower game is creation.

## Authoring model — data, not code

The engine is a small fixed kernel interpreting a large data world: maps,
event scripts (bytecode), battle/growth rules (calc-VM bytecode), text,
encounters, and music sequences are all data the engine looks up at runtime
(indirection — the engine asks, the data layer answers).

- **Content vs behavior.** New spells composed from existing handlers,
  animations and SFX; new dungeons composed from existing script ops, maps,
  text and encounters — these are *data authoring*, no engine code. Genuinely
  new behavior (new effect handlers, new systems) is *engine work*: ASM on
  the `.gb` path, new TypeScript handlers on the port path. That is the
  plugin/addon line, and it is where TOLkster's addon layer lives.
- **Asset packs** (TOLkster-side, modern-only, never the `.gb` path). Audio:
  manifest maps track ID → file + loop points, per-track fallback to the
  synthesized original; OGG/Opus preferred (MP3 padding breaks seamless
  loops). Graphics: manifest maps sprite/tile ID → PNG/WebP with
  grid-alignment and frame-inventory contracts; the engine keeps timing and
  flip attributes; unmapped frames fall back to the original.
- **Hotswap.** On the port, the data layer resolves IDs dynamically — by
  story flags, scripts, mods, or procedural generators (endless tower
  floors, randomized arena formations). On the `.gb`, selection is among
  pre-compiled variants (conditional maps are native — 28 decoded in
  Legend II); the pool is fixed at build time.
- **Editor responsibilities:** ID allocator (no collisions across new maps,
  text, flags, formations); per-target budget view (ROM space + flag bits on
  `.gb` — tracking overwrite / dummy-slot / new-bank strategy per addition;
  unbounded on port); authoring forms (maps, warps, variants-by-flag, text,
  encounters); validator enforcing referential integrity across all
  configurations (the feature that makes hotswap safe).

## Unified data model

- A character is: chassis (human, mutant, monster, robot, beast, cyborg)
  x growth module (which game's rules raise it) x form pool.
- A single unified meat graph: (form x meat) -> new form, assembled from all
  three games' decoded transformation tables. Growth mode decides when a
  character may traverse the graph and what meat/parts are for; the graph
  itself does not change per mode.
- Formations and creatures from all three games (~700+ forms) live in one
  pool, tagged by home game and tier.

## Growth modes (arena / tower)

Mode is a property of the run, not of the arena. Default: **II**.

- **Mode II (default):** usage-based human growth, robots as equipment
  chassis, mutant ability churn, monsters transform via meat.
- **Mode I:** humans buy stats with gold (the shop is the progression),
  mutants grow randomly, monsters transform via meat. No robot growth track.
- **Mode III:** XP levels; meat moves characters toward beast forms, parts
  toward cyborg forms; transformation is a build path for the whole party.
- **Freeform (later tier):** growth module elected per character. This breaks
  single-economy difficulty assumptions, so it ships after the fixed modes.

## Arena mode (Colosseum-style)

- Pure randomized battles, session-based, no campaign structure: bring any
  party, draw any formation from the unified pool — including final bosses.
  A level-1 party CAN draw the Legend III final boss. The unfairness is the
  point (reference: FFVI's Colosseum; audience: old-school players).
- Rewards: GP, meat, items; growth applies per the active mode.
- Open question: wagering (bet GP or an item for better rewards, Colosseum
  style) — Geon undecided; keep as an optional toggle if implemented.

## Tower Run mode

- Structured endless climb: floors of battles; a landing with inn + shop
  every few floors; god-tier boss floors at intervals.
- Strata themed by game: Legend I worlds low, Legend II mid, Legend III
  high, mixed above that. Floor pools, landings and boss floors are data
  rows the editor can author (shareable "tower packs").

## Sequencing (the ratchet)

1. Legend II port P1-P3 (faithful core: slice, full field, full battle).
2. Legend I pipeline (same method; simplest game).
3. Legend III pipeline.
4. Arena in Mode II with the unified creature pool.
5. Arena Modes I and III; Tower Run.
6. Editor GUI over the proven data layer; tower packs.
7. Freeform growth; combined climb campaign (capstone).

## Open questions

- Cross-game meat-graph conflicts: where the three games' tables disagree,
  what arbitration rule wins?
- Balance model for cross-game formations (arena is exempt by design;
  Tower Run is not).
- Wagering in arena (above).
- Per-variant table layouts: regional ROMs may place tables differently;
  each variant needs its own layout evidence (see The picture).
- Asset-pack format details (manifest schemas, grid/frame contract
  versioning, pack signing or trust marking).
- Name: must be neutral (no Square trademarks). Decided scheme (Geon,
  2026-10-12): project **FFTOL**, full title **Tower of Legends** (TOL),
  logo mark **F²**; toolkits FFL1kster / FFL2kster / FFL3kster; master
  engine **TOLkster**. Caution: an unrelated Steam platformer already
  uses the exact title (Tower Of Legends, EerieEchoGames, store-listed
  Aug 2026); fine for private use, would need a distinguisher for a
  public or store release. Wink variants (codename/tag layer): "F²",
  "FFTOL". Rejected: "Food Chain" (Geon: reads as a food/idle game),
  "Fx2". Unadopted: "Strata", "Legendary" (safe but crowded/generic).