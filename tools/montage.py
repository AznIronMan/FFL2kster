"""Tile screenshots into one labelled contact sheet: montage.py out.png in1.png in2.png ..."""
import sys
from PIL import Image, ImageDraw
out, files = sys.argv[1], sys.argv[2:]
cols = min(4, len(files)); rows = (len(files) + cols - 1) // cols
S = 2
W, H = 160 * S, 144 * S + 14
sheet = Image.new('RGB', (cols * W, rows * H), 'white')
dr = ImageDraw.Draw(sheet)
for i, f in enumerate(files):
    im = Image.open(f).convert('RGB').resize((160 * S, 144 * S), Image.NEAREST)
    x, y = (i % cols) * W, (i // cols) * H
    sheet.paste(im, (x, y + 14))
    dr.text((x + 2, y + 1), f.split('/')[-1][:40], fill='black')
sheet.save(out)
