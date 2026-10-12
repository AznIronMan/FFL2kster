/** P0 shell: import the player's own ROM, build the data package locally, persist it, and show a
 *  summary plus a graphics check. Game screens arrive in P1 (vertical slice). */
import { checkRom, importRom, decodeTile, type DataPackage } from "@ffl2k/importer";
import { clearPackage, loadPackage, savePackage } from "./storage";
import { Player } from "./player";
import { PACKAGE_FORMAT } from "@ffl2k/importer";

const app = document.getElementById("app")!;
const SHADES = [[255, 255, 255], [170, 170, 170], [85, 85, 85], [0, 0, 0]] as const;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...kids: (Node | string)[]) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  e.append(...kids);
  return e;
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
  const input = el("input", { type: "file", accept: ".gb,application/octet-stream", hidden: "" }) as HTMLInputElement;
  const drop = el("div", { class: "drop", tabindex: "0" }, "Drop your ROM file here, or click to choose it.");
  const status = el("p", {}, message ?? "");
  drop.onclick = () => input.click();
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add("over"); };
  drop.ondragleave = () => drop.classList.remove("over");
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove("over"); const f = e.dataTransfer?.files[0]; if (f) void handle(f, status); };
  input.onchange = () => { const f = input.files?.[0]; if (f) void handle(f, status); };
  app.replaceChildren(
    el("h1", {}, "FFL2kster"),
    el("p", { class: "lead" }, "This engine ships with no game content. Choose your own copy of the game ROM; it is read only on this device to build the game data."),
    el("section", { class: "panel" }, drop, input, status),
  );
}

async function handle(file: File, status: HTMLElement) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const check = await checkRom(bytes);
  if (!check.ok) {
    status.className = "err";
    status.textContent = `This file can't be used: ${check.reason}.`;
    return;
  }
  const bar = el("progress", { max: "10", value: "0" }) as HTMLProgressElement;
  status.className = "";
  status.replaceChildren("Building game data…", bar);
  const pkg = await importRom(bytes, (_s, done) => { bar.value = done; });
  await savePackage(pkg);
  showSummary(pkg);
}

function showSummary(pkg: DataPackage) {
  const dl = el("dl", {},
    el("dt", {}, "Source"), el("dd", {}, `${pkg.sourceSha256.slice(0, 12)}… (verified)`),
    el("dt", {}, "Monsters"), el("dd", {}, String(pkg.monsters.length)),
    el("dt", {}, "Items"), el("dd", {}, String(pkg.items.length)),
    el("dt", {}, "Text entries"), el("dd", {}, String(pkg.text.length)),
    el("dt", {}, "Maps"), el("dd", {}, String(Object.keys(pkg.maps.headers).length)),
    el("dt", {}, "Songs / SFX"), el("dd", {}, `${pkg.music.songs.length} / ${pkg.music.sfx.length}`),
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
  const play = el("button", { class: "primary" }, "Play");
  play.onclick = () => showPlayer(pkg);
  const reset = el("button", {}, "Remove game data from this device");
  reset.onclick = async () => { await clearPackage(); showImporter("Game data removed."); };
  app.replaceChildren(
    el("h1", {}, "FFL2kster"),
    el("p", { class: "lead" }, "Game data is ready on this device."),
    el("section", { class: "panel" }, el("div", { class: "row" }, play, el("span", { class: "muted" }, "Arrows move, Z = A, X = B, Enter = Start, Shift = Select. Gamepads work too."))),
    el("section", { class: "panel" }, dl),
    el("section", { class: "panel" }, el("div", { class: "row" }, "Monster graphic #", pick), view),
    el("section", { class: "panel" }, reset),
  );
}

function showPlayer(pkg: DataPackage) {
  const canvas = el("canvas", { class: "pixel screen" }) as HTMLCanvasElement;
  const status = el("p", { class: "muted" }, "");
  const back = el("button", {}, "Back");
  back.onclick = () => location.reload();
  app.replaceChildren(el("div", { class: "player" }, canvas), el("div", { class: "row" }, back, status));
  const player = new Player(pkg, { canvas, onStatus: (msg) => { status.textContent = msg; } });
  void player.start();
}

// ?rom=<url>: import a ROM the user serves themselves (testing convenience; nothing is uploaded).
const romUrl = new URLSearchParams(location.search).get("rom");
if (romUrl) {
  const r = await fetch(romUrl);
  const status = el("p", {});
  app.replaceChildren(el("h1", {}, "FFL2kster"), status);
  await handle(new File([await r.arrayBuffer()], "rom.gb"), status);
}

const existing = romUrl ? await loadPackage() : await loadPackage().catch(() => undefined);
if (existing && existing.format === PACKAGE_FORMAT) showSummary(existing);
else showImporter(existing ? "The game data format changed; please choose your ROM again to rebuild it." : undefined);
