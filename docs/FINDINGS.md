# Findings

Dated evidence log. Include failed hypotheses.

## 2026-10-11 — Input ROM identity (verified)

Source: `Final Fantasy Legend II.gb` extracted from the original archive
(kept in `.private/`), staged as `input/original.gb`.

| Field | Value |
|---|---|
| Size | 262144 bytes |
| SHA-256 | `ef66c90aeaab71672aefc6f39569b70925c08bda4996fe68f1452ed4a898486e` |
| MD5 | `4052912f83ddc2722dbc5409907ad8fa` |
| Title (0x134) | `SAGA2` |
| CGB flag (0x143) | 0x00 (DMG) |
| SGB flag (0x146) | 0x00 |
| Cartridge type (0x147) | 0x03 — MBC1 + RAM + Battery |
| ROM size (0x148) | 0x03 — 256 KiB |
| RAM size (0x149) | 0x02 — 8 KiB |
| Destination (0x14A) | 0x01 — non-Japanese |
| Old licensee (0x14B) | 0xC3 (Square) |
| Version (0x14C) | 0 |
| Header checksum (0x14D) | 0xCD — valid |
| Global checksum (0x14E–F) | 0xD970 — valid |

Matches the expected USA release (SAGA2, MBC1+RAM+Battery, 256 KiB / 8 KiB).
Method: Python parse of the header bytes; checksums recomputed per Pan Docs.
