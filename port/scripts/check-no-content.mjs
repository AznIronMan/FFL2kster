// Fails if a build output contains anything that looks like game content: no ROM/save/state
// files, no MIDI/JSON data and no images except the app's own icons (icons/icon*.png, small).
// The build must ship only engine code; game data is imported at runtime on the player's device.
// Usage: node scripts/check-no-content.mjs [DIR ...]   (default apps/web/dist)
import { readdirSync, statSync } from "node:fs";
import { join, sep } from "node:path";

const dirs = process.argv.slice(2).length ? process.argv.slice(2) : ["apps/web/dist"];
const bad = [];
const icon = (p, size) => p.split(sep).includes("icons") && /icon[\w-]*\.png$/i.test(p) && size < 64 * 1024;
const walk = (d) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f), s = statSync(p);
    if (s.isDirectory()) walk(p);
    else if (/\.(gb|gbc|sgb|sav|srm|state|mid)$/i.test(f)) bad.push(p);
    else if (/\.png$/i.test(f) && !icon(p, s.size)) bad.push(p);
    else if (/\.json$/i.test(f) && !/manifest|\.map$/.test(f)) bad.push(p);
  }
};
for (const d of dirs) walk(d);
if (bad.length) {
  console.error("Possible game content in the build output:\n" + bad.join("\n"));
  process.exit(1);
}
console.log(`no game content in ${dirs.join(", ")}`);
