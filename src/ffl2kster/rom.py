"""ROM loading, cartridge header parsing, checksums, and MBC1 addressing."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, asdict
from pathlib import Path

BANK_SIZE = 0x4000

CART_TYPES = {
    0x00: "ROM ONLY", 0x01: "MBC1", 0x02: "MBC1+RAM", 0x03: "MBC1+RAM+BATTERY",
    0x05: "MBC2", 0x06: "MBC2+BATTERY", 0x0F: "MBC3+TIMER+BATTERY",
    0x10: "MBC3+TIMER+RAM+BATTERY", 0x11: "MBC3", 0x12: "MBC3+RAM",
    0x13: "MBC3+RAM+BATTERY", 0x19: "MBC5", 0x1B: "MBC5+RAM+BATTERY",
}
RAM_SIZES = {0x00: 0, 0x01: 2048, 0x02: 8192, 0x03: 32768, 0x04: 131072, 0x05: 65536}
NINTENDO_LOGO = bytes.fromhex(
    "CEED6666CC0D000B03730083000C000D0008111F8889000EDCCC6EE6DDDDD999"
    "BBBB67636E0EECCCDDDC999FBBB9333E"
)


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def header_checksum(rom: bytes) -> int:
    c = 0
    for i in range(0x134, 0x14D):
        c = (c - rom[i] - 1) & 0xFF
    return c


def global_checksum(rom: bytes) -> int:
    return (sum(rom) - rom[0x14E] - rom[0x14F]) & 0xFFFF


def fix_checksums(rom: bytearray) -> None:
    """Recompute header and global checksums in place."""
    rom[0x14D] = header_checksum(rom)
    g = global_checksum(rom)
    rom[0x14E] = (g >> 8) & 0xFF
    rom[0x14F] = g & 0xFF


@dataclass
class Header:
    title: str
    cgb_flag: int
    sgb_flag: int
    cart_type: int
    cart_type_name: str
    rom_size_code: int
    rom_size_bytes: int
    ram_size_code: int
    ram_size_bytes: int
    destination: int
    destination_name: str
    old_licensee: int
    version: int
    logo_ok: bool
    header_checksum: int
    header_checksum_calc: int
    header_checksum_ok: bool
    global_checksum: int
    global_checksum_calc: int
    global_checksum_ok: bool

    def to_dict(self) -> dict:
        return asdict(self)


def parse_header(rom: bytes) -> Header:
    if len(rom) < 0x150:
        raise ValueError("file too small to contain a Game Boy header")
    title = rom[0x134:0x144].split(b"\x00", 1)[0].decode("ascii", "replace")
    hc = header_checksum(rom)
    gc = global_checksum(rom)
    stored_g = (rom[0x14E] << 8) | rom[0x14F]
    return Header(
        title=title,
        cgb_flag=rom[0x143],
        sgb_flag=rom[0x146],
        cart_type=rom[0x147],
        cart_type_name=CART_TYPES.get(rom[0x147], "unknown"),
        rom_size_code=rom[0x148],
        rom_size_bytes=(32 * 1024) << rom[0x148],
        ram_size_code=rom[0x149],
        ram_size_bytes=RAM_SIZES.get(rom[0x149], -1),
        destination=rom[0x14A],
        destination_name="Japan" if rom[0x14A] == 0 else "Overseas",
        old_licensee=rom[0x14B],
        version=rom[0x14C],
        logo_ok=rom[0x104:0x134] == NINTENDO_LOGO,
        header_checksum=rom[0x14D],
        header_checksum_calc=hc,
        header_checksum_ok=rom[0x14D] == hc,
        global_checksum=stored_g,
        global_checksum_calc=gc,
        global_checksum_ok=stored_g == gc,
    )


def file_to_bank(offset: int) -> tuple[int, int]:
    """File offset -> (bank, CPU address). Bank 0 maps 0000-3FFF, others 4000-7FFF."""
    bank, rel = divmod(offset, BANK_SIZE)
    return bank, rel if bank == 0 else 0x4000 + rel


def bank_to_file(bank: int, addr: int) -> int:
    """(bank, CPU address) -> file offset."""
    if addr < 0x4000:
        if bank not in (0,):
            raise ValueError("addresses below 0x4000 are always bank 0 on MBC1 (mode 0)")
        return addr
    if not 0x4000 <= addr < 0x8000:
        raise ValueError(f"address {addr:#06x} is not in ROM space")
    if bank == 0:
        raise ValueError("bank 0 cannot be mapped at 4000-7FFF on MBC1 (selects bank 1)")
    return bank * BANK_SIZE + (addr - 0x4000)


def fmt_loc(offset: int) -> str:
    bank, addr = file_to_bank(offset)
    return f"{offset:#07x} ({bank:02X}:{addr:04X})"


def load_rom(path: str | Path) -> bytes:
    return Path(path).read_bytes()
