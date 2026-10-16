/** The Options panel (P5 extras): game options (off = the original), speed, display and
 *  accessibility, and control bindings. Changes apply at once and are kept on this device. */
import { currentAudio } from "./audio";
import { settings, update, resetSettings, onSettings, layoutBindings, PALETTES, BUTTON_NAMES, DEFAULT_KEYS, DEFAULT_PAD, type Settings, type PaletteId } from "./settings";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...kids: (Node | string)[]) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  e.append(...kids);
  return e;
}

function check(key: keyof Settings, label: string, hint?: string): HTMLElement[] {
  const box = el("input", { type: "checkbox" }) as HTMLInputElement;
  box.checked = settings()[key] as boolean;
  box.onchange = () => update({ [key]: box.checked } as Partial<Settings>);
  return [el("label", {}, box, label), ...(hint ? [el("div", { class: "hint" }, hint)] : [])];
}

function choose(key: keyof Settings, label: string, opts: [string, string][], hint?: string): HTMLElement[] {
  const sel = el("select") as HTMLSelectElement;
  for (const [v, t] of opts) sel.append(el("option", { value: v }, t));
  sel.value = String(settings()[key]);
  sel.onchange = () => update({ [key]: typeof DEF[key] === "number" ? Number(sel.value) : sel.value } as Partial<Settings>);
  return [el("label", {}, label, sel), ...(hint ? [el("div", { class: "hint" }, hint)] : [])];
}
const DEF = settings();

/** Waits for the next key or gamepad button and returns it ("key:Code" / "pad:N"). */
function capture(onDone: (what: string | null) => void): () => void {
  let raf = 0;
  const base = new Set<number>();
  for (const p of navigator.getGamepads?.() ?? []) p?.buttons.forEach((b, i) => { if (b.pressed) base.add(i); });
  const key = (e: KeyboardEvent) => {
    e.preventDefault();
    e.stopImmediatePropagation();
    stop();
    onDone(e.code === "Escape" ? null : `key:${e.code}`);
  };
  const poll = () => {
    for (const p of navigator.getGamepads?.() ?? []) {
      const i = p?.buttons.findIndex((b, k) => b.pressed && !base.has(k)) ?? -1;
      if (i >= 0) { stop(); onDone(`pad:${i}`); return; }
    }
    raf = requestAnimationFrame(poll);
  };
  const stop = () => { window.removeEventListener("keydown", key, true); cancelAnimationFrame(raf); };
  window.addEventListener("keydown", key, true);
  raf = requestAnimationFrame(poll);
  return stop;
}

function bindings(): HTMLElement {
  const grid = el("div", { class: "bindings" });
  const layout = el("select") as HTMLSelectElement;
  layout.append(el("option", { value: "gameboy" }, "Game Boy: A is the right button (pad B / X key), B the left (pad A / Z key)"),
    el("option", { value: "xbox" }, "Xbox: A is the bottom button (pad A / Z key), B the right (pad B / X key)"));
  layout.value = settings().layout;
  layout.onchange = () => { update(layoutBindings(settings(), layout.value as "gameboy" | "xbox")); draw(); };
  const draw = () => {
    const s = settings();
    grid.replaceChildren();
    for (const [bit, name] of BUTTON_NAMES) {
      const keys = Object.entries(s.keys).filter(([, b]) => b === bit).map(([k]) => k.replace(/^Key|^Arrow/, ""));
      const pads = Object.entries(s.pad).filter(([, b]) => b === bit).map(([i]) => `pad ${i}`);
      const add = el("button", {}, "Add") as HTMLButtonElement;
      add.onclick = () => {
        add.textContent = "Press a key or pad button…";
        capture((what) => {
          if (what?.startsWith("key:")) {
            const keysNow = { ...settings().keys, [what.slice(4)]: bit };
            update({ keys: keysNow });
          } else if (what?.startsWith("pad:")) {
            update({ pad: { ...settings().pad, [Number(what.slice(4))]: bit } });
          }
          draw();
        });
      };
      const clear = el("button", {}, "Clear") as HTMLButtonElement;
      clear.onclick = () => {
        const s2 = settings();
        update({
          keys: Object.fromEntries(Object.entries(s2.keys).filter(([, b]) => b !== bit)),
          pad: Object.fromEntries(Object.entries(s2.pad).filter(([, b]) => b !== bit)) as Record<number, number>,
        });
        draw();
      };
      grid.append(el("strong", {}, name), el("code", {}, [...keys, ...pads].join(", ") || "—"), el("span", { class: "row" }, add, clear));
    }
  };
  draw();
  const reset = el("button", {}, "Reset controls") as HTMLButtonElement;
  reset.onclick = () => { update({ layout: "gameboy", keys: { ...DEFAULT_KEYS }, pad: { ...DEFAULT_PAD } }); layout.value = "gameboy"; draw(); };
  return el("div", {}, el("label", {}, "A/B layout", layout), grid, el("p", { class: "muted" }, "Hold Tab or the right shoulder button to fast-forward. The left stick always moves."), reset);
}

/** A live readout of the sound delay while a game plays (our buffer, the system's output). */
function soundDelay(): HTMLElement {
  const line = el("div", { class: "hint" }, "");
  const show = () => {
    const a = currentAudio();
    if (!line.isConnected && line.textContent) return;
    if (!a) { line.textContent = "Sound delay: shown while a game plays."; }
    else {
      const d = a.delayMs();
      line.textContent = `Sound delay now: ${d.buffer + d.device} ms (buffer ${d.buffer} ms, system output ${d.device} ms). Wireless headphones add their own delay.`;
    }
    setTimeout(show, 500);
  };
  show();
  return line;
}

export function optionsPanel(onClose?: () => void): HTMLElement {
  const speeds: [string, string][] = [["1", "Normal"], ["2", "×2"], ["3", "×3"], ["4", "×4"]];
  const reset = el("button", {}, "Reset all options") as HTMLButtonElement;
  const panel = el("section", { class: "panel options" },
    el("h2", {}, "Options"),
    el("h3", {}, "Game (off = the original game)"),
    ...check("fastText", "Fast text", "Messages appear a window at a time."),
    ...check("capBreak", "Cap break (experimental)", "Max HP up to 9,999 and stats up to 255; numbers past 999/99 take an extra column on screen."),
    el("h3", {}, "Speed"),
    ...choose("battleSpeed", "Battle speed", speeds),
    ...choose("fastForward", "Fast-forward speed (hold Tab / right shoulder)", speeds.slice(1)),
    ...check("autoBattle", "Auto-battle", "In battle, each member repeats their last command (A is pressed for you at the command menus)."),
    el("h3", {}, "Display and accessibility"),
    ...choose("palette", "Colours", Object.entries(PALETTES).map(([k, v]) => [k, v.name])),
    ...check("reduceFlash", "Reduce flashing", "Screen flashes become short fades."),
    ...check("integerScale", "Integer scaling", "Sharp pixels: the screen grows in whole steps."),
    ...check("largeTouch", "Larger touch buttons"),
    ...check("widescreen", "Widescreen field (experimental)", "Shows more of the map on the sides while walking (background only; characters appear in the original view)."),
    el("h3", {}, "Sound"),
    ...check("muted", "Mute", "Also on the play screen (Sound button) and the M key."),
    ...choose("audioLatency", "Audio latency", [["low", "Low (fast machines)"], ["normal", "Normal"], ["safe", "Safe (if sound crackles)"]]),
    soundDelay(),
    el("h3", {}, "Controls"),
    bindings(),
    el("div", { class: "row" }, reset, ...(onClose ? [Object.assign(el("button", { class: "primary" }, "Close"), { onclick: onClose })] : [])),
  );
  reset.onclick = () => {
    if (!confirm("Reset every option and control to its default?")) return;
    resetSettings();
    panel.replaceWith(optionsPanel(onClose));
  };
  return panel;
}

/** Body classes for display options, and the integer scale. */
export function applyDisplay(s: Settings = settings()): void {
  document.body.classList.toggle("integer", s.integerScale);
  document.body.classList.toggle("largetouch", s.largeTouch);
  const ar = s.widescreen ? 256 / 144 : 160 / 144;
  const touch = document.body.classList.contains("touch") ? 300 : 120;
  const scale = Math.max(1, Math.floor(Math.min((innerWidth - 16) / (144 * ar), (innerHeight - touch) / 144)));
  document.body.style.setProperty("--scale", String(scale));
}

onSettings((s) => applyDisplay(s));
addEventListener("resize", () => applyDisplay());
export type { PaletteId };
