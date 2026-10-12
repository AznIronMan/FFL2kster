/** The few things that differ between the web build (browser or installed PWA), the Tauri desktop
 *  shell and the Capacitor mobile shells: writing a file the player keeps (save export), reading
 *  one (ROM, save import) and fullscreen. Everything else (game data, battery RAM) lives in
 *  IndexedDB, which all three provide (the shells keep it in the app's data directory). */

export type PlatformKind = "web" | "tauri" | "capacitor";

interface TauriGlobal {
  dialog: {
    save(o: { defaultPath?: string; filters?: { name: string; extensions: string[] }[] }): Promise<string | null>;
    open(o: { multiple?: boolean; filters?: { name: string; extensions: string[] }[] }): Promise<string | string[] | null>;
  };
  fs: { writeFile(path: string, data: Uint8Array): Promise<void>; readFile(path: string): Promise<Uint8Array> };
  window: { getCurrentWindow(): { isFullscreen(): Promise<boolean>; setFullscreen(v: boolean): Promise<void> } };
}

interface CapacitorGlobal {
  isNativePlatform(): boolean;
  getPlatform(): string;
}

const w = globalThis as unknown as { __TAURI__?: TauriGlobal; Capacitor?: CapacitorGlobal };

export function platform(): PlatformKind {
  if (w.__TAURI__) return "tauri";
  if (w.Capacitor?.isNativePlatform()) return "capacitor";
  return "web";
}

/** "web", "tauri", "ios" or "android" — for labels and the status line. */
export function platformName(): string {
  const p = platform();
  return p === "capacitor" ? w.Capacitor!.getPlatform() : p;
}

const ext = (name: string) => name.split(".").pop() ?? "";

/** Let the player keep a file: a download in browsers, a native save dialog on the desktop, the
 *  share sheet on phones (Files, Drive, mail…). Returns false when the player cancelled. */
export async function saveFile(name: string, bytes: Uint8Array, mime = "application/octet-stream"): Promise<boolean> {
  const p = platform();
  if (p === "tauri") {
    const path = await w.__TAURI__!.dialog.save({ defaultPath: name, filters: [{ name: ext(name).toUpperCase(), extensions: [ext(name)] }] });
    if (!path) return false;
    await w.__TAURI__!.fs.writeFile(path, bytes);
    return true;
  }
  if (p === "capacitor") {
    const { Filesystem, Directory } = await import("@capacitor/filesystem");
    const { Share } = await import("@capacitor/share");
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    const r = await Filesystem.writeFile({ path: name, data: btoa(bin), directory: Directory.Cache });
    await Share.share({ title: name, files: [r.uri] }).catch((e: Error) => {
      if (!/cancel/i.test(e.message)) throw e;
    });
    return true;
  }
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return true;
}

/** Let the player choose a file (native dialog on the desktop; the system picker elsewhere). */
export async function pickFile(extensions: string[]): Promise<{ name: string; bytes: Uint8Array } | null> {
  if (platform() === "tauri") {
    const path = await w.__TAURI__!.dialog.open({ multiple: false, filters: [{ name: extensions.join(", "), extensions }] });
    if (!path || Array.isArray(path)) return null;
    return { name: path.split(/[\\/]/).pop() ?? path, bytes: await w.__TAURI__!.fs.readFile(path) };
  }
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    // Mobile pickers grey out files whose type they do not know; accept anything there.
    if (platform() === "web") input.accept = extensions.map((e) => `.${e}`).join(",") + ",application/octet-stream";
    input.onchange = async () => {
      const f = input.files?.[0];
      resolve(f ? { name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) } : null);
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}

/** Toggle fullscreen (the desktop window, or the page). */
export async function toggleFullscreen(): Promise<void> {
  if (platform() === "tauri") {
    const win = w.__TAURI__!.window.getCurrentWindow();
    await win.setFullscreen(!(await win.isFullscreen()));
    return;
  }
  if (document.fullscreenElement) await document.exitFullscreen();
  else await document.documentElement.requestFullscreen?.().catch(() => {});
}
