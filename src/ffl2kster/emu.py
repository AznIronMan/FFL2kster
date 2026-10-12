"""PyBoy harness for reproducible original-vs-patched comparisons.

Battle detection hooks bank 0D:44F4, the routine that copies an enemy's name
(0F:6EC0 + 8*id) and stats record (0D:6F80 + 10*id) when a battle loads.
Enemy group block 0xD500: [alive, total, name x8, id, type, HP lo, HP hi,
stat0..stat3, (ability, uses) pairs...]. See docs/ROM_MAP.md for evidence.
"""

from __future__ import annotations

import io
import shutil
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

ENEMY_LOAD_HOOK = (0x0D, 0x44F4)
ENEMY_BLOCK = 0xD500
PLAYER_X, PLAYER_Y = 0xC42C, 0xC42D


def _pyboy():
    from pyboy import PyBoy  # optional dependency
    return PyBoy


@dataclass
class BattleSnapshot:
    rom: str
    loaded: bool
    hook_frames: list[int] = field(default_factory=list)
    block: bytes = b""
    wram: bytes = b""
    screenshot: object = None

    @property
    def enemy_id(self) -> int:
        return self.block[10]

    @property
    def enemy_hp(self) -> int:
        return self.block[12] | (self.block[13] << 8)

    @property
    def enemy_stats(self) -> list[int]:
        return list(self.block[14:18])

    @property
    def individual_hp(self) -> list[int]:
        """Per-enemy current HP at D541 + 8*i (probable: moves with max HP under controlled change)."""
        return [self.block[0x41 + 8 * i] | (self.block[0x42 + 8 * i] << 8) for i in range(self.block[1])]


class Emulator:
    """Context manager running a private copy of a ROM (PyBoy may write .ram files)."""

    def __init__(self, rom_path: str | Path):
        self._tmp = tempfile.mkdtemp(prefix="ffl2k-emu-")
        self.rom_copy = Path(self._tmp) / "rom.gb"
        shutil.copyfile(rom_path, self.rom_copy)
        self.rom_path = str(rom_path)
        self.pb = _pyboy()(str(self.rom_copy), window="null", sound_emulated=False)
        self.pb.set_emulation_speed(0)
        self.hook_hits: list[int] = []
        self.pb.hook_register(*ENEMY_LOAD_HOOK, lambda _: self.hook_hits.append(self.pb.frame_count), None)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()

    def close(self):
        try:
            self.pb.stop(save=False)
        finally:
            shutil.rmtree(self._tmp, ignore_errors=True)

    def load_state(self, path: str | Path):
        with open(path, "rb") as f:
            self.pb.load_state(f)
        self.hook_hits.clear()

    def save_state(self, path: str | Path):
        b = io.BytesIO()
        self.pb.save_state(b)
        Path(path).write_bytes(b.getvalue())

    def press(self, button: str, hold: int = 12, wait: int = 30):
        self.pb.button(button, hold)
        self.pb.tick(hold + wait, False)

    def position(self) -> tuple[int, int]:
        return self.pb.memory[PLAYER_X], self.pb.memory[PLAYER_Y]

    def wram(self) -> bytes:
        return bytes(self.pb.memory[0xC000:0xE000])

    def screenshot(self):
        self.pb.tick(1, True)
        return self.pb.screen.image.copy()

    def screen_text(self) -> list[str]:
        """Visible text: window tilemap (if enabled) else BG tilemap, decoded per row."""
        from .text import decode_screen_row
        m = self.pb.memory
        lcdc = m[0xFF40]
        rows = []
        if lcdc & 0x20:  # window enabled
            base = 0x9C00 if lcdc & 0x40 else 0x9800
            wy = m[0xFF4A]
            for r in range(max(0, (144 - wy) // 8)):
                rows.append(decode_screen_row(bytes(m[base + 32 * r:base + 32 * r + 20])))
        bgbase = 0x9C00 if lcdc & 0x08 else 0x9800
        for r in range(18):
            rows.append(decode_screen_row(bytes(m[bgbase + 32 * r:bgbase + 32 * r + 20])))
        return rows

    def battle_log(self, presses: int = 60, wait: int = 26) -> list[str]:
        """Press A repeatedly, collecting each distinct line of battle text (window rows)."""
        log, last = [], set()
        for _ in range(presses):
            self.pb.button("a", 6)
            self.pb.tick(wait, False)
            lines = [ln.strip("| ·").strip() for ln in self.screen_text()]
            for ln in lines:
                if ln and ln not in last and set(ln) - set("|· "):
                    log.append(ln)
            last = set(lines) | {x.strip("| ·").strip() for x in lines}
        return log

    def battle_events(self, presses: int = 120, wait: int = 26) -> list[dict]:
        """Press A repeatedly and parse completed battle messages into events:
        {'actor','target','with','damage'} / {'text'} (other messages)."""
        import re
        boxes = []
        for _ in range(presses):
            self.pb.button("a", 6)
            self.pb.tick(wait, False)
            txt = " ".join(ln.strip("| ·").strip() for ln in self.screen_text()[:10])
            txt = re.sub(r"\s+", " ", txt).strip()
            if not boxes or boxes[-1] != txt:
                boxes.append(txt)
        # keep only boxes not a prefix-state of the next one (typewriter)
        full = [b for i, b in enumerate(boxes) if i + 1 == len(boxes) or not boxes[i + 1].startswith(b[:max(1, len(b) - 2)])]
        events, seen = [], set()
        pat = re.compile(r"(\S+) attacks (\S+) with (\S+?)\.? (\d+) ?damages")
        for b in full:
            for m in pat.finditer(b):
                key = m.group(0)
                if key in seen:
                    continue
                seen.add(key)
                events.append({"actor": m.group(1), "target": m.group(2), "with": m.group(3),
                               "damage": int(m.group(4))})
        return events

    def step_into_battle(self, direction: str, settle: int = 240) -> BattleSnapshot:
        """From a 'one step before battle' state, take the step and let the battle load."""
        self.hook_hits.clear()
        self.press(direction)
        loaded = bool(self.hook_hits)
        self.pb.tick(settle, False)
        return BattleSnapshot(self.rom_path, loaded, list(self.hook_hits),
                              bytes(self.pb.memory[ENEMY_BLOCK:ENEMY_BLOCK + 0x60]),
                              self.wram(), self.screenshot())


def battle_from_state(rom_path, state_path, direction="up", settle=240) -> BattleSnapshot:
    with Emulator(rom_path) as emu:
        emu.load_state(state_path)
        return emu.step_into_battle(direction, settle)
