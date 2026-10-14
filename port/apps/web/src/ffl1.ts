/** Legend I (FFL1kster) in the app shell: import the player's own Legend I ROM (verified, or
 *  unverified on request), build its data package locally, keep it and its saves beside Legend
 *  II's, and run the Legend I player. Nothing of Legend II's flow changes. */
import { checkFfl1Rom, importFfl1Rom, FFL1_PACKAGE_FORMAT, FFL1_TITLE, type Ffl1Check, type Ffl1DataPackage } from "@ffl1k/importer";
import { saveFfl1Package, clearFfl1Package, loadFfl1Sram, saveFfl1Sram, loadFfl1SramBackup } from "./storage";
import { Player1 } from "./player1";
import { aboutPanel } from "./about";
import { optionsPanel, applyDisplay } from "./options";
import { pickFile, saveFile, toggleFullscreen, platformName } from "./platform";
import { TouchPad, touchByDefault } from "./touch";
import { settings, onSettings, type Settings } from "./settings";
import { gameLinks } from "./games";

export const TITLE1 = "Tower of Legends · Legend I";
/** MBC2 battery RAM as emulators store it: 512 bytes, one 4-bit cell per byte. */
export const SAV1_SIZE = 0x200;
export const SAV1_NAME = "legend1.sav";

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

/** Whether a file is meant for Legend I: the verified dump, or a 128 KiB "SAGA" image. */
export async function isFfl1(bytes: Uint8Array): Promise<Ffl1Check | null> {
  const c = await checkFfl1Rom(bytes);
  return c.ok || (c.canOverride && c.title === FFL1_TITLE) ? c : null;
}

export async function handleFfl1(app: HTMLElement, bytes: Uint8Array, check: Ffl1Check, status: HTMLElement): Promise<void> {
  if (check.ok) return build(app, bytes, status, false);
  status.className = "err";
  status.replaceChildren(el("div", { class: "warn" },
    el("p", {}, `This file is not the supported Legend I ROM revision (SHA-256 ${check.sha256.slice(0, 12)}…). It may be another dump or revision, a translation, a hack or a patched build.`),
    ...(check.warnings.length ? [el("ul", {}, ...check.warnings.map((w) => el("li", {}, w)))] : []),
    el("p", {}, "You can import it anyway in unverified mode: the game data is extracted with Legend I's layout, and anything may be wrong or crash. Verified-path guarantees do not apply."),
    button("Import anyway (unverified)", () => build(app, bytes, status, true))));
}

async function build(app: HTMLElement, bytes: Uint8Array, status: HTMLElement, unverified: boolean): Promise<void> {
  const bar = el("progress", { max: "7", value: "0" }) as HTMLProgressElement;
  status.className = "";
  status.replaceChildren("Building Legend I game data…", bar);
  try {
    const pkg = await importFfl1Rom(bytes, (_s, done) => { bar.value = done; }, { unverified });
    await saveFfl1Package(pkg);
    showFfl1Summary(app, pkg);
  } catch (e) {
    status.className = "err";
    status.textContent = `Import failed: ${(e as Error).message}`;
  }
}

export function ffl1PackageUsable(p: unknown): p is Ffl1DataPackage {
  return !!p && (p as Ffl1DataPackage).game === "FFL1" && (p as Ffl1DataPackage).format === FFL1_PACKAGE_FORMAT;
}

function savesPanel(): HTMLElement {
  const msg = el("p", { class: "muted" }, "");
  const refresh = async () => {
    const s = await loadFfl1Sram().catch(() => undefined);
    msg.textContent = s ? `A Legend I save is stored on this device. Export it as ${SAV1_NAME} (the same file works in Game Boy emulators).` : "No Legend I save on this device yet.";
  };
  void refresh();
  return el("section", { class: "panel" },
    el("h2", {}, "Saves"),
    msg,
    el("div", { class: "row" },
      button("Export save", async () => {
        const s = await loadFfl1Sram().catch(() => undefined);
        if (!s) { msg.textContent = "No save to export yet."; return; }
        msg.textContent = (await saveFile(SAV1_NAME, Uint8Array.from(s, (v) => 0xf0 | (v & 0x0f)))) ? "Save exported." : "Export cancelled.";
      }),
      button("Restore previous save", async () => {
        const prev = await loadFfl1SramBackup().catch(() => undefined);
        if (!prev) { msg.textContent = "No earlier save kept yet."; return; }
        if (!confirm("Go back to the save as it was before the last play session?")) return;
        await saveFfl1Sram(prev);
        msg.textContent = "Previous save restored.";
      }),
      button("Import save", async () => {
        const f = await pickFile(["sav"]);
        if (!f) return;
        if (f.bytes.length !== SAV1_SIZE) { msg.textContent = `This file can't be used: a Legend I save is ${SAV1_SIZE} bytes (this one is ${f.bytes.length}).`; return; }
        if (!confirm("Replace the Legend I save on this device with this file?")) return;
        await saveFfl1Sram(Uint8Array.from(f.bytes, (v) => v & 0x0f));
        msg.textContent = "Save imported.";
        void refresh();
      }),
    ));
}

export function showFfl1Summary(app: HTMLElement, pkg: Ffl1DataPackage): void {
  const dl = el("dl", {},
    el("dt", {}, "Source"), el("dd", {}, `${pkg.sourceSha256.slice(0, 12)}… ${pkg.verified ? "(verified)" : "(UNVERIFIED)"}`),
    el("dt", {}, "Monsters"), el("dd", {}, String(pkg.monsters.length)),
    el("dt", {}, "Items"), el("dd", {}, String(pkg.items.length)),
    el("dt", {}, "Platform"), el("dd", {}, platformName()));
  document.title = "Tower of Legends — Legend I";
  app.replaceChildren(
    el("h1", {}, TITLE1),
    el("p", { class: "lead" }, pkg.verified ? "Legend I game data is ready on this device." : "Legend I game data is ready on this device — imported in UNVERIFIED mode."),
    el("section", { class: "panel" }, el("div", { class: "row" }, button("Play", () => showFfl1Player(app, pkg), "primary"),
      ...gameLinks(1).map((l) => button(l.label, l.run)),
      el("span", { class: "muted" }, "Legend I is in progress: the title, a new game, towns, menus, shops and battles play, with music; the world map's random encounters are not ported yet."))),
    savesPanel(),
    el("p", { class: "muted" }, "Legend I uses these options: fast text, fast-forward, colours, sound and controls. The others apply to Legend II for now."),
    optionsPanel(),
    aboutPanel(),
    el("section", { class: "panel" }, dl),
    el("section", { class: "panel" }, button("Remove Legend I game data from this device", async () => {
      if (!confirm("Remove the Legend I game data built from your ROM? Saves stay.")) return;
      await clearFfl1Package();
      location.reload();
    })));
}

function showFfl1Player(app: HTMLElement, pkg: Ffl1DataPackage): void {
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
  const player = new Player1(pkg, { canvas, onStatus: (m) => { status.textContent = m; }, onError, inputs: [() => touch.buttons()] });
  applyDisplay();
  if (new URLSearchParams(location.search).has("debug")) (globalThis as { fftolPlayer1?: Player1 }).fftolPlayer1 = player;
  void player.start();
}
