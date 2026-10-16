# Installing and running Tower of Legends

Tower of Legends plays **Legend I, II and III** (Game Boy, USA). Every build ships engine code
only: on first start, drop your own ROM file onto the window (or click to choose it); the game data is built on that computer. The
other two games are one button away on each game's summary screen (import their ROMs the same
way). Saves stay on the computer; Options → Saves exports or imports `legend1.sav`,
`legend2.sav` or `legend3.sav` (the cartridge's battery RAM: the same file works on every target
and in Game Boy emulators).

## Where the files are

GitHub → Releases → the draft for the version (visible only to the repository's owner and
collaborators), or any run of the Platforms workflow (Actions → Platforms → a run → Artifacts:
`fftol-desktop-windows`, `-macos`, `-linux`, `fftol-web-pwa`). Pick **one** file for your system:

| System | Easiest | Also |
|---|---|---|
| Windows 10 / 11 | `TowerOfLegends-<version>-windows-portable.exe`: no install, double-click it | `-windows-setup.exe` (installer, Start menu entry, no admin rights needed), `-windows.msi` |
| macOS 10.15+ (Apple silicon and Intel) | `TowerOfLegends-<version>-macos.dmg`: drag the app to Applications | `-macos-app.zip`: unzip, run the app from anywhere |
| Linux (x86-64) | `TowerOfLegends-<version>-linux-x86_64.AppImage`: `chmod +x` it and run it | `-linux-amd64.deb` (Debian, Ubuntu, Mint), `-linux-x86_64.rpm` (Fedora, openSUSE) |
| Any browser | `TowerOfLegends-<version>-web.zip` on a static web server | |

## First start of an unsigned build

The builds are not code-signed yet (that needs the owner's certificates, docs/PLATFORMS.md), so
each system asks once:

- **Windows:** SmartScreen shows "Windows protected your PC": choose **More info → Run anyway**.
  The app uses Microsoft Edge WebView2, which Windows 10/11 include; the setup `.exe` installs it
  if a system lacks it (the portable `.exe` needs it present).
- **macOS:** the app is ad-hoc signed, not notarized. The first start says Apple could not check
  it: **right-click (or Control-click) the app → Open → Open**. On macOS 15 and later, if there
  is no Open button: System Settings → Privacy & Security → **Open Anyway**. If macOS says the
  app "is damaged", the download was quarantined: run
  `xattr -dr com.apple.quarantine "/Applications/Tower of Legends.app"` once.
- **Linux:** nothing to approve. The app uses the system WebKitGTK 4.1 (installed with most
  desktops; the `.deb` / `.rpm` pull it in). An AppImage needs FUSE 2 (`libfuse2` on Ubuntu
  22.04+); without it run `./TowerOfLegends-<version>-linux-x86_64.AppImage --appimage-extract-and-run`.

Install commands for the Linux packages:

- Debian/Ubuntu: `sudo apt install ./TowerOfLegends-<version>-linux-amd64.deb`
- Fedora/openSUSE: `sudo dnf install ./TowerOfLegends-<version>-linux-x86_64.rpm`

## Web
Unzip `TowerOfLegends-<version>-web.zip` onto any static web server (a private server, a NAS, or
`python3 -m http.server` in the folder for this computer only, then open http://localhost:8000).
Open it in Chrome, Edge, Firefox or Safari. On https or localhost the browser offers "Install
app", and the app then works offline. Note: a page served from a public host (e.g. GitHub Pages
of a public repository) is public.

## Controls
Keyboard: arrows + X (A) / Z (B), or WASD + K (A) / J (B); Enter or Space = Start; Shift or
Backspace = Select; hold Tab = fast-forward; Esc = options; F11 = fullscreen; M or the Sound
button = mute. Gamepads (Xbox, PlayStation, Switch Pro) use the Game Boy layout by default: the
right face button is A. Everything is rebindable in Options → Controls.

## Updating and uninstalling
Install a newer build over the old one (or replace the portable file); game data and saves are
kept. Remove the app as usual for the system. Game data and saves live in the app's data folder
(per app identifier `llc.cnb.fftol`; browser site data for the web build), which removing the
app may delete: export your saves first if you want to keep them.
