/** App shell: import the player's own ROM (verified, or unverified on request), build the data
 *  package locally, persist it, manage portable saves, and run the player. The same build runs in
 *  browsers (installable as a PWA), in the Tauri desktop shell and in the Capacitor mobile shells
 *  (platform.ts holds the differences). */
import { checkRom, importRom, decodeTile, type DataPackage, type RomCheck } from "@ffl2k/importer";
import { clearPackage, loadPackage, savePackage, loadSram, saveSram, saveBase, clearBase, loadSramBackup, saveSramBackup } from "./storage";
import { aboutPanel } from "./about";
import { modsPanel } from "./mods";
import { Player } from "./player";
import { PACKAGE_FORMAT } from "@ffl2k/importer";
import { pickFile, platform, platformName, toggleFullscreen } from "./platform";
import { exportSave, importSave, SAV_NAME } from "./saves";
import { TouchPad, touchByDefault } from "./touch";
import { optionsPanel, applyDisplay } from "./options";
import { settings, onSettings, type Settings } from "./settings";
import { isFfl1, handleFfl1, showFfl1Summary, ffl1PackageUsable } from "./ffl1";
import { loadFfl1Package, loadFfl3Package } from "./storage";
import { isFfl3, handleFfl3, showFfl3Summary, ffl3PackageUsable } from "./ffl3";
import { setGameLinks, gameLinks } from "./games";

/** Displayed title: the project (FFTOL, Tower of Legends) and the game this port plays. */
const TITLE = "Tower of Legends · Legend II";
/** Legend I data is on this device too (set at start-up and after a Legend I import). */
let hasFfl1 = false;
/** Legend III data is on this device too. */
let hasFfl3 = false;
/** Legend II data is on this device (for the other games' summaries). */
let hasFfl2 = false;
// the game switch: each other Legend, played from its stored data or imported
setGameLinks((current) => ([1, 2, 3] as const).filter((n) => n !== current).map((n) => {
  const name = ["", "Legend I", "Legend II", "Legend III"][n]!;
  const has = n === 1 ? hasFfl1 : n === 2 ? hasFfl2 : hasFfl3;
  return { label: has ? name : `Add ${name}`, run: () => { if (has) location.search = n === 2 ? "" : `?game=${n}`; else showImporter(); } };
}));
const app = document.getElementById("app")!;
const SHADES = [[255, 255, 255], [170, 170, 170], [85, 85, 85], [0, 0, 0]] as const;

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

function drawTiles(tiles: Uint8Array, w: number, h: number, scale = 3): HTMLCanvasElement {
  const c = el("canvas", { class: "pixel", width: String(w * 8), height: String(h * 8) }) as HTMLCanvasElement;
  c.style.width = `${w * 8 * scale}px`;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(w * 8, h * 8);
  for (let t = 0; t < w * h; t++) {
    const px = decodeTile(tiles.subarray(16 * t, 16 * t + 16));
    const tx = (t % w) * 8, ty = Math.floor(t / w) * 8;
    for (let i = 0; i < 64; i++) {
      const o = ((ty + (i >> 3)) * w * 8 + tx + (i & 7)) * 4;
      const s = SHADES[px[i]!]!;
      img.data[o] = s[0]; img.data[o + 1] = s[1]; img.data[o + 2] = s[2]; img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function showImporter(message?: string) {
  const drop = el("div", { class: "drop", tabindex: "0" }, "Drop your ROM file here, or tap to choose it.");
  const status = el("p", {}, message ?? "");
  drop.onclick = async () => {
    const f = await pickFile(["gb"]);
    if (f) void handle(f.bytes, status);
  };
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add("over"); };
  drop.ondragleave = () => drop.classList.remove("over");
  drop.ondrop = async (e) => {
    e.preventDefault();
    drop.classList.remove("over");
    const f = e.dataTransfer?.files[0];
    if (f) void handle(new Uint8Array(await f.arrayBuffer()), status);
  };
  app.replaceChildren(
    el("h1", {}, TITLE),
    el("p", { class: "lead" }, "This engine ships with no game content. Choose your own copy of the game ROM (Legend I, II or III); it is read only on this device to build the game data."),
    el("section", { class: "panel" }, drop, status),
  );
}

/** Which games' data are stored now (an import earlier in this session counts). */
async function refreshGames(): Promise<void> {
  hasFfl1 = ffl1PackageUsable(await loadFfl1Package().catch(() => undefined));
  hasFfl3 = ffl3PackageUsable(await loadFfl3Package().catch(() => undefined));
  hasFfl2 = (await loadPackage().catch(() => undefined))?.format === PACKAGE_FORMAT;
}

async function handle(bytes: Uint8Array, status: HTMLElement) {
  await refreshGames();
  const check = await checkRom(bytes);
  // Legend I (FFL1kster): its verified dump, or a "SAGA" image that is not Legend II's
  // Legend III (FFL3kster): its verified dump, or a "SAGA3" image
  const c3 = check.ok ? null : await isFfl3(bytes);
  if (c3) return handleFfl3(app, bytes, c3, status);
  const c1 = check.ok ? null : await isFfl1(bytes);
  if (c1) return handleFfl1(app, bytes, c1, status);
  if (!check.ok) {
    status.className = "err";
    if (!check.canOverride) {
      status.textContent = `This file can't be used: ${check.reason}.`;
      return;
    }
    status.replaceChildren(unverifiedPrompt(check, () => void build(bytes, status, true)));
    return;
  }
  await build(bytes, status, false);
}

/** Direction note C: a hash mismatch is not a dead end. The player may import anyway, clearly
 *  labelled unverified: best-effort extraction with this game's layout, no parity claim. */
function unverifiedPrompt(check: RomCheck, go: () => void): HTMLElement {
  return el("div", { class: "warn" },
    el("p", {}, `This file is not the supported ROM revision (SHA-256 ${check.sha256.slice(0, 12)}…). It may be another dump or revision, a translation, a hack or a patched build.`),
    ...(check.warnings.length ? [el("ul", {}, ...check.warnings.map((w) => el("li", {}, w)))] : []),
    el("p", {}, "You can import it anyway in unverified mode: the game data is extracted with Legend II's layout, and anything may be wrong or crash. Verified-path guarantees do not apply."),
    button("Import anyway (unverified)", go),
  );
}

async function build(bytes: Uint8Array, status: HTMLElement, unverified: boolean) {
  const bar = el("progress", { max: "10", value: "0" }) as HTMLProgressElement;
  status.className = "";
  status.replaceChildren("Building game data…", bar);
  try {
    const pkg = await importRom(bytes, (_s, done) => { bar.value = done; }, { unverified });
    await savePackage(pkg);
    await saveBase(bytes);
    showSummary(pkg);
  } catch (e) {
    status.className = "err";
    status.textContent = `Import failed: ${(e as Error).message}`;
  }
}

function savesPanel(): HTMLElement {
  const msg = el("p", { class: "muted" }, "");
  const refresh = async () => {
    const s = await loadSram().catch(() => undefined);
    msg.textContent = s ? `A save is stored on this device. Export it as ${SAV_NAME} to move it to another device or app (the same file works in Game Boy emulators).` : "No save on this device yet.";
  };
  void refresh();
  return el("section", { class: "panel" },
    el("h2", {}, "Saves"),
    msg,
    el("div", { class: "row" },
      button("Export save", async () => {
        const r = await exportSave();
        msg.textContent = r === "saved" ? "Save exported." : r === "empty" ? "No save to export yet." : "Export cancelled.";
      }),
      button("Restore previous save", async () => {
        const prev = await loadSramBackup().catch(() => undefined);
        if (!prev) { msg.textContent = "No earlier save kept yet (one is kept when a play session first saves)."; return; }
        if (!confirm("Go back to the save as it was before the last play session? The current save becomes the backup, so you can switch back.")) return;
        const cur = await loadSram().catch(() => undefined);
        await saveSram(prev);
        if (cur) await saveSramBackup(cur);
        msg.textContent = "Previous save restored. Continue from the title screen.";
      }),
      button("Import save", async () => {
        const f = await pickFile(["sav"]);
        if (!f) return;
        if (!confirm("Replace the save on this device with this file?")) return;
        const err = await importSave(f.bytes);
        msg.textContent = err ? `This file can't be used: ${err}.` : "Save imported. Continue from the title screen.";
      }),
    ),
  );
}

function showSummary(pkg: DataPackage) {
  const verified = pkg.verified !== false;
  const dl = el("dl", {},
    el("dt", {}, "Source"), el("dd", {}, `${pkg.sourceSha256.slice(0, 12)}… ${verified ? "(verified)" : pkg.mods?.length ? "(modded)" : "(UNVERIFIED)"}`),
    ...(pkg.mods?.length ? [el("dt", {}, "Mods"), el("dd", {}, pkg.mods.join(", "))] : []),
    el("dt", {}, "Monsters"), el("dd", {}, String(pkg.monsters.length)),
    el("dt", {}, "Items"), el("dd", {}, String(pkg.items.length)),
    el("dt", {}, "Text entries"), el("dd", {}, String(pkg.text.length)),
    el("dt", {}, "Maps"), el("dd", {}, String(Object.keys(pkg.maps.headers).length)),
    el("dt", {}, "Songs / SFX"), el("dd", {}, `${pkg.music.songs.length} / ${pkg.music.sfx.length}`),
    el("dt", {}, "Platform"), el("dd", {}, platformName()),
  );
  const pick = el("input", { type: "number", min: "0", max: "255", value: "120" }) as HTMLInputElement;
  const view = el("div", { class: "row" });
  const draw = () => {
    const m = pkg.gfx.monsters[Number(pick.value) & 255]!;
    const mon = pkg.monsters[Number(pick.value) & 255]!;
    view.replaceChildren(drawTiles(m.tiles, m.w, m.h), el("span", {}, `${mon.name} — ${m.w}×${m.h} tiles`));
  };
  pick.oninput = draw;
  draw();
  app.replaceChildren(
    el("h1", {}, TITLE),
    el("p", { class: "lead" }, verified ? "Game data is ready on this device." : pkg.mods?.length ? `Game data is ready on this device — MODDED (${pkg.mods.join(", ")}).` : "Game data is ready on this device — imported in UNVERIFIED mode."),
    el("section", { class: "panel" }, el("div", { class: "row" }, button("Play", () => showPlayer(pkg), "primary"),
      ...gameLinks(2).map((l) => button(l.label, l.run)),
      el("span", { class: "muted" }, "Arrows + X (A) / Z (B), or WASD + K (A) / J (B); Enter or Space = Start, Shift = Select; hold Tab = fast-forward; Esc = options; F11 = fullscreen, M = mute. Gamepads use the Game Boy layout (A on the right: Xbox B = A, Xbox A = B; switchable in Options); touch works too."))),
    savesPanel(),
    optionsPanel(),
    modsPanel(pkg, (p) => showSummary(p)),
    aboutPanel(),
    el("section", { class: "panel" }, dl),
    el("section", { class: "panel" }, el("div", { class: "row" }, "Monster graphic #", pick), view),
    el("section", { class: "panel" }, button("Remove game data from this device", async () => {
      if (!confirm("Remove the game data built from your ROM (and the ROM copy kept for mods)? Saves and mod files stay.")) return;
      await clearPackage();
      await clearBase();
      showImporter("Game data removed.");
    })),
  );
}

function showPlayer(pkg: DataPackage) {
  document.body.classList.add("playing");
  const canvas = el("canvas", { class: "pixel screen" }) as HTMLCanvasElement;
  const status = el("p", { class: "muted" }, pkg.mods?.length ? "Modded" : pkg.verified === false ? "Unverified ROM" : "");
  const touch = new TouchPad();
  const setTouch = (on: boolean) => { touch.el.hidden = !on; document.body.classList.toggle("touch", on); };
  setTouch(touchByDefault() || platform() === "capacitor");
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
    const pre = el("pre", { class: "details" }, details);
    const box = el("div", { class: "overlay" }, el("section", { class: "panel" },
      el("h2", {}, "The game stopped"),
      el("p", {}, message),
      el("p", { class: "muted" }, "Your save is safe: it was written before this point, and the save from before this session is kept too (Saves → Restore previous save). The details below help find the cause; they contain no save or ROM data."),
      pre,
      el("div", { class: "row" },
        button("Copy details", async () => { await navigator.clipboard?.writeText(details).catch(() => {}); }),
        button("Back to the menu", () => location.reload(), "primary"))));
    document.body.append(box);
  };
  const player = new Player(pkg, { canvas, onStatus: (msg) => { status.textContent = msg; }, onError, inputs: [() => touch.buttons()] });
  applyDisplay();
  // ?debug: expose the player for inspection in the console (development convenience)
  if (new URLSearchParams(location.search).has("debug")) (globalThis as { fftolPlayer?: Player }).fftolPlayer = player;
  void player.start();
}

/** Installable web app: the service worker caches this app's own code for offline play (never
 *  game data, which stays in IndexedDB). Only in browsers, over https or on localhost. */
if (platform() === "web" && "serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
  void navigator.serviceWorker.register("./sw.js").catch((e) => console.warn("service worker", e));
}

// ?rom=<url>: import a ROM the user serves themselves (testing convenience; nothing is uploaded).
const romUrl = new URLSearchParams(location.search).get("rom");
// which other games' data are on this device (the summaries offer them)
await refreshGames();
if (romUrl) {
  const r = await fetch(romUrl);
  const status = el("p", {});
  app.replaceChildren(el("h1", {}, TITLE), status);
  await handle(new Uint8Array(await r.arrayBuffer()), status); // shows the summary, a prompt or an error
} else {
  const existing = await loadPackage().catch(() => undefined);
  const ffl1 = await loadFfl1Package().catch(() => undefined);
  const ffl3 = await loadFfl3Package().catch(() => undefined);
  const legend2 = existing && existing.format === PACKAGE_FORMAT ? existing : undefined;
  // Legend I's data alone, or chosen with ?game=1 when both games are on this device
  hasFfl1 = ffl1PackageUsable(ffl1);
  hasFfl3 = ffl3PackageUsable(ffl3);
  const want = new URLSearchParams(location.search).get("game");
  // Legend III's data alone, or chosen with ?game=3
  if (ffl3PackageUsable(ffl3) && (want === "3" || (!legend2 && !ffl1PackageUsable(ffl1))))
    showFfl3Summary(app, ffl3);
  else if (ffl1PackageUsable(ffl1) && (!legend2 || want === "1"))
    showFfl1Summary(app, ffl1);
  else if (legend2) showSummary(legend2);
  else showImporter(existing ? "The game data format changed; please choose your ROM again to rebuild it." : undefined);
}
