#!/usr/bin/env python3
"""Recria todos os ícones do Mestre do PC a partir do logo oficial.

Fonte: logo-mestre-transparent.png (raiz do repo).
Requer Pillow:  python -m pip install pillow
Uso:            python scripts/gerar-icones.py
"""
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "logo-mestre-transparent.png"
BG = (7, 11, 18, 255)  # --bg do PWA (#070b12)
SMALL_MAX = 32  # até aqui o texto da faixa fica ilegível: usa só a cabeça do mascote


def load_sources():
    logo = Image.open(SOURCE).convert("RGBA")
    logo = logo.crop(logo.getchannel("A").getbbox())
    w, h = logo.size
    # A faixa "MESTRE DO PC" começa em ~60% da altura; acima dela fica a cabeça.
    head = logo.crop((0, 0, w, int(h * 0.6)))
    head = head.crop(head.getchannel("A").getbbox())
    return logo, head


def fit(img, size, scale=1.0, bg=None):
    canvas = Image.new("RGBA", (size, size), bg or (0, 0, 0, 0))
    inner = max(1, round(size * scale))
    w, h = img.size
    ratio = min(inner / w, inner / h)
    resized = img.resize((max(1, round(w * ratio)), max(1, round(h * ratio))), Image.LANCZOS)
    canvas.alpha_composite(resized, ((size - resized.width) // 2, (size - resized.height) // 2))
    return canvas


def transparent(logo, head, size):
    return fit(head if size <= SMALL_MAX else logo, size, 1.0)


def app_icon(logo, size):
    # Fundo sólido + margem: área segura de ícone "maskable" (~80%).
    return fit(logo, size, 0.8, BG)


def save(img, rel):
    path = ROOT / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, optimize=True)
    print(f"ok  {rel}  {img.size[0]}x{img.size[1]}")


def main():
    logo, head = load_sources()

    save(transparent(logo, head, 512), "favicon.png")  # build-package.cjs copia para dist/site

    for size in (192, 512):
        icon = app_icon(logo, size)
        for rel in (f"v10/icon-{size}.png", f"v10/mobile/icon-{size}.png", f"dist/site/mobile/icon-{size}.png"):
            save(icon, rel)

    for size in (32, 48):
        save(transparent(logo, head, size), f"v10/chat-integrado/favicon-{size}.png")

    # Os ícones da extensão não saem daqui: seguem o Design System 1.0 e são gerados
    # por browser-extension/icons/build-icons.js (desenho vetorial, legível em 16 px).

    ico_sizes = (16, 24, 32, 48, 64, 128, 256)
    frames = [transparent(logo, head, s) for s in ico_sizes]
    ico = ROOT / "icon.ico"
    frames[-1].save(ico, format="ICO", sizes=[(s, s) for s in ico_sizes], append_images=frames[:-1])
    print(f"ok  icon.ico  {', '.join(str(s) for s in ico_sizes)}")


if __name__ == "__main__":
    main()
