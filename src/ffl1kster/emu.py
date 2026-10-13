"""PyBoy harness for Legend I (original-vs-patched comparisons, save states).

Everything here is Legend I's own (docs/ffl1/ROM_MAP.md):
- enemy loader 06:5713 copies one 9-byte monster record (06:6AE8 + 9*id) into a 32-byte combatant
  slot (slot k at D000 + 32*k; enemies from slot 4 = D080); the hook counts loader calls;
- slot layout: +0 b0, +1 nibble (06:71F0), +3/+4 HP (LE), +5/+6 max HP (LE), +7..+0A stats,
  +0B/+0C ability attribute masks, +0E..+15 ability ids, +16..+1D uses, +1F monster id;
- field position: CCC9 = x tile, CCC8 = y tile (probable).
"""

from __future__ import annotations

import io
import shutil
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

ENEMY_LOADER = (0x06, 0x5713)
SLOT_BASE, SLOT_SIZE, FIRST_ENEMY_SLOT = 0xD000, 0x20, 4
POS_X, POS_Y = 0xCCC9, 0xCCC8

A_CODE, LOWER_A, DIGIT0, SPACE = 0x8A, 0xA4, 0x80, 0xFF


def decode_char(c: int) -> str:
    if A_CODE <= c < A_CODE + 26:
        return chr(65 + c - A_CODE)
    if LOWER_A <= c < LOWER_A + 26:
        return chr(97 + c - LOWER_A)
    if DIGIT0 <= c < DIGIT0 + 10:
        return chr(48 + c - DIGIT0)
    return " " if c == SPACE else "·"


@dataclass
class Combatant:
    raw: bytes

    @property
    def monster_id(self) -> int: return self.raw[0x1F]
    @property
    def hp(self) -> int: return self.raw[3] | self.raw[4] << 8
    @property
    def max_hp(self) -> int: return self.raw[5] | self.raw[6] << 8
    @property
    def stats(self) -> list[int]: return list(self.raw[7:11])
    @property
    def abilities(self) -> list[int]: return list(self.raw[0x0E:0x16])


@dataclass
class BattleSnapshot:
    rom: str
    loaded: bool
    loader_frames: list[int] = field(default_factory=list)
    slots: bytes = b""
    wram: bytes = b""
    screenshot: object = None

    def slot(self, k: int) -> Combatant:
        return Combatant(self.slots[SLOT_SIZE * k:SLOT_SIZE * (k + 1)])

    @property
    def enemies(self) -> list[Combatant]:
        return [self.slot(k) for k in range(FIRST_ENEMY_SLOT, 8) if self.slot(k).monster_id != 0xFF]


class Emulator:
    """Runs a private copy of the ROM (PyBoy may write battery files next to it)."""

    def __init__(self, rom_path, sound: bool = False):
        from pyboy import PyBoy
        self._tmp = tempfile.mkdtemp(prefix="ffl1k-emu-")
        self.rom_copy = Path(self._tmp) / "rom.gb"
        shutil.copyfile(rom_path, self.rom_copy)
        self.rom_path = str(rom_path)
        self.pb = PyBoy(str(self.rom_copy), window="null", sound_emulated=sound)
        self.pb.set_emulation_speed(0)
        self.loader_hits: list[int] = []
        self.pb.hook_register(*ENEMY_LOADER, lambda _: self.loader_hits.append(self.pb.frame_count), None)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()

    def close(self):
        try:
            self.pb.stop(save=False)
        finally:
            shutil.rmtree(self._tmp, ignore_errors=True)

    def load_state(self, path):
        with open(path, "rb") as f:
            self.pb.load_state(f)
        self.loader_hits.clear()

    def save_state(self, path):
        b = io.BytesIO()
        self.pb.save_state(b)
        Path(path).write_bytes(b.getvalue())

    def state_bytes(self) -> bytes:
        b = io.BytesIO()
        self.pb.save_state(b)
        return b.getvalue()

    def press(self, button: str, hold: int = 4, wait: int = 36):
        self.pb.button(button, hold)
        self.pb.tick(hold + 1 + wait, False)

    def position(self) -> tuple[int, int]:
        return self.pb.memory[POS_X], self.pb.memory[POS_Y]

    def wram(self) -> bytes:
        return bytes(self.pb.memory[0xC000:0xE000])

    def slots(self) -> bytes:
        return bytes(self.pb.memory[SLOT_BASE:SLOT_BASE + 8 * SLOT_SIZE])

    def screenshot(self):
        self.pb.tick(1, True)
        return self.pb.screen.image.copy()

    def screen_text(self) -> list[str]:
        """Window rows (when shown) then BG rows, decoded; tile data at 8800 shifts codes by 0x80."""
        m = self.pb.memory
        lcdc = m[0xFF40]
        shift = 0x80 if not lcdc & 0x10 else 0

        def row(base):
            return "".join(decode_char(c + shift if c < 0x80 and shift else c) for c in m[base:base + 20])
        rows = []
        if lcdc & 0x20 and m[0xFF4A] < 144:
            wb = 0x9C00 if lcdc & 0x40 else 0x9800
            rows += [row(wb + 32 * r) for r in range((144 - m[0xFF4A]) // 8)]
        bb = 0x9C00 if lcdc & 0x08 else 0x9800
        rows += [row(bb + 32 * r) for r in range(18)]
        return rows

    def wait_for_text(self, needle: str, max_frames: int = 6000, step: int = 30) -> bool:
        for _ in range(0, max_frames, step):
            if any(needle in r for r in self.screen_text()):
                return True
            self.pb.tick(step, False)
        return False

    def step_into_battle(self, direction: str, settle: int = 200) -> BattleSnapshot:
        self.loader_hits.clear()
        self.press(direction)
        self.pb.tick(settle, False)
        return BattleSnapshot(self.rom_path, bool(self.loader_hits), list(self.loader_hits),
                              self.slots(), self.wram(), self.screenshot())


def battle_from_state(rom_path, state_path, direction="right", settle=200) -> BattleSnapshot:
    with Emulator(rom_path) as emu:
        emu.load_state(state_path)
        return emu.step_into_battle(direction, settle)
