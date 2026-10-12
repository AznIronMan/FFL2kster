"""Original app icon for FFTOL (Tower of Legends): a stepped tower on a green square. Drawn from
simple shapes (no game content); writes the SVG and the PNG sizes the PWA, Tauri and Capacitor use.
Usage: python port/assets/make_icons.py (from the repository root)."""
from PIL import Image, ImageDraw

BG, FG, ACC = (47, 111, 79), (244, 244, 239), (127, 196, 160)
# tower in a 100 x 100 design grid: base, two narrower stories, a spire; a door and a window
SHAPES = [("rect", (26, 70, 74, 84), FG), ("rect", (32, 50, 68, 70), FG), ("rect", (38, 32, 62, 50), FG),
          ("poly", [(36, 32), (50, 12), (64, 32)], FG), ("rect", (45, 74, 55, 84), BG), ("rect", (46, 38, 54, 45), ACC),
          ("rect", (22, 84, 78, 88), ACC)]


def draw(size, pad=0.0, round_=True):
    s = size / 100
    im = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    if round_:
        d.rounded_rectangle((0, 0, size - 1, size - 1), radius=int(22 * s), fill=BG)
    else:
        d.rectangle((0, 0, size, size), fill=BG)
    k = s * (1 - 2 * pad)
    o = size * pad
    for kind, pts, col in SHAPES:
        if kind == "rect":
            x0, y0, x1, y1 = pts
            d.rectangle((o + x0 * k, o + y0 * k, o + x1 * k - 1, o + y1 * k - 1), fill=col)
        else:
            d.polygon([(o + x * k, o + y * k) for x, y in pts], fill=col)
    return im


def svg():
    parts = [f'<rect width="100" height="100" rx="22" fill="rgb{BG}"/>']
    for kind, pts, col in SHAPES:
        if kind == "rect":
            x0, y0, x1, y1 = pts
            parts.append(f'<rect x="{x0}" y="{y0}" width="{x1 - x0}" height="{y1 - y0}" fill="rgb{col}"/>')
        else:
            parts.append(f'<polygon points="{" ".join(f"{x},{y}" for x, y in pts)}" fill="rgb{col}"/>')
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' + "".join(parts) + "</svg>\n"


if __name__ == "__main__":
    out = "port/apps/web/public/icons"
    open(f"{out}/icon.svg", "w").write(svg())
    for n in (180, 192, 512):
        draw(n).save(f"{out}/icon-{n}.png")
    draw(512, pad=0.1, round_=False).save(f"{out}/icon-maskable-512.png")
    draw(1024).save("port/assets/icon-1024.png")
    draw(1024, round_=False).save("port/assets/icon-1024-square.png")
    print("icons written")
