# Installing a private build

Builds come from a tagged release (GitHub → Releases → the draft for the version; visible only to
the repository's owner and collaborators) or from any run of the Platforms workflow (Artifacts).
Every build ships engine code only: on first start, choose your own ROM (Legend II, USA) and the
game data is built on that computer. Saves stay on the computer; use Options → Saves to export or
import `legend2.sav` (the same file works on every target and in Game Boy emulators).

## Web
Unzip `TowerOfLegends-<version>-web.zip` onto any static web server (a private server, a NAS, or
`python3 -m http.server` in the folder for this computer only). Open it in Chrome, Edge, Firefox or
Safari. On https or localhost the browser offers "Install app", and the app then works offline.
Note: a page served from a public host (e.g. GitHub Pages of a public repository) is public.

## Windows 10 / 11
Run `Tower of Legends_<version>_x64-setup.exe` (or the `.msi`). The build is not code-signed, so
SmartScreen shows "Windows protected your PC": choose **More info → Run anyway**. Microsoft Edge
WebView2 is part of Windows 10/11; the installer fetches it if a system lacks it.

## macOS
Open `Tower of Legends_<version>_universal.dmg` and drag the app to Applications (Apple silicon
and Intel). The build is not notarized, so the first start needs **right-click → Open → Open**
(or System Settings → Privacy & Security → Open Anyway). Signing and notarization switch on
automatically in CI once the Apple secrets are added (docs/PLATFORMS.md).

## Linux
- Debian/Ubuntu: `sudo apt install ./"Tower of Legends_<version>_amd64.deb"`
- Fedora/openSUSE: `sudo dnf install ./"Tower of Legends-<version>-1.x86_64.rpm"`
- Any distribution: `chmod +x "Tower of Legends_<version>_amd64.AppImage"` and run it.
The app uses the system WebKitGTK (4.1) for its window.

## Controls
Keyboard: arrows + X (A) / Z (B), or WASD + K (A) / J (B); Enter or Space = Start; Shift or
Backspace = Select; hold Tab = fast-forward; Esc = options; F11 = fullscreen; M or the Sound button = mute. Gamepads
(Xbox, PlayStation, Switch Pro) use the Game Boy layout by default: the right face button is A.
Everything is rebindable in Options → Controls.

## Uninstalling
Remove the app as usual for the system. Game data and saves live in the app's data folder
(browser site data for the web build); export your save first if you want to keep it.
