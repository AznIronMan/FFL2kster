# FFL2kster port (web first)

A TypeScript engine that plays the game from data built **on the player's device from their own
ROM**. The repository and every build contain no game content.

## Run

```bash
cd port
npm install
npm run dev          # http://localhost:5173 — choose your ROM, the data package is built locally
npm test             # golden tests run when ../input/original.gb (or $FFL2K_ROM) exists
npm run build        # web build in apps/web/dist (then: npm run check:no-content)
```

## Layout

| Package | Status | Role |
|---|---|---|
| `packages/importer` | P0 done | ROM check → data package (text, tables, maps + layout renderer, events, rules, calc-VM listing, music/SFX/MIDI, graphics, bytecode segments). Golden-tested against the Python toolkit. |
| `packages/core` | scaffold | deterministic engine (P1) |
| `packages/render` | scaffold | 160×144 renderer (P1) |
| `packages/audio` | scaffold | APU-style synth (P1) |
| `packages/ui` | scaffold | windows/menus/input (P1) |
| `apps/web` | P0 shell | ROM import, IndexedDB persistence, import summary |

The data package is stored only in the browser's IndexedDB (or a wrapper's app data). It can
be removed from the app.
