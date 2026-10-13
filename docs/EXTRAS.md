# Extras (P5)

Opt-in enhancements of the port. **Every extra is off by default**, and with all of them off the
game is the original: the parity suites (dedicated traces, 1,637 field sweep traces, 2,152 battle
traces) run with the defaults. Settings are kept per device (Options, on the menu screen or Esc in
the player); mods are kept per device too.

## What each extra does and where it acts

| Extra | Kind | Acts in | Changes the game? |
|---|---|---|---|
| Fast text | game option | text engine: no frame per character, no speed delay (`Game.options.fastText`) | timing only: messages finish sooner; the same characters and windows |
| Cap break (experimental) | game option | bytecode limits patched in memory (`CAP_BREAK_PATCHES`: max HP growth/items to 9,999, stats to 255) and the number display (a 4th HP digit / 3rd stat digit only when needed) | yes: higher limits for the party (direction note D; enemies already exceed the party's limits in the original). Wide numbers can overlap a window border |
| Battle speed ×2-×4 | player | runs 2-4 game frames per display frame while in battle (FF8B = FF) | no: the same frames, shown faster; sound sped up to match |
| Fast-forward | player | the same while Tab or the right shoulder button is held | no |
| Auto-battle | player | presses A (2 frames on, 4 off) while the battle command menus wait (`Game.ui.battleCommand`); each member repeats the last command (the menus remember it) | no: input only |
| Colours | display | 6 palettes for the 4 shades (grey default, green, pocket, teal, high-contrast amber, dark) | no |
| Reduce flashing | display | when more than a third of the picture changes brightness sharply in one frame, pixels move a quarter of the way per frame (flashes become fades) | no |
| Integer scaling | display | whole-number screen scale | no |
| Larger touch buttons | display | on-screen pad 1.2× | no |
| Widescreen field (experimental) | display | 256×144 (16:9) while on the field: 48 extra columns per side drawn from the field map in WRAM, the tileset in VRAM and each line's scroll/palette registers, with the game's own metatile rules; background only (the game places characters for its 160-pixel view); outside the field the margins keep their last picture or stay blank | no: reads memory only |
| Rebinding | input | keys and gamepad buttons per Game Boy button; Reset controls restores arrows+Z/X, WASD+K/J and the standard gamepad map | no |
| Mods | data | IPS/BPS patches applied on the device to the player's ROM in order, then the game data rebuilt; turning every mod off re-imports the original (verified again) | yes, as the mod says; modded games are labelled and carry no parity claim |

`Game.ui` holds hints the player shell reads (`battleCommand`, `fieldFrame`); game logic never
reads them, so they cannot change behaviour.

## Mods

FFL2kster writes a shareable patch with `python -m ffl2kster build --ips build/my-mod.ips`
(only the changed bytes; never a ROM). In the port: Mods → Add patch → Apply mods. BPS patches from
other tools are checked against their CRC32s (wrong ROM or damaged patch is refused). The ROM copy
kept for switching mods is removed with "Remove game data from this device".

## Verification

- Defaults: `parity/test/options.test.ts` (all options off; cap-break bytes patched only while on
  and restored after); the full suites pass with the defaults (see PROGRESS).
- Fast text: the same field message prints the same characters and the same finished window in
  under half the frames (options.test.ts).
- Patches: IPS records/RLE and BPS round trip with checksums (importer/test/patch.test.ts); the
  Python IPS writer round-trips (tests/test_ips.py); an `ffl2kster build --ips` patch applied in the
  web app changes Jaguar's HP to 200, and turning it off restores the verified original.
- Display extras checked in the browser pane: options panel, green palette, widescreen town view
  (margins line up with the game's view), cap-break numbers on the menu and status screens.
