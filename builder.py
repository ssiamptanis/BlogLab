"""
PDF Builder — Brand-locked, content-flexible document generator.
Configured for GWI brand guidelines.

Usage:
    from builder import PDFBuilder

    pdf = PDFBuilder("output.pdf", doc_title="My Report")
    pdf.cover(title="Report Title", subtitle="Subtitle here", author="Jane Smith")
    pdf.section("Executive Summary")
    pdf.body("Body text goes here...")
    pdf.build()
"""

import html as _html_mod
import json
import os
import re
import sys
import tempfile
import urllib.request
from datetime import datetime
from xml.etree import ElementTree as ET

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, LETTER, A3
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate, Frame, PageTemplate, Paragraph, Spacer,
    Table, TableStyle, Image, PageBreak, KeepTogether,
    ListFlowable, ListItem
)
from reportlab.platypus.flowables import Flowable

_ASSETS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "assets")
_tmp_image_files = []  # track temp files to clean up after build

def _resolve_image(image: str):
    """Resolve a block image value to a local file path.

    Accepts:
    - A data URI (data:image/...) — decoded and written to a temp file
    - A URL (http/https) — downloaded to a temp file
    - A bare filename — looked up in assets/images/
    - An empty string / None / '__loading__' — returns None
    """
    if not image or image == '__loading__':
        return None

    # ── Data URI (preferred — sent by the browser pre-fetched) ─────────────
    if image.startswith("data:"):
        try:
            header, b64data = image.split(",", 1)
            ext = ".svg" if "svg" in header else ".png"
            import base64
            raw = base64.b64decode(b64data)
            tmp = tempfile.NamedTemporaryFile(delete=False, suffix=ext)
            tmp.write(raw)
            tmp.close()
            _tmp_image_files.append(tmp.name)
            return tmp.name
        except Exception as e:
            print(f"[builder] Could not decode data URI: {e}", file=sys.stderr)
            return None

    # ── Remote URL (fallback) ───────────────────────────────────────────────
    if image.startswith("http://") or image.startswith("https://"):
        try:
            ext = ".svg" if "image/svg" in image or image.split("?")[0].endswith(".svg") else ".png"
            tmp = tempfile.NamedTemporaryFile(delete=False, suffix=ext)
            urllib.request.urlretrieve(image, tmp.name)
            _tmp_image_files.append(tmp.name)
            return tmp.name
        except Exception as e:
            print(f"[builder] Could not download image {image}: {e}", file=sys.stderr)
            return None

    # ── Bare filename — look in assets/images/ ─────────────────────────────
    candidate = os.path.join(_ASSETS_DIR, "images", image)
    return candidate if os.path.exists(candidate) else None
from reportlab.graphics.shapes import Drawing, Path, Rect, Circle
from reportlab.graphics import renderPDF


# ---------------------------------------------------------------------------
# Utilities
# ---------------------------------------------------------------------------

def hex_to_rgb(hex_color: str) -> colors.Color:
    hex_color = hex_color.lstrip("#")
    r, g, b = (int(hex_color[i:i+2], 16) / 255 for i in (0, 2, 4))
    return colors.Color(r, g, b)


def rich_to_rl(text: str) -> str:
    """
    Convert contenteditable innerHTML to ReportLab XML markup.
    Handles <b>, <strong>, <i>, <em>, <br>, <span style="color:..."> and
    <font color="..."> (produced by execCommand foreColor in Electron/Chrome).
    All other tags are stripped; their text content is kept.

    IMPORTANT: do NOT call html.unescape() before processing tags — attribute
    values may contain encoded > (&gt;) which would break [^>]* regexes and
    leave "> fragments in the output (seen with Figma paste metadata spans).
    """
    if not text:
        return ""

    t = text

    # Strip Figma / editor paste metadata spans (data-metadata, data-buffer)
    # These have no visible content but pollute the HTML
    t = re.sub(r'<span\s+data-[^>]*>.*?</span>', '', t,
               flags=re.IGNORECASE | re.DOTALL)

    # <br> → temporary newline marker
    t = re.sub(r'<br\s*/?>', '\n', t, flags=re.IGNORECASE)

    # <strong> / <em> → <b> / <i>
    t = re.sub(r'<strong[^>]*>', '<b>', t, flags=re.IGNORECASE)
    t = re.sub(r'</strong>', '</b>', t, flags=re.IGNORECASE)
    t = re.sub(r'<em[^>]*>', '<i>', t, flags=re.IGNORECASE)
    t = re.sub(r'</em>', '</i>', t, flags=re.IGNORECASE)

    # Process <span>...</span> pairs atomically — extract colour if present,
    # else strip the span tags and keep the inner content.
    # Unescape only the attributes string for matching (not the whole text).
    # Multiple passes handle nested spans.
    def _convert_span(m):
        attrs = _html_mod.unescape(m.group(1))
        inner = m.group(2)
        # font-weight: bold → wrap in <b>
        is_bold = bool(re.search(r'font-weight\s*:\s*bold', attrs, re.IGNORECASE))
        # colour → wrap in <font color>
        rgb = re.search(
            r'color:\s*rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)',
            attrs, re.IGNORECASE)
        if rgb:
            r, g, b = int(rgb.group(1)), int(rgb.group(2)), int(rgb.group(3))
            result = f'<font color="#{r:02x}{g:02x}{b:02x}">{inner}</font>'
            return f'<b>{result}</b>' if is_bold else result
        hexc = re.search(r'color:\s*(#[0-9a-fA-F]{3,8})', attrs, re.IGNORECASE)
        if hexc:
            result = f'<font color="{hexc.group(1)}">{inner}</font>'
            return f'<b>{result}</b>' if is_bold else result
        if is_bold:
            return f'<b>{inner}</b>'
        return inner  # no colour, no bold — strip span, keep text

    # Match only leaf spans (inner content contains no child <span> tags).
    # Each pass unwraps one level; repeat until stable.
    _leaf_span = re.compile(
        r'<span([^>]*)>((?:(?!</?span)[\s\S])*)</span>',
        re.IGNORECASE)
    for _ in range(10):
        t2 = _leaf_span.sub(_convert_span, t)
        if t2 == t:
            break
        t = t2

    # Strip any remaining HTML tags not supported by ReportLab
    # Keep: <b> <i> <font ...> <br/>
    t = re.sub(r'<(?!/?(b|i|font)(\s[^>]*)?/?>|br\s*/?>)[^>]*>',
               '', t, flags=re.IGNORECASE)

    # &nbsp; → regular space
    t = t.replace('&nbsp;', ' ')

    # Escape bare & not already part of an XML entity
    t = re.sub(r'&(?!#?\w+;)', '&amp;', t)

    # Restore newlines as <br/>
    t = t.replace('\n', '<br/>')

    return t.strip()


# ---------------------------------------------------------------------------
# Faktum font registration
# ---------------------------------------------------------------------------
_FONTS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "assets", "fonts")

def _reg(name, filename):
    path = os.path.join(_FONTS_DIR, filename)
    if os.path.exists(path):
        pdfmetrics.registerFont(TTFont(name, path))
        return True
    return False

_reg("Faktum-Thin",       "Faktum-Thin.ttf")
_reg("Faktum-ExtraLight", "Faktum-ExtraLight.ttf")
_reg("Faktum-Light",      "Faktum-Light.ttf")
_reg("Faktum-Regular",    "Faktum-Regular.ttf")
_reg("Faktum-Italic",     "Faktum-Italic.ttf")
_reg("Faktum-Medium",     "Faktum-Medium.ttf")
_reg("Faktum-SemiBold",   "Faktum-SemiBold.ttf")
_reg("Faktum-Bold",       "Faktum-Bold.ttf")
_reg("Faktum-BoldItalic", "Faktum-BoldItalic.ttf")
_reg("Faktum-ExtraBold",  "Faktum-ExtraBold.ttf")

pdfmetrics.registerFontFamily(
    "Faktum",
    normal="Faktum-Regular",
    bold="Faktum-Bold",
    italic="Faktum-Italic",
    boldItalic="Faktum-BoldItalic",
)

PAGE_SIZES = {"A4": A4, "A3": A3, "LETTER": LETTER}
# CANVAS is resolved dynamically from brand_config page_width


# ---------------------------------------------------------------------------
# SVG Logo Renderer
# ---------------------------------------------------------------------------

def _parse_svg_path(d: str, svg_h: float, scale: float, fill_color) -> Path:
    """Convert an SVG path 'd' attribute to a ReportLab Path (Y-flipped)."""
    path = Path(fillColor=fill_color, strokeColor=None, strokeWidth=0)
    tokens = re.findall(
        r'[MLHVCSQTAZmlhvcsqtaz]|[-+]?[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?', d
    )
    i = 0
    cx, cy = 0.0, 0.0

    def fx(x): return x * scale
    def fy(y): return (svg_h - y) * scale

    while i < len(tokens):
        cmd = tokens[i]; i += 1
        if cmd == 'M':
            x, y = float(tokens[i]), float(tokens[i+1]); i += 2
            path.moveTo(fx(x), fy(y)); cx, cy = x, y
        elif cmd == 'H':
            x = float(tokens[i]); i += 1
            path.lineTo(fx(x), fy(cy)); cx = x
        elif cmd == 'V':
            y = float(tokens[i]); i += 1
            path.lineTo(fx(cx), fy(y)); cy = y
        elif cmd == 'L':
            x, y = float(tokens[i]), float(tokens[i+1]); i += 2
            path.lineTo(fx(x), fy(y)); cx, cy = x, y
        elif cmd == 'C':
            x1, y1 = float(tokens[i]), float(tokens[i+1]); i += 2
            x2, y2 = float(tokens[i]), float(tokens[i+1]); i += 2
            x,  y  = float(tokens[i]), float(tokens[i+1]); i += 2
            path.curveTo(fx(x1), fy(y1), fx(x2), fy(y2), fx(x), fy(y))
            cx, cy = x, y
        elif cmd in ('Z', 'z'):
            path.closePath()
        # skip unsupported commands
    return path


def build_logo_drawing(svg_path: str, target_w: float, target_h: float) -> Drawing:
    """Parse an SVG file and return a ReportLab Drawing scaled to target dimensions."""
    tree = ET.parse(svg_path)
    root = tree.getroot()
    ns = {'svg': 'http://www.w3.org/2000/svg'}

    vb = root.get('viewBox', '0 0 264 81').split()
    svg_w, svg_h = float(vb[2]), float(vb[3])

    scale = min(target_w / svg_w, target_h / svg_h)
    dw = svg_w * scale
    dh = svg_h * scale

    drawing = Drawing(dw, dh)

    for elem in root.iter():
        tag = elem.tag.split('}')[-1] if '}' in elem.tag else elem.tag
        fill_hex = elem.get('fill', '#000000')
        fill_color = hex_to_rgb(fill_hex) if fill_hex and fill_hex != 'none' else colors.black

        if tag == 'path':
            d = elem.get('d', '')
            if d:
                p = _parse_svg_path(d, svg_h, scale, fill_color)
                drawing.add(p)

        elif tag == 'rect':
            x = float(elem.get('x', 0))
            y = float(elem.get('y', 0))
            w = float(elem.get('width', 0))
            h = float(elem.get('height', 0))
            r = Rect(x * scale, (svg_h - y - h) * scale, w * scale, h * scale,
                     fillColor=fill_color, strokeColor=None)
            drawing.add(r)

        elif tag == 'circle':
            cx = float(elem.get('cx', 0))
            cy = float(elem.get('cy', 0))
            rad = float(elem.get('r', 0))
            c = Circle(cx * scale, (svg_h - cy) * scale, rad * scale,
                       fillColor=fill_color, strokeColor=None)
            drawing.add(c)

    return drawing


def _svg_to_png_temp(img_path: str, target_w: float, target_h: float):
    """
    Convert an SVG file to a temporary PNG using PyMuPDF (fitz).
    Returns (tmp_path, native_w, native_h) or raises on failure.
    target_w/h are in PDF points — used to choose a good raster resolution.
    """
    import fitz  # pymupdf
    doc  = fitz.open(img_path)
    page = doc[0]
    svg_w = page.rect.width  or 100.0
    svg_h = page.rect.height or 100.0
    # Render at enough DPI so the image looks crisp at target size
    zoom = max(2.0, max(target_w / svg_w, target_h / svg_h) * 2.0)
    mat  = fitz.Matrix(zoom, zoom)
    pix  = page.get_pixmap(matrix=mat, alpha=True)
    tmp  = tempfile.NamedTemporaryFile(delete=False, suffix='.png')
    pix.save(tmp.name)
    tmp.close()
    _tmp_image_files.append(tmp.name)
    doc.close()
    return tmp.name, svg_w, svg_h


def draw_image_scaled(c, img_path: str, cx: float, cy: float,
                      max_w: float, max_h: float, scale: float = 1.0):
    """
    Draw an image (SVG or raster) centred at (cx, cy), fitting within
    (max_w × max_h) then multiplied by scale.
    SVGs are converted to PNG via PyMuPDF for full Figma-SVG compatibility,
    with svglib as a fallback.
    """
    is_svg = img_path.lower().endswith('.svg')
    try:
        if is_svg:
            # ── PyMuPDF path (preferred — handles complex Figma SVGs) ──────
            try:
                png_path, svg_w, svg_h = _svg_to_png_temp(img_path, max_w, max_h)
                base  = min(max_w / svg_w, max_h / svg_h) * scale
                dw    = svg_w * base
                dh    = svg_h * base
                x     = cx - dw / 2
                y     = cy - dh / 2
                c.drawImage(png_path, x, y, dw, dh, mask='auto')
                return
            except Exception as fitz_err:
                print(f"[builder] PyMuPDF SVG conversion failed ({img_path}): {fitz_err}", file=sys.stderr)
            # ── svglib fallback ──────────────────────────────────────────────
            from svglib.svglib import svg2rlg
            drawing = svg2rlg(img_path)
            if drawing is None:
                raise ValueError(f"svglib could not parse {img_path}")
            base  = min(max_w / drawing.width, max_h / drawing.height)
            final = base * scale
            dw    = drawing.width  * final
            dh    = drawing.height * final
            drawing.width     = dw
            drawing.height    = dh
            drawing.transform = (final, 0, 0, final, 0, 0)
            x = cx - dw / 2
            y = cy - dh / 2
            renderPDF.draw(drawing, c, x, y)
        else:
            from reportlab.lib.utils import ImageReader
            ir   = ImageReader(img_path)
            iw, ih = ir.getSize()
            base  = min(max_w / iw, max_h / ih)
            final = base * scale
            dw    = iw * final
            dh    = ih * final
            x = cx - dw / 2
            y = cy - dh / 2
            c.drawImage(img_path, x, y, dw, dh, mask='auto')
    except Exception as e:
        print(f"[builder] draw_image_scaled error ({img_path}): {e}", file=sys.stderr)


# ---------------------------------------------------------------------------
# Custom Flowables
# ---------------------------------------------------------------------------

class ColorBar(Flowable):
    def __init__(self, width, height, color):
        super().__init__()
        self.width = width
        self.bar_height = height
        self.bar_color = color

    def draw(self):
        self.canv.setFillColor(self.bar_color)
        self.canv.rect(0, 0, self.width, self.bar_height, fill=1, stroke=0)

    def wrap(self, aw, ah):
        return self.width, self.bar_height


class Divider(Flowable):
    def __init__(self, width=None, color="#CED9EB", thickness=0.5, margin_v=4):
        super().__init__()
        self._width = width
        self._color = color
        self._thickness = thickness
        self._margin_v = margin_v

    def wrap(self, aw, ah):
        self.width = self._width or aw
        self.height = self._margin_v * 2 + self._thickness
        return self.width, self.height

    def draw(self):
        self.canv.setStrokeColor(hex_to_rgb(self._color))
        self.canv.setLineWidth(self._thickness)
        self.canv.line(0, self._margin_v, self.width, self._margin_v)


class CalloutBox(Flowable):
    STYLES = {
        "info":    ("#EBF1FB", "#007CB6"),
        "success": ("#E6F4EE", "#008851"),
        "warning": ("#FEF8EC", "#F6C26D"),
        "error":   ("#FDECEA", "#DA3441"),
        "brand":   ("#FFE8EE", "#FF0077"),
    }

    def __init__(self, text, style="info", width=None):
        super().__init__()
        self._text = text
        self._style = style
        self._width = width

    def wrap(self, aw, ah):
        self.width = self._width or aw
        # Estimate height at 40pt font, ~24pt per char avg, 48pt leading
        chars_per_line = max(1, int((self.width - 30) / 24))
        lines = max(1, len(self._text) // chars_per_line + 1)
        self.height = max(80, lines * 48 + 32)
        return self.width, self.height

    def draw(self):
        bg_hex, border_hex = self.STYLES.get(self._style, self.STYLES["info"])
        bg     = hex_to_rgb(bg_hex)
        border = hex_to_rgb(border_hex)

        c = self.canv
        c.setFillColor(bg)
        c.setStrokeColor(border)
        c.setLineWidth(1)
        c.roundRect(0, 0, self.width, self.height, 4, fill=1, stroke=1)

        # Left accent strip
        c.setFillColor(border)
        c.rect(0, 0, 4, self.height, fill=1, stroke=0)

        # Text — simple word wrap, 40pt light
        FONT, FS, LEAD = "Faktum-Light", 40, 48
        c.setFillColor(hex_to_rgb("#000000"))
        c.setFont(FONT, FS)
        max_w = self.width - 30
        words = self._text.split()
        line, lines_out = [], []
        for word in words:
            test = " ".join(line + [word])
            if c.stringWidth(test, FONT, FS) < max_w:
                line.append(word)
            else:
                lines_out.append(" ".join(line))
                line = [word]
        if line:
            lines_out.append(" ".join(line))

        y_start = self.height - LEAD
        for j, ln in enumerate(lines_out):
            c.drawString(14, y_start - j * LEAD, ln)


# ---------------------------------------------------------------------------
# Page Header / Footer (canvas callbacks)
# ---------------------------------------------------------------------------

def _make_on_page(brand, page_type, page_w, page_h):
    """Return an onPage callback for a given page type."""
    layout  = brand["layout"]
    ml, mr  = layout["margin_left"], layout["margin_right"]
    mt, mb  = layout["margin_top"],  layout["margin_bottom"]

    c_primary = hex_to_rgb(brand["colors"]["primary"])
    c_accent  = hex_to_rgb(brand["colors"]["accent"])
    c_border  = hex_to_rgb(brand["colors"]["border"])
    c_light   = hex_to_rgb(brand["colors"]["text_light"])

    logo_cfg = brand["logo"]
    # Choose correct logo variant based on page type
    logo_path_key = "path_on_dark" if page_type in ("cover", "section") else "path"
    svg_path = os.path.join(os.path.dirname(__file__), logo_cfg[logo_path_key])

    # Pre-build the logo drawing once
    logo_w = logo_cfg["width"]
    logo_h = logo_cfg["height"]
    try:
        logo_drawing = build_logo_drawing(svg_path, logo_w, logo_h)
        _logo = logo_drawing
    except Exception:
        _logo = None

    def on_page(canvas, doc):
        canvas.saveState()

        if page_type != "cover":
            # ── Header ────────────────────────────────────────────
            hdr_y = page_h - mt + 10

            if _logo:
                renderPDF.draw(_logo, canvas, ml, hdr_y - 4)
            else:
                canvas.setFont("Faktum-Bold", 14)
                canvas.setFillColor(c_primary)
                canvas.drawString(ml, hdr_y, brand["brand"]["name"])

            # Divider
            canvas.setStrokeColor(c_border)
            canvas.setLineWidth(0.5)
            canvas.line(ml, page_h - mt + 4, page_w - mr, page_h - mt + 4)

            # Accent dot (brand i-dot nod)
            canvas.setFillColor(c_accent)
            canvas.circle(page_w - mr, hdr_y + 10, 3, fill=1, stroke=0)

        # ── Footer ────────────────────────────────────────────────
        if page_type != "cover":
            ftr_y = mb - 18

            canvas.setStrokeColor(c_border)
            canvas.setLineWidth(0.5)
            canvas.line(ml, mb - 6, page_w - mr, mb - 6)

            canvas.setFont("Faktum-Regular", 7)
            canvas.setFillColor(c_light)
            footer_text = brand["footer"]["custom_text"] or brand["brand"]["name"]
            canvas.drawString(ml, ftr_y, footer_text)

            if brand["footer"]["show_page_numbers"]:
                canvas.drawRightString(page_w - mr, ftr_y, f"Page {doc.page}")

        canvas.restoreState()

    return on_page


# ---------------------------------------------------------------------------
# PDFBuilder
# ---------------------------------------------------------------------------

class PDFBuilder:
    """
    GWI brand-locked, content-flexible PDF builder.

    Brand settings are loaded from brand_config.json and cannot be overridden
    at runtime. All content methods give full flexibility over page content.
    """

    CONFIG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "brand_config.json")

    def __init__(self, output_path: str, doc_title: str = "Document",
                 doc_author: str = "", doc_subject: str = ""):
        self.output_path = output_path

        with open(self.CONFIG_PATH) as f:
            self._brand = json.load(f)

        b = self._brand
        layout    = b["layout"]
        if layout["page_size"] == "CANVAS":
            page_w = float(layout["page_width"])
            page_h = page_w * 1.5   # placeholder; build() will set real height
        else:
            page_w, page_h = PAGE_SIZES.get(layout["page_size"], A4)

        self._page_w      = page_w
        self._page_h      = page_h
        self._content_w   = page_w - layout["margin_left"] - layout["margin_right"]
        self._gutter      = layout["gutter"]
        self._layout      = layout
        self.c            = {k: hex_to_rgb(v) for k, v in b["colors"].items()}
        self._story       = []

        self._doc = BaseDocTemplate(
            output_path,
            pagesize=(page_w, page_h),
            title=doc_title,
            author=doc_author or b["brand"]["name"],
            subject=doc_subject,
            leftMargin=layout["margin_left"],
            rightMargin=layout["margin_right"],
            topMargin=layout["margin_top"],
            bottomMargin=layout["margin_bottom"],
        )

        ml = layout["margin_left"]
        mr = layout["margin_right"]
        mt = layout["margin_top"]
        mb = layout["margin_bottom"]
        cw = self._content_w
        ch = page_h - mt - mb

        def make_tmpl(name, ptype):
            frame = Frame(ml, mb, cw, ch, id="main",
                          leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
            return PageTemplate(id=name, frames=[frame],
                                onPage=_make_on_page(b, ptype, page_w, page_h))

        self._doc.addPageTemplates([
            make_tmpl("cover",   "cover"),
            make_tmpl("content", "content"),
        ])

        self._styles = self._build_styles()

    # ------------------------------------------------------------------
    # Styles
    # ------------------------------------------------------------------

    def _build_styles(self):
        b   = self._brand
        typ = b["typography"]
        sz  = typ["sizes"]
        col = b["colors"]

        def ps(name, **kw): return ParagraphStyle(name, **kw)

        return {
            "h1": ps("H1",
                fontName=typ["heading_font"], fontSize=sz["h1"],
                textColor=hex_to_rgb(col["primary"]),
                spaceAfter=8, spaceBefore=18, leading=sz["h1"] * 1.2),
            "h2": ps("H2",
                fontName=typ["heading_font"], fontSize=sz["h2"],
                textColor=hex_to_rgb(col["primary"]),
                spaceAfter=6, spaceBefore=14, leading=sz["h2"] * 1.3),
            "h3": ps("H3",
                fontName=typ["subheading_font"], fontSize=sz["h3"],
                textColor=hex_to_rgb(col["secondary"]),
                spaceAfter=5, spaceBefore=10, leading=sz["h3"] * 1.3),
            "h4": ps("H4",
                fontName=typ["subheading_font"], fontSize=sz["h4"],
                textColor=hex_to_rgb(col["text_secondary"]),
                spaceAfter=4, spaceBefore=8, leading=sz["h4"] * 1.4),
            "body": ps("Body",
                fontName=typ["body_font"], fontSize=sz["body"],
                textColor=hex_to_rgb(col["text"]),
                spaceAfter=6, leading=sz["body"] * 1.65),
            "body_muted": ps("BodyMuted",
                fontName=typ["body_font"], fontSize=sz["body"],
                textColor=hex_to_rgb(col["text_secondary"]),
                spaceAfter=6, leading=sz["body"] * 1.65),
            "small": ps("Small",
                fontName=typ["body_font"], fontSize=sz["small"],
                textColor=hex_to_rgb(col["text_light"]),
                spaceAfter=4, leading=sz["small"] * 1.5),
            "caption": ps("Caption",
                fontName=typ["body_font"], fontSize=sz["caption"],
                textColor=hex_to_rgb(col["text_light"]),
                spaceAfter=4, leading=sz["caption"] * 1.5, alignment=1),
            "code": ps("Code",
                fontName=typ["mono_font"], fontSize=sz["small"],
                textColor=hex_to_rgb(col["text"]),
                backColor=hex_to_rgb(col["surface"]),
                spaceAfter=6, leading=sz["small"] * 1.6,
                leftIndent=10, rightIndent=10,
                borderPadding=(6, 8, 6, 8)),
        }

    # ------------------------------------------------------------------
    # Cover page
    # ------------------------------------------------------------------

    def cover(self, title: str, subtitle: str = "", author: str = "",
               date: str = "", category: str = ""):
        """Full branded cover page — black background, Hot Pink accent bar, white logo."""
        b       = self._brand
        layout  = b["layout"]
        page_w, page_h = self._page_w, self._page_h
        cw      = self._content_w
        c_black = self.c["primary"]
        c_pink  = self.c["accent"]
        c_white = self.c["text_white"]
        c_grey  = self.c["text_secondary"]
        c_surf  = self.c["surface"]

        # ── White logo on dark cover (drawn directly on canvas) ──────────
        # We do this in a Flowable so it renders at the right time
        class CoverPage(Flowable):
            def __init__(inner, brand, page_w, page_h, title, subtitle,
                         author, date, category):
                super().__init__()
                inner._brand     = brand
                inner._page_w    = page_w
                inner._page_h    = page_h
                inner._title     = title
                inner._subtitle  = subtitle
                inner._author    = author
                inner._date      = date or datetime.today().strftime("%-d %B %Y")
                inner._cat       = category

            def wrap(inner, aw, ah):
                inner.width  = aw
                inner.height = ah
                return aw, ah

            def draw(inner):
                c    = inner.canv
                pw   = inner._page_w
                ph   = inner._page_h
                ml   = layout["margin_left"]
                mb_l = layout["margin_bottom"]
                mr   = layout["margin_right"]

                # Translate so we can use page coordinates directly
                c.saveState()
                c.translate(-ml, -mb_l)

                # Full-page black background
                c.setFillColor(colors.black)
                c.rect(0, 0, pw, ph, fill=1, stroke=0)

                # Hot Pink bar at bottom
                bar_h = 8
                c.setFillColor(hex_to_rgb(b["colors"]["accent"]))
                c.rect(0, 0, pw, bar_h, fill=1, stroke=0)

                # White GWI logo (top left)
                logo_cfg = b["logo"]
                logo_svg = os.path.join(
                    os.path.dirname(os.path.abspath(__file__)),
                    logo_cfg["path_on_dark"]
                )
                logo_w, logo_h = 120, 37
                try:
                    logo_d = build_logo_drawing(logo_svg, logo_w, logo_h)
                    renderPDF.draw(logo_d, c, ml, ph - 80)
                except Exception:
                    c.setFont("Faktum-Bold", 18)
                    c.setFillColor(colors.white)
                    c.drawString(ml, ph - 70, "GWI")

                # Category badge
                if inner._cat:
                    badge_w = c.stringWidth(inner._cat.upper(), "Faktum-Bold", 8) + 20
                    c.setFillColor(hex_to_rgb(b["colors"]["accent"]))
                    c.roundRect(ml, ph * 0.52, badge_w, 18, 3, fill=1, stroke=0)
                    c.setFillColor(colors.white)
                    c.setFont("Faktum-Bold", 8)
                    c.drawString(ml + 10, ph * 0.52 + 5, inner._cat.upper())

                # Title
                title_y = ph * 0.46
                c.setFillColor(colors.white)
                c.setFont("Faktum-Bold", 36)
                # Word-wrap the title
                words = inner._title.split()
                line, lines = [], []
                for word in words:
                    test = " ".join(line + [word])
                    if c.stringWidth(test, "Faktum-Bold", 36) < (pw - ml - mr - 20):
                        line.append(word)
                    else:
                        lines.append(" ".join(line)); line = [word]
                if line: lines.append(" ".join(line))

                for j, ln in enumerate(lines):
                    c.drawString(ml, title_y - j * 44, ln)

                # Subtitle
                if inner._subtitle:
                    sub_y = title_y - len(lines) * 44 - 16
                    c.setFillColor(hex_to_rgb(b["colors"]["text_light"]))
                    c.setFont("Faktum-Regular", 13)
                    words2 = inner._subtitle.split()
                    line2, lines2 = [], []
                    for word in words2:
                        test = " ".join(line2 + [word])
                        if c.stringWidth(test, "Faktum-Regular", 13) < (pw - ml - mr - 20):
                            line2.append(word)
                        else:
                            lines2.append(" ".join(line2)); line2 = [word]
                    if line2: lines2.append(" ".join(line2))
                    for j, ln in enumerate(lines2):
                        c.drawString(ml, sub_y - j * 18, ln)

                # Meta (author · date)
                meta_parts = []
                if inner._author: meta_parts.append(inner._author)
                if inner._date:   meta_parts.append(inner._date)
                if meta_parts:
                    meta_y = mb_l + 30
                    c.setFillColor(hex_to_rgb(b["colors"]["text_secondary"]))
                    c.setFont("Faktum-Regular", 9)
                    c.drawString(ml, meta_y, "  ·  ".join(meta_parts))

                c.restoreState()

        self._story.append(CoverPage(b, page_w, page_h, title, subtitle,
                                      author, date, category))
        self._story.append(PageBreak())

    # ------------------------------------------------------------------
    # Section divider page
    # ------------------------------------------------------------------

    def section_page(self, title: str, description: str = ""):
        """Full-page branded section divider (black background)."""
        b      = self._brand
        layout = b["layout"]
        cw     = self._content_w

        class SectionCover(Flowable):
            def __init__(inner, page_w, page_h):
                super().__init__()
                inner._pw = page_w
                inner._ph = page_h

            def wrap(inner, aw, ah):
                inner.width  = aw
                inner.height = ah
                return aw, ah

            def draw(inner):
                c   = inner.canv
                pw  = inner._pw
                ph  = inner._ph
                ml  = layout["margin_left"]
                mr  = layout["margin_right"]

                # Translate so we can use page coordinates directly
                c.saveState()
                c.translate(-ml, -layout["margin_bottom"])

                c.setFillColor(colors.black)
                c.rect(0, 0, pw, ph, fill=1, stroke=0)

                # Pink bar at bottom
                c.setFillColor(hex_to_rgb(b["colors"]["accent"]))
                c.rect(0, 0, pw, 6, fill=1, stroke=0)

                # Title
                c.setFillColor(colors.white)
                c.setFont("Faktum-Bold", 32)
                y = ph * 0.55
                words = title.split()
                line, lines = [], []
                for word in words:
                    test = " ".join(line + [word])
                    if c.stringWidth(test, "Faktum-Bold", 32) < (pw - ml - mr):
                        line.append(word)
                    else:
                        lines.append(" ".join(line)); line = [word]
                if line: lines.append(" ".join(line))
                for j, ln in enumerate(lines):
                    c.drawString(ml, y - j * 40, ln)

                if description:
                    desc_y = y - len(lines) * 40 - 18
                    c.setFillColor(hex_to_rgb(b["colors"]["text_light"]))
                    c.setFont("Faktum-Regular", 12)
                    c.drawString(ml, desc_y, description[:120])

                c.restoreState()

        self._story.append(SectionCover(self._page_w, self._page_h))
        self._story.append(PageBreak())

    # ------------------------------------------------------------------
    # Headings
    # ------------------------------------------------------------------

    def h1(self, text: str):
        self._story.append(Paragraph(text, self._styles["h1"]))
        self._story.append(Divider(color=self._brand["colors"]["accent"], thickness=2,
                                    margin_v=2))

    def h2(self, text: str):
        self._story.append(Paragraph(text, self._styles["h2"]))

    def h3(self, text: str):
        self._story.append(Paragraph(text, self._styles["h3"]))

    def h4(self, text: str):
        self._story.append(Paragraph(text, self._styles["h4"]))

    def section(self, title: str, level: int = 1):
        """Alias for heading — level 1–4."""
        {1: self.h1, 2: self.h2, 3: self.h3, 4: self.h4}.get(level, self.h1)(title)

    # ------------------------------------------------------------------
    # Body text
    # ------------------------------------------------------------------

    def body(self, text: str, muted: bool = False):
        style = self._styles["body_muted"] if muted else self._styles["body"]
        self._story.append(Paragraph(text, style))

    def small(self, text: str):
        self._story.append(Paragraph(text, self._styles["small"]))

    def caption(self, text: str):
        self._story.append(Paragraph(text, self._styles["caption"]))

    def code(self, text: str):
        self._story.append(Paragraph(text.replace("\n", "<br/>"), self._styles["code"]))

    # ------------------------------------------------------------------
    # Lists
    # ------------------------------------------------------------------

    def bullets(self, items: list, ordered: bool = False):
        list_items = [
            ListItem(
                Paragraph(item, self._styles["body"]),
                bulletColor=self.c["accent"],
                leftIndent=18, bulletIndent=0,
            )
            for item in items
        ]
        self._story.append(ListFlowable(
            list_items,
            bulletType="bullet" if not ordered else "1",
            leftIndent=18, spaceAfter=6,
        ))

    def numbered(self, items: list):
        self.bullets(items, ordered=True)

    # ------------------------------------------------------------------
    # Table
    # ------------------------------------------------------------------

    def table(self, headers: list, rows: list, col_widths: list = None,
               zebra: bool = True, caption: str = ""):
        """
        Branded data table.
        headers    : column header strings
        rows       : list of row lists
        col_widths : list of widths in points (auto-divided if None)
        zebra      : alternate row shading
        caption    : optional caption below table
        """
        b   = self._brand
        col = b["colors"]
        cw  = self._content_w

        if col_widths is None:
            w = cw / max(len(headers), 1)
            col_widths = [w] * len(headers)

        th_s = ParagraphStyle("TH",
            fontName="Faktum-Bold", fontSize=18,
            textColor=hex_to_rgb(col["text_white"]), leading=22)
        td_s = ParagraphStyle("TD",
            fontName="Faktum-Regular", fontSize=18,
            textColor=hex_to_rgb(col["text"]), leading=24)

        data = [[Paragraph(str(h), th_s) for h in headers]]
        for row in rows:
            data.append([Paragraph(str(cell), td_s) for cell in row])

        tbl = Table(data, colWidths=col_widths, repeatRows=1)
        tbl.setStyle(TableStyle([
            ("BACKGROUND",     (0, 0), (-1, 0),  self.c["primary"]),
            ("ROWBACKGROUNDS",  (0, 1), (-1, -1),
                [hex_to_rgb(col["surface"]), colors.white] if zebra else [colors.white]),
            ("INNERGRID",      (0, 0), (-1, -1),  0.4, self.c["border"]),
            ("BOX",            (0, 0), (-1, -1),  0.8, self.c["border"]),
            ("LEFTPADDING",    (0, 0), (-1, -1),  16),
            ("LEFTPADDING",    (0, 0), (0, -1),   20),   # first col extra
            ("RIGHTPADDING",   (0, 0), (-1, -1),  16),
            ("TOPPADDING",     (0, 0), (-1, -1),   8),
            ("BOTTOMPADDING",  (0, 0), (-1, -1),   8),
            ("VALIGN",         (0, 0), (-1, -1),  "MIDDLE"),
            ("LINEBELOW",      (0, 0), (-1, 0),   2, self.c["accent"]),
            ("ROUNDEDCORNERS", [16, 16, 16, 16]),
        ]))

        self._story.append(tbl)
        if caption:
            self._story.append(Spacer(1, 4))
            self.caption(caption)
        self._story.append(Spacer(1, 10))

    # ------------------------------------------------------------------
    # Stat / metric cards
    # ------------------------------------------------------------------

    def stats(self, items: list, columns: int = 1,
               section_num: str = "", section_title: str = "",
               body: str = ""):
        """
        Figma-spec stat block.

        items         : list of dicts — {value, unit, description}
                        e.g. [{"value": "14", "unit": "%", "description": "of UK professionals..."}]
        columns       : 1 (full width) or 2 (two stats side by side)
        section_num   : large thin decorative number, e.g. "01"
        section_title : bold section heading
        body          : optional body copy below the stat row
        """
        b   = self._brand
        col = b["colors"]
        cw  = self._content_w
        g   = self._gutter

        c_pink    = self.c["accent"]
        c_black   = self.c["primary"]
        c_text    = self.c["text"]
        c_light   = self.c["text_light"]

        # ── Section number ────────────────────────────────────────────
        if section_num:
            num_style = ParagraphStyle("StatSecNum",
                fontName="Faktum-Thin",
                fontSize=100,
                textColor=c_pink,
                leading=100,
                spaceAfter=6,
            )
            self._story.append(Paragraph(section_num, num_style))

        # ── Section title ─────────────────────────────────────────────
        if section_title:
            title_style = ParagraphStyle("StatSecTitle",
                fontName="Faktum-Bold",
                fontSize=18,
                textColor=c_black,
                leading=24,
                spaceAfter=14,
            )
            self._story.append(Paragraph(section_title, title_style))

        # ── Stat rows ─────────────────────────────────────────────────
        def build_stat_cell(item, cell_w):
            value = str(item.get("value", "—"))
            unit  = str(item.get("unit", ""))
            desc  = rich_to_rl(str(item.get("description", "")))

            # Value + unit inline (mixed sizes via XML markup in Paragraph)
            val_xml = (
                f'<font name="Faktum-Bold" size="60" color="#FF0077">{value}</font>'
                f'<font name="Faktum-Regular" size="40" color="#FF0077"> {unit}</font>'
            )
            val_style = ParagraphStyle("StatVal",
                fontName="Faktum-Bold", fontSize=60,
                textColor=c_pink, leading=68, spaceAfter=0, spaceBefore=0)
            val_para = Paragraph(val_xml, val_style)

            desc_style = ParagraphStyle("StatDesc",
                fontName="Faktum-Regular", fontSize=20,
                textColor=c_text, leading=28, spaceAfter=0, spaceBefore=0)
            desc_para = Paragraph(desc, desc_style)

            val_w  = 160
            gap_w  = 16
            desc_w = max(80, cell_w - val_w - gap_w)

            row_tbl = Table([[val_para, Spacer(gap_w, 1), desc_para]],
                            colWidths=[val_w, gap_w, desc_w])
            row_tbl.setStyle(TableStyle([
                ("VALIGN",        (0,0), (-1,-1), "MIDDLE"),
                ("LEFTPADDING",   (0,0), (-1,-1), 0),
                ("RIGHTPADDING",  (0,0), (-1,-1), 0),
                ("TOPPADDING",    (0,0), (-1,-1), 0),
                ("BOTTOMPADDING", (0,0), (-1,-1), 0),
            ]))
            return row_tbl

        if columns == 2 and len(items) >= 2:
            col_w = (cw - g) / 2
            left_cell  = build_stat_cell(items[0], col_w)
            right_cell = build_stat_cell(items[1], col_w)
            grid = Table([[left_cell, right_cell]], colWidths=[col_w, col_w])
            grid.setStyle(TableStyle([
                ("VALIGN",       (0,0), (-1,-1), "TOP"),
                ("LEFTPADDING",  (0,0), (-1,-1), 0),
                ("RIGHTPADDING", (0,0), (-1,-1), 0),
                ("TOPPADDING",   (0,0), (-1,-1), 0),
                ("BOTTOMPADDING",(0,0), (-1,-1), 0),
                ("RIGHTPADDING", (0,0), (0,-1),  g),
            ]))
            self._story.append(grid)
        else:
            for item in items:
                self._story.append(build_stat_cell(item, cw))

        # ── Body copy ─────────────────────────────────────────────────
        if body:
            body_style = ParagraphStyle("StatBody",
                fontName="Faktum-Regular", fontSize=11,
                textColor=c_text, leading=17,
                spaceBefore=12, spaceAfter=6)
            self._story.append(Paragraph(body, body_style))

        self._story.append(Spacer(1, 16))

    # ------------------------------------------------------------------
    # Stat cards — two independent full stat cards side by side
    # ------------------------------------------------------------------

    def stat_cards(self, left: dict, right: dict):
        """
        Two complete stat cards placed side by side, separated by a 1pt
        #CED9EB vertical rule. Each card has section_num, section_title,
        value, unit, description, and optional body copy.
        """
        b      = self._brand
        cw     = self._content_w
        g      = self._gutter
        c_pink = self.c["accent"]
        c_text = self.c["text"]
        c_black = self.c["primary"]
        divider_color = hex_to_rgb("#CED9EB")

        def build_card(card, card_w):
            """Build a list of flowables for one stat card."""
            flowables = []
            num   = str(card.get("section_num", ""))
            title = str(card.get("section_title", ""))
            body  = str(card.get("body", ""))

            if num:
                flowables.append(Paragraph(num, ParagraphStyle("SC_Num",
                    fontName="Faktum-Thin", fontSize=100, textColor=c_pink,
                    leading=100, spaceAfter=6)))

            if title:
                flowables.append(Paragraph(title, ParagraphStyle("SC_Title",
                    fontName="Faktum-Bold", fontSize=30, textColor=c_black,
                    leading=36, spaceAfter=12)))

            # Resolve items — new structure uses items[], legacy uses flat fields
            raw_items = card.get("items")
            if not raw_items:
                raw_items = [{
                    "value_type":  card.get("value_type", "stat"),
                    "value":       card.get("value", "—"),
                    "unit":        card.get("unit", ""),
                    "description": card.get("description", ""),
                    "icon":        card.get("icon", ""),
                }]

            val_w  = 125
            gap_w  = 10
            desc_w = 347

            for stat_item in raw_items:
                value_type  = str(stat_item.get("value_type", "stat"))
                icon_file   = str(stat_item.get("icon", ""))
                lucide_icon = str(stat_item.get("lucide_icon", ""))
                icon_png_b64 = str(stat_item.get("icon_png_b64", ""))
                value       = str(stat_item.get("value", "—"))
                unit        = str(stat_item.get("unit", ""))
                desc        = rich_to_rl(str(stat_item.get("description", "")))

                from reportlab.platypus import Image as RLImage

                if value_type == "icon" and icon_file:
                    icon_path = os.path.join(
                        os.path.dirname(os.path.abspath(__file__)),
                        "assets", "icons", "Icongraphy", "Icongraphy", icon_file
                    )
                    if os.path.exists(icon_path):
                        if icon_file.lower().endswith('.svg'):
                            try:
                                png_path, _, _ = _svg_to_png_temp(icon_path, val_w, val_w)
                                left_cell = RLImage(png_path, width=val_w, height=val_w)
                            except Exception:
                                try:
                                    from svglib.svglib import svg2rlg
                                    drawing = svg2rlg(icon_path)
                                    if drawing:
                                        s = min(val_w / drawing.width, val_w / drawing.height)
                                        drawing.width  = drawing.width  * s
                                        drawing.height = drawing.height * s
                                        drawing.transform = (s, 0, 0, s, 0, 0)
                                        left_cell = drawing
                                    else:
                                        left_cell = Spacer(val_w, val_w)
                                except Exception:
                                    left_cell = Spacer(val_w, val_w)
                        else:
                            left_cell = RLImage(icon_path, width=val_w, height=val_w)
                    else:
                        left_cell = Spacer(val_w, val_w)
                elif value_type == "lucide" and icon_png_b64:
                    # Base64 PNG from the frontend canvas renderer
                    import base64
                    try:
                        raw = icon_png_b64.split(",", 1)[-1]
                        png_bytes = base64.b64decode(raw)
                        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tf:
                            tf.write(png_bytes)
                            tmp_icon_path = tf.name
                        left_cell = RLImage(tmp_icon_path, width=val_w, height=val_w)
                        if not hasattr(self, '_tmp_files'):
                            self._tmp_files = []
                        self._tmp_files.append(tmp_icon_path)
                    except Exception:
                        left_cell = Spacer(val_w, val_w)
                else:
                    val_xml = (
                        f'<font name="Faktum-Bold" size="60" color="#FF0077">{value}</font>'
                        f'<font name="Faktum-Regular" size="40" color="#FF0077"> {unit}</font>'
                    )
                    left_cell = Paragraph(val_xml, ParagraphStyle("SC_Val",
                        fontName="Faktum-Bold", fontSize=60,
                        textColor=c_pink, leading=68, spaceAfter=0, spaceBefore=0))

                desc_para = Paragraph(desc, ParagraphStyle("SC_Desc",
                    fontName="Faktum-Regular", fontSize=20,
                    textColor=c_text, leading=28, spaceBefore=0))

                stat_row = Table([[left_cell, Spacer(gap_w, 1), desc_para]],
                                 colWidths=[val_w, gap_w, desc_w])
                stat_row.setStyle(TableStyle([
                    ("VALIGN",        (0,0), (-1,-1), "MIDDLE"),
                    ("LEFTPADDING",   (0,0), (-1,-1), 0),
                    ("RIGHTPADDING",  (0,0), (-1,-1), 0),
                    ("TOPPADDING",    (0,0), (-1,-1), 0),
                    ("BOTTOMPADDING", (0,0), (-1,-1), 0),
                ]))
                flowables.append(stat_row)
                # Consistent gap between rows AND before body copy
                flowables.append(Spacer(1, 10))

            if body:
                flowables.append(Paragraph(rich_to_rl(body), ParagraphStyle("SC_Body",
                    fontName="Faktum-Regular", fontSize=20, textColor=c_text,
                    leading=30, spaceBefore=0)))

            return flowables

        col_w     = (cw - 1) / 2   # equal halves, line exactly at page centre
        left_col  = build_card(left,  col_w)
        right_col = build_card(right, col_w)

        # Wrap each card's flowables in a KeepTogether inside a single-cell table
        # then place both in a two-column table with the divider line
        tbl = Table(
            [[left_col, Spacer(1, 1), right_col]],
            colWidths=[col_w, 1, col_w],
        )
        tbl.setStyle(TableStyle([
            ("VALIGN",        (0,0), (-1,-1), "TOP"),
            ("LEFTPADDING",   (0,0), (-1,-1), 0),
            ("RIGHTPADDING",  (0,0), (-1,-1), 0),
            ("TOPPADDING",    (0,0), (-1,-1), 0),
            ("BOTTOMPADDING", (0,0), (-1,-1), 0),
            ("RIGHTPADDING",  (0,0), (0,-1),  30),       # left col: wrap 30pt sooner
            ("LEFTPADDING",   (2,0), (2,-1),  g + 20),   # right col: 20pt extra from divider
            ("RIGHTPADDING",  (2,0), (2,-1),  30),       # right col: wrap 30pt sooner
            ("LINEAFTER",     (0,0), (0,-1),  1, divider_color),  # divider
        ]))
        self._story.append(tbl)
        self._story.append(Spacer(1, 16))

    # ------------------------------------------------------------------
    # Two-column layout
    # ------------------------------------------------------------------

    def two_columns(self, left: str, right: str):
        half = (self._content_w - self._gutter) / 2
        col_style = ParagraphStyle(
            "TwoColBody",
            fontName="Faktum",
            fontSize=18,
            leading=27,
            textColor=hex_to_rgb("#000000"),
            spaceAfter=0,
        )
        tbl = Table(
            [[Paragraph(left, col_style),
              Paragraph(right, col_style)]],
            colWidths=[half, half]
        )
        tbl.setStyle(TableStyle([
            ("VALIGN",       (0,0), (-1,-1), "TOP"),
            ("LEFTPADDING",  (0,0), (-1,-1), 0),
            ("RIGHTPADDING", (0,0), (-1,-1), 0),
            ("TOPPADDING",   (0,0), (-1,-1), 0),
            ("BOTTOMPADDING",(0,0), (-1,-1), 0),
            ("RIGHTPADDING", (0,0), (0,-1),  self._gutter),
        ]))
        self._story.append(tbl)
        self._story.append(Spacer(1, 8))

    # ------------------------------------------------------------------
    # Callout boxes
    # ------------------------------------------------------------------

    def callout(self, text: str, style: str = "info"):
        """
        Callout / highlight box.
        style: "info" | "success" | "warning" | "error" | "brand"
        """
        box = CalloutBox(text, style=style, width=self._content_w)
        self._story.append(box)
        self._story.append(Spacer(1, 8))

    # ------------------------------------------------------------------
    # Images
    # ------------------------------------------------------------------

    def image(self, path: str, width: float = None, caption: str = "",
               center: bool = True):
        max_w = self._content_w
        img_w = min(width or max_w, max_w)
        try:
            img = Image(path, width=img_w, kind="proportional")
            if center:
                img.hAlign = "CENTER"
            self._story.append(img)
        except Exception:
            self.callout(f"[Image not found: {path}]", style="warning")

        if caption:
            self._story.append(Spacer(1, 4))
            self.caption(caption)
        self._story.append(Spacer(1, 8))

    # ------------------------------------------------------------------
    # Data-viz colour helper
    # ------------------------------------------------------------------

    def data_viz_colors(self) -> list:
        """
        Return the GWI data viz palette in order (use for charts/graphs).
        Returns list of hex strings: Hot Pink, Violet, Black, Purple, Grey, Pink Light.
        """
        col = self._brand["colors"]
        return ["#FF0077", "#5461C8", "#000000", "#963CBD", "#ABB8CF", "#FF9FBD"]

    # ------------------------------------------------------------------
    # Layout utilities
    # ------------------------------------------------------------------

    def divider(self, thick: bool = False):
        self._story.append(Divider(
            color=self._brand["colors"]["border_light"],
            thickness=1.5 if thick else 0.5
        ))

    # ------------------------------------------------------------------
    # Infographic Hero block
    # ------------------------------------------------------------------

    def infographic_hero(self, accent: str = "", title: str = "", image: str = "", image_scale: float = 1.0):
        """
        Infographic hero: pink italic accent line + large bold black title on left,
        illustration image on right, GWI logo bottom-left, full-width rule at bottom.
        """
        cw       = self._content_w
        c_pink   = self.c["accent"]
        c_black  = colors.black

        logo_svg = os.path.join(
            os.path.dirname(os.path.abspath(__file__)),
            "assets", "gwi-logo.svg",
        )

        img_path = _resolve_image(image)

        # ── helpers ───────────────────────────────────────────────────────
        def _img_drawn_size(img_path, max_w):
            """Return (drawn_w, drawn_h) for an image constrained to max_w."""
            try:
                if img_path.lower().endswith('.svg'):
                    try:
                        import fitz
                        doc = fitz.open(img_path)
                        page = doc[0]
                        svg_w = page.rect.width or max_w
                        svg_h = page.rect.height or max_w
                        doc.close()
                        s = max_w / svg_w
                        return svg_w * s, svg_h * s
                    except Exception:
                        pass
                    from svglib.svglib import svg2rlg
                    d = svg2rlg(img_path)
                    if d:
                        s = max_w / d.width
                        return d.width * s, d.height * s
                else:
                    from reportlab.lib.utils import ImageReader
                    ir = ImageReader(img_path)
                    iw, ih = ir.getSize()
                    s = max_w / iw
                    return iw * s, ih * s
            except Exception:
                pass
            return max_w, max_w   # fallback square

        class IGHeroFlowable(Flowable):
            def __init__(inner, accent, title, cw, c_pink, logo_svg, img_path, img_scale):
                super().__init__()
                inner._accent    = accent
                inner._title     = title
                inner._cw        = cw
                inner._c_pink    = c_pink
                inner._logo_svg  = logo_svg
                inner._img_path  = img_path
                inner._img_scale = img_scale

            def wrap(inner, aw, ah):
                from reportlab.pdfbase import pdfmetrics as _pm
                inner.width = aw

                ACCENT_SIZE = 80
                TITLE_SIZE  = 80
                LEADING     = 88
                PAD_LEFT    = 0    # doc frame already provides 60pt left margin
                PAD_TOP     = 60
                LOGO_H      = 37
                LOGO_GAP    = 28   # minimum gap between last text line and logo
                LOGO_BOTTOM = 36   # space below logo centre to rule

                right_frac = min(0.70, 0.50 * (inner._img_scale or 1.0)) if inner._img_path else 0.0
                inner._right_frac = right_frac
                right_x    = aw * (1.0 - right_frac)
                right_w    = aw * right_frac
                left_w     = right_x - aw * 0.02
                text_limit = left_w - PAD_LEFT

                # Count wrapped lines to compute required text height
                line_count = 0
                if inner._accent:
                    line_count += 1
                for seg in (inner._title or "").split("\n"):
                    if not seg.strip():
                        continue
                    cur = []
                    for word in seg.split():
                        test = " ".join(cur + [word])
                        if _pm.stringWidth(test, "Faktum-Bold", TITLE_SIZE) <= text_limit:
                            cur.append(word)
                        else:
                            if cur:
                                line_count += 1
                            cur = [word]
                    if cur:
                        line_count += 1

                # Height needed for text block
                text_top_h = PAD_TOP + ACCENT_SIZE + max(0, line_count - 1) * LEADING
                text_block_h = text_top_h + LOGO_GAP + LOGO_H + LOGO_BOTTOM

                # Height needed for image (width-constrained, bottom-anchored at y=0)
                img_h = 0.0
                if inner._img_path:
                    _, img_h = _img_drawn_size(inner._img_path, right_w)
                inner._img_drawn_h = img_h

                inner.height = max(text_block_h, img_h + 10)
                return aw, inner.height

            def draw(inner):
                c = inner.canv
                w = inner.width
                h = inner.height

                right_frac = getattr(inner, '_right_frac',
                    min(0.70, 0.50 * (inner._img_scale or 1.0)) if inner._img_path else 0.0)
                right_x = w * (1.0 - right_frac)
                right_w = w * right_frac
                left_w  = right_x - w * 0.02

                ACCENT_SIZE = 80
                TITLE_SIZE  = 80
                LEADING     = 88
                PAD_LEFT    = 0    # doc frame already provides 60pt left margin
                PAD_TOP     = 60
                LOGO_W, LOGO_H = 120, 37

                # Draw image — bottom-anchored at y=0 so it grows upward like the preview
                if inner._img_path:
                    img_drawn_h = getattr(inner, '_img_drawn_h', 0.0)
                    if img_drawn_h <= 0:
                        _, img_drawn_h = _img_drawn_size(inner._img_path, right_w)
                    cx = right_x + right_w / 2
                    cy = img_drawn_h / 2   # bottom of image sits on the rule line
                    draw_image_scaled(c, inner._img_path, cx, cy,
                                      right_w, img_drawn_h * 1.01, 1.0)

                # Draw accent line (pink bold italic)
                y = h - PAD_TOP - ACCENT_SIZE
                if inner._accent:
                    c.setFont("Faktum-BoldItalic", ACCENT_SIZE)
                    c.setFillColor(inner._c_pink)
                    c.drawString(PAD_LEFT, y, inner._accent)
                    y -= LEADING

                # Draw title lines (black bold) — word-wrap to fit left column
                c.setFont("Faktum-Bold", TITLE_SIZE)
                c.setFillColor(c_black)
                for line in (inner._title or "").split("\n"):
                    if line.strip():
                        words = line.split()
                        cur_line = []
                        for word in words:
                            test = " ".join(cur_line + [word])
                            if c.stringWidth(test, "Faktum-Bold", TITLE_SIZE) <= left_w - PAD_LEFT:
                                cur_line.append(word)
                            else:
                                if cur_line:
                                    c.drawString(PAD_LEFT, y, " ".join(cur_line))
                                    y -= LEADING
                                cur_line = [word]
                        if cur_line:
                            c.drawString(PAD_LEFT, y, " ".join(cur_line))
                            y -= LEADING

                # GWI logo — placed safely below the last text line
                logo_bottom = LOGO_H / 2 + 20   # centre Y
                draw_image_scaled(c, inner._logo_svg,
                                  PAD_LEFT + LOGO_W / 2,
                                  logo_bottom,
                                  LOGO_W, LOGO_H, 1.0)

                # Full-width rule at bottom
                c.setStrokeColor(c_black)
                c.setLineWidth(2)
                c.line(0, 0, w, 0)

        self._story.append(IGHeroFlowable(accent, title, cw, c_pink, logo_svg, img_path, image_scale))

    # ------------------------------------------------------------------
    # Infographic Stats Grid block
    # ------------------------------------------------------------------

    def ig_stats(self, columns: int = 3, items: list = None):
        """
        Infographic stat grid: 2 or 3 equal columns with vertical grey dividers.
        Each stat cell has optional pink bold eyebrow, large pink light value, black description.
        """
        if items is None:
            items = []
        cw     = self._content_w
        c_pink = self.c["accent"]

        class IGStatsFlowable(Flowable):
            def __init__(inner, columns, items, cw, c_pink):
                super().__init__()
                inner._columns = max(2, min(3, columns))
                inner._items   = items
                inner._cw      = cw
                inner._c_pink  = c_pink

            def wrap(inner, aw, ah):
                inner.width = aw
                cols  = inner._columns
                n     = len(inner._items)
                rows  = max(1, -(-n // cols))   # ceiling division
                # Cell height: eyebrow(optional) + value + desc + vertical padding
                CELL_H = 260
                inner.height = rows * CELL_H
                inner._cell_h = CELL_H
                return aw, inner.height

            def draw(inner):
                c    = inner.canv
                w    = inner.width
                cols = inner._columns
                col_w = w / cols
                items = inner._items
                n     = len(items)
                rows  = max(1, -(-n // cols))
                cell_h = inner._cell_h

                EYEBROW_SIZE = 22
                if cols == 2:
                    VALUE_SIZE = 110
                elif rows >= 2:
                    VALUE_SIZE = 68
                else:
                    VALUE_SIZE = 88
                UNIT_SIZE    = int(VALUE_SIZE * 0.45)
                DESC_SIZE    = 18 if rows >= 2 else 20
                PAD_L        = 36
                PAD_T        = 28 if rows >= 2 else 32
                GREY         = colors.HexColor("#E5E7EB")
                GREY_DARK    = colors.HexColor("#000000")
                C_PINK       = inner._c_pink


                for idx, item in enumerate(items):
                    row = idx // cols
                    col = idx % cols

                    x = col * col_w
                    # y=0 is bottom; rows drawn top→bottom means row 0 is at the top
                    y = (rows - row - 1) * cell_h

                    # Horizontal divider (below each row except the last)
                    if row < rows - 1:
                        c.setStrokeColor(GREY)
                        c.setLineWidth(0.5)
                        c.line(x, y, x + col_w, y)

                    # Vertical divider (right edge of each col except last)
                    if col < cols - 1:
                        c.setStrokeColor(GREY)
                        c.setLineWidth(0.5)
                        c.line(x + col_w, y, x + col_w, y + cell_h)

                    # Content — draw from top of cell down
                    text_y = y + cell_h - PAD_T

                    # Eyebrow
                    if item.get("stat_type") == "eyebrow" and item.get("eyebrow"):
                        c.setFont("Faktum-Bold", EYEBROW_SIZE)
                        c.setFillColor(inner._c_pink)
                        c.drawString(x + PAD_L, text_y - EYEBROW_SIZE, item["eyebrow"])
                        text_y -= EYEBROW_SIZE + 6

                    # Value + unit
                    val  = str(item.get("value", ""))
                    unit = str(item.get("unit", ""))
                    c.setFont("Faktum-Light", VALUE_SIZE)
                    c.setFillColor(inner._c_pink)
                    val_w = c.stringWidth(val, "Faktum-Light", VALUE_SIZE)
                    c.drawString(x + PAD_L, text_y - VALUE_SIZE, val)
                    if unit:
                        c.setFont("Faktum-Light", UNIT_SIZE)
                        c.drawString(x + PAD_L + val_w + 2, text_y - UNIT_SIZE - 4, unit)
                    text_y -= VALUE_SIZE + 14

                    # Description — strip HTML tags (canvas can't render inline markup)
                    desc = re.sub(r'<[^>]+>', '', str(item.get("description", "")))
                    desc = desc.replace('&amp;', '&').replace('&nbsp;', ' ').replace('&lt;', '<').replace('&gt;', '>').strip()
                    if desc:
                        max_desc_w = col_w - PAD_L * 2
                        c.setFont("Faktum-Regular", DESC_SIZE)
                        c.setFillColor(GREY_DARK)
                        words, line, lines_out = desc.split(), [], []
                        for word in words:
                            test = " ".join(line + [word])
                            if c.stringWidth(test, "Faktum-Regular", DESC_SIZE) < max_desc_w:
                                line.append(word)
                            else:
                                lines_out.append(" ".join(line))
                                line = [word]
                        if line:
                            lines_out.append(" ".join(line))
                        for dl in lines_out:
                            if text_y - DESC_SIZE < y:
                                break
                            c.drawString(x + PAD_L, text_y - DESC_SIZE, dl)
                            text_y -= DESC_SIZE + 4

        self._story.append(IGStatsFlowable(columns, items, cw, c_pink))

    # ------------------------------------------------------------------
    # ABX Header block
    # ------------------------------------------------------------------

    def abx_header(self, title: str = "", descriptor: str = "", image: str = "", image_scale: float = 1.0, image_wrap: float = None):
        """
        Full-width ABX-style section header:
          - Large bold black title
          - Hot-pink rounded band with white descriptor + GWI logo
          - Optional illustration image in the right column
        """
        b       = self._brand
        layout  = b["layout"]
        cw      = self._content_w
        c_pink  = self.c["accent"]
        c_white = self.c["text_white"]

        # Use all-white mono logo for the pink band (pink dot would vanish on path_on_dark)
        logo_svg = os.path.join(
            os.path.dirname(os.path.abspath(__file__)),
            b["logo"].get("path_mono", b["logo"]["path_on_dark"]),
        )
        logo_w, logo_h = 143, 44

        img_path = _resolve_image(image)

        class ABXHeaderFlowable(Flowable):
            def __init__(inner, title, descriptor, cw, c_pink, c_white,
                         logo_svg, logo_w, logo_h, img_path, img_scale, img_wrap):
                super().__init__()
                inner._title      = title
                inner._descriptor = descriptor
                inner._cw         = cw
                inner._c_pink     = c_pink
                inner._c_white    = c_white
                inner._logo_svg   = logo_svg
                inner._logo_w     = logo_w
                inner._logo_h     = logo_h
                inner._img_path   = img_path
                inner._img_scale  = img_scale
                inner._img_wrap   = img_wrap  # 0.3 (most image) → 1.3 (widest text)

            def wrap(inner, aw, ah):
                inner.width   = aw
                TITLE_FONT    = "Faktum-ExtraBold"   # CSS uses font-weight:800
                TITLE_SIZE    = 80
                TITLE_LEADING = 88
                DESC_SIZE     = 30
                # Column split: mirrors the canvas padding-right formula exactly.
                # Canvas: _imgH = 420 * image_scale, _pad = _imgH * (1.6 - image_wrap)
                # Canvas content_w = page_width(1200) - margin_left(60) - margin_right(60) = 1080
                # right_frac = _pad / content_w = (420/1080) * image_scale * (1.6 - image_wrap)
                if inner._img_path:
                    if inner._img_wrap is not None:
                        img_scale = inner._img_scale or 1.0
                        img_wrap  = inner._img_wrap
                        right_frac = max(0.10, min(0.65,
                            (420.0 / 1080.0) * img_scale * (1.6 - img_wrap)
                        ))
                    else:
                        right_frac = min(0.58, 0.40 * (inner._img_scale or 1.0))
                else:
                    right_frac = 0.0
                inner._right_frac = right_frac
                text_w = aw * (1.0 - right_frac) if inner._img_path else aw
                from reportlab.pdfbase.pdfmetrics import stringWidth
                words = inner._title.split()
                line, lines_out = [], []
                for word in words:
                    test = " ".join(line + [word])
                    if stringWidth(test, TITLE_FONT, TITLE_SIZE) < text_w:
                        line.append(word)
                    else:
                        lines_out.append(" ".join(line))
                        line = [word]
                if line:
                    lines_out.append(" ".join(line))
                title_lines = max(1, len(lines_out))
                inner._title_h = title_lines * TITLE_LEADING

                # Count wrapped descriptor lines to size band correctly
                DESC_PAD_LEFT = 40
                max_desc_w = text_w - DESC_PAD_LEFT - 20
                dwords = (inner._descriptor or '').split()
                dline, dlines = [], []
                for word in dwords:
                    test = " ".join(dline + [word])
                    if stringWidth(test, "Faktum-Regular", DESC_SIZE) < max_desc_w:
                        dline.append(word)
                    else:
                        dlines.append(" ".join(dline))
                        dline = [word]
                if dline:
                    dlines.append(" ".join(dline))
                desc_line_count = max(1, len(dlines))
                desc_h = desc_line_count * (DESC_SIZE + 6)

                # band: 40px top + desc height + 60px gap + 44px logo + 40px bottom
                inner._band_h  = 40 + desc_h + 60 + 44 + 40
                # total: title + 40px margin + band
                inner.height   = inner._title_h + 40 + inner._band_h
                return aw, inner.height

            def draw(inner):
                c   = inner.canv
                w   = inner.width
                th  = inner._title_h
                bh  = inner._band_h
                has_img    = bool(inner._img_path)
                right_frac = getattr(inner, '_right_frac', 0.0)
                img_x      = w * (1.0 - right_frac)
                img_w      = w * right_frac
                text_w     = w * (1.0 - right_frac) if has_img else w

                # Spacing constants matching CSS (px = pt 1:1)
                TITLE_MARGIN_BOTTOM = 40
                DESC_SIZE           = 30
                DESC_PAD_TOP        = 40
                DESC_PAD_LEFT       = 40
                DESC_MARGIN_BOTTOM  = 60
                LOGO_PAD_LEFT       = 40
                LOGO_PAD_BOTTOM     = 40

                # --- Pink band — always full width ---
                band_y = 0
                c.setFillColor(inner._c_pink)
                c.roundRect(0, band_y, w, bh, 16, fill=1, stroke=0)

                # GWI logo — bottom-left with 40px left & bottom padding
                try:
                    logo_d = build_logo_drawing(inner._logo_svg, inner._logo_w, inner._logo_h)
                    renderPDF.draw(logo_d, c, LOGO_PAD_LEFT, band_y + LOGO_PAD_BOTTOM)
                except Exception:
                    c.setFont("Faktum-Bold", DESC_SIZE)
                    c.setFillColor(colors.white)
                    c.drawString(LOGO_PAD_LEFT, band_y + LOGO_PAD_BOTTOM, "GWI.")

                # Descriptor text — 40px from top of band, 40px left, 60px above logo
                if inner._descriptor:
                    c.setFillColor(colors.white)
                    c.setFont("Faktum-Regular", DESC_SIZE)
                    dwords = inner._descriptor.split()
                    dline, dlines = [], []
                    max_dw = text_w - DESC_PAD_LEFT - 20
                    for word in dwords:
                        test = " ".join(dline + [word])
                        if c.stringWidth(test, "Faktum-Regular", DESC_SIZE) < max_dw:
                            dline.append(word)
                        else:
                            dlines.append(" ".join(dline))
                            dline = [word]
                    if dline:
                        dlines.append(" ".join(dline))
                    # Start from top of band minus top padding
                    dy = bh - DESC_PAD_TOP - DESC_SIZE
                    for dl in dlines:
                        c.drawString(DESC_PAD_LEFT, dy, dl)
                        dy -= DESC_SIZE + 6

                # --- Title (80pt extra-bold) — 40px margin below title before band ---
                TITLE_FONT    = "Faktum-ExtraBold"   # CSS uses font-weight:800
                TITLE_SIZE    = 80
                TITLE_LEADING = 88
                c.setFont(TITLE_FONT, TITLE_SIZE)
                c.setFillColor(colors.black)
                words = inner._title.split()
                line, lines_out = [], []
                for word in words:
                    test = " ".join(line + [word])
                    if c.stringWidth(test, TITLE_FONT, TITLE_SIZE) < text_w:
                        line.append(word)
                    else:
                        lines_out.append(" ".join(line))
                        line = [word]
                if line:
                    lines_out.append(" ".join(line))
                # Title sits above band; bottom of title is bh + TITLE_MARGIN_BOTTOM
                y = bh + TITLE_MARGIN_BOTTOM + (len(lines_out) - 1) * TITLE_LEADING + TITLE_SIZE
                for ln in lines_out:
                    c.drawString(0, y - TITLE_SIZE, ln)
                    y -= TITLE_LEADING

                # --- Illustration image — fills the right column exactly ---
                if has_img:
                    cx = img_x + img_w / 2
                    cy = inner.height / 2
                    draw_image_scaled(c, inner._img_path, cx, cy,
                                      img_w, inner.height, 1.0)

        self._story.append(Spacer(1, 6))
        self._story.append(ABXHeaderFlowable(
            title, descriptor, cw, c_pink, c_white,
            logo_svg, logo_w, logo_h, img_path, image_scale, image_wrap,
        ))
        self._story.append(Spacer(1, 16))

    # ------------------------------------------------------------------
    # Card wrapping
    # ------------------------------------------------------------------

    def begin_card(self, border_color: str = '', bg_color: str = '#FFFFFF'):
        """Start capturing flowables to be wrapped in a bordered card."""
        if not hasattr(self, '_card_stack'):
            self._card_stack = []
        self._card_stack.append({
            'story': self._story,
            'border_color': border_color,
            'bg_color': bg_color,
        })
        self._story = []

    def end_card(self):
        """Close the card, wrapping captured flowables in a styled table."""
        if not hasattr(self, '_card_stack') or not self._card_stack:
            return
        info   = self._card_stack.pop()
        inner  = self._story
        self._story = info['story']
        if not inner:
            return
        try:
            bg_c = hex_to_rgb(info['bg_color'])
        except Exception:
            bg_c = colors.white
        border_color = info['border_color']
        style_cmds = [
            ('BACKGROUND',    (0, 0), (-1, -1), bg_c),
            ('LEFTPADDING',   (0, 0), (-1, -1), 14),
            ('RIGHTPADDING',  (0, 0), (-1, -1), 14),
            ('TOPPADDING',    (0, 0), (-1, -1), 12),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 12),
        ]
        if border_color:
            style_cmds.append(('BOX', (0, 0), (-1, -1), 1.5, hex_to_rgb(border_color)))
        t = Table([[inner]], colWidths=[self._content_w])
        t.setStyle(TableStyle(style_cmds))
        self._story.append(Spacer(1, 4))
        self._story.append(t)
        self._story.append(Spacer(1, 4))

    def footer(self, text: str = "", button_label: str = "Discover more", button_url: str = ""):
        """Full-width black footer with centred white text and a green CTA button."""
        cw = self._content_w

        text_style = ParagraphStyle(
            "FooterText",
            fontName="Faktum-Medium",
            fontSize=26,
            leading=36,
            textColor=colors.white,
            alignment=1,
            spaceAfter=0,
        )
        btn_label_style = ParagraphStyle(
            "FooterBtn",
            fontName="Faktum-Bold",
            fontSize=20,
            leading=26,
            textColor=colors.black,
            alignment=1,
        )

        # Plain text — split on newlines and join with <br/>
        safe_text = _html_mod.escape(text.replace("\r\n", "\n").replace("\r", "\n")).replace("\n", "<br/>")
        text_para = Paragraph(safe_text, text_style)

        # Button label — wrap in a clickable link if URL provided
        safe_label = _html_mod.escape(button_label)
        if button_url:
            safe_url = _html_mod.escape(button_url, quote=True)
            btn_content = f'<link href="{safe_url}"><font color="#000000">{safe_label}</font></link>'
        else:
            btn_content = safe_label
        btn_para = Paragraph(btn_content, btn_label_style)

        # Green button cell
        btn_table = Table([[btn_para]], colWidths=[220])
        btn_table.setStyle(TableStyle([
            ("BACKGROUND",     (0, 0), (-1, -1), colors.HexColor("#00FF88")),
            ("ALIGN",          (0, 0), (-1, -1), "CENTER"),
            ("VALIGN",         (0, 0), (-1, -1), "MIDDLE"),
            ("TOPPADDING",     (0, 0), (-1, -1), 14),
            ("BOTTOMPADDING",  (0, 0), (-1, -1), 14),
            ("LEFTPADDING",    (0, 0), (-1, -1), 28),
            ("RIGHTPADDING",   (0, 0), (-1, -1), 28),
        ]))

        # Inner content table (no background — drawn by the Flowable wrapper)
        inner_tbl = Table(
            [[text_para], [btn_table]],
            colWidths=[cw],
        )
        inner_tbl.setStyle(TableStyle([
            ("ALIGN",         (0, 0), (-1, -1), "CENTER"),
            ("VALIGN",        (0, 0), (-1, -1), "MIDDLE"),
            ("TOPPADDING",    (0, 0), (0,  0),  40),
            ("BOTTOMPADDING", (0, 0), (0,  0),  16),
            ("TOPPADDING",    (0, 1), (0,  1),  0),
            ("BOTTOMPADDING", (0, 1), (0,  1),  40),
            ("LEFTPADDING",   (0, 0), (-1, -1), 0),
            ("RIGHTPADDING",  (0, 0), (-1, -1), 0),
        ]))

        # Custom Flowable: draws a rounded-rect black background, then the table on top
        class RoundedFooter(Flowable):
            def __init__(self, tbl, width, radius=16):
                Flowable.__init__(self)
                self._tbl   = tbl
                self.width  = width
                self._r     = radius
                self._h     = 0

            def wrap(self, aw, ah):
                w, h = self._tbl.wrap(aw, ah)
                self._h = h
                self.height = h
                return w, h

            def draw(self):
                c = self.canv
                c.saveState()
                c.setFillColor(colors.black)
                c.roundRect(0, 0, self.width, self._h, self._r, fill=1, stroke=0)
                c.restoreState()
                self._tbl.canv = c
                self._tbl.drawOn(c, 0, 0)

        self._story.append(Spacer(1, 60))   # 60pt gap above the footer box
        self._story.append(RoundedFooter(inner_tbl, cw, radius=16))

    def space(self, height: float = 12):
        self._story.append(Spacer(1, height))

    def page_break(self):
        self._story.append(PageBreak())

    def keep_together(self, fn, *args, **kwargs):
        """Prevent a block from splitting across pages."""
        old = self._story
        self._story = []
        fn(*args, **kwargs)
        block = self._story
        self._story = old
        self._story.append(KeepTogether(block))

    # ------------------------------------------------------------------
    # Build
    # ------------------------------------------------------------------

    def build(self) -> str:
        """
        Build a single continuous-scroll canvas PDF — no page breaks, no header/footer.

        Strategy:
          Pass 1 — measure: build the story into a BytesIO buffer using a very tall
                   scratch page so all content lands on ONE page and we get its real
                   height from doc.frame.y2.
          Pass 2 — render: build to the real file with height = measured content height
                   + top/bottom margins, as a single page.
        """
        import io, copy

        layout  = self._layout
        ml, mr  = layout["margin_left"],  layout["margin_right"]
        mt, mb  = layout["margin_top"],   layout["margin_bottom"]
        page_w  = self._page_w
        cw      = self._content_w

        # Strip any explicit PageBreak flowables — we never want page splits
        clean_story = [f for f in self._story if not isinstance(f, PageBreak)]

        # Deep-copy before pass 1 consumes the flowables
        story_pass2 = copy.deepcopy(clean_story)

        # ── Pass 1: measure total content height ───────────────────────────
        SCRATCH_H = 100_000   # tall enough for any report
        buf = io.BytesIO()

        class _MeasureDoc(BaseDocTemplate):
            """BaseDocTemplate subclass that records the lowest y reached."""
            def __init__(self, *a, **kw):
                super().__init__(*a, **kw)
                self._lowest_y = SCRATCH_H

            def afterFlowable(self, flowable):
                try:
                    y = self.frame._y
                    if y < self._lowest_y:
                        self._lowest_y = y
                except AttributeError:
                    pass

        measure_doc = _MeasureDoc(
            buf,
            pagesize=(page_w, SCRATCH_H),
            leftMargin=ml, rightMargin=mr,
            topMargin=mt, bottomMargin=0,
        )
        f_measure = Frame(ml, 0, cw, SCRATCH_H - mt, id="main",
                          leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
        measure_doc.addPageTemplates([
            PageTemplate(id="main", frames=[f_measure])
        ])
        measure_doc.build(clean_story)

        content_h = (SCRATCH_H - mt) - measure_doc._lowest_y
        total_h   = content_h + mt + mb

        # ── Pass 2: render to real file as one tall page ───────────────────
        real_doc = BaseDocTemplate(
            self.output_path,
            pagesize=(page_w, total_h),
            title=self._doc.title,
            author=self._doc.author,
            subject=getattr(self._doc, 'subject', ''),
            leftMargin=ml, rightMargin=mr,
            topMargin=mt, bottomMargin=mb,
        )
        f_real = Frame(ml, mb, cw, total_h - mt - mb, id="main",
                       leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
        real_doc.addPageTemplates([
            PageTemplate(id="main", frames=[f_real])
        ])
        real_doc.build(story_pass2)

        # Clean up any temp icon files created for Lucide icons
        for p in getattr(self, '_tmp_files', []):
            try:
                os.unlink(p)
            except Exception:
                pass

        print(f"✓ PDF saved: {self.output_path} "
              f"({page_w:.0f}×{total_h:.0f}px, 1 page)")
        return self.output_path
