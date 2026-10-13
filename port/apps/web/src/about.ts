/** About panel: version, the non-affiliation and no-content notice (NOTICE.md) and the bundled
 *  third-party software (THIRD_PARTY.md). */
import { platformName } from "./platform";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...kids: (Node | string)[]) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  e.append(...kids);
  return e;
}

export function aboutPanel(): HTMLElement {
  const thirdParty: [string, string][] = [
    ["Vite runtime helper", "MIT"], ["@capacitor/core, filesystem, share (mobile shells only)", "MIT"], ["@capacitor/synapse (mobile shells only)", "ISC"],
    ["Tauri 2 and its Rust dependencies (desktop apps)", "MIT OR Apache-2.0 and permissive licences"],
  ];
  const details = el("details", {}, el("summary", {}, "Third-party software"),
    el("ul", {}, ...thirdParty.map(([n, l]) => el("li", {}, `${n} — ${l}`))),
    el("p", { class: "muted" }, "The desktop apps show this page in the system web view (WebView2, WKWebView, WebKitGTK), which is part of the operating system."));
  return el("section", { class: "panel" },
    el("h2", {}, "About"),
    el("p", {}, `FFTOL — Tower of Legends ${__APP_VERSION__} (${platformName()}).`),
    el("p", { class: "muted" }, "An independent, non-commercial fan project, not affiliated with, endorsed by or sponsored by Square Enix, Nintendo or any other rights holder. Final Fantasy, SaGa, Game Boy and related names are trademarks of their owners, used only to identify the game this engine is compatible with."),
    el("p", { class: "muted" }, "No game content is included: the game data is built on this device from your own ROM, which is never uploaded. Saves stay on this device unless you export them."),
    details);
}
