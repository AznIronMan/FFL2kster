# FFTOL web port — Legend II (web first)

Part of FFTOL (Tower of Legends); the port of *Final Fantasy Legend II* built on the FFL2kster
toolkit.

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

## Platforms (P4)

One web build runs everywhere; the shells only wrap it. Builds for all six targets come from the
`Platforms` workflow (`.github/workflows/platforms.yml`, artifacts on each run). Local builds:

| Target | Shell | Local build | Output |
|---|---|---|---|
| Web / PWA | browser (installable: manifest + service worker caching app code only) | `npm run build -w @ffl2k/web` | `apps/web/dist` (static hosting) |
| Windows, macOS, Linux | Tauri 2 (`apps/desktop`) | Rust toolchain, then `npm run build -w @ffl2k/web && cd apps/desktop && npx tauri build` | `.msi`/`.exe`, `.dmg`/`.app`, `.deb`/`.rpm`/`.AppImage` |
| Android | Capacitor 8 (`apps/mobile/android`) | JDK 21 + Android SDK: `npm run build -w @ffl2k/web && npm run android:apk -w @ffl2k/mobile` | debug-signed `.apk` |
| iOS | Capacitor 8 (`apps/mobile/ios`, Swift Package Manager) | Xcode with the iOS platform: `npm run ios:sim -w @ffl2k/mobile` | simulator `.app`; device builds need signing |

Common to all: ROM import with the native picker (verified, or **unverified** on request for
other revisions and patched builds), game data and battery RAM in IndexedDB (the shells keep it in
the app's data directory), **portable saves** (export/import of the 8 KiB `.sav`, the same file on
every platform and in Game Boy emulators), keyboard (arrows + Z/X or WASD + K/J), every connected
gamepad (standard mapping: Xbox, PlayStation, Switch Pro),
on-screen touch controls, fullscreen, pause while hidden.

Signing: macOS sign + notarize turn on in CI when the repository has the Apple secrets listed in
the workflow; Windows code signing, Android release signing and iOS device signing need the
owner's certificates/keystore and are not set up (docs/PLATFORMS.md).

## Layout

| Package | Role |
|---|---|
| `packages/importer` | ROM check → data package (text, tables, maps + layout renderer, events, rules, calc-VM listing, music/SFX/MIDI, graphics, bytecode segments). Golden-tested against the Python toolkit. |
| `packages/core` | deterministic engine: one function per original routine, state at the original addresses (P1-P3, parity-tested) |
| `packages/render` | 160×144 PPU renderer |
| `packages/audio` | DMG APU synth |
| `packages/parity` | PyBoy trace replay and sweeps (needs the ROM and traces in ../build) |
| `apps/web` | the app: ROM import, IndexedDB, saves, player, input, PWA |
| `apps/desktop` | Tauri 2 shell (Windows, macOS, Linux) |
| `apps/mobile` | Capacitor 8 shells (Android, iOS) |
| `assets` | original app icon (`make_icons.py`) |

The data package is stored only in IndexedDB (in a browser or a shell's app data). It can be
removed from the app; saves stay until replaced.
