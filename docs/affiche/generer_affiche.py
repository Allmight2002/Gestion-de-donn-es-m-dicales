#!/usr/bin/env python3
"""Genere l'affiche MedData (A4 vertical) : SVG modifiable, PDF imprimable, PNG 300 DPI.

Usage :
    python docs/affiche/generer_affiche.py \
        --service "Neurochirurgie" --assistance-url "https://wa.me/23569308332" \
        --contact "WhatsApp : +235 69 30 83 32"

Dependances : segno (QR code), Pillow (metadonnees PNG), Chromium (rendu PDF/PNG ;
CHROMIUM_PATH ou le Chromium Playwright de /opt/pw-browsers). Ne jamais inscrire
d'identifiant ni de mot de passe sur l'affiche.
"""
from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from xml.sax.saxutils import escape

import segno
from PIL import Image

URL = "https://gestion-de-donn-es-m-dicales.vercel.app/"
TEAL = "#0f766e"  # theme_color du manifeste PWA (vite.config.ts)
TEAL_LIGHT = "#e6f4f2"
INK = "#0f172a"
MUTED = "#475569"
FONT = "Inter, 'Helvetica Neue', Helvetica, Arial, sans-serif"
DPI = 300
A4_PX = (2480, 3508)  # 210 x 297 mm a 300 DPI

# Icones au trait dessinees dans une grille 24 x 24.
ICONS = {
    "phone": '<rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M10.5 18.5h3"/>',
    "key": '<circle cx="8" cy="15" r="5"/><path d="M11.5 11.5 20 3M16.5 6.5l2.5 2.5M14 9l2 2"/>',
    "clipboard": '<rect x="5" y="4" width="14" height="18" rx="2"/><rect x="9" y="2" width="6" height="4" rx="1"/>'
                 '<path d="M12 10v8M8 14h8"/>',
    "lock": '<rect x="4.5" y="10.5" width="15" height="11" rx="2"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/>',
    "help": '<circle cx="12" cy="12" r="9.5"/><path d="M9.3 9.2a2.8 2.8 0 0 1 5.4 1c0 1.9-2.7 2.6-2.7 2.6"/>'
            '<path d="M12 16.8h.01"/>',
}


def icon(name: str, x: float, y: float, size: float, color: str, stroke: float = 2.0) -> str:
    s = size / 24
    return (f'<g transform="translate({x:.2f} {y:.2f}) scale({s:.4f})" fill="none" stroke="{color}" '
            f'stroke-width="{stroke}" stroke-linecap="round" stroke-linejoin="round">{ICONS[name]}</g>')


def qr_path(data: str, x: float, y: float, size: float, error: str) -> tuple[str, float]:
    """Chemin SVG d'un QR code (sans marge) et largeur de sa marge blanche de 4 modules."""
    qr = segno.make(data, error=error, micro=False, boost_error=False)
    matrix = [list(row) for row in qr.matrix]
    n = len(matrix)
    m = size / n
    parts = []
    for r, row in enumerate(matrix):
        c = 0
        while c < n:
            if row[c]:
                start = c
                while c < n and row[c]:
                    c += 1
                parts.append(f"M{x + start * m:.3f} {y + r * m:.3f}h{(c - start) * m:.3f}v{m:.3f}h{-(c - start) * m:.3f}z")
            else:
                c += 1
    return f'<path fill="#000000" d="{"".join(parts)}"/>', 4 * m


def build_svg(service: str, contact: str, assistance_url: str) -> str:
    service_e, contact_e = escape(service), escape(contact)
    sub_size = 7.0 if len(service) <= 34 else max(4.8, 7.0 * 34 / len(service))
    contact_size = 4.6 if len(contact) <= 40 else max(3.6, 4.6 * 40 / len(contact))

    # QR code principal : 88 mm, marge blanche de 4 modules dans le cadre blanc.
    qr_size, inner_top = 88.0, 72.5
    modules = segno.make(URL, error="q", micro=False, boost_error=False).symbol_size(border=0)[0]
    quiet = 4 * qr_size / modules
    inner_h = qr_size + 2 * quiet
    qr_svg, _ = qr_path(URL, (210 - qr_size) / 2, inner_top + quiet, qr_size, "q")
    frame_bottom = inner_top + inner_h + 22

    # QR code d'assistance : petit, a lire de pres, dans le pied de page.
    help_box, help_x, help_y = 29.0, 164.0, 256.0
    help_modules = segno.make(assistance_url, error="m", micro=False, boost_error=False).symbol_size(border=0)[0]
    help_size = help_box * help_modules / (help_modules + 8)
    help_svg, _ = qr_path(assistance_url, help_x + (help_box - help_size) / 2,
                                   help_y + (help_box - help_size) / 2, help_size, "m")

    steps = [
        ("phone", "1", [("Scannez", True), (" le QR code",)], ["avec votre téléphone."]),
        ("key", "2", [("Connectez-vous", True)], ["avec vos identifiants", "de saisie."]),
        ("clipboard", "3", [("Accédez", True), (" au registre",)], ["du service et enregistrez", "le patient."]),
    ]
    steps_svg = []
    for i, (ico, num, first, rest) in enumerate(steps):
        cx = 45 + i * 60
        steps_svg.append(f'<circle cx="{cx}" cy="223" r="7.5" fill="{TEAL_LIGHT}"/>')
        steps_svg.append(icon(ico, cx - 4.5, 218.5, 9, TEAL, 2.0))
        steps_svg.append(f'<circle cx="{cx - 6}" cy="217" r="3" fill="{TEAL}"/>'
                         f'<text x="{cx - 6}" y="218.45" font-size="4" font-weight="700" fill="#fff" '
                         f'text-anchor="middle">{num}</text>')
        spans = "".join(f'<tspan font-weight="700">{escape(t[0])}</tspan>' if len(t) == 2 else escape(t[0])
                        for t in first)
        lines = [spans] + [escape(line) for line in rest]
        for j, line in enumerate(lines):
            steps_svg.append(f'<text x="{cx}" y="{239 + j * 5.6:.1f}" font-size="4.6" fill="{INK}" '
                             f'text-anchor="middle">{line}</text>')

    return f'''<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="210mm" height="297mm" viewBox="0 0 210 297"
     font-family="{FONT}" role="img" aria-label="Affiche MedData - Registre des patients">
  <title>MedData - Registre des patients</title>
  <rect width="210" height="297" fill="#ffffff"/>

  <!-- En-tete -->
  <g transform="translate(15 13) scale({14 / 512:.5f})">
    <rect width="512" height="512" rx="96" fill="{TEAL}"/>
    <g fill="#ffffff"><rect x="216" y="136" width="80" height="240" rx="20"/><rect x="136" y="216" width="240" height="80" rx="20"/></g>
  </g>
  <text x="33" y="23.4" font-size="9" font-weight="800" fill="{INK}" letter-spacing="-0.15">Med<tspan fill="{TEAL}">Data</tspan></text>
  <rect x="15" y="32" width="180" height="0.5" fill="{TEAL}" opacity="0.35"/>

  <text x="105" y="49" font-size="12.5" font-weight="800" fill="{INK}" text-anchor="middle" letter-spacing="0.2">REGISTRE DES PATIENTS</text>
  <!-- SERVICE : modifier le texte ci-dessous -->
  <text id="service" x="105" y="61.5" font-size="{sub_size:.2f}" font-weight="600" fill="{TEAL}" text-anchor="middle">Service de {service_e}</text>

  <!-- Zone QR code -->
  <rect x="30" y="{inner_top - 3.5}" width="150" height="{frame_bottom - inner_top + 3.5:.2f}" rx="6" fill="{TEAL}"/>
  <rect x="33.5" y="{inner_top}" width="143" height="{inner_h:.2f}" rx="3.5" fill="#ffffff"/>
  {qr_svg}
  <text x="105" y="{inner_top + inner_h + 13.2:.2f}" font-size="6.4" font-weight="800" fill="#ffffff" text-anchor="middle" letter-spacing="0.2">SCANNEZ POUR ACCÉDER AU REGISTRE</text>
  <text x="105" y="{frame_bottom + 6.5:.2f}" font-size="3.6" fill="{MUTED}" text-anchor="middle">ou saisissez : <tspan font-weight="600" fill="{INK}">gestion-de-donn-es-m-dicales.vercel.app</tspan></text>

  <!-- Instructions -->
  {"".join(steps_svg)}

  <!-- Pied de page -->
  <rect x="15" y="254" width="180" height="33" rx="3" fill="#f1f5f9"/>
  {icon("help", 21, 261.9, 7, TEAL, 2.2)}
  <text x="31" y="267.6" font-size="5.2" fill="{INK}"><tspan font-weight="700">Assistance :</tspan> scannez ce code →</text>
  <!-- CONTACT : modifier le texte ci-dessous -->
  <text id="contact" x="31" y="276.2" font-size="{contact_size:.2f}" fill="{MUTED}">{contact_e}</text>
  <!-- QR code d'assistance ({escape(assistance_url)}) -->
  <rect x="{help_x}" y="{help_y}" width="{help_box}" height="{help_box}" rx="1.5" fill="#ffffff"/>
  {help_svg}
</svg>
'''


def chromium() -> str:
    for candidate in (os.environ.get("CHROMIUM_PATH"), "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
                      shutil.which("chromium"), shutil.which("chromium-browser"), shutil.which("google-chrome")):
        if candidate and Path(candidate).exists():
            return candidate
    raise SystemExit("Chromium introuvable : definir CHROMIUM_PATH.")


def render(svg: str, out_dir: Path, stem: str) -> None:
    exe = chromium()
    common = [exe, "--headless", "--no-sandbox", "--disable-gpu", "--hide-scrollbars", "--force-color-profile=srgb"]
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        pdf_html = tmp_path / "pdf.html"
        pdf_html.write_text(f'<!doctype html><meta charset="utf-8"><style>@page{{size:210mm 297mm;margin:0}}'
                            f'html,body{{margin:0}}svg{{display:block}}</style>{svg.split("?>", 1)[1]}', "utf-8")
        png_html = tmp_path / "png.html"
        png_html.write_text(f'<!doctype html><meta charset="utf-8"><style>html,body{{margin:0}}'
                            f'svg{{display:block;width:{A4_PX[0]}px;height:{A4_PX[1]}px}}</style>{svg.split("?>", 1)[1]}',
                            "utf-8")
        subprocess.run(common + ["--no-pdf-header-footer", f"--print-to-pdf={out_dir / (stem + '.pdf')}",
                                 pdf_html.as_uri()], check=True, capture_output=True)
        raw_png = tmp_path / "raw.png"
        subprocess.run(common + [f"--window-size={A4_PX[0]},{A4_PX[1]}", f"--screenshot={raw_png}",
                                 png_html.as_uri()], check=True, capture_output=True)
        with Image.open(raw_png) as img:
            img.convert("RGB").crop((0, 0, *A4_PX)).save(out_dir / (stem + ".png"), dpi=(DPI, DPI), optimize=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--service", default="Neurochirurgie")
    parser.add_argument("--contact", default="WhatsApp : +235 69 30 83 32")
    parser.add_argument("--assistance-url", default="https://wa.me/23569308332",
                        help="lien encode dans le petit QR code d'assistance")
    parser.add_argument("--out", type=Path, default=Path(__file__).resolve().parent)
    parser.add_argument("--nom", default="affiche-meddata", help="nom de base des fichiers produits")
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    svg = build_svg(args.service, args.contact, args.assistance_url)
    (args.out / f"{args.nom}.svg").write_text(svg, "utf-8")
    render(svg, args.out, args.nom)
    print(f"Affiche generee dans {args.out} ({args.nom}.svg/.pdf/.png)")


if __name__ == "__main__":
    main()
