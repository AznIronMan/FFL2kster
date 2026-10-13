/** Mods panel (P5 run-time mods): IPS/BPS patches (e.g. from `ffl2kster build --ips`) applied on
 *  this device to the player's own ROM, in order, then the game data is rebuilt. With no mod on,
 *  the original ROM is imported again and the game is verified again. Modded games are labelled
 *  and carry no parity claim. */
import { applyPatch, importRom, patchFormat, sha256Hex, type DataPackage } from "@ffl2k/importer";
import { loadBase, loadMods, saveBase, saveMods, savePackage, type Mod } from "./storage";
import { pickFile } from "./platform";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...kids: (Node | string)[]) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  e.append(...kids);
  return e;
}

/** The unpatched ROM: stored at import, or rebuilt from an unmodded package's segments. */
async function base(pkg: DataPackage): Promise<Uint8Array | null> {
  const b = await loadBase().catch(() => undefined);
  if (b) return b;
  if (pkg.mods?.length) return null;
  const n = Object.keys(pkg.segments).length;
  const rom = new Uint8Array(n * 0x4000);
  for (const [k, v] of Object.entries(pkg.segments)) rom.set(v, parseInt(k, 16) * 0x4000);
  await saveBase(rom);
  return rom;
}

export function modsPanel(pkg: DataPackage, onRebuilt: (p: DataPackage) => void): HTMLElement {
  const list = el("div", { class: "options" });
  const msg = el("p", { class: "muted" }, pkg.mods?.length ? `Active: ${pkg.mods.join(", ")}` : "No mods active: the original game.");
  let mods: Mod[] = [];
  const draw = () => {
    list.replaceChildren(...mods.map((mod, i) => {
      const box = el("input", { type: "checkbox" }) as HTMLInputElement;
      box.checked = mod.enabled;
      box.onchange = async () => { mods[i]!.enabled = box.checked; await saveMods(mods); };
      const rm = el("button", {}, "Remove") as HTMLButtonElement;
      rm.onclick = async () => { mods.splice(i, 1); await saveMods(mods); draw(); };
      return el("label", {}, box, `${mod.name} (${patchFormat(mod.bytes)?.toUpperCase()}, ${mod.bytes.length} bytes)`, rm);
    }));
    if (!mods.length) list.append(el("span", { class: "muted" }, "No patch files added."));
  };
  void loadMods().then((m) => { mods = m; draw(); });
  const add = el("button", {}, "Add patch (.ips / .bps)") as HTMLButtonElement;
  add.onclick = async () => {
    const f = await pickFile(["ips", "bps"]);
    if (!f) return;
    if (!patchFormat(f.bytes)) { msg.textContent = `${f.name} is not an IPS or BPS patch.`; return; }
    mods.push({ name: f.name, bytes: f.bytes, enabled: true });
    await saveMods(mods);
    draw();
  };
  const apply = el("button", { class: "primary" }, "Apply mods") as HTMLButtonElement;
  apply.onclick = async () => {
    const rom = await base(pkg);
    if (!rom) { msg.textContent = "Choose your ROM again (Remove game data, then import) to change mods."; return; }
    const on = mods.filter((m) => m.enabled);
    try {
      let bytes = rom;
      for (const m of on) bytes = applyPatch(bytes, m.bytes);
      msg.textContent = "Rebuilding game data…";
      const p = on.length
        ? await importRom(bytes, () => {}, { unverified: true, mods: on.map((m) => m.name), baseSha256: await sha256Hex(rom) })
        : await importRom(rom, () => {}, { unverified: true });
      await savePackage(p);
      onRebuilt(p);
    } catch (e) {
      msg.textContent = `Mods not applied: ${(e as Error).message}`;
    }
  };
  return el("section", { class: "panel" },
    el("h2", {}, "Mods"),
    el("p", { class: "muted" }, "Patch files made with FFL2kster (ffl2kster build --ips) or other ROM-hacking tools, applied on this device to your own ROM. Modded games are labelled; the faithful-port guarantees cover the original game only."),
    msg, list, el("div", { class: "row" }, add, apply));
}
