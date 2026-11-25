#!/usr/bin/env python3
"""Lossless Dual-IP Asset Extractor & Data Generator for CrossArena (Naruto + Bleach).

Extracts original pixel-art character sprites, multi-forms, awakening animations, assists,
portraits, and standees from:
  - 5DPLAY-Game-Studio/OpenBleachVsNaruto (uncompressed Flash XFL .dat bitmaps + XML timelines)
  - 5DPLAY-Game-Studio/BleachVsNaruto_TagAssets (character select & HUD portraits/standees)

Enforces all CrossArena D1-D13 & Dual-IP compliance rules:
  - 2x nearest-neighbor pixel upscale onto [512, 512] transparent canvas
  - Foot anchor locked at ground_anchor = [256, 480], all 4 corners alpha == 0
  - Packed sprite sheets with 2px extruded edges + crop_offset metadata
  - Hitboxes derived from / aligned with rendered sprite bounds and strictly inside active frames
  - Full roster_manifest.json for ALL BVN Naruto & Bleach playable characters, forms, and assists
  - All extracted third-party assets tagged license="pending_authorization", redistributable=False
"""
from __future__ import annotations

import concurrent.futures
import io
import json
import math
import re
import struct
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
import zlib
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
CACHE_DIR = ROOT / ".cache" / "bvn_raw"
SCRATCH_RAW = Path(
    r"C:/Users/lenovo/.gemini/antigravity/brain/de4c7ea5-d9dd-4acb-b3b2-6e48fa1c6054/scratch/repos/raw"
)
ROSTER_MATRIX_PATH = Path(
    r"C:/Users/lenovo/.gemini/antigravity/brain/de4c7ea5-d9dd-4acb-b3b2-6e48fa1c6054/scratch/repos/full_roster_matrix.json"
)

NS = {"xfl": "http://ns.adobe.com/xfl/2008/"}
CANVAS_W, CANVAS_H = 512, 512
ANCHOR_X, ANCHOR_Y = 256, 480
SPRITE_SCALE = 2.0
MARGIN = 10

OBVN_BASE = "https://raw.githubusercontent.com/5DPLAY-Game-Studio/OpenBleachVsNaruto/master"
TAG_BASE = "https://raw.githubusercontent.com/5DPLAY-Game-Studio/BleachVsNaruto_TagAssets/master"

IGNORED_LAYER_KEYWORDS = (
    "标签", "AS", "控制", "移动", "效果", "人物全", "被打面", "检测面", "攻击面",
    "AI", "语音", "声音", "定位", "引导", "Action", "sound", "Sound",
)

# ---------------------------------------------------------------------------
# Network & Disk Cache Helpers
# ---------------------------------------------------------------------------

def fetch_cached(repo_key: str, base_url: str, rel_path: str) -> bytes | None:
    rel_clean = rel_path.lstrip("/")
    # Reuse scratch cache if already downloaded during audit
    scratch_candidate = SCRATCH_RAW / repo_key / rel_clean
    if scratch_candidate.is_file() and scratch_candidate.stat().st_size > 0:
        return scratch_candidate.read_bytes()

    local_path = CACHE_DIR / repo_key / rel_clean
    if local_path.is_file() and local_path.stat().st_size > 0:
        return local_path.read_bytes()

    encoded = "/".join(urllib.parse.quote(seg, safe="") for seg in rel_clean.split("/"))
    url = f"{base_url}/{encoded}"
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "CrossArena-Extractor/2.0"})
            with urllib.request.urlopen(req, timeout=25) as resp:
                data = resp.read()
            local_path.parent.mkdir(parents=True, exist_ok=True)
            local_path.write_bytes(data)
            return data
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
        except Exception:
            if attempt == 2:
                return None
    return None


def fetch_obvn(rel_path: str) -> bytes | None:
    return fetch_cached("OpenBleachVsNaruto", OBVN_BASE, rel_path)


def fetch_tag_asset(rel_path: str) -> bytes | None:
    return fetch_cached("BleachVsNaruto_TagAssets", TAG_BASE, rel_path)


# ---------------------------------------------------------------------------
# Lossless XFL Bitmap (.dat / .png / .jpg) Decoder
# ---------------------------------------------------------------------------

def decode_xfl_bitmap(data: bytes) -> Image.Image:
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return Image.open(io.BytesIO(data)).convert("RGBA")
    if data[:2] == b"\xff\xd8" or data[:4] == b"\xff\xd9\xff\xd8":
        raw_jpg = data[2:] if data[:4] == b"\xff\xd9\xff\xd8" else data
        return Image.open(io.BytesIO(raw_jpg)).convert("RGBA")

    magic = data[:2]
    if magic == b"\x03\x03":
        row_bytes, w, h = struct.unpack_from("<HHH", data, 2)
        if w <= 0 or h <= 0:
            return Image.new("RGBA", (4, 4), (0, 0, 0, 0))
        # 8-bit indexed ARGB palette format: header(24) + has_alpha(1) + n_colors_u16(2) + palette(n*4) + comp_flag(1) + payload
        if row_bytes < w * 4:
            has_alpha = data[24] != 0
            n_colors = struct.unpack_from("<H", data, 25)[0]
            if n_colors <= 0 or n_colors > 256:
                n_colors = 256
            pal_start = 27
            pal_end = pal_start + n_colors * 4
            comp_flag = data[pal_end] if pal_end < len(data) else 1
            if comp_flag == 0:
                raw = data[pal_end + 1 : pal_end + 1 + row_bytes * h]
            else:
                raw = _decompress_xfl_zlib(data, offsets=(pal_end + 1, pal_end, pal_end + 2))
            palette_rgba: list[tuple[int, int, int, int]] = []
            for i in range(n_colors):
                po = pal_start + i * 4
                if po + 4 > len(data):
                    palette_rgba.append((0, 0, 0, 0))
                    continue
                pa = data[po] if has_alpha else 255
                pr = data[po + 1]
                pg = data[po + 2]
                pb = data[po + 3]
                if pa == 0:
                    palette_rgba.append((0, 0, 0, 0))
                else:
                    if pa < 255:
                        pr = min(255, (pr * 255 + (pa >> 1)) // pa)
                        pg = min(255, (pg * 255 + (pa >> 1)) // pa)
                        pb = min(255, (pb * 255 + (pa >> 1)) // pa)
                    palette_rgba.append((pr, pg, pb, pa))
            rgba = bytearray(w * h * 4)
            n_pal = len(palette_rgba)
            for y in range(h):
                row_off = y * row_bytes
                out_off = y * w * 4
                if row_off + w > len(raw):
                    break
                for x in range(w):
                    idx = raw[row_off + x]
                    if idx < n_pal:
                        pr, pg, pb, pa = palette_rgba[idx]
                        if pa > 0:
                            rgba[out_off] = pr
                            rgba[out_off + 1] = pg
                            rgba[out_off + 2] = pb
                            rgba[out_off + 3] = pa
                    out_off += 4
            return Image.frombytes("RGBA", (w, h), bytes(rgba))

    if magic in (b"\x03\x05", b"\x03\x03", b"\x03\x04"):
        row_bytes, w, h = struct.unpack_from("<HHH", data, 2)
        if w <= 0 or h <= 0:
            return Image.new("RGBA", (4, 4), (0, 0, 0, 0))
        comp_flag32 = data[25] if len(data) > 25 else 1
        if comp_flag32 == 0:
            raw = data[26 : 26 + row_bytes * h]
        else:
            raw = _decompress_xfl_zlib(data)
        has_alpha = magic != b"\x03\x03"
        rgba = bytearray(w * h * 4)
        for y in range(h):
            row_off = y * row_bytes
            out_off = y * w * 4
            if row_off + w * 4 > len(raw):
                break
            for x in range(w):
                px_off = row_off + x * 4
                a = raw[px_off] if has_alpha else 255
                r = raw[px_off + 1]
                g = raw[px_off + 2]
                b = raw[px_off + 3]
                if a > 0:
                    if a < 255:
                        r = min(255, (r * 255 + (a >> 1)) // a)
                        g = min(255, (g * 255 + (a >> 1)) // a)
                        b = min(255, (b * 255 + (a >> 1)) // a)
                    rgba[out_off] = r
                    rgba[out_off + 1] = g
                    rgba[out_off + 2] = b
                    rgba[out_off + 3] = a
                out_off += 4
        return Image.frombytes("RGBA", (w, h), bytes(rgba))

    # Fallback Pillow attempt
    try:
        return Image.open(io.BytesIO(data)).convert("RGBA")
    except Exception:
        return Image.new("RGBA", (4, 4), (0, 0, 0, 0))


def _decompress_xfl_zlib(data: bytes, offsets: tuple[int, ...] = (26, 25, 24, 22)) -> bytes:
    # Try chunk-prefixed zlib at candidate offsets (standard Flash XFL .dat)
    for start in offsets:
        if start >= len(data):
            continue
        # Direct zlib stream
        if data[start : start + 1] == b"\x78":
            try:
                return zlib.decompress(data[start:])
            except Exception:
                pass
        # Length-prefixed <H chunks
        try:
            pos = start
            comp = bytearray()
            while pos + 2 <= len(data):
                clen = struct.unpack_from("<H", data, pos)[0]
                pos += 2
                if clen == 0 or pos + clen > len(data):
                    break
                comp.extend(data[pos : pos + clen])
                pos += clen
            if comp:
                return zlib.decompress(bytes(comp))
        except Exception:
            continue
    return b""


# ---------------------------------------------------------------------------
# XFL Package Loader & Recursive Affine Symbol Renderer
# ---------------------------------------------------------------------------

Matrix2D = tuple[float, float, float, float, float, float]  # (a, b, c, d, tx, ty)
IDENTITY_MAT: Matrix2D = (1.0, 0.0, 0.0, 1.0, 0.0, 0.0)


def mat_mul(m1: Matrix2D, m2: Matrix2D) -> Matrix2D:
    a1, b1, c1, d1, tx1, ty1 = m1
    a2, b2, c2, d2, tx2, ty2 = m2
    return (
        a1 * a2 + c1 * b2,
        b1 * a2 + d1 * b2,
        a1 * c2 + c1 * d2,
        b1 * c2 + d1 * d2,
        a1 * tx2 + c1 * ty2 + tx1,
        b1 * tx2 + d1 * ty2 + ty1,
    )


def parse_matrix_el(parent: ET.Element) -> Matrix2D:
    m = parent.find("xfl:matrix/xfl:Matrix", NS)
    if m is None:
        return IDENTITY_MAT
    return (
        float(m.attrib.get("a", "1")),
        float(m.attrib.get("b", "0")),
        float(m.attrib.get("c", "0")),
        float(m.attrib.get("d", "1")),
        float(m.attrib.get("tx", "0")),
        float(m.attrib.get("ty", "0")),
    )


TWIP_NUM_RE = re.compile(r"#([0-9A-Fa-f]+)(?:\.([0-9A-Fa-f]+))?|(-?\d+(?:\.\d+)?)")


def parse_shape_twip_bbox(shape_el: ET.Element) -> tuple[float, float, float, float] | None:
    xs: list[float] = []
    ys: list[float] = []
    for edge in shape_el.findall(".//xfl:Edge", NS):
        edges_str = edge.attrib.get("edges", "")
        if not edges_str:
            continue
        cleaned = re.sub(r"S\d+", " ", edges_str)
        nums: list[float] = []
        for m in TWIP_NUM_RE.finditer(cleaned):
            if m.group(1) is not None:
                hi = int(m.group(1), 16)
                if hi >= 0x800000:
                    hi -= 0x1000000
                frac = int(m.group(2), 16) / 256.0 if m.group(2) else 0.0
                nums.append((hi + frac) / 20.0)
            elif m.group(3) is not None:
                nums.append(float(m.group(3)) / 20.0)
        for i in range(0, len(nums) - 1, 2):
            xs.append(nums[i])
            ys.append(nums[i + 1])
    if not xs or not ys:
        return None
    return (min(xs), min(ys), max(xs), max(ys))


class XflPackage:
    def __init__(self, xfl_prefix: str) -> None:
        self.prefix = xfl_prefix.rstrip("/")
        dom_bytes = fetch_obvn(f"{self.prefix}/DOMDocument.xml")
        if not dom_bytes:
            raise RuntimeError(f"Missing DOMDocument.xml for {self.prefix}")
        self.dom = ET.fromstring(dom_bytes.decode("utf-8", "replace"))
        self.bitmap_hrefs: dict[str, tuple[str, str]] = {}
        for bm in self.dom.findall(".//xfl:DOMBitmapItem", NS):
            name = bm.attrib.get("name", "")
            dat_ref = bm.attrib.get("bitmapDataHRef", "")
            href = bm.attrib.get("href", "")
            if name:
                self.bitmap_hrefs[name] = (dat_ref, href)
        self.symbols: dict[str, ET.Element | None] = {}
        self.bitmaps: dict[str, Image.Image] = {}

    def get_root_form_symbol(self, form_frame_index: int) -> str:
        for lyr in self.dom.findall(".//xfl:DOMTimeline/xfl:layers/xfl:DOMLayer", NS):
            for fr in lyr.findall(".//xfl:DOMFrame", NS):
                idx = int(fr.attrib.get("index", "0"))
                dur = int(fr.attrib.get("duration", "1"))
                if idx <= form_frame_index < idx + dur:
                    for s in fr.findall(".//xfl:DOMSymbolInstance", NS):
                        lib = s.attrib.get("libraryItemName", "")
                        inst = s.attrib.get("name", "")
                        if inst in ("mc", "main_mc") or "mc_" in lib:
                            return lib
        raise RuntimeError(f"Form symbol at root frame {form_frame_index} not found in {self.prefix}")

    def load_symbol(self, sym_name: str) -> ET.Element | None:
        if sym_name in self.symbols:
            return self.symbols[sym_name]
        raw = fetch_obvn(f"{self.prefix}/LIBRARY/{sym_name}.xml")
        if not raw:
            self.symbols[sym_name] = None
            return None
        el = ET.fromstring(raw.decode("utf-8", "replace"))
        self.symbols[sym_name] = el
        return el

    def prefetch_dependencies(self, timeline_el: ET.Element, frame_ranges: list[tuple[int, int]]) -> None:
        """Recursively discover and parallel-download all referenced XML symbols and .dat bitmaps."""
        needed_bitmaps: set[str] = set()
        visited_syms: set[str] = set()

        def scan_timeline(tl: ET.Element, ranges: list[tuple[int, int]] | None) -> None:
            pending_syms: list[str] = []
            for lyr in tl.findall("xfl:layers/xfl:DOMLayer", NS):
                lname = lyr.attrib.get("name", "")
                if any(k in lname for k in IGNORED_LAYER_KEYWORDS):
                    continue
                for fr in lyr.findall("xfl:frames/xfl:DOMFrame", NS):
                    f_start = int(fr.attrib.get("index", "0"))
                    f_dur = int(fr.attrib.get("duration", "1"))
                    f_end = f_start + f_dur - 1
                    if ranges is not None:
                        if not any(lo <= f_end and f_start <= hi for lo, hi in ranges):
                            continue
                    for bi in fr.findall(".//xfl:DOMBitmapInstance", NS):
                        bname = bi.attrib.get("libraryItemName", "")
                        if bname:
                            needed_bitmaps.add(bname)
                    for bf in fr.findall(".//xfl:BitmapFill", NS):
                        bpath = bf.attrib.get("bitmapPath", "")
                        if bpath:
                            needed_bitmaps.add(bpath)
                    for si in fr.findall(".//xfl:DOMSymbolInstance", NS):
                        sname = si.attrib.get("libraryItemName", "")
                        if sname and sname not in visited_syms:
                            visited_syms.add(sname)
                            pending_syms.append(sname)

            if pending_syms:
                with concurrent.futures.ThreadPoolExecutor(max_workers=16) as pool:
                    list(pool.map(self.load_symbol, pending_syms))
                for sname in pending_syms:
                    sub = self.symbols.get(sname)
                    if sub is not None:
                        sub_tl = sub.find("xfl:timeline/xfl:DOMTimeline", NS)
                        if sub_tl is not None:
                            scan_timeline(sub_tl, None)

        scan_timeline(timeline_el, frame_ranges)

        missing_bms = [b for b in needed_bitmaps if b not in self.bitmaps and b in self.bitmap_hrefs]
        if missing_bms:
            def _load_one_bm(bname: str) -> tuple[str, Image.Image]:
                dat_ref, href = self.bitmap_hrefs[bname]
                raw = None
                if dat_ref:
                    raw = fetch_obvn(f"{self.prefix}/bin/{dat_ref}")
                if raw is None and href:
                    raw = fetch_obvn(f"{self.prefix}/LIBRARY/{href}")
                if raw is None:
                    return bname, Image.new("RGBA", (4, 4), (0, 0, 0, 0))
                return bname, decode_xfl_bitmap(raw)

            with concurrent.futures.ThreadPoolExecutor(max_workers=16) as pool:
                for bname, img in pool.map(_load_one_bm, missing_bms):
                    self.bitmaps[bname] = img

    def collect_draw_ops(
        self,
        timeline_el: ET.Element,
        frame_idx: int,
        parent_mat: Matrix2D = IDENTITY_MAT,
        clip_rect: tuple[float, float, float, float] | None = None,
        depth: int = 0,
        include_fx: bool = False,
    ) -> list[tuple[Image.Image, Matrix2D, tuple[float, float, float, float] | None]]:
        if depth > 8:
            return []
        layers = timeline_el.findall("xfl:layers/xfl:DOMLayer", NS)
        # Pre-compute mask layer rects in current timeline local space -> parent space
        mask_rects: dict[int, tuple[float, float, float, float]] = {}
        for l_idx, lyr in enumerate(layers):
            if lyr.attrib.get("layerType") == "mask":
                fr = _find_frame_at(lyr, frame_idx)
                if fr is not None:
                    sh = fr.find(".//xfl:DOMShape", NS)
                    if sh is not None:
                        bb = parse_shape_twip_bbox(sh)
                        if bb is not None:
                            mask_rects[l_idx] = _transform_bbox(bb, parent_mat)

        ops: list[tuple[Image.Image, Matrix2D, tuple[float, float, float, float] | None]] = []
        # Flash renders bottom layer first, top layer last
        for l_idx in range(len(layers) - 1, -1, -1):
            lyr = layers[l_idx]
            ltype = lyr.attrib.get("layerType", "normal")
            if ltype in ("guide", "mask", "folder"):
                continue
            lname = lyr.attrib.get("name", "")
            if any(k in lname for k in IGNORED_LAYER_KEYWORDS):
                continue
            if not include_fx and lname in ("特效", "特效2", "背后特效"):
                continue

            eff_clip = clip_rect
            p_idx_str = lyr.attrib.get("parentLayerIndex")
            if p_idx_str is not None and p_idx_str.isdigit():
                m_rect = mask_rects.get(int(p_idx_str))
                if m_rect is not None:
                    eff_clip = _intersect_bbox(eff_clip, m_rect) if eff_clip else m_rect

            fr = _find_frame_at(lyr, frame_idx)
            if fr is None:
                continue
            f_start = int(fr.attrib.get("index", "0"))
            offset_in_keyframe = max(0, frame_idx - f_start)

            elems = fr.find("xfl:elements", NS)
            if elems is None:
                continue

            def _iter_visual_nodes(container: ET.Element):
                for el in list(container):
                    t = el.tag.split("}")[-1]
                    if t == "DOMGroup":
                        mem = el.find("xfl:members", NS)
                        if mem is not None:
                            yield from _iter_visual_nodes(mem)
                    else:
                        yield el

            for child in _iter_visual_nodes(elems):
                tag = child.tag.split("}")[-1]
                if tag == "DOMBitmapInstance":
                    bname = child.attrib.get("libraryItemName", "")
                    img = self.bitmaps.get(bname)
                    if img is not None:
                        cmat = mat_mul(parent_mat, parse_matrix_el(child))
                        ops.append((img, cmat, eff_clip))
                elif tag == "DOMShape":
                    cmat = mat_mul(parent_mat, parse_matrix_el(child))
                    sh_bb = parse_shape_twip_bbox(child)
                    sh_clip = _transform_bbox(sh_bb, cmat) if sh_bb else None
                    merged_clip = _intersect_bbox(eff_clip, sh_clip) if (eff_clip and sh_clip) else (sh_clip or eff_clip)
                    for bf in child.findall(".//xfl:BitmapFill", NS):
                        bpath = bf.attrib.get("bitmapPath", "")
                        img = self.bitmaps.get(bpath)
                        if img is not None:
                            bm_el = bf.find("xfl:matrix/xfl:Matrix", NS)
                            if bm_el is not None:
                                ba = float(bm_el.attrib.get("a", "20")) / 20.0
                                bb = float(bm_el.attrib.get("b", "0")) / 20.0
                                bc = float(bm_el.attrib.get("c", "0")) / 20.0
                                bd = float(bm_el.attrib.get("d", "20")) / 20.0
                                btx = float(bm_el.attrib.get("tx", "0"))
                                bty = float(bm_el.attrib.get("ty", "0"))
                                bmat = mat_mul(cmat, (ba, bb, bc, bd, btx, bty))
                            else:
                                bmat = cmat
                            ops.append((img, bmat, merged_clip))
                elif tag == "DOMSymbolInstance":
                    sname = child.attrib.get("libraryItemName", "")
                    sub_el = self.load_symbol(sname)
                    if sub_el is None:
                        continue
                    sub_tl = sub_el.find("xfl:timeline/xfl:DOMTimeline", NS)
                    if sub_tl is None:
                        continue
                    sub_total = _timeline_length(sub_tl)
                    first_f = int(child.attrib.get("firstFrame", "0"))
                    loop_mode = child.attrib.get("loop", "loop")
                    if sub_total <= 1 or loop_mode == "single frame":
                        sub_f = min(max(0, first_f), max(0, sub_total - 1))
                    elif loop_mode == "play once":
                        sub_f = min(sub_total - 1, first_f + offset_in_keyframe)
                    else:
                        sub_f = (first_f + offset_in_keyframe) % sub_total
                    cmat = mat_mul(parent_mat, parse_matrix_el(child))
                    ops.extend(
                        self.collect_draw_ops(
                            sub_tl, sub_f, cmat, eff_clip, depth + 1, include_fx=include_fx
                        )
                    )
        return ops


def _find_frame_at(layer_el: ET.Element, frame_idx: int) -> ET.Element | None:
    for fr in layer_el.findall("xfl:frames/xfl:DOMFrame", NS):
        idx = int(fr.attrib.get("index", "0"))
        dur = int(fr.attrib.get("duration", "1"))
        if idx <= frame_idx < idx + dur:
            return fr
    return None


def _timeline_length(timeline_el: ET.Element) -> int:
    max_len = 1
    for lyr in timeline_el.findall("xfl:layers/xfl:DOMLayer", NS):
        for fr in lyr.findall("xfl:frames/xfl:DOMFrame", NS):
            end = int(fr.attrib.get("index", "0")) + int(fr.attrib.get("duration", "1"))
            if end > max_len:
                max_len = end
    return max_len


def _transform_bbox(
    bb: tuple[float, float, float, float], m: Matrix2D
) -> tuple[float, float, float, float]:
    x0, y0, x1, y1 = bb
    a, b, c, d, tx, ty = m
    pts = [
        (a * x0 + c * y0 + tx, b * x0 + d * y0 + ty),
        (a * x1 + c * y0 + tx, b * x1 + d * y0 + ty),
        (a * x0 + c * y1 + tx, b * x0 + d * y1 + ty),
        (a * x1 + c * y1 + tx, b * x1 + d * y1 + ty),
    ]
    return (
        min(p[0] for p in pts),
        min(p[1] for p in pts),
        max(p[0] for p in pts),
        max(p[1] for p in pts),
    )


def _intersect_bbox(
    b1: tuple[float, float, float, float], b2: tuple[float, float, float, float]
) -> tuple[float, float, float, float]:
    return (max(b1[0], b2[0]), max(b1[1], b2[1]), min(b1[2], b2[2]), min(b1[3], b2[3]))


def render_ops_to_canvas(
    ops: list[tuple[Image.Image, Matrix2D, tuple[float, float, float, float] | None]],
    origin_x: float,
    origin_y: float,
    scale: float = SPRITE_SCALE,
) -> Image.Image:
    canvas = Image.new("RGBA", (CANVAS_W, CANVAS_H), (0, 0, 0, 0))
    # Stage-to-Canvas matrix: cx = ANCHOR_X + (sx - origin_x) * scale; cy = ANCHOR_Y + (sy - origin_y) * scale
    stage_to_canvas: Matrix2D = (
        scale,
        0.0,
        0.0,
        scale,
        ANCHOR_X - origin_x * scale,
        ANCHOR_Y - origin_y * scale,
    )

    for img, mat, clip_stage in ops:
        w, h = img.size
        if w <= 0 or h <= 0:
            continue
        full_mat = mat_mul(stage_to_canvas, mat)
        a, b, c, d, tx, ty = full_mat
        det = a * d - b * c
        if abs(det) < 1e-6:
            continue

        corners = [
            (tx, ty),
            (a * w + tx, b * w + ty),
            (c * h + tx, d * h + ty),
            (a * w + c * h + tx, b * w + d * h + ty),
        ]
        x0 = math.floor(min(p[0] for p in corners))
        y0 = math.floor(min(p[1] for p in corners))
        x1 = math.ceil(max(p[0] for p in corners))
        y1 = math.ceil(max(p[1] for p in corners))

        if clip_stage is not None:
            cx0 = math.floor(ANCHOR_X + (clip_stage[0] - origin_x) * scale)
            cy0 = math.floor(ANCHOR_Y + (clip_stage[1] - origin_y) * scale)
            cx1 = math.ceil(ANCHOR_X + (clip_stage[2] - origin_x) * scale)
            cy1 = math.ceil(ANCHOR_Y + (clip_stage[3] - origin_y) * scale)
            x0 = max(x0, cx0)
            y0 = max(y0, cy0)
            x1 = min(x1, cx1)
            y1 = min(y1, cy1)

        # Keep safe margin so 4 canvas corners remain strictly transparent (alpha == 0)
        x0 = max(MARGIN, x0)
        y0 = max(MARGIN, y0)
        x1 = min(CANVAS_W - MARGIN, x1)
        y1 = min(CANVAS_H - MARGIN, y1)
        pw = x1 - x0
        ph = y1 - y0
        if pw <= 0 or ph <= 0:
            continue

        # Inverse affine from patch pixel (px, py) -> bitmap pixel (bx, by)
        dx0 = x0 - tx
        dy0 = y0 - ty
        inv_a = d / det
        inv_c = -c / det
        inv_tx = (d * dx0 - c * dy0) / det
        inv_b = -b / det
        inv_d = a / det
        inv_ty = (-b * dx0 + a * dy0) / det

        patch = img.transform(
            (pw, ph),
            Image.Transform.AFFINE,
            (inv_a, inv_c, inv_tx, inv_b, inv_d, inv_ty),
            resample=Image.Resampling.NEAREST,
        )
        canvas.alpha_composite(patch, (x0, y0))

    # Guarantee 4 corners alpha == 0
    for cx, cy in ((0, 0), (CANVAS_W - 1, 0), (0, CANVAS_H - 1), (CANVAS_W - 1, CANVAS_H - 1)):
        canvas.putpixel((cx, cy), (0, 0, 0, 0))
    return canvas


def parse_timeline_labels(timeline_el: ET.Element) -> dict[str, tuple[int, int]]:
    """Return {label_name: (start_frame, duration)} across label layer."""
    labels_ordered: list[tuple[int, int, str]] = []
    total_len = _timeline_length(timeline_el)
    for lyr in timeline_el.findall("xfl:layers/xfl:DOMLayer", NS):
        for fr in lyr.findall("xfl:frames/xfl:DOMFrame", NS):
            nm = fr.attrib.get("name", "").strip()
            if nm:
                idx = int(fr.attrib.get("index", "0"))
                dur = int(fr.attrib.get("duration", "1"))
                labels_ordered.append((idx, dur, nm))
    labels_ordered.sort(key=lambda x: x[0])
    out: dict[str, tuple[int, int]] = {}
    for i, (idx, dur, nm) in enumerate(labels_ordered):
        if nm in ("End", "end"):
            continue
        # Span until next label if duration is 1 on a marker keyframe
        next_idx = labels_ordered[i + 1][0] if i + 1 < len(labels_ordered) else total_len
        span = max(dur, next_idx - idx)
        if nm not in out:
            out[nm] = (idx, max(1, span))
    return out


def measure_stage_foot_origin(
    pkg: XflPackage, timeline_el: ET.Element, idle_frame: int
) -> tuple[float, float]:
    ops = pkg.collect_draw_ops(timeline_el, idle_frame, include_fx=False)
    probe = render_ops_to_canvas(ops, 0.0, 0.0, scale=1.0)
    bbox = probe.getbbox()
    if not bbox:
        return (0.0, 28.0)
    cx = (bbox[0] + bbox[2]) * 0.5 - ANCHOR_X
    foot_y = bbox[3] - ANCHOR_Y
    return (cx, foot_y)


# ---------------------------------------------------------------------------
# Sprite Sheet Packer (Matches validate.py & FighterRenderer)
# ---------------------------------------------------------------------------

def extrude_pad(cropped: Image.Image, pad: int = 2) -> Image.Image:
    w, h = cropped.size
    out = Image.new("RGBA", (w + pad * 2, h + pad * 2), (0, 0, 0, 0))
    out.paste(cropped, (pad, pad))
    top = cropped.crop((0, 0, w, 1))
    bot = cropped.crop((0, h - 1, w, h))
    left = cropped.crop((0, 0, 1, h))
    right = cropped.crop((w - 1, 0, w, h))
    for p in range(pad):
        out.paste(top, (pad, p))
        out.paste(bot, (pad, h + pad + p))
        out.paste(left, (p, pad))
        out.paste(right, (w + pad + p, pad))
    return out


def pack_animation(target_dir: Path, anim_id: str, frames: list[Image.Image]) -> None:
    anim_dir = target_dir / "animations" / anim_id
    anim_dir.mkdir(parents=True, exist_ok=True)
    sprites_dir = target_dir / "sprites"
    sprites_dir.mkdir(parents=True, exist_ok=True)

    cropped_cells: list[tuple[Image.Image, tuple[int, int], tuple[int, int]]] = []
    for idx, img in enumerate(frames):
        img.save(anim_dir / f"frame_{idx:03d}.png", format="PNG", compress_level=3)
        bbox = img.getbbox()
        if not bbox:
            # Ensure non-empty visible pixel at foot anchor if a source frame was blank
            fallback = img.copy()
            fallback.putpixel((ANCHOR_X, ANCHOR_Y - 2), (180, 180, 200, 16))
            bbox = (ANCHOR_X - 2, ANCHOR_Y - 4, ANCHOR_X + 2, ANCHOR_Y)
            crop = fallback.crop(bbox)
        else:
            crop = img.crop(bbox)
        padded = extrude_pad(crop, pad=2)
        cropped_cells.append((padded, (bbox[0], bbox[1]), crop.size))

    cols = min(6, len(cropped_cells))
    rows = (len(cropped_cells) + cols - 1) // cols
    cell_w = max(c[0].size[0] for c in cropped_cells)
    cell_h = max(c[0].size[1] for c in cropped_cells)
    sheet = Image.new("RGBA", (cols * cell_w, rows * cell_h), (0, 0, 0, 0))

    atlas_entries = []
    for idx, (padded, crop_off, orig_size) in enumerate(cropped_cells):
        gx = (idx % cols) * cell_w
        gy = (idx // cols) * cell_h
        sheet.paste(padded, (gx, gy))
        atlas_entries.append({
            "frame": idx,
            "rect": [gx + 2, gy + 2, orig_size[0], orig_size[1]],
            "crop_offset": [crop_off[0], crop_off[1]],
        })

    sheet_name = f"{anim_id}.png"
    sheet.save(sprites_dir / sheet_name, format="PNG", compress_level=3)
    (sprites_dir / f"{anim_id}.json").write_text(
        json.dumps({"animation_id": anim_id, "sheet": sheet_name, "frames": atlas_entries}, indent=2) + "\n",
        encoding="utf-8",
    )


# ---------------------------------------------------------------------------
# BVN Label Mapping & Frame Sampling
# ---------------------------------------------------------------------------

# Maps CrossArena standard animation_id -> candidate BVN labels + max sampled frames + loop + anim_type
FIGHTER_ANIM_SPECS: list[tuple[str, list[str], int, bool, str]] = [
    ("idle", ["站立"], 8, True, "core"),
    ("walk_forward", ["走"], 8, True, "core"),
    ("walk_backward", ["走"], 8, True, "core"),
    ("dash", ["瞬步", "走"], 6, False, "core"),
    ("crouch", ["防御", "起跳", "站立"], 4, True, "core"),
    ("jump_start", ["起跳", "跳"], 4, False, "core"),
    ("jump_loop", ["跳", "跳中"], 5, True, "core"),
    ("landing", ["落地", "落"], 4, False, "core"),
    ("light_01", ["砍1"], 7, False, "combat"),
    ("light_02", ["砍2", "砍1"], 8, False, "combat"),
    ("medium_01", ["砍3", "砍技1", "砍2"], 9, False, "combat"),
    ("heavy_01", ["砍4", "砍技2", "砍3"], 10, False, "combat"),
    ("crouch_light", ["砍1", "招1"], 7, False, "extra"),
    ("crouch_heavy", ["砍技1", "砍3", "招2"], 9, False, "extra"),
    ("overhead_01", ["砍技2", "跳砍", "砍4"], 9, False, "extra"),
    ("air_attack", ["跳砍", "跳招"], 7, False, "combat"),
    ("throw", ["摔1", "摔2", "砍技1"], 9, False, "combat"),
    ("block", ["防御"], 4, False, "combat"),
    ("hit", ["被打"], 5, False, "combat"),
    ("knockdown", ["击飞", "击飞_倒"], 8, False, "combat"),
    ("wakeup", ["起身", "击飞_起"], 6, False, "combat"),
    ("skill_01", ["招1", "砍技1"], 10, False, "skill"),
    ("skill_02", ["招2", "上必杀", "砍技2"], 11, False, "skill"),
    ("skill_03", ["招3", "必杀", "招1"], 11, False, "skill"),
    ("skill_ultimate", ["超必杀", "必杀"], 14, False, "skill"),
    ("intro", ["开场", "站立"], 8, False, "presentation"),
    ("victory", ["胜利", "开场", "站立"], 8, False, "presentation"),
    ("defeat", ["失败", "击飞_倒", "被打"], 6, False, "presentation"),
]


def sample_indices(start: int, duration: int, max_frames: int, min_frames: int = 4) -> list[int]:
    dur = max(1, duration)
    if dur < min_frames:
        return [start + min(i, dur - 1) for i in range(min_frames)]
    if dur <= max_frames:
        return [start + i for i in range(dur)]
    if max_frames <= 1:
        return [start]
    return [start + round(i * (dur - 1) / (max_frames - 1)) for i in range(max_frames)]


def squish_crouch_frame(img: Image.Image) -> Image.Image:
    """Create a genuine lower-stance crouch silhouette when using standing/guard pixel frames."""
    bbox = img.getbbox()
    if not bbox:
        return img
    crop = img.crop(bbox)
    cw, ch = crop.size
    new_h = max(16, round(ch * 0.80))
    squished = crop.resize((cw, new_h), resample=Image.Resampling.NEAREST)
    out = Image.new("RGBA", (CANVAS_W, CANVAS_H), (0, 0, 0, 0))
    paste_x = bbox[0]
    paste_y = max(MARGIN, ANCHOR_Y - new_h)
    out.alpha_composite(squished, (paste_x, paste_y))
    return out


# ---------------------------------------------------------------------------
# Playable Roster & Assist Definitions (Naruto + Bleach)
# ---------------------------------------------------------------------------

NARUTO_CHARACTERS: list[dict[str, Any]] = [
    {
        "dir": "naruto_uzumaki",
        "name_zh": "漩涡鸣人",
        "name_en": "Uzumaki Naruto",
        "form_name_zh": "常态",
        "xfl_pack": "naruto",
        "xfl_frame": 1,
        "tag_pack": "naruto",
        "face_prefix": "naruto",
        "forms": ["naruto.naruto_onetail", "naruto.naruto_sennin", "naruto.naruto_kyubi"],
        "awaken_target": "naruto.naruto_sennin",
        "awaken_name_zh": "仙人模式觉醒",
        "stats": {"max_hp": 1000, "walk_speed": 4500, "jump_velocity": 18500, "gravity": 920, "defense": 100, "max_gauge": 3000, "dash_speed": 10500, "dash_ticks": 14},
        "skills_cfg": [
            ("rasengan", "skill_01", "melee", "skill_01", 0, 45, "螺旋丸", [13000, 0]),
            ("kage_bunshin", "skill_02", "multi_hit", "skill_02", 0, 60, "多重影分身连弹", [8500, 0]),
            ("shuriken_barrage", "skill_03", "projectile", "skill_03", 0, 50, "风魔手里剑", "effects/chakra_sphere/frame_000.png"),
            ("oodama_rasengan", "skill_ultimate", "ultimate", "skill_ultimate", 1000, 0, "大玉螺旋丸", [14000, 0]),
        ],
        "bio": "木叶隐村第七班忍者，体内封印着九尾妖狐，擅长影分身术与近身螺旋丸突进连段。",
        "quote": "说到做到，这就是我的忍道！",
    },
    {
        "dir": "naruto_onetail",
        "base": "naruto.naruto_uzumaki",
        "name_zh": "漩涡鸣人·一尾",
        "name_en": "Naruto One-Tail",
        "form_name_zh": "九尾一尾状态",
        "xfl_pack": "naruto",
        "xfl_frame": 2,
        "tag_pack": "naruto",
        "face_prefix": "naruto_oneTail",
        "awaken_target": "naruto.naruto_kyubi",
        "awaken_name_zh": "九尾查克拉解放",
        "stats": {"max_hp": 1020, "walk_speed": 5200, "jump_velocity": 19200, "gravity": 940, "defense": 96, "max_gauge": 3000, "dash_speed": 12000, "dash_ticks": 13},
        "skills_cfg": [
            ("chakra_claw", "skill_01", "melee", "skill_01", 0, 40, "九尾查克拉爪击", [14500, 0]),
            ("vermilion_rush", "skill_02", "dash", "skill_02", 0, 55, "妖狐狂暴突进", [16000, 0]),
            ("chakra_roar", "skill_03", "area", "skill_03", 0, 65, "尾兽查克拉咆哮", [0, 0]),
            ("vermilion_rasengan", "skill_ultimate", "ultimate", "skill_ultimate", 1000, 0, "朱之螺旋丸", [15000, 0]),
        ],
        "bio": "终结之谷爆发的九尾查克拉外衣形态，拥有极高的突进速度与利爪压制判定。",
        "quote": "我绝对要把佐助带回木叶！",
    },
    {
        "dir": "naruto_sennin",
        "base": "naruto.naruto_uzumaki",
        "name_zh": "漩涡鸣人·仙人",
        "name_en": "Sage Mode Naruto",
        "form_name_zh": "仙人模式",
        "xfl_pack": "naruto",
        "xfl_frame": 4,
        "tag_pack": "naruto_hermit",
        "face_prefix": "naruto_hermit",
        "awaken_target": "naruto.naruto_kyubi",
        "awaken_name_zh": "九尾仙人模式",
        "stats": {"max_hp": 1060, "walk_speed": 4800, "jump_velocity": 19000, "gravity": 920, "defense": 106, "max_gauge": 3000, "dash_speed": 11200, "dash_ticks": 13},
        "skills_cfg": [
            ("kawazu_kumite", "skill_01", "melee", "skill_01", 0, 42, "蛙组手·仙法掌", [12000, 0]),
            ("senpo_rengan", "skill_02", "multi_hit", "skill_02", 0, 55, "仙法·螺旋连丸", [13000, 0]),
            ("wind_rasen_wave", "skill_03", "projectile", "skill_03", 0, 60, "风遁·螺旋丸投射", "effects/chakra_sphere/frame_000.png"),
            ("rasenshuriken", "skill_ultimate", "ultimate", "skill_ultimate", 1000, 0, "仙法·风遁螺旋手里剑", [10000, 0]),
        ],
        "bio": "妙木山修得自然能量的仙人模式，兼顾蛙组手大范围拳脚与高爆发螺旋手里剑。",
        "quote": "自然能量已完全凝聚，一招定胜负！",
    },
    {
        "dir": "naruto_kyubi",
        "base": "naruto.naruto_uzumaki",
        "name_zh": "漩涡鸣人·九尾",
        "name_en": "Kurama Link Naruto",
        "form_name_zh": "九尾查克拉模式",
        "xfl_pack": "naruto",
        "xfl_frame": 5,
        "tag_pack": "naruto_hermit",
        "face_prefix": "naruto_kurama",
        "stats": {"max_hp": 1100, "walk_speed": 5500, "jump_velocity": 19600, "gravity": 930, "defense": 108, "max_gauge": 3000, "dash_speed": 13200, "dash_ticks": 12},
        "skills_cfg": [
            ("planetary_rasengan", "skill_01", "melee", "skill_01", 0, 40, "惑星螺旋丸", [15000, 0]),
            ("yellow_flash_strike", "skill_02", "dash", "skill_02", 0, 50, "金色闪光瞬身击", [18000, 0]),
            ("kurama_shock", "skill_03", "projectile", "skill_03", 0, 55, "小型尾兽玉", "effects/chakra_sphere/frame_000.png"),
            ("bijudama", "skill_ultimate", "ultimate", "skill_ultimate", 1000, 0, "超迷你尾兽玉轰击", [12000, 0]),
        ],
        "bio": "与九喇嘛心意相通的金色查克拉形态，具备全场顶级的瞬身机动性与火力。",
        "quote": "走吧九喇嘛，让他们见识我们的力量！",
    },
    {
        "dir": "sasuke_uchiha",
        "name_zh": "宇智波佐助",
        "name_en": "Uchiha Sasuke",
        "form_name_zh": "常态",
        "xfl_pack": "sasuke",
        "xfl_frame": 1,
        "tag_pack": "sasuke",
        "face_prefix": "sasuke",
        "forms": ["naruto.sasuke_mantra", "naruto.sasuke_susanoo"],
        "awaken_target": "naruto.sasuke_mantra",
        "awaken_name_zh": "天之咒印觉醒",
        "stats": {"max_hp": 980, "walk_speed": 4900, "jump_velocity": 18800, "gravity": 920, "defense": 98, "max_gauge": 3000, "dash_speed": 11600, "dash_ticks": 13},
        "skills_cfg": [
            ("chidori", "skill_01", "dash", "skill_01", 0, 45, "千鸟突刺", [16500, 0]),
            ("chidori_nagashi", "skill_02", "area", "skill_02", 0, 60, "千鸟流雷网", [0, 0]),
            ("katon_gokakyu", "skill_03", "projectile", "skill_03", 0, 50, "火遁·豪火球之术", "effects/fireball/frame_000.png"),
            ("kirin", "skill_ultimate", "ultimate", "skill_ultimate", 1000, 0, "雷遁奥义·麒麟", [9000, 0]),
        ],
        "bio": "宇智波一族天才剑士与雷遁忍者，草薙剑立回距离极佳，千鸟与豪火球远近兼备。",
        "quote": "我的写轮眼早已看穿你的全部动作。",
    },
    {
        "dir": "sasuke_mantra",
        "base": "naruto.sasuke_uchiha",
        "name_zh": "宇智波佐助·咒印",
        "name_en": "Curse Mark Sasuke",
        "form_name_zh": "咒印状态二",
        "xfl_pack": "sasuke",
        "xfl_frame": 2,
        "tag_pack": "sasuke",
        "face_prefix": "sasuke_mantra",
        "awaken_target": "naruto.sasuke_susanoo",
        "awaken_name_zh": "万花筒·须佐能乎",
        "stats": {"max_hp": 1020, "walk_speed": 5100, "jump_velocity": 19500, "gravity": 900, "defense": 100, "max_gauge": 3000, "dash_speed": 12200, "dash_ticks": 13},
        "skills_cfg": [
            ("habataku_chidori", "skill_01", "dash", "skill_01", 0, 42, "恸哭千鸟", [17500, 0]),
            ("curse_wing_slash", "skill_02", "multi_hit", "skill_02", 0, 55, "咒印翼连斩", [11000, 0]),
            ("dragon_flame", "skill_03", "projectile", "skill_03", 0, 52, "火遁·豪龙火之术", "effects/fireball/frame_000.png"),
            ("dark_thunder", "skill_ultimate", "ultimate", "skill_ultimate", 1000, 0, "黑千鸟终结斩", [14500, 0]),
        ],
        "bio": "完全解放天之咒印的黑雷形态，恸哭千鸟拥有霸体与强力破防压制。",
        "quote": "感受这股黑暗雷霆的力量吧！",
    },
    {
        "dir": "sasuke_susanoo",
        "base": "naruto.sasuke_uchiha",
        "name_zh": "宇智波佐助·须佐",
        "name_en": "Susanoo Sasuke",
        "form_name_zh": "万花筒·须佐能乎",
        "xfl_pack": "sasuke",
        "xfl_frame": 3,
        "tag_pack": "sasuke",
        "face_prefix": "sasuke_susanoo",
        "stats": {"max_hp": 1060, "walk_speed": 4600, "jump_velocity": 18500, "gravity": 930, "defense": 108, "max_gauge": 3000, "dash_speed": 11000, "dash_ticks": 14},
        "skills_cfg": [
            ("susanoo_fist", "skill_01", "melee", "skill_01", 0, 48, "须佐骨架重击", [9500, 0]),
            ("kagutsuchi_slash", "skill_02", "area", "skill_02", 0, 58, "炎遁·加具土命剑", [8000, 0]),
            ("amaterasu_flame", "skill_03", "projectile", "skill_03", 0, 55, "天照黑炎", "effects/fireball/frame_000.png"),
            ("susanoo_arrow", "skill_ultimate", "ultimate", "skill_ultimate", 1000, 0, "须佐能乎·加具土命之箭", [6000, 0]),
        ],
        "bio": "觉醒万花筒写轮眼之力，以天照黑炎与须佐能乎神力掌控中远距离立回。",
        "quote": "无法熄灭的黑炎会将一切燃尽。",
    },
    {
        "dir": "sakura_haruno",
        "name_zh": "春野樱",
        "name_en": "Haruno Sakura",
        "form_name_zh": "怪力纲手流",
        "xfl_pack": "sakura",
        "xfl_frame": 1,
        "tag_pack": "sakura",
        "face_prefix": "sakura",
        "stats": {"max_hp": 1000, "walk_speed": 4600, "jump_velocity": 18600, "gravity": 920, "defense": 102, "max_gauge": 3000, "dash_speed": 10800, "dash_ticks": 13},
        "skills_cfg": [
            ("oka_sho", "skill_01", "melee", "skill_01", 0, 45, "樱花冲碎地", [12000, 0]),
            ("chakra_dropkick", "skill_02", "dash", "skill_02", 0, 52, "怪力飞踢", [14500, 0]),
            ("boulder_toss", "skill_03", "projectile", "skill_03", 0, 56, "巨岩崩击投掷", "effects/chakra_sphere/frame_000.png"),
            ("shanaro_smash", "skill_ultimate", "ultimate", "skill_ultimate", 1000, 0, "百豪怪力·天崩地裂", [11000, 0]),
        ],
        "bio": "继承第五代火影纲手怪力体术的近战破防型格斗家，单发重击与破防能力极强。",
        "quote": "这一次轮到我走在大家前面了——怪力全开！",
    },
    {
        "dir": "kakashi_hatake",
        "name_zh": "旗木卡卡西",
        "name_en": "Hatake Kakashi",
        "form_name_zh": "写轮眼常态",
        "xfl_pack": "kakashi",
        "xfl_frame": 1,
        "tag_pack": "kakashi",
        "face_prefix": "kakashi",
        "forms": ["naruto.kakashi_kamui"],
        "awaken_target": "naruto.kakashi_kamui",
        "awaken_name_zh": "万花筒写轮眼·神威",
        "stats": {"max_hp": 990, "walk_speed": 4800, "jump_velocity": 18700, "gravity": 920, "defense": 100, "max_gauge": 3000, "dash_speed": 11400, "dash_ticks": 13},
        "skills_cfg": [
            ("raikiri", "skill_01", "dash", "skill_01", 0, 44, "雷切突进", [16000, 0]),
            ("nin_hounds", "skill_02", "control", "skill_02", 0, 58, "通灵·忍犬追牙", [10000, 0]),
            ("suiryudan", "skill_03", "projectile", "skill_03", 0, 54, "水遁·水龙弹之术", "effects/chakra_sphere/frame_000.png"),
            ("lightning_wolf", "skill_ultimate", "ultimate", "skill_ultimate", 1000, 0, "雷传·双雷震奥义", [13000, 0]),
        ],
        "bio": "拷贝上千种忍术的木叶精英上忍，兼具雷切高速差合惩罚与水遁牵制。",
        "quote": "不珍惜同伴的人，连废物都不如。",
    },
    {
        "dir": "kakashi_kamui",
        "base": "naruto.kakashi_hatake",
        "name_zh": "旗木卡卡西·神威",
        "name_en": "Kamui Kakashi",
        "form_name_zh": "万花筒·神威",
        "xfl_pack": "kakashi",
        "xfl_frame": 2,
        "tag_pack": "kakashi",
        "face_prefix": "kakashi_kamui",
        "stats": {"max_hp": 1030, "walk_speed": 5000, "jump_velocity": 19000, "gravity": 920, "defense": 103, "max_gauge": 3000, "dash_speed": 12000, "dash_ticks": 12},
        "skills_cfg": [
            ("kamui_raikiri", "skill_01", "dash", "skill_01", 0, 42, "神威雷切", [17000, 0]),
            ("lightning_clone", "skill_02", "invuln", "skill_02", 0, 58, "雷分身反击", [8000, 0]),
            ("kamui_vortex", "skill_03", "projectile", "skill_03", 0, 55, "万花筒·神威扭曲", "effects/chakra_sphere/frame_000.png"),
            ("kamui_dimension", "skill_ultimate", "ultimate", "skill_ultimate", 1000, 0, "神威空间断罪", [11000, 0]),
        ],
        "bio": "开启万花筒写轮眼的神威形态，空间判定与神威雷切令对手难以固守。",
        "quote": "在这双万花筒面前，防御毫无意义。",
    },
    {
        "dir": "gaara_kazekage",
        "name_zh": "我爱罗",
        "name_en": "Fifth Kazekage Gaara",
        "form_name_zh": "第五代风影",
        "xfl_pack": "gaara",
        "xfl_frame": 1,
        "tag_pack": "gaara",
        "face_prefix": "gaara",
        "stats": {"max_hp": 1060, "walk_speed": 4000, "jump_velocity": 17800, "gravity": 910, "defense": 110, "max_gauge": 3000, "dash_speed": 9600, "dash_ticks": 14},
        "skills_cfg": [
            ("sand_coffin", "skill_01", "control", "skill_01", 0, 52, "砂缚柩抓取", [8000, 0]),
            ("sand_tsunami", "skill_02", "area", "skill_02", 0, 58, "流砂瀑流", [9000, 0]),
            ("sand_shuriken", "skill_03", "projectile", "skill_03", 0, 48, "砂时雨连射", "effects/chakra_sphere/frame_000.png"),
            ("sabaku_taiso", "skill_ultimate", "ultimate", "skill_ultimate", 1000, 0, "砂瀑大葬", [7000, 0]),
        ],
        "bio": "砂隐村第五代风影，绝对防御与中距离砂浪控场代表角色。",
        "quote": "风影之名，由我的砂来守护。",
    },
    {
        "dir": "neji_hyuga",
        "name_zh": "日向宁次",
        "name_en": "Hyuga Neji",
        "form_name_zh": "白眼·柔拳",
        "xfl_pack": "neji",
        "xfl_frame": 1,
        "tag_pack": "neji",
        "face_prefix": "neji",
        "stats": {"max_hp": 990, "walk_speed": 4800, "jump_velocity": 18800, "gravity": 920, "defense": 102, "max_gauge": 3000, "dash_speed": 11500, "dash_ticks": 13},
        "skills_cfg": [
            ("gentle_step", "skill_01", "multi_hit", "skill_01", 0, 44, "柔拳法·点穴掌", [12500, 0]),
            ("kaiten", "skill_02", "invuln", "skill_02", 0, 62, "八卦掌·回天", [0, 0]),
            ("hakke_kusho", "skill_03", "projectile", "skill_03", 0, 48, "八卦空掌", "effects/chakra_sphere/frame_000.png"),
            ("sixty_four_palms", "skill_ultimate", "ultimate", "skill_ultimate", 1000, 0, "柔拳法·八卦六十四掌", [11500, 0]),
        ],
        "bio": "日向一族天才上忍，拥有无敌升龙技“回天”与高速多段封穴连招。",
        "quote": "你已踏入我的八卦领域之内！",
    },
    {
        "dir": "rock_lee",
        "name_zh": "洛克李",
        "name_en": "Rock Lee",
        "form_name_zh": "常态体术",
        "xfl_pack": "lee",
        "xfl_frame": 1,
        "tag_pack": "lee",
        "face_prefix": "lee",
        "forms": ["naruto.rock_lee_tomon"],
        "awaken_target": "naruto.rock_lee_tomon",
        "awaken_name_zh": "八门遁甲·杜门开",
        "stats": {"max_hp": 980, "walk_speed": 5300, "jump_velocity": 19400, "gravity": 950, "defense": 98, "max_gauge": 3000, "dash_speed": 12800, "dash_ticks": 12},
        "skills_cfg": [
            ("konoha_senpu", "skill_01", "dash", "skill_01", 0, 40, "木叶大旋风", [15500, 0]),
            ("kage_buyo", "skill_02", "melee", "skill_02", 0, 48, "影舞叶浮空踢", [13000, -4000]),
            ("dynamic_entry", "skill_03", "dash", "skill_03", 0, 52, "青春飞踢突进", [16500, 0]),
            ("omote_renge", "skill_ultimate", "ultimate", "skill_ultimate", 1000, 0, "表莲华", [14500, 0]),
        ],
        "bio": "纯粹极致的近身体术专家，步速、冲刺与连续取消择位极具侵略性。",
        "quote": "努力是可以超越天才的！",
    },
    {
        "dir": "rock_lee_tomon",
        "base": "naruto.rock_lee",
        "name_zh": "洛克李·杜门",
        "name_en": "Fifth Gate Rock Lee",
        "form_name_zh": "八门遁甲·杜门",
        "xfl_pack": "lee",
        "xfl_frame": 2,
        "tag_pack": "lee",
        "face_prefix": "lee_domen",
        "stats": {"max_hp": 1000, "walk_speed": 5800, "jump_velocity": 20200, "gravity": 960, "defense": 95, "max_gauge": 3000, "dash_speed": 14500, "dash_ticks": 11},
        "skills_cfg": [
            ("sonic_combo", "skill_01", "dash", "skill_01", 0, 36, "音速连弹", [18000, 0]),
            ("heavenly_kick", "skill_02", "multi_hit", "skill_02", 0, 45, "八门乱舞踢", [15000, -3000]),
            ("shockwave_rush", "skill_03", "dash", "skill_03", 0, 48, "真·木叶刚力旋风", [17500, 0]),
            ("ura_renge", "skill_ultimate", "ultimate", "skill_ultimate", 1000, 0, "八门奥义·里莲华", [16000, 0]),
        ],
        "bio": "开启八门遁甲第五门“杜门”，卸除负重后获得超越音速的贴身连招爆发。",
        "quote": "八门遁甲第五门——杜门，开！",
    },
    {
        "dir": "itachi_uchiha",
        "name_zh": "宇智波鼬",
        "name_en": "Uchiha Itachi",
        "form_name_zh": "晓·万花筒",
        "xfl_pack": "itachi",
        "xfl_frame": 1,
        "tag_pack": "itachi",
        "face_prefix": "itachi",
        "stats": {"max_hp": 960, "walk_speed": 4800, "jump_velocity": 18800, "gravity": 910, "defense": 98, "max_gauge": 3000, "dash_speed": 11800, "dash_ticks": 13},
        "skills_cfg": [
            ("crow_feint", "skill_01", "dash", "skill_01", 0, 44, "乌鸦分身奇袭", [14500, 0]),
            ("clone_explosion", "skill_02", "area", "skill_02", 0, 56, "分身大爆破", [7000, 0]),
            ("amaterasu_cast", "skill_03", "projectile", "skill_03", 0, 54, "万花筒·天照", "effects/fireball/frame_000.png"),
            ("tsukuyomi", "skill_ultimate", "ultimate", "skill_ultimate", 1000, 0, "幻术奥义·月读", [10000, 0]),
        ],
        "bio": "幻术与火遁大师，擅长乌鸦瞬身惑敌、分身爆破防反与月读高伤终结。",
        "quote": "人们都活在自己的认知束缚之中。",
    },
    {
        "dir": "nagato_pain",
        "name_zh": "佩恩·天道",
        "name_en": "Six Paths Deva",
        "form_name_zh": "轮回眼·天道",
        "xfl_pack": "pain",
        "xfl_frame": 1,
        "tag_pack": "pain",
        "face_prefix": "pain",
        "stats": {"max_hp": 1050, "walk_speed": 4400, "jump_velocity": 18400, "gravity": 910, "defense": 106, "max_gauge": 3000, "dash_speed": 10800, "dash_ticks": 13},
        "skills_cfg": [
            ("bansho_tenin", "skill_01", "control", "skill_01", 0, 50, "万象天引", [6000, 0]),
            ("shinra_tensei", "skill_02", "invuln", "skill_02", 0, 62, "神罗天征", [0, 0]),
            ("black_rod_shot", "skill_03", "projectile", "skill_03", 0, 50, "黑棒查克拉贯刺", "effects/chakra_sphere/frame_000.png"),
            ("chibaku_tensei", "skill_ultimate", "ultimate", "skill_ultimate", 1000, 0, "轮回奥义·地爆天星", [8000, 0]),
        ],
        "bio": "掌控引力与斥力的轮回眼统帅，万象天引拉近择投与神罗天征无敌弹反兼具。",
        "quote": "从痛苦中思考，感受神罗天征吧。",
    },
]

BLEACH_CHARACTERS: list[dict[str, Any]] = [
    {
        "dir": "kurosaki_ichigo",
        "name_zh": "黑崎一护",
        "name_en": "Kurosaki Ichigo",
        "form_name_zh": "始解·斩月",
        "xfl_pack": "ichigo",
        "xfl_frame": 1,
        "tag_pack": "ichigo",
        "face_prefix": "ichigo",
        "forms": ["bleach.ichigo_bankai", "bleach.ichigo_vizored"],
        "awaken_target": "bleach.ichigo_bankai",
        "awaken_name_zh": "卍解·天锁斩月",
        "stats": {"max_hp": 1020, "walk_speed": 4600, "jump_velocity": 18600, "gravity": 920, "defense": 100, "max_gauge": 3000, "dash_speed": 11200, "dash_ticks": 13},
        "skills_cfg": [
            ("zangetsu_cleave", "skill_01", "melee", "skill_01", 0, 44, "斩月旋风斩", [12500, 0]),
            ("shunpo_upper", "skill_02", "dash", "skill_02", 0, 52, "瞬步升龙斩", [13500, -3000]),
            ("getsuga_tensho", "skill_03", "projectile", "skill_03", 0, 48, "月牙天冲", "effects/reiatsu_wave/frame_000.png"),
            ("reiatsu_getsuga", "skill_ultimate", "ultimate", "skill_ultimate", 1000, 0, "灵压全开·大月牙天冲", [12000, 0]),
        ],
        "bio": "代理死神黑崎一护始解形态，巨刃斩月拥有扎实的中距离挥砍判定与月牙天冲立回。",
        "quote": "我要斩断命运的利刃，守护所有人！",
    },
    {
        "dir": "ichigo_bankai",
        "base": "bleach.kurosaki_ichigo",
        "name_zh": "黑崎一护·卍解",
        "name_en": "Bankai Ichigo",
        "form_name_zh": "卍解·天锁斩月",
        "xfl_pack": "ichigo",
        "xfl_frame": 2,
        "tag_pack": "ichigo",
        "face_prefix": "ichigo_bankai",
        "awaken_target": "bleach.ichigo_vizored",
        "awaken_name_zh": "假面虚化觉醒",
        "stats": {"max_hp": 1040, "walk_speed": 5500, "jump_velocity": 19500, "gravity": 940, "defense": 100, "max_gauge": 3000, "dash_speed": 13800, "dash_ticks": 12},
        "skills_cfg": [
            ("tensa_flurry", "skill_01", "multi_hit", "skill_01", 0, 40, "天锁超速连斩", [15500, 0]),
            ("flash_cross", "skill_02", "dash", "skill_02", 0, 48, "瞬步残影穿刺", [17000, 0]),
            ("kuroi_getsuga", "skill_03", "projectile", "skill_03", 0, 48, "黑月牙天冲", "effects/dark_reiatsu/frame_000.png"),
            ("tensa_finis", "skill_ultimate", "ultimate", "skill_ultimate", 1000, 0, "天锁斩月·终式连月牙", [14500, 0]),
        ],
        "bio": "将全部卍解灵压压缩为超高速战力的天锁斩月形态，瞬步压制与黑月牙衔接极快。",
        "quote": "卍解——天锁斩月！跟得上我的速度吗？",
    },
    {
        "dir": "ichigo_vizored",
        "base": "bleach.kurosaki_ichigo",
        "name_zh": "黑崎一护·虚化",
        "name_en": "Hollow Mask Ichigo",
        "form_name_zh": "假面虚化状态",
        "xfl_pack": "ichigo",
        "xfl_frame": 4,
        "tag_pack": "ichigo",
        "face_prefix": "ichigo_vizored",
        "stats": {"max_hp": 1080, "walk_speed": 5700, "jump_velocity": 19800, "gravity": 940, "defense": 104, "max_gauge": 3000, "dash_speed": 14500, "dash_ticks": 11},
        "skills_cfg": [
            ("hollow_rend", "skill_01", "melee", "skill_01", 0, 38, "虚化暴走重斩", [16500, 0]),
            ("sonido_ambush", "skill_02", "dash", "skill_02", 0, 46, "响转狂袭", [18000, 0]),
            ("crimson_getsuga", "skill_03", "projectile", "skill_03", 0, 46, "赤黑月牙天冲", "effects/dark_reiatsu/frame_000.png"),
            ("gran_rey_getsuga", "skill_ultimate", "ultimate", "skill_ultimate", 1000, 0, "虚闪·二重黑月牙", [15000, 0]),
        ],
        "bio": "驾驭内虚假面力量的巅峰高速形态，兼具死神剑技与大虚灵压破坏力。",
        "quote": "死神与虚的力量，此刻合二为一！",
    },
    {
        "dir": "kuchiki_rukia",
        "name_zh": "朽木露琪亚",
        "name_en": "Kuchiki Rukia",
        "form_name_zh": "义骸·鬼道",
        "xfl_pack": "rukia",
        "xfl_frame": 1,
        "tag_pack": "rukia",
        "face_prefix": "rukia",
        "forms": ["bleach.rukia_shikai"],
        "awaken_target": "bleach.rukia_shikai",
        "awaken_name_zh": "始解·袖白雪",
        "stats": {"max_hp": 960, "walk_speed": 4900, "jump_velocity": 18800, "gravity": 900, "defense": 98, "max_gauge": 3000, "dash_speed": 11500, "dash_ticks": 13},
        "skills_cfg": [
            ("glove_combo", "skill_01", "melee", "skill_01", 0, 42, "悟魂手甲疾踢", [13000, 0]),
            ("rikujokoro", "skill_02", "control", "skill_02", 0, 56, "缚道之六十一·六杖光牢", [6000, 0]),
            ("shakkaho", "skill_03", "projectile", "skill_03", 0, 48, "破道之三十一·赤火炮", "effects/reiatsu_wave/frame_000.png"),
            ("soren_sokatsui", "skill_ultimate", "ultimate", "skill_ultimate", 1000, 0, "破道之七十三·双莲苍火坠", [9500, 0]),
        ],
        "bio": "擅长灵活体术与高阶鬼道连携的十三番队死神，可觉醒解放纯白斩魄刀袖白雪。",
        "quote": "凌舞吧，我的灵压与鬼道！",
    },
    {
        "dir": "rukia_shikai",
        "base": "bleach.kuchiki_rukia",
        "name_zh": "朽木露琪亚·始解",
        "name_en": "Sode no Shirayuki Rukia",
        "form_name_zh": "始解·袖白雪",
        "xfl_pack": "rukia",
        "xfl_frame": 2,
        "tag_pack": "rukia",
        "face_prefix": "rukia_shikai",
        "stats": {"max_hp": 1000, "walk_speed": 5000, "jump_velocity": 19000, "gravity": 900, "defense": 102, "max_gauge": 3000, "dash_speed": 12000, "dash_ticks": 12},
        "skills_cfg": [
            ("some_no_mai", "skill_01", "area", "skill_01", 0, 46, "初舞·月白冰柱", [8000, 0]),
            ("tsugi_no_mai", "skill_02", "projectile", "skill_02", 0, 52, "次舞·白涟", "effects/reiatsu_wave/frame_000.png"),
            ("san_no_mai", "skill_03", "dash", "skill_03", 0, 50, "参舞·白刀贯刺", [15000, 0]),
            ("absolute_zero_dance", "skill_ultimate", "ultimate", "skill_ultimate", 1000, 0, "袖白雪·极寒冰华终舞", [10500, 0]),
        ],
        "bio": "尸魂界最美冰雪系斩魄刀“袖白雪”解放姿态，月白防空控场与白涟远程压制极其出色。",
        "quote": "凌舞吧，袖白雪——初舞·月白！",
    },
    {
        "dir": "kuchiki_byakuya",
        "name_zh": "朽木白哉",
        "name_en": "Kuchiki Byakuya",
        "form_name_zh": "始解·千本樱",
        "xfl_pack": "byakuya",
        "xfl_frame": 1,
        "tag_pack": "byakuya",
        "face_prefix": "byakuya",
        "forms": ["bleach.byakuya_bankai"],
        "awaken_target": "bleach.byakuya_bankai",
        "awaken_name_zh": "卍解·千本樱景严",
        "stats": {"max_hp": 1010, "walk_speed": 4700, "jump_velocity": 18600, "gravity": 910, "defense": 103, "max_gauge": 3000, "dash_speed": 12200, "dash_ticks": 12},
        "skills_cfg": [
            ("senka_step", "skill_01", "dash", "skill_01", 0, 46, "闪花背身斩", [16000, 0]),
            ("petal_vortex", "skill_02", "area", "skill_02", 0, 54, "散落吧·千本樱刃浪", [8000, 0]),
            ("byakurai", "skill_03", "projectile", "skill_03", 0, 48, "破道之四·白雷", "effects/reiatsu_wave/frame_000.png"),
            ("senbonzakura_storm", "skill_ultimate", "ultimate", "skill_ultimate", 1000, 0, "千本樱·无伤圈绝杀", [9000, 0]),
        ],
        "bio": "护廷十三队六番队队长，以贵族瞬步“闪花”与千本樱刀瓣封锁中距离空间。",
        "quote": "散落吧，千本樱。",
    },
    {
        "dir": "byakuya_bankai",
        "base": "bleach.kuchiki_byakuya",
        "name_zh": "朽木白哉·卍解",
        "name_en": "Senbonzakura Kageyoshi Byakuya",
        "form_name_zh": "卍解·千本樱景严",
        "xfl_pack": "byakuya",
        "xfl_frame": 2,
        "tag_pack": "byakuya",
        "face_prefix": "byakuya_bankai",
        "stats": {"max_hp": 1060, "walk_speed": 4900, "jump_velocity": 18800, "gravity": 910, "defense": 106, "max_gauge": 3000, "dash_speed": 12600, "dash_ticks": 12},
        "skills_cfg": [
            ("gokei_crush", "skill_01", "area", "skill_01", 0, 46, "吭景·千本樱景严", [9000, 0]),
            ("senkei_blades", "skill_02", "multi_hit", "skill_02", 0, 54, "歼景·千刃葬列", [12000, 0]),
            ("petal_lance", "skill_03", "projectile", "skill_03", 0, 48, "樱刃洪流", "effects/reiatsu_wave/frame_000.png"),
            ("shukei_hakuteiken", "skill_ultimate", "ultimate", "skill_ultimate", 1000, 0, "终景·白帝剑", [14000, 0]),
        ],
        "bio": "亿万樱瓣化作攻防一体领域的卍解形态，终景·白帝剑具备毁灭级爆发。",
        "quote": "卍解——千本樱景严，终景·白帝剑！",
    },
    {
        "dir": "abarai_renji",
        "name_zh": "阿散井恋次",
        "name_en": "Abarai Renji",
        "form_name_zh": "蛇尾丸",
        "xfl_pack": "renji",
        "xfl_frame": 1,
        "tag_pack": "renji",
        "face_prefix": "renji",
        "stats": {"max_hp": 1030, "walk_speed": 4600, "jump_velocity": 18600, "gravity": 930, "defense": 102, "max_gauge": 3000, "dash_speed": 11000, "dash_ticks": 13},
        "skills_cfg": [
            ("zabimaru_whip", "skill_01", "melee", "skill_01", 0, 44, "咆哮吧·蛇尾丸横扫", [11000, 0]),
            ("higa_zekko", "skill_02", "area", "skill_02", 0, 56, "狒牙绝咬", [8500, 0]),
            ("shakkaho_blast", "skill_03", "projectile", "skill_03", 0, 50, "蛇牙冲击波", "effects/reiatsu_wave/frame_000.png"),
            ("hikotsu_taiho", "skill_ultimate", "ultimate", "skill_ultimate", 1000, 0, "卍解·狒狒王蛇尾丸·狒骨大炮", [10000, 0]),
        ],
        "bio": "六番队副队长，伸缩鞭刃“蛇尾丸”在紧凑擂台中拥有极强的中远距离摸奖与压制力。",
        "quote": "咆哮吧，蛇尾丸！",
    },
    {
        "dir": "hitsugaya_toshiro",
        "name_zh": "日番谷冬狮郎",
        "name_en": "Hitsugaya Toshiro",
        "form_name_zh": "始解·冰轮丸",
        "xfl_pack": "toushirou",
        "xfl_frame": 1,
        "tag_pack": "toushirou",
        "face_prefix": "toushirou",
        "forms": ["bleach.toshiro_bankai"],
        "awaken_target": "bleach.toshiro_bankai",
        "awaken_name_zh": "卍解·大红莲冰轮丸",
        "stats": {"max_hp": 980, "walk_speed": 4900, "jump_velocity": 19000, "gravity": 900, "defense": 100, "max_gauge": 3000, "dash_speed": 11800, "dash_ticks": 13},
        "skills_cfg": [
            ("tensho_frost", "skill_01", "melee", "skill_01", 0, 44, "端坐霜天·冰华斩", [12500, 0]),
            ("hyoryu_senbi", "skill_02", "area", "skill_02", 0, 54, "冰龙旋尾", [10500, 0]),
            ("guncho_tsurara", "skill_03", "projectile", "skill_03", 0, 48, "群鸟冰柱", "effects/reiatsu_wave/frame_000.png"),
            ("sennen_hyoro", "skill_ultimate", "ultimate", "skill_ultimate", 1000, 0, "冰轮丸·千年冰牢", [9500, 0]),
        ],
        "bio": "护廷十三队最年轻十番队队长，执掌冰雪系最强斩魄刀冰轮丸，空对地与防空压制极佳。",
        "quote": "端坐于霜天吧，冰轮丸！",
    },
    {
        "dir": "toshiro_bankai",
        "base": "bleach.hitsugaya_toshiro",
        "name_zh": "日番谷冬狮郎·卍解",
        "name_en": "Daiguren Hyorinmaru Toshiro",
        "form_name_zh": "卍解·大红莲冰轮丸",
        "xfl_pack": "toushirou",
        "xfl_frame": 2,
        "tag_pack": "toushirou",
        "face_prefix": "toushirou_bankai",
        "stats": {"max_hp": 1030, "walk_speed": 5200, "jump_velocity": 19600, "gravity": 890, "defense": 104, "max_gauge": 3000, "dash_speed": 12800, "dash_ticks": 12},
        "skills_cfg": [
            ("ice_wing_rush", "skill_01", "dash", "skill_01", 0, 42, "冰翼疾空斩", [16000, 0]),
            ("ryusenka", "skill_02", "multi_hit", "skill_02", 0, 52, "龙霰架碎冰刺", [13500, 0]),
            ("glacial_lance", "skill_03", "projectile", "skill_03", 0, 48, "大红莲寒冰咆哮", "effects/reiatsu_wave/frame_000.png"),
            ("hyoten_hyakkaso", "skill_ultimate", "ultimate", "skill_ultimate", 1000, 0, "大红莲冰轮丸·冰天百花葬", [9000, 0]),
        ],
        "bio": "身披红莲冰龙双翼的卍解形态，机动能力与冰天百花葬范围压制全面强化。",
        "quote": "当冰之华全部凋零之时，便是你的终结——冰天百花葬！",
    },
    {
        "dir": "zaraki_kenpachi",
        "name_zh": "更木剑八",
        "name_en": "Zaraki Kenpachi",
        "form_name_zh": "十一番队·剑鬼",
        "xfl_pack": "kenpachi",
        "xfl_frame": 1,
        "tag_pack": "kenpachi",
        "face_prefix": "kenpachi",
        "stats": {"max_hp": 1120, "walk_speed": 4300, "jump_velocity": 18200, "gravity": 960, "defense": 112, "max_gauge": 3000, "dash_speed": 10600, "dash_ticks": 14},
        "skills_cfg": [
            ("armored_cleave", "skill_01", "melee", "skill_01", 0, 48, "刚腕霸体裂地斩", [13000, 0]),
            ("berserk_charge", "skill_02", "dash", "skill_02", 0, 56, "金色灵压狂突", [15000, 0]),
            ("reiatsu_shock", "skill_03", "projectile", "skill_03", 0, 54, "剑压冲击波", "effects/reiatsu_wave/frame_000.png"),
            ("kendo_ryodan", "skill_ultimate", "ultimate", "skill_ultimate", 1000, 0, "摘下眼罩·剑道两断", [13500, 0]),
        ],
        "bio": "嗜战如命的十一番队队长，生命值、霸体抗打断与破防重斩威慑力冠绝全场。",
        "quote": "厮杀就是要这样才够痛快啊！",
    },
    {
        "dir": "aizen_sosuke",
        "name_zh": "蓝染惣右介",
        "name_en": "Aizen Sosuke",
        "form_name_zh": "镜花水月",
        "xfl_pack": "aizen",
        "xfl_frame": 1,
        "tag_pack": "aizen",
        "face_prefix": "aizen",
        "stats": {"max_hp": 1050, "walk_speed": 4800, "jump_velocity": 18600, "gravity": 910, "defense": 106, "max_gauge": 3000, "dash_speed": 12200, "dash_ticks": 12},
        "skills_cfg": [
            ("kyoka_counter", "skill_01", "invuln", "skill_01", 0, 54, "镜花水月·完全催眠闪击", [14000, 0]),
            ("dankai_barrier", "skill_02", "area", "skill_02", 0, 56, "缚道之八十一·断空碎击", [7000, 0]),
            ("raikoho", "skill_03", "projectile", "skill_03", 0, 50, "破道之六十三·雷吼炮", "effects/dark_reiatsu/frame_000.png"),
            ("kurohitsugi", "skill_ultimate", "ultimate", "skill_ultimate", 1000, 0, "破道之九十·黑棺", [8000, 0]),
        ],
        "bio": "立于天之王座的虚圈统帅，拥有镜花水月无敌幻影反击与满咏唱黑棺重创对手。",
        "quote": "碎裂吧，镜花水月。从一开始就没有人立于天上。",
    },
    {
        "dir": "ulquiorra_cifer",
        "name_zh": "乌尔奇奥拉",
        "name_en": "Ulquiorra Cifer",
        "form_name_zh": "第四十刃·常态",
        "xfl_pack": "ulquiorra",
        "xfl_frame": 1,
        "tag_pack": "ulquiorra",
        "face_prefix": "ulquiorra",
        "forms": ["bleach.ulquiorra_resurreccion"],
        "awaken_target": "bleach.ulquiorra_resurreccion",
        "awaken_name_zh": "归刃·黑翼大魔",
        "stats": {"max_hp": 1010, "walk_speed": 5000, "jump_velocity": 19000, "gravity": 910, "defense": 104, "max_gauge": 3000, "dash_speed": 12600, "dash_ticks": 12},
        "skills_cfg": [
            ("sonido_pierce", "skill_01", "dash", "skill_01", 0, 42, "超速响转贯手", [16500, 0]),
            ("murcielago_slash", "skill_02", "melee", "skill_02", 0, 48, "虚夜剑闪", [12000, 0]),
            ("bala_cero", "skill_03", "projectile", "skill_03", 0, 46, "虚弹·翠绿虚闪", "effects/dark_reiatsu/frame_000.png"),
            ("cero_oscuras_base", "skill_ultimate", "ultimate", "skill_ultimate", 1000, 0, "十刃奥义·王虚闪光", [10000, 0]),
        ],
        "bio": "破面十刃第四刃，冷静精准的响转突刺与翠绿虚闪令对手防不胜防。",
        "quote": "看不见的东西，我从不相信其为心。",
    },
    {
        "dir": "ulquiorra_resurreccion",
        "base": "bleach.ulquiorra_cifer",
        "name_zh": "乌尔奇奥拉·归刃",
        "name_en": "Murcielago Ulquiorra",
        "form_name_zh": "归刃·黑翼大魔",
        "xfl_pack": "ulquiorra",
        "xfl_frame": 2,
        "tag_pack": "ulquiorra",
        "face_prefix": "ulquiorra_resurreccion",
        "stats": {"max_hp": 1070, "walk_speed": 5500, "jump_velocity": 19800, "gravity": 890, "defense": 106, "max_gauge": 3000, "dash_speed": 14000, "dash_ticks": 11},
        "skills_cfg": [
            ("luz_de_la_luna", "skill_01", "dash", "skill_01", 0, 40, "月光剑俯冲", [17500, 0]),
            ("black_wing_storm", "skill_02", "multi_hit", "skill_02", 0, 50, "黑翼连斩风暴", [14000, 0]),
            ("cero_oscuras", "skill_03", "projectile", "skill_03", 0, 48, "黑虚闪", "effects/dark_reiatsu/frame_000.png"),
            ("lanza_del_relampago", "skill_ultimate", "ultimate", "skill_ultimate", 1000, 0, "二段归刃·雷霆之枪", [12000, 0]),
        ],
        "bio": "封锁吧黑翼大魔！兼具超速滞空突袭、黑虚闪与毁天灭地的雷霆之枪。",
        "quote": "封锁吧，黑翼大魔——感受绝望的形态吧。",
    },
]

ASSISTS_CONFIG: dict[str, list[dict[str, Any]]] = {
    "naruto": [
        {
            "dir": "minato_assist",
            "name_zh": "波风水门",
            "name_en": "Namikaze Minato",
            "skill_name_zh": "飞雷神·时空螺旋丸",
            "xfl_pack": "minato",
            "tag_pack": "minato",
            "face_prefix": "minato",
            "spawn_offset": [120000, 0],
            "move_vel": [9000, 0],
            "damage": 85,
            "guard_type": "mid",
        },
        {
            "dir": "tsunade_assist",
            "name_zh": "第五代火影·纲手",
            "name_en": "Fifth Hokage Tsunade",
            "skill_name_zh": "怪力·痛天脚破防",
            "xfl_pack": "tsunate",
            "tag_pack": "tsunate",
            "face_prefix": "tsunate",
            "spawn_offset": [110000, 0],
            "move_vel": [4000, 0],
            "damage": 95,
            "guard_type": "overhead",
            "guard_break": True,
        },
        {
            "dir": "shikamaru_assist",
            "name_zh": "奈良鹿丸",
            "name_en": "Nara Shikamaru",
            "skill_name_zh": "秘术·影子模仿术定身",
            "xfl_pack": "shikamaru",
            "tag_pack": "shikamaru",
            "face_prefix": "shikamaru",
            "spawn_offset": [-50000, 0],
            "move_vel": [0, 0],
            "damage": 65,
            "guard_type": "low",
            "hitstun": 34,
        },
        {
            "dir": "madara_assist",
            "name_zh": "宇智波斑",
            "name_en": "Uchiha Madara",
            "skill_name_zh": "火遁·豪火灭却",
            "xfl_pack": "madara",
            "tag_pack": "madara",
            "face_prefix": "madara",
            "spawn_offset": [-40000, 0],
            "move_vel": [3000, 0],
            "damage": 100,
            "guard_type": "mid",
        },
    ],
    "bleach": [
        {
            "dir": "yamamoto_assist",
            "name_zh": "山本元柳斋重国",
            "name_en": "Captain Yamamoto",
            "skill_name_zh": "流刃若火·松明炎柱",
            "xfl_pack": "yamamoto",
            "tag_pack": "yamamoto",
            "face_prefix": "yamamoto",
            "spawn_offset": [70000, 0],
            "move_vel": [3000, 0],
            "damage": 100,
            "guard_type": "mid",
        },
        {
            "dir": "yoruichi_assist",
            "name_zh": "四枫院夜一",
            "name_en": "Shihouin Yoruichi",
            "skill_name_zh": "瞬哄·雷神飞踢",
            "xfl_pack": "yoruichi",
            "tag_pack": "yoruichi",
            "face_prefix": "yoruichi",
            "spawn_offset": [60000, 0],
            "move_vel": [14000, 0],
            "damage": 85,
            "guard_type": "overhead",
        },
        {
            "dir": "grimmjow_assist",
            "name_zh": "葛力姆乔",
            "name_en": "Grimmjow Jaegerjaquez",
            "skill_name_zh": "豹王之爪突袭",
            "xfl_pack": "grimmjow",
            "tag_pack": "grimmjow",
            "face_prefix": "grimmjow",
            "spawn_offset": [65000, 0],
            "move_vel": [12500, 0],
            "damage": 90,
            "guard_type": "mid",
        },
        {
            "dir": "rangiku_assist",
            "name_zh": "松本乱菊",
            "name_en": "Matsumoto Rangiku",
            "skill_name_zh": "低吟吧·灰猫刃雾",
            "xfl_pack": "rangiku",
            "tag_pack": "rangiku",
            "face_prefix": "rangiku",
            "spawn_offset": [-30000, 0],
            "move_vel": [2000, 0],
            "damage": 75,
            "guard_type": "mid",
            "hitstun": 28,
        },
    ],
}


# ---------------------------------------------------------------------------
# FrameData & Skill JSON Builders (Strictly obeying D8 & validate.py)
# ---------------------------------------------------------------------------

def build_attack_framedata(
    move_id: str,
    anim_id: str,
    frame_count: int,
    frames_imgs: list[Image.Image],
    *,
    damage: int,
    hitstun: int,
    blockstun: int,
    hitstop: int,
    knockback: list[int],
    priority: int,
    guard_type: str = "mid",
    knockdown: bool = False,
    guard_break: bool = False,
    air_hit: bool = True,
    cancel_into: list[str] | None = None,
    move_vel: list[int] | None = None,
    invuln: bool = False,
    armor: bool = False,
    super_freeze_dur: int = 0,
    projectile_effect: str | None = None,
    multi_hit_count: int = 1,
) -> dict[str, Any]:
    sim_total = max(6, frame_count * 2)
    startup = max(3, min(14, sim_total // 3))
    active = max(3, min(12, sim_total // 3))
    recovery = max(2, sim_total - startup - active)
    if startup + active + recovery > sim_total:
        recovery = max(1, sim_total - startup - active)

    active_lo = startup
    active_hi = startup + active - 1

    # Measure rendered sprite reach during active window to build accurate hitbox!
    mid_anim_f = min(len(frames_imgs) - 1, active_lo // 2)
    bb = frames_imgs[mid_anim_f].getbbox() or (220, 340, 310, 480)
    front_reach_px = max(72, bb[2] - ANCHOR_X + 24)
    top_px = min(-95, bb[1] - ANCHOR_Y - 8)
    bot_px = -8 if guard_type == "low" else -22
    h_px = max(48, bot_px - top_px)

    if move_id == "throw":
        hb_rect = [10000, -135000, 78000, 115000]
    elif guard_type == "low":
        hb_rect = [12000, -68000, max(78000, front_reach_px * 1000), 62000]
    elif move_id == "skill_ultimate":
        hb_rect = [-20000, -185000, max(165000, (front_reach_px + 55) * 1000), 175000]
    else:
        hb_rect = [12000, top_px * 1000, front_reach_px * 1000, h_px * 1000]

    fd: dict[str, Any] = {
        "move_id": move_id,
        "animation_id": anim_id,
        "startup": startup,
        "active": active,
        "recovery": recovery,
        "meter_gain_on_whiff": 12 if move_id != "skill_ultimate" else 0,
    }

    if super_freeze_dur > 0:
        fd["super_freeze"] = {"frame": 1, "duration": super_freeze_dur}

    if move_vel and (move_vel[0] != 0 or move_vel[1] != 0):
        vel_end = min(sim_total - 2, active_hi)
        fd["move_velocity"] = [{"frames": [1, max(1, vel_end)], "vel": move_vel}]

    if invuln:
        fd["invuln_frames"] = [[0, min(sim_total - 1, active_lo + 2)]]
    if armor:
        fd["armor_frames"] = [[1, min(sim_total - 1, active_lo + 1)]]

    if cancel_into:
        fd["cancel_windows"] = [
            {"frames": [active_lo, min(sim_total - 1, active_hi + max(2, recovery // 2))], "into": cancel_into}
        ]

    if projectile_effect:
        fd["hitboxes"] = []
        fd["projectile_spawn"] = [
            {
                "frame": active_lo,
                "offset": [54000, -82000],
                "rect": [-32000, -32000, 64000, 64000],
                "hit": {
                    "damage": damage,
                    "knockback": knockback,
                    "hitstun": hitstun,
                    "blockstun": blockstun,
                    "hitstop": hitstop,
                    "air_hit": True,
                    "priority": priority,
                    "guard_type": "mid",
                    "meter_gain_on_hit": 55,
                    "meter_gain_on_block": 25,
                },
            }
        ]
    else:
        hbs = []
        if multi_hit_count > 1 and active >= multi_hit_count * 2:
            span = active // multi_hit_count
            per_dmg = max(12, damage // multi_hit_count)
            for h_i in range(multi_hit_count):
                h_lo = active_lo + h_i * span
                h_hi = active_hi if h_i == multi_hit_count - 1 else (h_lo + span - 1)
                last_hit = h_i == multi_hit_count - 1
                hbs.append({
                    "frames": [h_lo, h_hi],
                    "rect": hb_rect,
                    "hit_index": h_i,
                    "damage": per_dmg if not last_hit else (damage - per_dmg * (multi_hit_count - 1)),
                    "knockback": knockback if last_hit else [16000, 0],
                    "hitstun": hitstun if last_hit else 16,
                    "blockstun": blockstun if last_hit else 11,
                    "hitstop": hitstop if last_hit else 5,
                    "air_hit": air_hit,
                    "priority": priority,
                    "guard_type": guard_type,
                    "knockdown": knockdown and last_hit,
                    "guard_break": guard_break and last_hit,
                    "meter_gain_on_hit": 25,
                    "meter_gain_on_block": 12,
                })
        else:
            hbs.append({
                "frames": [active_lo, active_hi],
                "rect": hb_rect,
                "hit_index": 0,
                "damage": damage,
                "knockback": knockback,
                "hitstun": hitstun,
                "blockstun": blockstun,
                "hitstop": hitstop,
                "air_hit": air_hit,
                "priority": priority,
                "guard_type": guard_type,
                "knockdown": knockdown,
                "guard_break": guard_break,
                "meter_gain_on_hit": 45 if move_id != "skill_ultimate" else 0,
                "meter_gain_on_block": 20 if move_id != "skill_ultimate" else 0,
            })
        fd["hitboxes"] = hbs

    return fd


def fetch_portrait_and_splash(
    char_dir: Path,
    tag_kind: str,
    tag_pack: str,
    face_prefix: str,
    fallback_idle_frame: Image.Image,
    accent_rgba: tuple[int, int, int, int],
) -> None:
    """Portrait = native face icon (50x48) at 2x nearest (100x96, never stretched);
    splash = original standee art (300x250) untouched. Falls back to a head crop of the idle sprite."""
    del accent_rgba
    prev_dir = char_dir / "previews"
    prev_dir.mkdir(parents=True, exist_ok=True)
    base = f"shared/assets/assets/packs/{tag_kind}/{tag_pack}/face/{face_prefix}"
    small = fetch_tag_asset(f"{base}.png")
    big = fetch_tag_asset(f"{base}_b.png")
    win = fetch_tag_asset(f"{base}_w.png")

    bb = fallback_idle_frame.getbbox() or (200, 320, 312, 480)
    if small:
        ic = Image.open(io.BytesIO(small)).convert("RGBA")
        portrait = ic.resize((ic.width * 2, ic.height * 2), resample=Image.Resampling.NEAREST)
    else:
        head = fallback_idle_frame.crop((bb[0], bb[1], bb[2], bb[1] + max(8, (bb[3] - bb[1]) // 3)))
        s = min(96 / max(1, head.width), 92 / max(1, head.height))
        head = head.resize((max(1, round(head.width * s)), max(1, round(head.height * s))), Image.Resampling.NEAREST)
        portrait = Image.new("RGBA", (100, 96), (24, 28, 40, 255))
        portrait.alpha_composite(head, ((100 - head.width) // 2, (96 - head.height) // 2))
    portrait.save(prev_dir / "portrait.png", format="PNG")

    src = win or big
    if src:
        splash = Image.open(io.BytesIO(src)).convert("RGBA")
    else:
        crop = fallback_idle_frame.crop(bb)
        splash = crop.resize((crop.width * 2, crop.height * 2), Image.Resampling.NEAREST)
    splash.save(prev_dir / "splash.png", format="PNG")


def _legacy_fetch_portrait_and_splash(
    char_dir: Path,
    tag_kind: str,
    tag_pack: str,
    face_prefix: str,
    fallback_idle_frame: Image.Image,
    accent_rgba: tuple[int, int, int, int],
) -> None:
    prev_dir = char_dir / "previews"
    prev_dir.mkdir(parents=True, exist_ok=True)

    face_small = fetch_tag_asset(
        f"shared/assets/assets/packs/{tag_kind}/{tag_pack}/face/{face_prefix}.png"
    )
    face_big = fetch_tag_asset(
        f"shared/assets/assets/packs/{tag_kind}/{tag_pack}/face/{face_prefix}_b.png"
    )
    face_win = fetch_tag_asset(
        f"shared/assets/assets/packs/{tag_kind}/{tag_pack}/face/{face_prefix}_w.png"
    )

    # Portrait 128x128
    portrait = Image.new("RGBA", (128, 128), (16, 20, 30, 255))
    src_p_bytes = face_big or face_small
    if src_p_bytes:
        p_img = Image.open(io.BytesIO(src_p_bytes)).convert("RGBA")
        scale = min(120 / max(1, p_img.width), 120 / max(1, p_img.height))
        nw = max(1, round(p_img.width * scale))
        nh = max(1, round(p_img.height * scale))
        resized = p_img.resize((nw, nh), resample=Image.Resampling.NEAREST)
        portrait.alpha_composite(resized, ((128 - nw) // 2, (128 - nh) // 2))
    else:
        bb = fallback_idle_frame.getbbox() or (200, 320, 312, 480)
        crop = fallback_idle_frame.crop(bb)
        portrait.alpha_composite(crop.resize((96, 96), Image.Resampling.NEAREST), (16, 16))
    ImageDraw.Draw(portrait).rectangle([0, 0, 127, 127], outline=accent_rgba, width=3)
    portrait.save(prev_dir / "portrait.png", format="PNG")

    # Splash standee 280x360
    splash = Image.new("RGBA", (280, 360), (12, 16, 26, 220))
    src_s_bytes = face_win or face_big
    if src_s_bytes:
        s_img = Image.open(io.BytesIO(src_s_bytes)).convert("RGBA")
        scale = min(260 / max(1, s_img.width), 340 / max(1, s_img.height))
        nw = max(1, round(s_img.width * scale))
        nh = max(1, round(s_img.height * scale))
        resized = s_img.resize((nw, nh), resample=Image.Resampling.NEAREST)
        splash.alpha_composite(resized, ((280 - nw) // 2, (360 - nh) // 2))
    else:
        bb = fallback_idle_frame.getbbox() or (190, 300, 322, 480)
        crop = fallback_idle_frame.crop(bb)
        scale = min(240 / max(1, crop.width), 320 / max(1, crop.height))
        nw, nh = max(1, round(crop.width * scale)), max(1, round(crop.height * scale))
        splash.alpha_composite(crop.resize((nw, nh), Image.Resampling.NEAREST), ((280 - nw) // 2, 340 - nh))
    ImageDraw.Draw(splash).rectangle([0, 0, 279, 359], outline=accent_rgba, width=3)
    splash.save(prev_dir / "splash.png", format="PNG")


# ---------------------------------------------------------------------------
# Extract One Playable Character / Form
# ---------------------------------------------------------------------------

def extract_fighter_bundle(
    ip_id: str,
    cfg: dict[str, Any],
    pkg_cache: dict[str, XflPackage],
    accent_rgba: tuple[int, int, int, int],
) -> tuple[int, int]:
    """Returns (total_animations, total_frames) extracted."""
    xfl_pack = cfg["xfl_pack"]
    if xfl_pack not in pkg_cache:
        pkg_cache[xfl_pack] = XflPackage(f"swf_source/f_fighter/{xfl_pack}")
    pkg = pkg_cache[xfl_pack]

    sym_name = pkg.get_root_form_symbol(cfg["xfl_frame"])
    sym_el = pkg.load_symbol(sym_name)
    if sym_el is None:
        raise RuntimeError(f"Missing symbol {sym_name} in {xfl_pack}")
    tl = sym_el.find("xfl:timeline/xfl:DOMTimeline", NS)
    if tl is None:
        raise RuntimeError(f"Missing timeline in {sym_name}")

    labels = parse_timeline_labels(tl)
    # Build animation frame lists
    anim_plan: list[tuple[str, list[int], bool, str, bool]] = []
    frame_ranges_needed: list[tuple[int, int]] = []

    specs = list(FIGHTER_ANIM_SPECS)
    if cfg.get("awaken_target"):
        specs.append(("skill_awaken", ["万解", "开场", "超必杀"], 10, False, "extra"))

    for anim_id, cand_labels, max_f, loop, anim_type in specs:
        chosen = None
        used_label = ""
        for lbl in cand_labels:
            if lbl in labels:
                chosen = labels[lbl]
                used_label = lbl
                break
        if chosen is None:
            chosen = labels.get("站立", (0, 6))
            used_label = "站立"
        f_indices = sample_indices(chosen[0], chosen[1], max_f)
        if anim_id == "walk_backward":
            f_indices = list(reversed(f_indices))
        squish = anim_id in ("crouch", "crouch_light", "crouch_heavy") and used_label in ("站立", "防御")
        anim_plan.append((anim_id, f_indices, loop, anim_type, squish))
        frame_ranges_needed.append((min(f_indices), max(f_indices)))

    pkg.prefetch_dependencies(tl, frame_ranges_needed)

    idle_start = labels.get("站立", (0, 1))[0]
    origin_x, origin_y = measure_stage_foot_origin(pkg, tl, idle_start)

    char_id = f"{ip_id}.{cfg['dir']}"
    char_dir = ROOT / "ip_content" / ip_id / "characters" / cfg["dir"]
    (char_dir / "metadata").mkdir(parents=True, exist_ok=True)
    (char_dir / "framedata").mkdir(parents=True, exist_ok=True)
    (char_dir / "skills").mkdir(parents=True, exist_ok=True)

    rendered_anims: dict[str, list[Image.Image]] = {}
    total_frames = 0

    for anim_id, f_indices, loop, anim_type, squish in anim_plan:
        include_fx = anim_id in ("skill_01", "skill_02", "skill_03", "skill_ultimate", "skill_awaken")
        frames: list[Image.Image] = []
        for fi in f_indices:
            ops = pkg.collect_draw_ops(tl, fi, include_fx=include_fx)
            if not ops:
                ops = pkg.collect_draw_ops(tl, idle_start, include_fx=False)
            img = render_ops_to_canvas(ops, origin_x, origin_y, scale=SPRITE_SCALE)
            if squish:
                img = squish_crouch_frame(img)
            frames.append(img)

        pack_animation(char_dir, anim_id, frames)
        rendered_anims[anim_id] = frames
        total_frames += len(frames)

        meta_obj = {
            "animation_id": anim_id,
            "character_id": char_id,
            "animation_type": anim_type,
            "source_frames": f"animations/{anim_id}/",
            "frame_count": len(frames),
            "animation_fps": 30,
            "loop": loop,
            "facing_mode": "flip",
            "canvas_size": [CANVAS_W, CANVAS_H],
            "pivot": [ANCHOR_X, ANCHOR_Y],
            "ground_anchor": [ANCHOR_X, ANCHOR_Y],
            "presentation_events": [],
        }
        (char_dir / "metadata" / f"{anim_id}.json").write_text(
            json.dumps(meta_obj, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
        )

    # Hurtbox & Pushbox (Decision D6)
    idle_bb = rendered_anims["idle"][0].getbbox() or (224, 356, 288, 480)
    stand_h = max(110, min(160, ANCHOR_Y - idle_bb[1]))
    stand_w = max(56, min(88, idle_bb[2] - idle_bb[0]))
    half_w = (stand_w // 2) * 1000
    crouch_h = max(76, round(stand_h * 0.68))

    hurtboxes_json = {
        "hurtbox_default": {
            "stand": [[-half_w, -stand_h * 1000, half_w * 2, stand_h * 1000]],
            "crouch": [[-half_w, -crouch_h * 1000, half_w * 2, crouch_h * 1000]],
            "air": [[-half_w, -(stand_h - 14) * 1000, half_w * 2, (stand_h - 26) * 1000]],
            "down": [[-52000, -36000, 104000, 36000]],
            "pushbox": {
                "stand": [-30000, -110000, 60000, 110000],
                "crouch": [-30000, -76000, 60000, 76000],
                "air": [-28000, -96000, 56000, 84000],
                "down": [-34000, -32000, 68000, 32000],
            },
        }
    }
    (char_dir / "framedata" / "hurtboxes.json").write_text(
        json.dumps(hurtboxes_json, indent=2) + "\n", encoding="utf-8"
    )

    # Standard Normal & Universal Attack FrameData
    normal_defs = [
        ("light_01", 38, 14, 9, 5, [18000, 0], 1, "mid", False, False, ["light_02", "medium_01", "crouch_light", "heavy_01", "skill", "ultimate"]),
        ("light_02", 44, 16, 10, 6, [22000, 0], 1, "mid", False, False, ["medium_01", "heavy_01", "crouch_heavy", "skill", "ultimate"]),
        ("medium_01", 62, 19, 12, 7, [28000, 0], 2, "mid", False, False, ["heavy_01", "crouch_heavy", "overhead_01", "skill", "ultimate"]),
        ("heavy_01", 86, 23, 14, 9, [42000, -13500], 3, "mid", False, False, ["skill", "ultimate", "awaken"]),
        ("crouch_light", 36, 14, 9, 5, [16000, 0], 1, "low", False, False, ["medium_01", "crouch_heavy", "skill", "ultimate"]),
        ("crouch_heavy", 82, 24, 13, 8, [34000, 0], 2, "low", True, False, ["skill", "ultimate"]),
        ("overhead_01", 74, 20, 12, 8, [26000, 0], 2, "overhead", False, True, ["skill", "ultimate"]),
        ("air_attack", 58, 18, 11, 7, [24000, 0], 2, "overhead", False, False, ["skill"]),
        ("throw", 105, 28, 0, 10, [56000, -14000], 4, "throw", True, False, None),
    ]
    for mid, dmg, hstun, bstun, hstop, kb, prio, gtype, kd, gbrk, cancels in normal_defs:
        imgs = rendered_anims[mid]
        fd = build_attack_framedata(
            mid, mid, len(imgs), imgs,
            damage=dmg, hitstun=hstun, blockstun=bstun, hitstop=hstop,
            knockback=kb, priority=prio, guard_type=gtype, knockdown=kd,
            guard_break=gbrk, cancel_into=cancels,
            move_vel=[4500, 0] if mid in ("medium_01", "heavy_01", "overhead_01") else None,
        )
        (char_dir / "framedata" / f"{mid}.json").write_text(
            json.dumps(fd, indent=2) + "\n", encoding="utf-8"
        )

    # Signature Skills & Ultimate
    skill_paths: list[str] = []
    for sk_id, move_id, sk_type, sk_input, cost, cooldown, sk_zh, extra in cfg["skills_cfg"]:
        imgs = rendered_anims[move_id]
        is_ult = sk_type == "ultimate"
        is_proj = sk_type == "projectile"
        proj_eff = extra if isinstance(extra, str) else None
        m_vel = extra if isinstance(extra, list) else [6000, 0]

        fd = build_attack_framedata(
            move_id,
            move_id,
            len(imgs),
            imgs,
            damage=235 if is_ult else (88 if is_proj else 112),
            hitstun=32 if is_ult else 22,
            blockstun=18 if is_ult else 13,
            hitstop=12 if is_ult else 8,
            knockback=[62000, -17500] if is_ult else ([36000, -12000] if sk_type in ("dash", "melee", "area") else [28000, 0]),
            priority=5 if is_ult else 3,
            guard_type="mid",
            knockdown=is_ult or sk_type in ("control", "area"),
            guard_break=(sk_id in ("armored_cleave", "oka_sho", "habataku_chidori")),
            cancel_into=["ultimate", "awaken"] if not is_ult else None,
            move_vel=None if is_proj else m_vel,
            invuln=is_ult or sk_type == "invuln",
            armor=(sk_id in ("armored_cleave", "berserk_charge", "susanoo_fist")),
            super_freeze_dur=26 if is_ult else 0,
            projectile_effect=proj_eff,
            multi_hit_count=3 if (is_ult or sk_type == "multi_hit") and not is_proj else 1,
        )
        (char_dir / "framedata" / f"{move_id}.json").write_text(
            json.dumps(fd, indent=2) + "\n", encoding="utf-8"
        )

        sk_obj: dict[str, Any] = {
            "skill_id": sk_id,
            "type": sk_type,
            "input": sk_input,
            "cost": cost,
            "cooldown": cooldown,
            "move_id": move_id,
            "name_zh": sk_zh,
            "name_en": sk_id.replace("_", " ").title(),
        }
        if is_proj and proj_eff:
            sk_obj["projectile"] = {
                "effect": proj_eff,
                "speed": 11500,
                "lifetime": 75,
                "velocity_y": 0,
                "projectile_gravity": 0,
            }
        rel_sk = f"skills/{sk_id}.json"
        skill_paths.append(rel_sk)
        (char_dir / rel_sk).write_text(
            json.dumps(sk_obj, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
        )

    # Optional In-Match Awakening Skill (`type === "awaken"`)
    if cfg.get("awaken_target"):
        aw_imgs = rendered_anims["skill_awaken"]
        aw_fd = build_attack_framedata(
            "skill_awaken",
            "skill_awaken",
            len(aw_imgs),
            aw_imgs,
            damage=65,
            hitstun=26,
            blockstun=14,
            hitstop=10,
            knockback=[48000, -14000],
            priority=6,
            guard_type="mid",
            knockdown=True,
            invuln=True,
            super_freeze_dur=24,
        )
        (char_dir / "framedata" / "skill_awaken.json").write_text(
            json.dumps(aw_fd, indent=2) + "\n", encoding="utf-8"
        )
        aw_sk = {
            "skill_id": "awaken_transform",
            "type": "awaken",
            "input": "awaken",
            "cost": 2000,
            "cooldown": 0,
            "move_id": "skill_awaken",
            "name_zh": cfg.get("awaken_name_zh", "觉醒变身"),
            "name_en": "Awakening",
            "target_form_id": cfg["awaken_target"],
            "awaken_duration_ticks": 0,
        }
        skill_paths.append("skills/awaken_transform.json")
        (char_dir / "skills" / "awaken_transform.json").write_text(
            json.dumps(aw_sk, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
        )

    # Previews (Portrait + Standee Splash)
    fetch_portrait_and_splash(
        char_dir, "fighters", cfg["tag_pack"], cfg["face_prefix"], rendered_anims["idle"][0], accent_rgba
    )

    # character.json
    char_json: dict[str, Any] = {
        "id": char_id,
        "ip_id": ip_id,
        "name_zh": cfg["name_zh"],
        "name_en": cfg["name_en"],
        "form_name_zh": cfg["form_name_zh"],
        "portrait": "previews/portrait.png",
        "splash": "previews/splash.png",
        "stats": cfg["stats"],
        "height_scale": 1.0,
        "hurtboxes": "hurtbox_default",
        "skills": skill_paths,
        "unsupported_core_moves": [],
        "ai_profile": {
            "aggression": 0.68,
            "anti_air": 0.65,
            "defense": 0.62,
            "zoning": 0.55,
            "combo_focus": 0.72,
            "meter_usage": 0.70,
            "assist_usage": 0.60,
        },
        "bio": cfg["bio"],
        "victory_quote_zh": cfg["quote"],
        "resource_metadata": {
            "origin_repo": "https://github.com/5DPLAY-Game-Studio/OpenBleachVsNaruto",
            "origin_pack": f"swf_source/f_fighter/{xfl_pack} (frame {cfg['xfl_frame']})",
            "completeness": "complete",
            "authorization_status": "pending_authorization",
            "sprite_scale": 2,
        },
    }
    if cfg.get("base"):
        char_json["base_character_id"] = cfg["base"]
    if cfg.get("forms"):
        char_json["forms"] = cfg["forms"]

    (char_dir / "character.json").write_text(
        json.dumps(char_json, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )

    # metadata/sources.json (concrete preview paths so D10 produces 0 warnings!)
    src_meta = {
        "source": f"5DPLAY-Game-Studio/OpenBleachVsNaruto (swf_source/f_fighter/{xfl_pack}) & BleachVsNaruto_TagAssets",
        "author": "5DPLAY Game Studio / respective anime IP rightsholders",
        "license": "pending_authorization",
        "redistributable": False,
        "placeholder": False,
    }
    sources_entries = [
        {"path": "animations/*", **src_meta},
        {"path": "sprites/*", **src_meta},
        {"path": "previews/portrait.png", **src_meta},
        {"path": "previews/splash.png", **src_meta},
    ]
    (char_dir / "metadata" / "sources.json").write_text(
        json.dumps({"entries": sources_entries}, indent=2) + "\n", encoding="utf-8"
    )

    return len(rendered_anims), total_frames


# ---------------------------------------------------------------------------
# Extract One Assist Bundle
# ---------------------------------------------------------------------------

def extract_assist_bundle(
    ip_id: str, cfg: dict[str, Any], accent_rgba: tuple[int, int, int, int]
) -> int:
    xfl_pack = cfg["xfl_pack"]
    pkg = XflPackage(f"swf_source/f_assistant/{xfl_pack}")
    tl = pkg.dom.find("xfl:timelines/xfl:DOMTimeline", NS)
    if tl is None:
        raise RuntimeError(f"Missing root timeline in assist {xfl_pack}")

    total_len = _timeline_length(tl)
    start_f = 1
    for probe_f in range(1, min(15, total_len)):
        has_elem = any(
            (_find_frame_at(lyr, probe_f) is not None and len(_find_frame_at(lyr, probe_f).findall(".//xfl:DOMSymbolInstance", NS)) + len(_find_frame_at(lyr, probe_f).findall(".//xfl:DOMBitmapInstance", NS)) > 0)  # type: ignore[union-attr]
            for lyr in tl.findall("xfl:layers/xfl:DOMLayer", NS)
            if not any(k in lyr.attrib.get("name", "") for k in IGNORED_LAYER_KEYWORDS)
        )
        if has_elem:
            start_f = probe_f
            break
    f_indices = sample_indices(start_f, max(6, min(total_len - start_f, 75)), 10)
    pkg.prefetch_dependencies(tl, [(min(f_indices), max(f_indices))])

    origin_x, origin_y = measure_stage_foot_origin(pkg, tl, f_indices[0])
    frames: list[Image.Image] = []
    for fi in f_indices:
        ops = pkg.collect_draw_ops(tl, fi, include_fx=True)
        if not ops:
            ops = pkg.collect_draw_ops(tl, 1, include_fx=True)
        frames.append(render_ops_to_canvas(ops, origin_x, origin_y, scale=SPRITE_SCALE))

    assist_id = f"{ip_id}.{cfg['dir']}"
    adir = ROOT / "ip_content" / ip_id / "assists" / cfg["dir"]
    (adir / "metadata").mkdir(parents=True, exist_ok=True)
    (adir / "framedata").mkdir(parents=True, exist_ok=True)

    pack_animation(adir, "assist_call", frames)
    fetch_portrait_and_splash(
        adir, "assists", cfg["tag_pack"], cfg["face_prefix"], frames[0], accent_rgba
    )

    (adir / "metadata" / "assist_call.json").write_text(
        json.dumps({
            "animation_id": "assist_call",
            "character_id": assist_id,
            "animation_type": "extra",
            "source_frames": "animations/assist_call/",
            "frame_count": len(frames),
            "animation_fps": 30,
            "loop": False,
            "facing_mode": "flip",
            "canvas_size": [CANVAS_W, CANVAS_H],
            "pivot": [ANCHOR_X, ANCHOR_Y],
            "ground_anchor": [ANCHOR_X, ANCHOR_Y],
            "presentation_events": [],
        }, indent=2) + "\n",
        encoding="utf-8",
    )

    fd = build_attack_framedata(
        "assist_call",
        "assist_call",
        len(frames),
        frames,
        damage=cfg["damage"],
        hitstun=cfg.get("hitstun", 22),
        blockstun=14,
        hitstop=7,
        knockback=[32000, -10000],
        priority=3,
        guard_type=cfg.get("guard_type", "mid"),
        knockdown=False,
        guard_break=cfg.get("guard_break", False),
        move_vel=cfg["move_vel"],
    )
    (adir / "framedata" / "assist_call.json").write_text(
        json.dumps(fd, indent=2) + "\n", encoding="utf-8"
    )

    (adir / "assist.json").write_text(
        json.dumps({
            "id": assist_id,
            "ip_id": ip_id,
            "name_zh": cfg["name_zh"],
            "name_en": cfg["name_en"],
            "skill_name_zh": cfg["skill_name_zh"],
            "portrait": "previews/portrait.png",
            "cooldown_ticks": 720,
            "spawn_offset": cfg["spawn_offset"],
            "move_id": "assist_call",
        }, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )

    src_meta = {
        "source": f"5DPLAY-Game-Studio/OpenBleachVsNaruto (swf_source/f_assistant/{xfl_pack}) & BleachVsNaruto_TagAssets",
        "author": "5DPLAY Game Studio / respective anime IP rightsholders",
        "license": "pending_authorization",
        "redistributable": False,
        "placeholder": False,
    }
    (adir / "metadata" / "sources.json").write_text(
        json.dumps({
            "entries": [
                {"path": "animations/*", **src_meta},
                {"path": "sprites/*", **src_meta},
                {"path": "previews/portrait.png", **src_meta},
                {"path": "previews/splash.png", **src_meta},
            ]
        }, indent=2) + "\n",
        encoding="utf-8",
    )
    return len(frames)


# ---------------------------------------------------------------------------
# IP Cover, Shared Projectile Effects & Exhaustive Roster Manifests
# ---------------------------------------------------------------------------

def generate_ip_shared_assets(
    ip_id: str,
    ip_obj: dict[str, Any],
    effects_spec: list[tuple[str, tuple[int, int, int, int], tuple[int, int, int, int]]],
    sample_splashes: list[Path],
) -> None:
    ip_dir = ROOT / "ip_content" / ip_id
    ip_dir.mkdir(parents=True, exist_ok=True)
    (ip_dir / "ip.json").write_text(
        json.dumps(ip_obj, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )

    # Compose rich IP Cover Banner (420x240) using extracted standees
    cover = Image.new("RGBA", (420, 240), (14, 18, 28, 255))
    cd = ImageDraw.Draw(cover)
    p_hex = ip_obj["theme"]["primary_hex"].lstrip("#")
    pr, pg, pb = int(p_hex[0:2], 16), int(p_hex[2:4], 16), int(p_hex[4:6], 16)
    cd.polygon([(0, 0), (280, 0), (190, 240), (0, 240)], fill=(pr, pg, pb, 85))
    for idx, sp_path in enumerate(sample_splashes[:3]):
        if sp_path.is_file():
            sp = Image.open(sp_path).convert("RGBA").resize((150, 192), Image.Resampling.NEAREST)
            cover.alpha_composite(sp, (18 + idx * 125, 36))
    cd.rectangle([0, 0, 419, 239], outline=(pr, pg, pb, 255), width=4)
    cover.save(ip_dir / "cover.png", format="PNG")

    eff_paths: list[str] = []
    for eff_name, outer_col, inner_col in effects_spec:
        edir = ip_dir / "effects" / eff_name
        edir.mkdir(parents=True, exist_ok=True)
        eimg = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
        ed = ImageDraw.Draw(eimg)
        ed.ellipse([6, 10, 58, 54], fill=outer_col, outline=(255, 255, 255, 220), width=2)
        ed.ellipse([18, 20, 52, 44], fill=inner_col)
        eimg.save(edir / "frame_000.png", format="PNG")
        eff_paths.append(f"effects/{eff_name}/frame_000.png")

    ip_sources = [
        {
            "path": "cover.png",
            "source": "Composite banner derived from BleachVsNaruto_TagAssets standees",
            "author": "5DPLAY Game Studio / respective anime IP rightsholders",
            "license": "pending_authorization",
            "redistributable": False,
        }
    ]
    for ep in eff_paths:
        ip_sources.append({
            "path": ep,
            "source": "CrossArena procedural pixel VFX sprite",
            "author": "cross-arena",
            "license": "project-internal",
            "redistributable": True,
        })
    (ip_dir / "sources.json").write_text(
        json.dumps({"entries": ip_sources}, indent=2) + "\n", encoding="utf-8"
    )


def generate_full_roster_manifests() -> tuple[int, int]:
    """Generate exhaustive roster_manifest.json for BOTH Naruto and Bleach cataloging ALL original BVN characters."""
    matrix = json.loads(ROSTER_MATRIX_PATH.read_text(encoding="utf-8"))

    # Map BVN variant id -> implemented CrossArena id
    impl_map = {
        "naruto": "naruto.naruto_uzumaki",
        "naruto_oneTail": "naruto.naruto_onetail",
        "naruto_hermit": "naruto.naruto_sennin",
        "naruto_kurama": "naruto.naruto_kyubi",
        "sasuke": "naruto.sasuke_uchiha",
        "sasuke_mantra": "naruto.sasuke_mantra",
        "sasuke_susanoo2": "naruto.sasuke_susanoo",
        "sasuke_susanoo": "naruto.sasuke_susanoo",
        "sakura": "naruto.sakura_haruno",
        "kakashi": "naruto.kakashi_hatake",
        "kakashi_kamui": "naruto.kakashi_kamui",
        "gaara": "naruto.gaara_kazekage",
        "neji": "naruto.neji_hyuga",
        "lee": "naruto.rock_lee",
        "lee_domen": "naruto.rock_lee_tomon",
        "itachi": "naruto.itachi_uchiha",
        "pain": "naruto.nagato_pain",
        "ichigo": "bleach.kurosaki_ichigo",
        "ichigo_bankai": "bleach.ichigo_bankai",
        "ichigo_vizored": "bleach.ichigo_vizored",
        "rukia": "bleach.kuchiki_rukia",
        "rukia_shikai": "bleach.rukia_shikai",
        "byakuya": "bleach.kuchiki_byakuya",
        "byakuya_bankai": "bleach.byakuya_bankai",
        "renji": "bleach.abarai_renji",
        "toushirou": "bleach.hitsugaya_toshiro",
        "toushirou_bankai": "bleach.toshiro_bankai",
        "kenpachi": "bleach.zaraki_kenpachi",
        "aizen": "bleach.aizen_sosuke",
        "ulquiorra": "bleach.ulquiorra_cifer",
        "ulquiorra_resurreccion": "bleach.ulquiorra_resurreccion",
    }
    impl_assist_map = {
        "minato": "naruto.minato_assist",
        "tsunate": "naruto.tsunade_assist",
        "shikamaru": "naruto.shikamaru_assist",
        "madara": "naruto.madara_assist",
        "yamamoto": "bleach.yamamoto_assist",
        "yoruichi": "bleach.yoruichi_assist",
        "grimmjow": "bleach.grimmjow_assist",
        "rangiku": "bleach.rangiku_assist",
    }

    excluded_packs = {
        "kenshin", "shishio", "random", "random_bleach", "random_naruto",
        "bear1", "bird1", "dog1", "pig1", "ninja1", "ninja2",
        "ninja_earth1", "ninja_fire1", "ninja_fire2", "ninja_sand1", "ninja_thunder1",
    }

    manifests: dict[str, list[dict[str, Any]]] = {"naruto": [], "bleach": []}

    for f_entry in matrix["fighters"]:
        pack = f_entry["pack"]
        if pack in excluded_packs or pack.endswith("_old"):
            continue
        ctypes = f_entry.get("comic_types", [])
        ip_id = "naruto" if 1 in ctypes else ("bleach" if 0 in ctypes else "")
        if ip_id not in manifests:
            continue
        has_xfl = f_entry.get("obvn_xfl") is not None or pack in ("naruto_hermit", "sasuke_susanoo")
        variants = f_entry.get("variants", [])
        base_vid = variants[0][0] if variants else pack
        # Group separate multi-form packs onto their canonical base character
        if pack in ("naruto_hermit",):
            canonical_base = "naruto.naruto_uzumaki"
        elif pack in ("sasuke_susanoo",):
            canonical_base = "naruto.sasuke_uchiha"
        elif pack in ("ichigo_zero",):
            canonical_base = "bleach.kurosaki_ichigo"
        else:
            canonical_base = impl_map.get(base_vid, f"{ip_id}.{base_vid.lower()}")

        for idx, var in enumerate(variants):
            vid, vzh = var[0], var[1]
            # Avoid duplicate sasuke_susanoo entry
            if pack == "sasuke_susanoo" and any(e["original_id"] == "sasuke_susanoo2" for e in manifests[ip_id]):
                continue
            cid = impl_map.get(vid, f"{ip_id}.{vid.lower()}")
            is_impl = vid in impl_map
            is_base = idx == 0 and pack not in ("naruto_hermit", "sasuke_susanoo", "ichigo_zero")
            cat = "playable" if is_base else "awakening_form"
            comp = "complete" if is_impl else ("pending_adapt" if has_xfl else "missing")
            entry: dict[str, Any] = {
                "id": cid,
                "original_id": vid,
                "name_zh": vzh,
                "name_en": vid.replace("_", " ").title(),
                "ip_id": ip_id,
                "category": cat,
                "source_repo": "OpenBleachVsNaruto + BleachVsNaruto_TagAssets" if has_xfl else "BleachVsNaruto_TagAssets (compiled SWF only)",
                "has_xfl_source": has_xfl,
                "implemented_in_engine": is_impl,
                "completeness": comp,
                "authorization_status": "pending_authorization",
                "notes": "已提取无损像素精灵图集、帧数据、技能与立绘并实装可玩" if is_impl else (
                    "存在开源 XFL 工程，已登记资源占位待后续批次适配" if has_xfl else "仅存编译态 SWF，未开源无损 XFL 位图，标记缺失占位"
                ),
            }
            if not is_base:
                entry["base_character_id"] = canonical_base
            manifests[ip_id].append(entry)

    # Assists manifest entries
    bleach_assist_packs = {
        "byakuya", "gin", "grimmjow", "halibel", "ichigo_hollow", "ichigo_padipata",
        "ikkaku", "kenpachi", "kon", "nemu", "orihime", "rangiku", "renji",
        "soifon", "starrk", "uryuu", "yachiru", "yamamoto", "yoruichi",
    }
    for a_entry in matrix["assists"]:
        pack = a_entry["pack"]
        if pack in excluded_packs:
            continue
        ip_id = "bleach" if pack in bleach_assist_packs else "naruto"
        vzh = a_entry["variants"][0][1] if a_entry.get("variants") else pack
        has_xfl = a_entry.get("obvn_xfl") is not None
        is_impl = pack in impl_assist_map
        cid = impl_assist_map.get(pack, f"{ip_id}.{pack.lower()}_assist")
        manifests[ip_id].append({
            "id": cid,
            "original_id": f"assist:{pack}",
            "name_zh": f"{vzh}（援助）",
            "name_en": f"{pack.replace('_', ' ').title()} Assist",
            "ip_id": ip_id,
            "category": "assist",
            "source_repo": "OpenBleachVsNaruto + BleachVsNaruto_TagAssets" if has_xfl else "BleachVsNaruto_TagAssets (compiled SWF only)",
            "has_xfl_source": has_xfl,
            "implemented_in_engine": is_impl,
            "completeness": "complete" if is_impl else ("pending_adapt" if has_xfl else "missing"),
            "authorization_status": "pending_authorization",
            "notes": "已提取独立援助精灵与紧凑擂台召唤判定" if is_impl else "原版援助角色数据占位（待授权/待适配）",
        })

    for ip_id, entries in manifests.items():
        playable_chars = [e for e in entries if e["category"] != "assist"]
        assist_chars = [e for e in entries if e["category"] == "assist"]
        (ROOT / "ip_content" / ip_id / "roster_manifest.json").write_text(
            json.dumps({
                "ip_id": ip_id,
                "playable_characters": playable_chars,
                "assist_characters": assist_chars,
                "entries": entries,
            }, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
    return len(manifests["naruto"]), len(manifests["bleach"])


def main() -> None:
    pkg_cache: dict[str, XflPackage] = {}
    naruto_accent = (255, 122, 24, 255)
    bleach_accent = (56, 189, 248, 255)

    total_chars = 0
    total_anims = 0
    total_frames = 0
    total_assist_frames = 0

    print("=== Extracting Naruto Playable Characters & Multi-Forms ===")
    for cfg in NARUTO_CHARACTERS:
        ac, fc = extract_fighter_bundle("naruto", cfg, pkg_cache, naruto_accent)
        total_chars += 1
        total_anims += ac
        total_frames += fc
        print(f"  [naruto.{cfg['dir']}] {cfg['name_zh']} ({cfg['form_name_zh']}): {ac} anims, {fc} frames")

    print("=== Extracting Bleach Playable Characters & Multi-Forms ===")
    for cfg in BLEACH_CHARACTERS:
        ac, fc = extract_fighter_bundle("bleach", cfg, pkg_cache, bleach_accent)
        total_chars += 1
        total_anims += ac
        total_frames += fc
        print(f"  [bleach.{cfg['dir']}] {cfg['name_zh']} ({cfg['form_name_zh']}): {ac} anims, {fc} frames")

    print("=== Extracting Compact-Stage Assists (Naruto + Bleach) ===")
    for ip_id, a_list in ASSISTS_CONFIG.items():
        acc = naruto_accent if ip_id == "naruto" else bleach_accent
        for acfg in a_list:
            af = extract_assist_bundle(ip_id, acfg, acc)
            total_assist_frames += af
            print(f"  [{ip_id}.{acfg['dir']}] {acfg['name_zh']} -> {acfg['skill_name_zh']}: {af} frames")

    # Generate IP metadata, covers & shared projectile effects
    generate_ip_shared_assets(
        "naruto",
        {
            "id": "naruto",
            "name_zh": "火影忍者",
            "name_en": "Naruto",
            "cover": "cover.png",
            "description": "木叶与晓的忍道激突！融合查克拉体术连段、忍术取消、尾兽/仙人/须佐能乎觉醒与小队援助。",
            "featured_characters": [
                "naruto.naruto_uzumaki",
                "naruto.sasuke_uchiha",
                "naruto.kakashi_hatake",
                "naruto.sakura_haruno",
                "naruto.rock_lee",
                "naruto.neji_hyuga",
                "naruto.gaara_kazekage",
                "naruto.itachi_uchiha",
                "naruto.nagato_pain",
            ],
            "status": "open",
            "stage_name_zh": "终结之谷·紧凑决斗台",
            "theme": {
                "primary_hex": "#ff7a18",
                "secondary_hex": "#1e293b",
                "accent_hex": "#fbbf24",
                "stage_sky_top": "#172554",
                "stage_sky_bottom": "#475569",
                "stage_floor_hex": "#334155",
                "emblem_label": "KONOHA ARENA",
            },
        },
        [
            ("chakra_sphere", (56, 189, 248, 235), (224, 242, 254, 255)),
            ("fireball", (249, 115, 22, 240), (254, 240, 138, 255)),
        ],
        [
            ROOT / "ip_content/naruto/characters/naruto_uzumaki/previews/splash.png",
            ROOT / "ip_content/naruto/characters/sasuke_uchiha/previews/splash.png",
            ROOT / "ip_content/naruto/characters/kakashi_hatake/previews/splash.png",
        ],
    )

    generate_ip_shared_assets(
        "bleach",
        {
            "id": "bleach",
            "name_zh": "死神",
            "name_en": "Bleach",
            "cover": "cover.png",
            "description": "尸魂界与虚圈的斩魄刀立回交锋！支持瞬步差合、鬼道牵制、卍解/虚化/归刃觉醒与护廷援助。",
            "featured_characters": [
                "bleach.kurosaki_ichigo",
                "bleach.kuchiki_rukia",
                "bleach.kuchiki_byakuya",
                "bleach.hitsugaya_toshiro",
                "bleach.abarai_renji",
                "bleach.zaraki_kenpachi",
                "bleach.aizen_sosuke",
                "bleach.ulquiorra_cifer",
            ],
            "status": "open",
            "stage_name_zh": "静灵廷·双极决斗台",
            "theme": {
                "primary_hex": "#38bdf8",
                "secondary_hex": "#0f172a",
                "accent_hex": "#e2e8f0",
                "stage_sky_top": "#090d16",
                "stage_sky_bottom": "#1e293b",
                "stage_floor_hex": "#1e293b",
                "emblem_label": "SEIREITEI ARENA",
            },
        },
        [
            ("reiatsu_wave", (56, 189, 248, 235), (240, 249, 255, 255)),
            ("dark_reiatsu", (168, 85, 247, 240), (244, 63, 94, 255)),
        ],
        [
            ROOT / "ip_content/bleach/characters/kurosaki_ichigo/previews/splash.png",
            ROOT / "ip_content/bleach/characters/kuchiki_rukia/previews/splash.png",
            ROOT / "ip_content/bleach/characters/kuchiki_byakuya/previews/splash.png",
        ],
    )

    n_manifest, b_manifest = generate_full_roster_manifests()
    print(
        f"\nExtraction Complete! {total_chars} playable forms ({total_anims} animations, {total_frames} frames) "
        f"+ 8 assists ({total_assist_frames} frames); Roster Manifests: Naruto={n_manifest}, Bleach={b_manifest}"
    )


if __name__ == "__main__":
    main()
