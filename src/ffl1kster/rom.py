"""Legend I ROM identity and MBC2 addressing.

Generic header/checksum/bank helpers come from ffl2kster.rom (game-independent code, used as is).
Legend I differs from Legend II at the cartridge level (verified from the header, 2026-10-12):
MBC2+BATTERY with no external RAM code (MBC2 has 512 x 4-bit RAM built in), 128 KiB = 8 banks.
MBC2 maps bank 0 at 0000-3FFF and banks 1-7 at 4000-7FFF, so the file<->bank math is the same.
"""

from __future__ import annotations

from ffl2kster.rom import (  # noqa: F401  (re-exported)
    BANK_SIZE, Header, bank_to_file, file_to_bank, fix_checksums, fmt_loc, global_checksum,
    header_checksum, load_rom, parse_header, sha256,
)

# The FFL1 USA reference dump (docs/VARIANTS.md). Hashes identify the file; it is never committed.
USA_SHA256 = "e5b1d116a8fb01b7a7213f906b3ef1bcc91a18f6826b01ee1bccd89429a0d906"
USA_SIZE = 131072
BANKS = USA_SIZE // BANK_SIZE
MBC2_RAM_NIBBLES = 512  # A000-A1FF, low 4 bits of each byte are stored
