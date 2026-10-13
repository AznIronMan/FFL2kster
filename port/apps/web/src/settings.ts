/** Player settings (P5 extras), kept per device in localStorage. Every extra that changes the
 *  game is off by default; display and input preferences only change presentation. */
import { BTN } from "@ffl2k/core";

export type PaletteId = "grey" | "green" | "pocket" | "light" | "amber" | "dark";

export interface Settings {
  // game options (Game.options; off = the original exactly)
  fastText: boolean;
  capBreak: boolean;
  // speed
  battleSpeed: number; // engine frames per display frame while in battle (1 = normal)
  fastForward: number; // speed while the fast-forward key/button is held
  autoBattle: boolean;
  // display and accessibility
  palette: PaletteId;
  reduceFlash: boolean;
  integerScale: boolean;
  largeTouch: boolean;
  widescreen: boolean;
  // input: keyboard code → buttons, gamepad button index → buttons
  keys: Record<string, number>;
  pad: Record<number, number>;
}

/** Two keyboard layouts at once (physical keys): arrows + Z/X and WASD + K/J. */
export const DEFAULT_KEYS: Record<string, number> = {
  ArrowUp: BTN.UP, ArrowDown: BTN.DOWN, ArrowLeft: BTN.LEFT, ArrowRight: BTN.RIGHT,
  KeyW: BTN.UP, KeyS: BTN.DOWN, KeyA: BTN.LEFT, KeyD: BTN.RIGHT,
  KeyZ: BTN.A, KeyX: BTN.B, KeyK: BTN.A, KeyJ: BTN.B,
  Enter: BTN.START, NumpadEnter: BTN.START, Space: BTN.START,
  ShiftRight: BTN.SELECT, ShiftLeft: BTN.SELECT, Backspace: BTN.SELECT,
};

/** W3C standard gamepad mapping (Xbox, PlayStation, Switch Pro): south = A, east = B,
 *  View/Back = Select, Menu/Start = Start, D-pad 12-15. The left stick always moves too. */
export const DEFAULT_PAD: Record<number, number> = {
  0: BTN.A, 1: BTN.B, 8: BTN.SELECT, 9: BTN.START, 12: BTN.UP, 13: BTN.DOWN, 14: BTN.LEFT, 15: BTN.RIGHT,
};

/** Fast-forward is held on Tab or the right shoulder button (gamepad 5). */
export const FAST_FORWARD_KEY = "Tab";
export const FAST_FORWARD_PAD = 5;

export const DEFAULTS: Settings = {
  fastText: false, capBreak: false,
  battleSpeed: 1, fastForward: 3, autoBattle: false,
  palette: "grey", reduceFlash: false, integerScale: false, largeTouch: false, widescreen: false,
  keys: DEFAULT_KEYS, pad: DEFAULT_PAD,
};

/** RGB for shades 0 (lightest) to 3 (darkest). */
export const PALETTES: Record<PaletteId, { name: string; rgb: [number, number, number][] }> = {
  grey: { name: "Grey (default)", rgb: [[0xff, 0xff, 0xff], [0xaa, 0xaa, 0xaa], [0x55, 0x55, 0x55], [0x00, 0x00, 0x00]] },
  green: { name: "Green (original screen)", rgb: [[0x9b, 0xbc, 0x0f], [0x8b, 0xac, 0x0f], [0x30, 0x62, 0x30], [0x0f, 0x38, 0x0f]] },
  pocket: { name: "Pocket", rgb: [[0xc4, 0xcf, 0xa1], [0x8b, 0x95, 0x6d], [0x4d, 0x53, 0x3c], [0x1f, 0x1f, 0x1f]] },
  light: { name: "Light (teal)", rgb: [[0x7e, 0xe0, 0xc8], [0x3c, 0xa8, 0x94], [0x1c, 0x6b, 0x60], [0x0b, 0x30, 0x2c]] },
  amber: { name: "High contrast (amber)", rgb: [[0xff, 0xe0, 0x80], [0xe0, 0x90, 0x10], [0x6a, 0x30, 0x00], [0x00, 0x00, 0x00]] },
  dark: { name: "Dark (inverted)", rgb: [[0x10, 0x10, 0x10], [0x6a, 0x6a, 0x6a], [0xb4, 0xb4, 0xb4], [0xff, 0xff, 0xff]] },
};

const KEY = "fftol.settings.v1";
let current: Settings = load();
const listeners = new Set<(s: Settings) => void>();

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULTS);
    const s = { ...structuredClone(DEFAULTS), ...JSON.parse(raw) } as Settings;
    if (!PALETTES[s.palette]) s.palette = "grey";
    return s;
  } catch {
    return structuredClone(DEFAULTS);
  }
}

export function settings(): Settings {
  return current;
}

export function update(patch: Partial<Settings>): void {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // storage unavailable (private mode): settings last for this session
  }
  for (const f of listeners) f(current);
}

export function resetSettings(): void {
  update(structuredClone(DEFAULTS));
}

export function onSettings(f: (s: Settings) => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

export const BUTTON_NAMES: [number, string][] = [
  [BTN.UP, "Up"], [BTN.DOWN, "Down"], [BTN.LEFT, "Left"], [BTN.RIGHT, "Right"],
  [BTN.A, "A"], [BTN.B, "B"], [BTN.START, "Start"], [BTN.SELECT, "Select"],
];
