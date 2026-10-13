"""IPS patches: the shareable form of an FFL2kster build. A patch holds only the changed bytes
(no game content beyond them) and is applied on the player's device to their own ROM (the FFTOL
port's Mods panel, or any IPS tool)."""

from __future__ import annotations

EOF_MARK = b"EOF"
MAX_RUN = 0xFFFF


def make_ips(original: bytes, patched: bytes) -> bytes:
    """Records for every run of differing bytes (runs split at 0xFFFF bytes; an offset that
    would read as "EOF" (0x454F46) starts one byte earlier)."""
    if len(original) != len(patched):
        raise ValueError("IPS here expects the same size (no truncation or growth)")
    out = bytearray(b"PATCH")
    i, n = 0, len(patched)
    while i < n:
        if original[i] == patched[i]:
            i += 1
            continue
        start = i
        while i < n and original[i] != patched[i] and i - start < MAX_RUN:
            i += 1
        if start == 0x454F46:
            start -= 1
        if start > 0xFFFFFF:
            raise ValueError("offset beyond IPS range")
        out += start.to_bytes(3, "big") + (i - start).to_bytes(2, "big") + patched[start:i]
    out += EOF_MARK
    return bytes(out)


def apply_ips(original: bytes, patch: bytes) -> bytes:
    if patch[:5] != b"PATCH":
        raise ValueError("not an IPS patch")
    out = bytearray(original)
    p = 5
    while True:
        if patch[p:p + 3] == EOF_MARK:
            p += 3
            break
        off = int.from_bytes(patch[p:p + 3], "big")
        size = int.from_bytes(patch[p + 3:p + 5], "big")
        p += 5
        if size == 0:
            run = int.from_bytes(patch[p:p + 2], "big")
            data = bytes([patch[p + 2]]) * run
            p += 3
        else:
            data = patch[p:p + size]
            p += size
        if off + len(data) > len(out):
            out.extend(b"\0" * (off + len(data) - len(out)))
        out[off:off + len(data)] = data
    if len(patch) >= p + 3:
        del out[int.from_bytes(patch[p:p + 3], "big"):]
    return bytes(out)
