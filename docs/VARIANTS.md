# ROM variant registry (direction note B)

Known dumps per game and their support status. Only **verified** variants get the faithful-port
guarantees; every other dump can still be imported in the labelled unverified mode (note C).
Hashes identify files; the ROMs themselves are never in the repository (the operator's reference
copies live in `.private/`, which git ignores).

| Game | Variant | Internal name | Size | SHA-256 | Status |
|---|---|---|---|---|---|
| Final Fantasy Legend II | USA | SAGA2 | 256 KiB | `ef66c90aeaab71672aefc6f39569b70925c08bda4996fe68f1452ed4a898486e` | **verified** (the port's game) |
| Sa-Ga 2: Hihou Densetsu | Japan | SAGA2 | 256 KiB | `56b3659210b1dde9e2494281bca2c7fc6141cb1828fe4a1d26a30c8740b3a696` | reference copy; not analysed |
| Sa-Ga 2: Hihou Densetsu | Japan Rev A | SAGA2 | 256 KiB | `31477ea9ae09d98e4170938d91ba5a9f5ab94072db4c289988882e0de7e48851` | reference copy; not analysed |
| The Final Fantasy Legend | USA | SAGA | 128 KiB | `e5b1d116a8fb01b7a7213f906b3ef1bcc91a18f6826b01ee1bccd89429a0d906` | **Legend I reference** (FFL1kster; analysis in progress, not yet verified for the port); SHA-1 `901dfc83c72e172d35a376835807fc788444a9bb`, MD5 `d5c27ff8cb1b69cb56df4ff170e2baf0`; MBC2+BATTERY; working copy `ffl1/input/original.gb` |
| Makai Toushi Sa-Ga | Japan | SAGA | 128 KiB | `c2f40e3ed1dcd4b6682dd19537d93ac4145ad754d1c6fd77581d09826f06f45c` | reference copy (other game) |
| Final Fantasy Legend III | USA | SAGA3 | 256 KiB | `5ed87f65225b72a74c3c04a4e5d67683fb5cc33e5f1266157350828ab973fc1d` | reference copy (other game) |
| Sa-Ga 3: Jikuu no Hasha | Japan | SAGA3 | 256 KiB | `3f54fab4d0c4c6b0128f4ce9e9f6d05b36e854566eefc689fd7272cabe5a1596` | reference copy (other game) |

Notes
- The two Japanese Sa-Ga 2 dumps have the same internal name and size as the supported ROM, so the
  importer currently offers them the unverified mode with Legend II's layout (no size or name
  warning). Their text encoding and data addresses are expected to differ; until they are analysed
  that import is best effort at most. A future importer step would recognise these hashes and say
  so before the player chooses.
- Legend I (USA) is under analysis as FFL1kster (docs/FFL1_PROGRESS.md); Legend III and the Japanese
  originals are for later FFTOL ports; the 128 KiB
  games are refused by today's importer (too small for Legend II's layout).
