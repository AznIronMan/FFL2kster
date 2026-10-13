# Third-party software

Components shipped inside FFTOL builds, with their licences. Build-only tools (Vite, TypeScript,
Vitest, PyBoy, the Tauri and Capacitor command-line tools, GitHub Actions) are not shipped and are
not listed.

| Component | Version | Licence | In |
|---|---|---|---|
| Vite runtime helper (module preload) | 6.x | MIT | web build (all targets) |
| @capacitor/core | 8.5.3 | MIT | web build (loaded only inside the mobile shells) |
| @capacitor/filesystem | 8.1.4 | MIT | web build (mobile shells only) |
| @capacitor/share | 8.0.3 | MIT | web build (mobile shells only) |
| @capacitor/synapse | 1.0.4 | ISC | web build (mobile shells only) |
| Tauri 2 (`tauri`, `tauri-build`, `tauri-plugin-dialog`, `tauri-plugin-fs`) and their Rust dependencies | 2.x | MIT OR Apache-2.0 (dependencies: MIT, Apache-2.0, BSD, ISC, Zlib, Unicode-3.0 and similar permissive licences) | Windows, macOS, Linux apps |
| Capacitor Android / iOS runtimes | 8.5.3 | MIT | Android and iOS apps (deferred targets) |

The desktop apps display the web build in the system's web view (Microsoft Edge WebView2 on
Windows, WKWebView on macOS, WebKitGTK on Linux), which belongs to the operating system and is not
bundled.

Licence texts: MIT — permission is granted, free of charge, to any person obtaining a copy of the
software, to deal in it without restriction, provided the copyright notice and this permission
notice are included; the software is provided "as is", without warranty of any kind. ISC is
equivalent. Apache-2.0: https://www.apache.org/licenses/LICENSE-2.0. The full notices of each
package are in its distribution (`node_modules/<package>/LICENSE`, `cargo` registry sources).
