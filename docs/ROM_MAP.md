# ROM Map

Bank/table/routine/RAM map for the supported ROM. Every entry carries a status:
`verified`, `probable`, `hypothesis`, or `external claim` (public reference not
yet locally verified), plus the evidence or source.

## Cartridge

| Field | Value | Status | Evidence |
|---|---|---|---|
| Size | 262144 bytes (16 × 16 KiB banks) | verified | file size |
| Mapper | MBC1 + RAM + Battery (0x03) | verified | header 0x147 |
| SRAM | 8 KiB (0x02) | verified | header 0x149 |

## Tables

_None yet._

## Routines

_None yet._

## RAM

_None yet._
