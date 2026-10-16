#!/usr/bin/env node
// The repository version (pyproject.toml, the single source) copied into the app shells: the
// Tauri config and crate (desktop installers are named by it), the Android versionName /
// versionCode and the iOS MARKETING_VERSION / CURRENT_PROJECT_VERSION. The build number is
// major * 10000 + minor * 100 + patch (1.61.0 -> 16100), so it only grows.
//   node scripts/sync-version.mjs          write the files
//   node scripts/sync-version.mjs --check  exit 1 when a file differs (nothing written)
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const port = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = resolve(port, "..");
const m = /^version\s*=\s*"(\d+)\.(\d+)\.(\d+)"/m.exec(readFileSync(resolve(root, "pyproject.toml"), "utf8"));
if (!m) throw new Error("pyproject.toml: no version");
const version = `${m[1]}.${m[2]}.${m[3]}`;
const build = Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3]);
const check = process.argv.includes("--check");

const edits = [
  ["apps/desktop/src-tauri/tauri.conf.json", [[/("version":\s*")[^"]*(")/, `$1${version}$2`]]],
  ["apps/desktop/src-tauri/Cargo.toml", [[/^(version\s*=\s*")[^"]*(")/m, `$1${version}$2`]]],
  ["apps/mobile/android/app/build.gradle", [[/(versionCode\s+)\d+/, `$1${build}`], [/(versionName\s+")[^"]*(")/, `$1${version}$2`]]],
  ["apps/mobile/ios/App/App.xcodeproj/project.pbxproj", [[/(MARKETING_VERSION = )[^;]*;/g, `$1${version};`], [/(CURRENT_PROJECT_VERSION = )[^;]*;/g, `$1${build};`]]],
];
let stale = 0;
for (const [rel, subs] of edits) {
  const path = resolve(port, rel);
  const before = readFileSync(path, "utf8");
  let after = before;
  for (const [re, to] of subs) after = after.replace(re, to);
  if (after === before) continue;
  stale++;
  if (check) console.error(`${rel}: not at ${version}`);
  else { writeFileSync(path, after); console.log(`${rel}: ${version} (build ${build})`); }
}
if (check && stale) process.exit(1);
if (!stale) console.log(`all shells at ${version}`);
