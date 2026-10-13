"""PyBoy harness for Legend III (exploration, save states, original-vs-patched comparisons).

Everything here is Legend III's own (docs/ffl3/ROM_MAP.md). Text tiles (verified on the title
screen, 2026-10-13: "New Game", "Continue", "©1993 SQUARE CO."): digits B0-B9, A-Z BA-D3,
a-z D4-ED, space FF; the menus are drawn on the window (map 9C00).
"""

from __future__ import annotations

import io
import shutil
import tempfile
from pathlib import Path

from dataclasses import dataclass

from .text import decode_char

# Battle (docs/ffl3/ROM_MAP.md): the enemy loader 0B:4526/453A builds one 0x80-byte entity in the
# staging slot D680 per group, then 0B:468B copies it once per enemy into D280, D300, ...
LOADER = (0x0B, 0x4526)
ENTITY0, ENTITY_SIZE, STAGING = 0xD280, 0x80, 0xD680


class Emulator:
    """Runs a private copy of the ROM (PyBoy may write battery files next to it)."""

    def __init__(self, rom_path, sound: bool = False):
        from pyboy import PyBoy
        self._tmp = tempfile.mkdtemp(prefix="ffl3k-emu-")
        self.rom_copy = Path(self._tmp) / "rom.gb"
        shutil.copyfile(rom_path, self.rom_copy)
        self.rom_path = str(rom_path)
        self.pb = PyBoy(str(self.rom_copy), window="null", sound_emulated=sound)
        self.pb.set_emulation_speed(0)
        self.hits: dict[tuple[int, int], list[int]] = {}

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()

    def close(self):
        try:
            self.pb.stop(save=False)
        finally:
            shutil.rmtree(self._tmp, ignore_errors=True)

    def hook(self, bank: int, addr: int):
        """Count the frames at which bank:addr executes (in self.hits)."""
        lst = self.hits.setdefault((bank, addr), [])
        self.pb.hook_register(bank, addr, lambda _: lst.append(self.pb.frame_count), None)
        return lst

    def load_state(self, path):
        with open(path, "rb") as f:
            self.pb.load_state(f)
        for v in self.hits.values():
            v.clear()

    def save_state(self, path):
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        Path(path).write_bytes(self.state_bytes())

    def state_bytes(self) -> bytes:
        b = io.BytesIO()
        self.pb.save_state(b)
        return b.getvalue()

    def press(self, button: str, hold: int = 4, wait: int = 36):
        self.pb.button(button, hold)
        self.pb.tick(hold + 1 + wait, False)

    def wram(self) -> bytes:
        return bytes(self.pb.memory[0xC000:0xE000])

    def screenshot(self):
        self.pb.tick(1, True)
        return self.pb.screen.image.copy()

    def screen_text(self) -> list[str]:
        """Window rows (when shown) then the visible BG rows (scroll applied), decoded."""
        m = self.pb.memory
        lcdc = m[0xFF40]

        def row(base, col=0):
            return "".join(decode_char(m[base + ((col + c) & 31)]) for c in range(20))
        rows = []
        if lcdc & 0x20 and m[0xFF4A] < 144:
            wb = 0x9C00 if lcdc & 0x40 else 0x9800
            rows += [row(wb + 32 * r) for r in range((144 - m[0xFF4A] + 7) // 8)]
        bb = 0x9C00 if lcdc & 0x08 else 0x9800
        sy, sx = m[0xFF42] >> 3, m[0xFF43] >> 3
        rows += [row(bb + 32 * ((sy + r) & 31), sx) for r in range(18)]
        return rows

    def wait_for_text(self, needle: str, max_frames: int = 6000, step: int = 30) -> bool:
        for _ in range(0, max_frames, step):
            if any(needle in r for r in self.screen_text()):
                return True
            self.pb.tick(step, False)
        return False


@dataclass
class Entity:
    raw: bytes

    @property
    def monster_id(self) -> int: return self.raw[0x0E]

    @property
    def name(self) -> str: return "".join(decode_char(c) for c in self.raw[5:13]).rstrip()

    @property
    def hp(self) -> int: return self.raw[0x10] | self.raw[0x11] << 8

    @property
    def max_hp(self) -> int: return self.raw[0x12] | self.raw[0x13] << 8


@dataclass
class BattleSnapshot:
    wram: bytes
    loads: int          # loader 0B:4526 calls (one per enemy group)
    menu: bool          # the Fight/Run/Auto menu was reached

    def entity(self, k: int) -> Entity:
        o = ENTITY0 - 0xC000 + ENTITY_SIZE * k
        return Entity(self.wram[o:o + ENTITY_SIZE])

    @property
    def group_ids(self) -> list[int]: return list(self.wram[0xCC59 - 0xC000:0xCC5C - 0xC000])

    @property
    def group_counts(self) -> list[int]: return list(self.wram[0xCC36 - 0xC000:0xCC39 - 0xC000])

    @property
    def enemies(self) -> list[Entity]:
        return [self.entity(k) for k in range(sum(self.group_counts))]


def battle_from_state(rom_path, state_path, override_ids: dict[int, int] | None = None,
                      max_frames: int = 900) -> BattleSnapshot:
    """Replay a pre-battle state on ROM `rom_path` until the battle menu; optionally replace the
    id the loader reads (CC70) for the n-th group load ({n: id}, a RAM poke at 0B:4526)."""
    with Emulator(rom_path) as emu:
        emu.load_state(state_path)
        pb, n = emu.pb, [0]

        def at_loader(_):
            if override_ids and n[0] in override_ids:
                pb.memory[0xCC70] = override_ids[n[0]]
            n[0] += 1
        pb.hook_register(*LOADER, at_loader, None)
        menu = False
        for _ in range(0, max_frames, 5):
            pb.tick(5, False)
            if n[0] and any("Fight" in r for r in emu.screen_text()):
                menu = True
                break
        return BattleSnapshot(emu.wram(), n[0], menu)
