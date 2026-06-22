#!/usr/bin/env python3
"""Generate desktop/build/icon.png — a 512x512 EBG monogram.

Warm cream rounded-rectangle background (#F5F0E8) with the serif letters
"EBG" centered in gold (#B8965A). Rendered at 4x and downsampled for clean,
anti-aliased edges. Uses a bold serif TrueType font.
"""
import os
from PIL import Image, ImageDraw, ImageFont

SIZE = 512
SCALE = 4               # supersample factor
S = SIZE * SCALE        # working canvas size

CREAM = (245, 240, 232, 255)   # #F5F0E8
GOLD = (184, 150, 90, 255)     # #B8965A

# Pick a bold serif font, with sensible fallbacks.
FONT_CANDIDATES = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf",
    "/mnt/skills/examples/canvas-design/canvas-fonts/IBMPlexSerif-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSerif-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf",
]


def load_font(px):
    for path in FONT_CANDIDATES:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, px)
            except Exception:
                continue
    return ImageFont.load_default()


def main():
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "icon.png")

    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Rounded-rectangle cream background filling most of the canvas.
    margin = int(S * 0.04)
    radius = int(S * 0.18)
    draw.rounded_rectangle(
        [margin, margin, S - margin, S - margin],
        radius=radius,
        fill=CREAM,
    )

    # Fit "EBG" to a target width, centered.
    text = "EBG"
    target_w = int(S * 0.74)
    px = int(S * 0.42)
    font = load_font(px)

    # Shrink until it fits the target width.
    for _ in range(60):
        bbox = draw.textbbox((0, 0), text, font=font)
        w = bbox[2] - bbox[0]
        if w <= target_w or px <= 10:
            break
        px = int(px * target_w / max(w, 1))
        font = load_font(px)

    bbox = draw.textbbox((0, 0), text, font=font)
    w = bbox[2] - bbox[0]
    h = bbox[3] - bbox[1]
    x = (S - w) / 2 - bbox[0]
    y = (S - h) / 2 - bbox[1]
    draw.text((x, y), text, font=font, fill=GOLD)

    # Downsample to final size for anti-aliasing.
    img = img.resize((SIZE, SIZE), Image.LANCZOS)
    img.save(out, "PNG")
    print("wrote", out, "(", os.path.getsize(out), "bytes )")


if __name__ == "__main__":
    main()
