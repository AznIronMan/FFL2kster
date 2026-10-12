"""Decode FFL2 (USA) text bytes. Encoding evidence: docs/FINDINGS.md (2026-10-11 text encoding)."""
import sys

def dec(b):
    s = ''
    for x in b:
        if 0xBA <= x <= 0xD3: s += chr(65 + x - 0xBA)
        elif 0xD4 <= x <= 0xED: s += chr(97 + x - 0xD4)
        elif 0xB0 <= x <= 0xB9: s += chr(48 + x - 0xB0)
        elif x == 0xFF: s += ' '
        elif x == 0xF2: s += '-'
        else: s += '{%02X}' % x
    return s

if __name__ == '__main__':
    d = open(sys.argv[1], 'rb').read()
    start, end, w = int(sys.argv[2], 0), int(sys.argv[3], 0), int(sys.argv[4]) if len(sys.argv) > 4 else 8
    for i, o in enumerate(range(start, end, w)):
        print(f'{o:#07x} #{i:3d} |{dec(d[o:o+w])}|')
