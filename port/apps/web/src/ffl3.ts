/** Legend III (FFL3kster) in the app shell: import the player's own Legend III ROM (verified, or
 *  unverified on request), build its data package locally, keep it and its saves beside the other
 *  games', and run the Legend III player. Nothing of Legend II's or Legend I's flow changes. */
import { checkFfl3Rom, importFfl3Rom, FFL3_PACKAGE_FORMAT, FFL3_TITLE, type Ffl3Check, type Ffl3DataPackage } from "@ffl3k/importer";
import { saveFfl3Package, clearFfl3Package, loadFfl3Sram, saveFfl3Sram, loadFfl3SramBackup } from "./storage";
import { Player3 } from "./player3";
import { aboutPanel } from "./about";
import { optionsPanel, applyDisplay } from "./options";
import { pickFile, saveFile, toggleFullscreen, platformName } from "./platform";
import { TouchPad, touchByDefault } from "./touch";
import { settings, onSettings, type Settings } from "./settings";
import { gameLinks } from "./games";

export const TITLE3 = "Tower of Legends · Legend III";
/** MBC1 battery RAM as emulators store it: 8 KiB. */
export const SAV3_SIZE = 0x2000;
export const SAV3_NAME = "legend3.sav";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...kids: (Node | string)[]) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  e.append(...kids);
  return e;
}

function button(label: string, onclick: () => unknown, cls = ""): HTMLButtonElement {
  const b = el("button", cls ? { class: cls } : {}, label) as HTMLButtonElement;
  b.onclick = () => void onclick();
  return b;
}

/** Whether a file is meant for Legend III: the verified dump, or a 256 KiB "SAGA3" image. */
export async function isFfl3(bytes: Uint8Array): Promise<Ffl3Check | null> {
  const c = await checkFfl3Rom(bytes);
  return c.ok || (c.canOverride && c.title === FFL3_TITLE) ? c : null;
}

export async function handleFfl3(app: HTMLElement, bytes: Uint8Array, check: Ffl3Check, status: HTMLElement): Promise<void> {
  if (check.ok) return build(app, bytes, status, false);
  status.className = "err";
  status.replaceChildren(el("div", { class: "warn" },
    el("p", {}, `This file is not the supported Legend III ROM revision (SHA-256 ${check.sha256.slice(0, 12)}…). It may be another dump or revision, a translation, a hack or a patched build.`),
    ...(check.warnings.length ? [el("ul", {}, ...check.warnings.map((w) => el("li", {}, w)))] : []),
    el("p", {}, "You can import it anyway in unverified mode: the game data is extracted with Legend III's layout, and anything may be wrong or crash. Verified-path guarantees do not apply."),
    button("Import anyway (unverified)", () => build(app, bytes, status, true))));
}

async function build(app: HTMLElement, bytes: Uint8Array, status: HTMLElement, unverified: boolean): Promise<void> {
  const bar = el("progress", { max: "7", value: "0" }) as HTMLProgressElement;
  status.className = "";
  status.replaceChildren("Building Legend III game data…", bar);
  try {
    const pkg = await importFfl3Rom(bytes, (_s, done) => { bar.value = done; }, { unverified });
    await saveFfl3Package(pkg);
    showFfl3Summary(app, pkg);
  } catch (e) {
    status.className = "err";
    status.textContent = `Import failed: ${(e as Error).message}`;
  }
}

export function ffl3PackageUsable(p: unknown): p is Ffl3DataPackage {
  return !!p && (p as Ffl3DataPackage).game === "FFL3" && (p as Ffl3DataPackage).format === FFL3_PACKAGE_FORMAT;
}

function savesPanel(): HTMLElement {
  const msg = el("p", { class: "muted" }, "");
  const refresh = async () => {
    const s = await loadFfl3Sram().catch(() => undefined);
    msg.textContent = s ? `A Legend III save is stored on this device. Export it as ${SAV3_NAME} (the same file works in Game Boy emulators).` : "No Legend III save on this device yet.";
  };
  void refresh();
  return el("section", { class: "panel" },
    el("h2", {}, "Saves"),
    msg,
    el("div", { class: "row" },
      button("Export save", async () => {
        const s = await loadFfl3Sram().catch(() => undefined);
        if (!s) { msg.textContent = "No save to export yet."; return; }
        msg.textContent = (await saveFile(SAV3_NAME, s)) ? "Save exported." : "Export cancelled.";
      }),
      button("Restore previous save", async () => {
        const prev = await loadFfl3SramBackup().catch(() => undefined);
        if (!prev) { msg.textContent = "No earlier save kept yet."; return; }
        if (!confirm("Go back to the save as it was before the last play session?")) return;
        await saveFfl3Sram(prev);
        msg.textContent = "Previous save restored.";
      }),
      button("Import save", async () => {
        const f = await pickFile(["sav"]);
        if (!f) return;
        if (f.bytes.length !== SAV3_SIZE) { msg.textContent = `This file can't be used: a Legend III save is ${SAV3_SIZE} bytes (this one is ${f.bytes.length}).`; return; }
        if (!confirm("Replace the Legend III save on this device with this file?")) return;
        await saveFfl3Sram(f.bytes.slice());
        msg.textContent = "Save imported.";
        void refresh();
      }),
    ));
}

export function showFfl3Summary(app: HTMLElement, pkg: Ffl3DataPackage): void {
  const dl = el("dl", {},
    el("dt", {}, "Source"), el("dd", {}, `${pkg.sourceSha256.slice(0, 12)}… ${pkg.verified ? "(verified)" : "(UNVERIFIED)"}`),
    el("dt", {}, "Platform"), el("dd", {}, platformName()));
  document.title = "Tower of Legends — Legend III";
  app.replaceChildren(
    el("h1", {}, TITLE3),
    el("p", { class: "lead" }, pkg.verified ? "Legend III game data is ready on this device." : "Legend III game data is ready on this device — imported in UNVERIFIED mode."),
    el("section", { class: "panel" }, el("div", { class: "row" }, button("Play", () => showFfl3Player(app, pkg), "primary"),
      ...gameLinks(3).map((l) => button(l.label, l.run)),
      el("span", { class: "muted" }, "Legend III is in progress: from power-on through the opening, the field, menus, shops, the ship, the world map and battles, with music and sound; parts no recorded run has reached yet (the late story, the ending) may still differ from the original."))),
    savesPanel(),
    el("p", { class: "muted" }, "Legend III uses these options: fast-forward, colours, sound and controls. The others apply to Legend II for now."),
    optionsPanel(),
    aboutPanel(),
    el("section", { class: "panel" }, dl),
    el("section", { class: "panel" }, button("Remove Legend III game data from this device", async () => {
      if (!confirm("Remove the Legend III game data built from your ROM? Saves stay.")) return;
      await clearFfl3Package();
      location.reload();
    })));
}

function showFfl3Player(app: HTMLElement, pkg: Ffl3DataPackage): void {
  document.body.classList.add("playing");
  const canvas = el("canvas", { class: "pixel screen" }) as HTMLCanvasElement;
  const status = el("p", { class: "muted" }, pkg.verified ? "" : "Unverified ROM");
  const touch = new TouchPad();
  const setTouch = (on: boolean) => { touch.el.hidden = !on; document.body.classList.toggle("touch", on); };
  setTouch(touchByDefault());
  let overlay: HTMLElement | null = null;
  const toggleOptions = () => {
    if (overlay) { overlay.remove(); overlay = null; player.setPaused(document.hidden); return; }
    overlay = el("div", { class: "overlay" }, optionsPanel(toggleOptions));
    document.body.append(overlay);
    player.setPaused(true);
  };
  const sound = button("", () => player.toggleMute());
  const showSound = (s: Settings) => {
    sound.textContent = s.muted ? "Sound: off" : "Sound: on";
    sound.setAttribute("aria-pressed", String(s.muted));
    sound.title = "Mute or unmute (M)";
  };
  showSound(settings());
  onSettings(showSound);
  const bar = el("div", { class: "row bar" },
    button("Back", () => location.reload()),
    button("Options", toggleOptions),
    button("Fullscreen", () => toggleFullscreen()),
    button("Touch controls", () => { setTouch(touch.el.hidden); applyDisplay(); }),
    sound,
    status);
  app.replaceChildren(el("div", { class: "player" }, canvas), touch.el, bar);
  window.addEventListener("keydown", (e) => {
    if (e.code === "F11") { e.preventDefault(); void toggleFullscreen(); }
    if (e.code === "Escape" && !e.repeat) { e.preventDefault(); toggleOptions(); }
  });
  const onError = (message: string, details: string) => {
    const box = el("div", { class: "overlay" }, el("section", { class: "panel" },
      el("h2", {}, "The game stopped"),
      el("p", {}, message),
      el("p", { class: "muted" }, "Your save is safe: it was written before this point. The details below help find the cause; they contain no save or ROM data."),
      el("pre", { class: "details" }, details),
      el("div", { class: "row" },
        button("Copy details", async () => { await navigator.clipboard?.writeText(details).catch(() => {}); }),
        button("Back to the menu", () => location.reload(), "primary"))));
    document.body.append(box);
  };
  const player = new Player3(pkg, { canvas, onStatus: (m) => { status.textContent = m; }, onError, inputs: [() => touch.buttons()] });
  applyDisplay();
  if (new URLSearchParams(location.search).has("debug")) (globalThis as { fftolPlayer3?: Player3 }).fftolPlayer3 = player;
  void player.start();
}
