# Platforms (P4)

The port is one web build (`port/apps/web`) wrapped by thin shells. Every build ships engine code
only; the player imports their own ROM on the device (verified, or unverified on request,
direction note C).

## Targets and how to install a build

Builds come from the `Platforms` workflow (GitHub Actions → a run → Artifacts).

| Target | Artifact | Install | Status |
|---|---|---|---|
| Web / PWA | `fftol-web-pwa` (static files) | host anywhere static (code only); browsers offer "Install app" | built in CI; offline shell verified in Chromium |
| Windows | `fftol-desktop-windows` (`.msi`, setup `.exe`) | run the installer; unsigned builds show a SmartScreen prompt ("More info → Run anyway") | built in CI |
| macOS | `fftol-desktop-macos` (`.dmg`, universal) | drag to Applications; unsigned builds: right-click → Open the first time (or sign and notarize, below) | built in CI |
| Linux | `fftol-desktop-linux` (`.deb`, `.rpm`, `.AppImage`) | install the package, or `chmod +x` the AppImage | built in CI |
| Android | `fftol-android-apk` (debug-signed `.apk`) | allow installs from the file manager/browser, open the APK (or `adb install`) | built in CI and locally |
| iOS | `fftol-ios` (simulator app zip, unsigned device `.ipa`) | simulator: drag the app onto a booted simulator; device: needs signing (below) | built in CI |

## Saves are portable

The game's battery RAM is exported and imported as `legend2.sav`: 8 KiB, the raw cartridge RAM,
the same file on every target and the format Game Boy emulators use for this cartridge. Export
uses a download (browsers), a save dialog (desktop) or the share sheet (phones); import uses the
system file picker. Verified: a `.sav` taken from the emulator (PyBoy) imports in the web build and
Continue loads it (slot "Save1", party and map as saved).

## Storage per platform

Game data (built from the ROM) and battery RAM are kept in IndexedDB everywhere: the browser's
site storage, the Tauri web view's data directory (per app identifier `llc.cnb.fftol`), the
Android/iOS web view's app storage. Removing the app removes them; export saves first.

## Input

Keyboard, two layouts at once by physical key, with B on the left key and A on the right as on the
Game Boy: arrows + X (A) / Z (B), or WASD + K (A) / J (B); Enter or Space = Start, Shift or
Backspace = Select, F11 = fullscreen, M = mute (also the Sound button in the player bar and
Options → Sound; remembered per device). Every connected gamepad (W3C "standard" mapping, which
Xbox, PlayStation and Switch Pro controllers report) uses the **Game Boy layout** by default: east
face button / Xbox B = A, south / Xbox A = B (A sits right of B, as on the Game Boy); Options →
Controls → A/B layout switches to the Xbox layout (south = A). View/Back = Select, Menu/Start =
Start, D-pad or left stick; verified with an Xbox Wireless Controller over USB-C on macOS. And
on-screen touch controls (shown by default on touch devices and
in the mobile shells; toggle in the player bar). A press is held at least 4 frames, so taps never
get lost. The game pauses while the app or tab is hidden and saves are flushed first.

## Signing (owner's credentials; not part of the repository)

- **macOS sign + notarize:** add repository secrets `APPLE_CERTIFICATE` (base64 of a Developer ID
  Application .p12), `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`,
  `APPLE_PASSWORD` (app-specific password) and `APPLE_TEAM_ID`; the workflow then signs and
  notarizes the macOS build.
- **Windows:** an Authenticode certificate (or Azure Trusted Signing) would remove the SmartScreen
  prompt; configure `bundle.windows` signing in `tauri.conf.json`. Not set up.
- **Android release:** a release keystore (kept outside the repository) and a `signingConfigs`
  block, or Play App Signing. The debug-signed APK installs by sideloading.
- **iOS device / TestFlight / App Store:** an Apple Developer team; open
  `port/apps/mobile/ios/App/App.xcodeproj`, choose the team, archive. Without it only the
  simulator build runs.

Store submissions are P6.
