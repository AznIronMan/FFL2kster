// Fails if a web build output contains anything that looks like game content: no .gb files and no
// large binary blobs. The build must ship only engine code; game data is imported at runtime.
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const dist = process.argv[2] ?? "apps/web/dist";
const bad = [];
const walk = (d) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f), s = statSync(p);
    if (s.isDirectory()) walk(p);
    else if (/\.(gb|gbc|sav|state|mid|png|json)$/i.test(f) && !/manifest|\.map$/.test(f)) bad.push(p);
  }
};
walk(dist);
if (bad.length) {
  console.error("Possible game content in the build output:\n" + bad.join("\n"));
  process.exit(1);
}
console.log(`no game content in ${dist}`);
