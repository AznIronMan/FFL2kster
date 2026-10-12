"""Text domain: rewrite a pure message in place (encoded length <= original span).

Edit: {"domain": "text", "id": <index>, "field": "<table>", "value": "<rendered text>"}
with tables field/story/battle/menu (see script_text.TABLES). Entries containing script
commands are refused (relocation and script editing are out of scope).
"""

from __future__ import annotations

from ..build import Patch
from .. import script_text as st

DOMAIN = "text"


def resolve(rom: bytes, edit) -> list[Patch]:
    o, e, toks = st.entry(rom, edit.field, edit.id)
    codes = {t[0] for t in toks if not isinstance(t, str)}
    if not codes <= st.SAFE_CODES:
        raise ValueError(f"text {edit.field}[{edit.id}] contains script commands "
                         f"{sorted(hex(c) for c in codes - st.SAFE_CODES)}; not editable")
    new = st.parse_rendered(str(edit.value))
    ncodes = {t[0] for t in new if not isinstance(t, str)}
    if not ncodes <= st.SAFE_CODES:
        raise ValueError("new text may only use ⟨end⟩, newlines, ⟨05⟩, ⟨20 ..⟩, ⟨36 ..⟩")
    if not new or new[-1] != (0x00, ()):
        raise ValueError("new text must end with ⟨end⟩")
    data = st.encode_tokens(rom, new)
    span = e - o
    if len(data) > span:
        raise ValueError(f"encoded text is {len(data)} bytes; only {span} available "
                         f"(relocation not supported yet)")
    data = data + bytes(span - len(data))   # pad with 0x00 (end) — unreachable bytes
    old = st.render(toks)
    return [Patch(o, data, f"text {edit.field}[{edit.id}] {old!r} -> {edit.value!r}")]


def add_commands(sub) -> None:
    import json
    from .. import rom as romlib

    def cmd_export(a):
        rows = st.export(romlib.load_rom(a.rom))
        with open(a.out, "w", encoding="utf-8") as fh:
            json.dump({"source_sha256": romlib.sha256(romlib.load_rom(a.rom)),
                       "format": "rendered: \\n = 0x06, ⟨end⟩ = 0x00, ⟨XX YY⟩ = control code + args",
                       "messages": rows}, fh, ensure_ascii=False, indent=1)
        if a.txt:
            with open(a.txt, "w", encoding="utf-8") as fh:
                for r in rows:
                    fh.write(f"### {r['table']}[{r['index']}] {r['bank']:02X}:{r['address']:04X}\n{r['text']}\n\n")
        print(f"wrote {a.out} ({len(rows)} entries)")
        return 0

    s = sub.add_parser("text-export", help="decode all dialogue/battle/menu text")
    s.add_argument("--rom", default="input/original.gb")
    s.add_argument("--out", default="data/text/messages.json")
    s.add_argument("--txt", default="data/text/messages.txt")
    s.set_defaults(fn=cmd_export)


from . import register  # noqa: E402

register(DOMAIN, resolve)
