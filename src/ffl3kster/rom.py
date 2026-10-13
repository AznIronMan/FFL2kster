"""Legend III ROM identity and MBC1 addressing.

Generic header/checksum/bank helpers come from ffl2kster.rom (game-independent code, used as is).
Legend III's cartridge (verified from the header, 2026-10-13): MBC1+RAM+BATTERY like Legend II,
256 KiB = 16 banks, 8 KiB battery RAM (RAM size code 02), DMG only (no CGB/SGB flags). Bank 0 at
0000-3FFF, banks 1-15 at 4000-7FFF.
"""

from __future__ import annotations

from ffl2kster.rom import (  # noqa: F401  (re-exported)
    BANK_SIZE, Header, bank_to_file, file_to_bank, fix_checksums, fmt_loc, global_checksum,
    header_checksum, load_rom, parse_header, sha256,
)

# The FFL3 USA reference dump (No-Intro "Final Fantasy Legend III (USA)"; docs/VARIANTS.md).
# Hashes identify the file; it is never committed.
USA_SHA256 = "5ed87f65225b72a74c3c04a4e5d67683fb5cc33e5f1266157350828ab973fc1d"
USA_SHA1 = "3864afa48a97db826ffda1d31a7ff9c6c315d5c9"
USA_MD5 = "db156bc96b528996ce1bf771195171af"
USA_SIZE = 262144
BANKS = USA_SIZE // BANK_SIZE
SRAM_SIZE = 0x2000
