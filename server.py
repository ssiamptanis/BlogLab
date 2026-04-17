"""
ABX PDF Builder — Flask backend
Supabase-backed: templates, folders, and image uploads stored in Supabase.
Auth: Supabase JWT validated on every /api/ route.
"""

import os
import sys
import uuid
import time
import datetime
import tempfile
import traceback
from functools import wraps
import requests as _requests
import jwt as _pyjwt
from flask import Flask, request, send_file, send_from_directory, jsonify, g
from flask_cors import CORS

# ── Load .env ─────────────────────────────────────────────────────────────────

from dotenv import load_dotenv
load_dotenv()

# ── Imports ───────────────────────────────────────────────────────────────────

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from builder import PDFBuilder

# ── Flask app ─────────────────────────────────────────────────────────────────

app = Flask(__name__)

# Auth is JWT via Authorization header — no credentials mode needed, allow all origins.
CORS(app, resources={r"/api/*": {"origins": "*"}},
     allow_headers=["Content-Type", "Authorization"])

# ── Supabase client ───────────────────────────────────────────────────────────

from supabase import create_client, Client as SupabaseClient

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_KEY"]          # anon/public key
SUPABASE_JWT_SECRET = os.environ.get("SUPABASE_JWT_SECRET", "")

_sb: SupabaseClient = create_client(SUPABASE_URL, SUPABASE_KEY)

# ── Supabase storage helpers ───────────────────────────────────────────────────

def _signed_url(url_res) -> str | None:
    """Extract signed URL from supabase-py v1 (dict) or v2 (response object)."""
    if url_res is None:
        return None
    # supabase-py v2+: response object with .data dict
    if hasattr(url_res, 'data'):
        data = url_res.data or {}
        return data.get("signedUrl") or data.get("signedURL")
    # supabase-py v1: plain dict
    if isinstance(url_res, dict):
        return (url_res.get("signedURL")
                or (url_res.get("data") or {}).get("signedUrl")
                or (url_res.get("data") or {}).get("signedURL"))
    return None

# ── Auth middleware ────────────────────────────────────────────────────────────

def require_auth(f):
    """Decorator: verify Supabase JWT (local if secret available, else API), set g.user_id."""
    @wraps(f)
    def wrapper(*args, **kwargs):
        auth = request.headers.get("Authorization", "")
        if not auth.startswith("Bearer "):
            return jsonify({"error": "Unauthorized"}), 401
        token = auth.split(" ", 1)[1]
        try:
            if SUPABASE_JWT_SECRET:
                # Fast path: verify locally, zero network round-trip
                payload = _pyjwt.decode(
                    token,
                    SUPABASE_JWT_SECRET,
                    algorithms=["HS256"],
                    options={"verify_aud": False},
                )
                g.user_id = payload["sub"]
            else:
                # Fallback: validate via Supabase API (slower but always works)
                user_resp = _sb.auth.get_user(token)
                g.user_id = user_resp.user.id
            g.token = token
        except Exception as e:
            return jsonify({"error": f"Invalid token: {e}"}), 401
        return f(*args, **kwargs)
    return wrapper


def _sb_user():
    """Return a Supabase client scoped to the current user's JWT (RLS applies)."""
    from supabase import create_client
    client = create_client(SUPABASE_URL, SUPABASE_KEY)
    client.postgrest.auth(g.token)
    client.storage._client.headers["Authorization"] = f"Bearer {g.token}"
    return client


# ── Static asset dirs (icons + fonts stay local on the server) ────────────────

ICONS_DIR  = os.path.join(os.path.dirname(os.path.abspath(__file__)), "assets", "icons", "Icongraphy", "Icongraphy")
IMAGES_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "assets", "images")
DIST_DIR   = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dist")

ALLOWED_EXTS = {'.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'}

# ── Templates list cache (global — all users see all templates) ───────────────
_templates_cache = {}   # key -> {'data': {...}, 'ts': float}
TEMPLATES_CACHE_TTL = 60  # seconds
_GLOBAL_CACHE_KEY   = '__global__'

def _templates_cache_get(user_id):
    entry = _templates_cache.get(_GLOBAL_CACHE_KEY)
    if entry and time.time() - entry['ts'] < TEMPLATES_CACHE_TTL:
        return entry['data']
    return None

def _templates_cache_set(user_id, data):
    _templates_cache[_GLOBAL_CACHE_KEY] = {'data': data, 'ts': time.time()}

def _templates_cache_invalidate(user_id):
    _templates_cache.pop(_GLOBAL_CACHE_KEY, None)

# ── Figma illustration library ─────────────────────────────────────────────────
FIGMA_FILE_KEY   = 'JZR9yXgaHwwQVvFgPfDnxn'
_figma_cache     = {'data': None, 'ts': 0}
FIGMA_CACHE_TTL  = 86400  # 24 hours

ILLUSTRATIONS = [
    {'node_id': '8376:462',  'name': 'Illustration 1', 'category': 'Illustrations'},
    {'node_id': '8399:1140', 'name': 'Illustration 2', 'category': 'Illustrations'},
    {'node_id': '8399:1141', 'name': 'Illustration 3', 'category': 'Illustrations'},
    {'node_id': '8399:1142', 'name': 'Illustration 4',  'category': 'Illustrations'},
    {'node_id': '8399:1143', 'name': 'Illustration 5',  'category': 'Illustrations'},
    {'node_id': '8399:1144', 'name': 'Illustration 6',  'category': 'Illustrations'},
    {'node_id': '8399:1148', 'name': 'Illustration 7',  'category': 'Illustrations'},
    {'node_id': '8399:1149', 'name': 'Illustration 8',  'category': 'Illustrations'},
    {'node_id': '8399:1150', 'name': 'Illustration 9',  'category': 'Illustrations'},
    {'node_id': '8399:1151', 'name': 'Illustration 10', 'category': 'Illustrations'},
    {'node_id': '8399:1152', 'name': 'Illustration 11', 'category': 'Illustrations'},
    {'node_id': '8399:1153', 'name': 'Illustration 12', 'category': 'Illustrations'},
    {'node_id': '8399:1154', 'name': 'Illustration 13', 'category': 'Illustrations'},
    {'node_id': '8399:1155', 'name': 'Illustration 14', 'category': 'Illustrations'},
    {'node_id': '8399:1156', 'name': 'Illustration 15', 'category': 'Illustrations'},
]

# In-memory SVG URL cache — keyed by node_id, value = signed URL string
_svg_url_cache = {}

def _prewarm_illustrations():
    """On startup: fetch SVGs, upload to shared Supabase path, cache signed URLs."""
    import time as _time
    _time.sleep(5)  # wait for server to fully start
    token = os.environ.get('FIGMA_TOKEN')
    if not token:
        print('[prewarm] no FIGMA_TOKEN, skipping', flush=True)
        return
    headers = {'X-Figma-Token': token}

    # Fetch thumbnails for picker
    node_ids = ','.join(i['node_id'] for i in ILLUSTRATIONS)
    try:
        r = _requests.get(
            f'https://api.figma.com/v1/images/{FIGMA_FILE_KEY}?ids={node_ids}&format=png&scale=0.5',
            headers=headers, timeout=30
        )
        thumbs = r.json().get('images', {}) if r.ok else {}
    except Exception as e:
        print(f'[prewarm] thumbnail error: {e}', flush=True)
        thumbs = {}

    # Fetch real node names from Figma (e.g. "Research/Woman with lightbulb")
    figma_names = {}
    try:
        # Use params= so requests properly URL-encodes colons in node IDs (%3A)
        rn = _requests.get(
            f'https://api.figma.com/v1/files/{FIGMA_FILE_KEY}/nodes',
            params={'ids': node_ids},
            headers=headers, timeout=30
        )
        print(f'[prewarm] nodes API status: {rn.status_code}', flush=True)
        print(f'[prewarm] nodes API url: {rn.url}', flush=True)
        if rn.ok:
            nodes_data = rn.json().get('nodes') or {}
            print(f'[prewarm] nodes keys: {list(nodes_data.keys())}', flush=True)
            for nid, node_data in nodes_data.items():
                doc = (node_data or {}).get('document', {})
                name = doc.get('name', '')
                print(f'[prewarm] node {nid!r} → name: {name!r}', flush=True)
                if name:
                    # Normalise key to colon format so lookup works against item['node_id']
                    figma_names[nid.replace('-', ':')] = name
        else:
            print(f'[prewarm] nodes API error body: {rn.text[:500]}', flush=True)
    except Exception as e:
        print(f'[prewarm] node name error: {e}', flush=True)

    result = []
    for item in ILLUSTRATIONS:
        nid = item['node_id']
        safe = nid.replace(':', '-').replace('/', '-')
        storage_path = f"shared/figma/{safe}.svg"

        # Check if SVG already in shared Supabase storage
        svg_url = None
        try:
            files = _sb.storage.from_("abx-images").list("shared/figma")
            if any(f.get('name') == f"{safe}.svg" for f in (files or [])):
                url_res = _sb.storage.from_("abx-images").create_signed_url(storage_path, 60 * 60 * 24 * 365)
                svg_url = _signed_url(url_res)
                print(f'[prewarm] SVG cache hit: {nid}', flush=True)
        except Exception as e:
            print(f'[prewarm] cache check error: {e}', flush=True)

        if not svg_url:
            # Fetch SVG from Figma and upload to shared storage
            try:
                r2 = _requests.get(
                    f'https://api.figma.com/v1/images/{FIGMA_FILE_KEY}?ids={nid}&format=svg',
                    headers=headers, timeout=30
                )
                svg_export_url = (r2.json().get('images') or {}).get(nid) if r2.ok else None
                if svg_export_url:
                    svg_bytes = _requests.get(svg_export_url, timeout=30).content
                    _sb.storage.from_("abx-images").upload(
                        path=storage_path,
                        file=svg_bytes,
                        file_options={"content-type": "image/svg+xml", "upsert": "true"},
                    )
                    url_res = _sb.storage.from_("abx-images").create_signed_url(storage_path, 60 * 60 * 24 * 365)
                    svg_url = _signed_url(url_res)
                    print(f'[prewarm] SVG uploaded and cached: {nid}', flush=True)
            except Exception as e:
                print(f'[prewarm] SVG upload error: {e}', flush=True)

        if svg_url:
            _svg_url_cache[nid] = svg_url

        result.append({
            'name':     figma_names.get(nid) or item['name'],
            'node_id':  nid,
            'url':      thumbs.get(nid, ''),
            'svg_url':  svg_url or '',
            'category': item['category'],
        })

    _figma_cache['data'] = result
    import time as _time2
    _figma_cache['ts'] = _time2.time()
    print(f'[prewarm] done — {len(result)} illustrations ready', flush=True)

import threading as _threading
_threading.Thread(target=_prewarm_illustrations, daemon=True).start()

# ── Default template IDs (set via Railway env vars) ───────────────────────────
# Maps template_type slug -> env var name that holds the default template UUID
_DEFAULT_TEMPLATE_ENV = {
    'insight-report': 'DEFAULT_INSIGHT_REPORT_ID',
    'infographic':    'DEFAULT_INFOGRAPHIC_ID',
}

# ── Template routes ───────────────────────────────────────────────────────────

@app.route("/api/template-default/<tmpl_type>", methods=["GET"])
@require_auth
def get_template_default(tmpl_type):
    """Return blocks from the configured default template for a type, or empty."""
    env_key = _DEFAULT_TEMPLATE_ENV.get(tmpl_type)
    default_id = os.environ.get(env_key, '') if env_key else ''
    if not default_id:
        return jsonify({"blocks": None})
    # Fetch using service key so we can read any user's template (it's a global default)
    res = _sb.table("templates") \
              .select("doc") \
              .eq("id", default_id) \
              .maybe_single() \
              .execute()
    if not res.data or not res.data.get("doc"):
        return jsonify({"blocks": None})
    blocks = res.data["doc"].get("blocks") or []
    return jsonify({"blocks": blocks})


@app.route("/api/templates", methods=["GET"])
@require_auth
def list_templates():
    cached = _templates_cache_get(g.user_id)
    if cached:
        return jsonify(cached)
    sb = _sb_user()
    res = sb.table("templates") \
             .select("id,user_id,name,status,folder_id,template_type,created_at,updated_at,block_count,block_types,thumb,doc") \
             .order("updated_at", desc=True) \
             .execute()
    folders_res = sb.table("folders") \
                    .select("*") \
                    .eq("user_id", g.user_id) \
                    .order("created_at") \
                    .execute()
    # Extract author info from doc — avoids sending full block payloads to dashboard
    templates = []
    for t in res.data:
        doc = t.pop("doc", None) or {}
        t["doc_author"]        = doc.get("docAuthor", "")
        t["doc_author_avatar"] = doc.get("docAuthorAvatar", "")
        t["doc_image_url"]     = doc.get("previewJpeg") or doc.get("imageUrl", "")
        templates.append(t)
    data = {"templates": templates, "folders": folders_res.data}
    _templates_cache_set(g.user_id, data)
    return jsonify(data)


@app.route("/api/templates", methods=["POST"])
@require_auth
def create_template():
    data = request.get_json(force=True)
    doc  = data.get("doc", {"filename": "untitled.pdf", "docTitle": "", "docAuthor": "", "blocks": []})
    blocks = doc.get("blocks", [])
    payload = {
        "user_id":       g.user_id,
        "name":          data.get("name", "Untitled"),
        "status":        data.get("status", "draft"),
        "folder_id":     data.get("folder_id") or None,
        "template_type": data.get("template_type") or None,
        "doc":           doc,
        "block_count":   len(blocks),
        "block_types":   [b.get("type", "text") for b in blocks],
    }
    sb = _sb_user()
    res = sb.table("templates").insert(payload).execute()
    _templates_cache_invalidate(g.user_id)
    return jsonify(res.data[0]), 201


@app.route("/api/templates/<tid>", methods=["GET"])
@require_auth
def get_template(tid):
    sb = _sb_user()
    res = sb.table("templates") \
             .select("*") \
             .eq("id", tid) \
             .maybe_single() \
             .execute()
    if not res.data:
        return jsonify({"error": "Not found"}), 404
    return jsonify(res.data)


@app.route("/api/templates/<tid>/copy", methods=["POST"])
@require_auth
def copy_template(tid):
    """Duplicate any template into the current user's own files."""
    sb = _sb_user()
    src = sb.table("templates") \
             .select("*") \
             .eq("id", tid) \
             .maybe_single() \
             .execute()
    if not src.data:
        return jsonify({"error": "Not found"}), 404
    orig = src.data
    doc  = orig.get("doc") or {}
    payload = {
        "user_id":       g.user_id,
        "name":          "Copy of " + orig.get("name", "Untitled"),
        "status":        "draft",
        "folder_id":     None,
        "template_type": orig.get("template_type"),
        "doc":           doc,
        "block_count":   orig.get("block_count", 0),
        "block_types":   orig.get("block_types", []),
    }
    res = sb.table("templates").insert(payload).execute()
    _templates_cache_invalidate(g.user_id)
    return jsonify(res.data[0]), 201


@app.route("/api/templates/<tid>", methods=["PUT"])
@require_auth
def update_template(tid):
    data  = request.get_json(force=True)
    patch = {}
    if "name"          in data: patch["name"]          = data["name"]
    if "status"        in data: patch["status"]        = data["status"]
    if "folder_id"     in data: patch["folder_id"]     = data["folder_id"] or None
    if "template_type" in data: patch["template_type"] = data["template_type"] or None
    if "thumb"         in data: patch["thumb"]         = data["thumb"]
    if "doc"           in data:
        patch["doc"] = data["doc"]
        blocks = data["doc"].get("blocks", [])
        patch["block_count"] = len(blocks)
        patch["block_types"] = [b.get("type", "text") for b in blocks]

    sb = _sb_user()
    res = sb.table("templates") \
             .update(patch) \
             .eq("id", tid) \
             .eq("user_id", g.user_id) \
             .execute()
    if not res.data:
        return jsonify({"error": "Not found"}), 404
    _templates_cache_invalidate(g.user_id)
    return jsonify(res.data[0])


@app.route("/api/templates/<tid>", methods=["DELETE"])
@require_auth
def delete_template(tid):
    sb = _sb_user()
    sb.table("templates") \
      .delete() \
      .eq("id", tid) \
      .eq("user_id", g.user_id) \
      .execute()
    _templates_cache_invalidate(g.user_id)
    return jsonify({"ok": True})


# ── Folder routes ─────────────────────────────────────────────────────────────

@app.route("/api/folders", methods=["GET"])
@require_auth
def list_folders():
    sb = _sb_user()
    res = sb.table("folders") \
             .select("*") \
             .eq("user_id", g.user_id) \
             .order("created_at") \
             .execute()
    return jsonify(res.data)


@app.route("/api/folders", methods=["POST"])
@require_auth
def create_folder():
    data = request.get_json(force=True)
    sb = _sb_user()
    res = sb.table("folders").insert({
        "user_id": g.user_id,
        "name":    data.get("name", "New Folder"),
    }).execute()
    _templates_cache_invalidate(g.user_id)
    return jsonify(res.data[0]), 201


@app.route("/api/folders/<fid>", methods=["PUT"])
@require_auth
def rename_folder(fid):
    data = request.get_json(force=True)
    sb = _sb_user()
    sb.table("folders") \
      .update({"name": data.get("name", "Folder")}) \
      .eq("id", fid) \
      .eq("user_id", g.user_id) \
      .execute()
    _templates_cache_invalidate(g.user_id)
    return jsonify({"ok": True})


@app.route("/api/folders/<fid>", methods=["DELETE"])
@require_auth
def delete_folder(fid):
    sb = _sb_user()
    # Orphan templates in this folder
    sb.table("templates") \
      .update({"folder_id": None}) \
      .eq("folder_id", fid) \
      .eq("user_id", g.user_id) \
      .execute()
    sb.table("folders") \
      .delete() \
      .eq("id", fid) \
      .eq("user_id", g.user_id) \
      .execute()
    _templates_cache_invalidate(g.user_id)
    return jsonify({"ok": True})


# ── Icon routes (served from local assets — read-only library) ────────────────

@app.route("/api/icons", methods=["GET"])
@require_auth
def list_icons():
    if not os.path.exists(ICONS_DIR):
        return jsonify([])
    files = sorted(
        f for f in os.listdir(ICONS_DIR)
        if os.path.splitext(f)[1].lower() in {'.png', '.svg', '.jpg', '.webp'}
    )
    return jsonify(files)


@app.route("/api/icon-file/<path:filename>", methods=["GET"])
def serve_icon_file(filename):
    return send_from_directory(ICONS_DIR, filename)


# ── Image routes (stored in Supabase Storage) ─────────────────────────────────

@app.route("/api/images", methods=["GET"])
@require_auth
def list_images():
    """List images uploaded by this user from Supabase Storage."""
    try:
        prefix = f"{g.user_id}/"
        res = _sb.storage.from_("abx-images").list(prefix)
        files = [f["name"] for f in (res or []) if f.get("name")]
        result = []
        for name in files:
            storage_path = f"{g.user_id}/{name}"
            url_res = _sb.storage.from_("abx-images").create_signed_url(storage_path, 60 * 60 * 24 * 365)
            result.append({"name": name, "url": _signed_url(url_res)})
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/images", methods=["POST"])
@require_auth
def upload_image():
    """Upload image to Supabase Storage under user's prefix."""
    if 'file' not in request.files:
        return jsonify({"error": "No file provided"}), 400
    f = request.files['file']
    if not f.filename:
        return jsonify({"error": "Empty filename"}), 400
    ext = os.path.splitext(f.filename)[1].lower()
    if ext not in ALLOWED_EXTS:
        return jsonify({"error": f"File type {ext} not allowed"}), 400
    safe_name = "".join(c for c in f.filename if c.isalnum() or c in '._- ').strip() or f"upload{ext}"
    storage_path = f"{g.user_id}/{safe_name}"
    file_bytes = f.read()
    try:
        _sb.storage.from_("abx-images").upload(
            path=storage_path,
            file=file_bytes,
            file_options={"content-type": f.content_type or "application/octet-stream", "upsert": "true"},
        )
        # Return a signed URL valid for 1 year
        url_res = _sb.storage.from_("abx-images").create_signed_url(storage_path, 60 * 60 * 24 * 365)
        return jsonify({"filename": safe_name, "url": _signed_url(url_res)})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/image-url/<path:filename>", methods=["GET"])
@require_auth
def image_url(filename):
    """Get a fresh signed URL for an image."""
    storage_path = f"{g.user_id}/{filename}"
    try:
        url_res = _sb.storage.from_("abx-images").create_signed_url(storage_path, 60 * 60 * 24)
        return jsonify({"url": _signed_url(url_res)})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ── Figma illustration library ────────────────────────────────────────────────

@app.route("/api/figma-names-debug", methods=["GET"])
@require_auth
def figma_names_debug():
    """Live test: hit the Figma nodes API right now and return raw name results."""
    token = os.environ.get('FIGMA_TOKEN')
    if not token:
        return jsonify({"error": "no FIGMA_TOKEN"})
    node_ids = ','.join(i['node_id'] for i in ILLUSTRATIONS)
    headers = {'X-Figma-Token': token}
    try:
        rn = _requests.get(
            f'https://api.figma.com/v1/files/{FIGMA_FILE_KEY}/nodes',
            params={'ids': node_ids},
            headers=headers, timeout=30
        )
        raw = rn.json() if rn.ok else {'status': rn.status_code, 'body': rn.text[:500]}
        names = {}
        if rn.ok:
            for nid, node_data in (raw.get('nodes') or {}).items():
                doc = (node_data or {}).get('document', {})
                names[nid] = doc.get('name', '(no name)')
        return jsonify({
            'request_url': rn.url,
            'status': rn.status_code,
            'names': names,
            'cache': _figma_cache['data'],
        })
    except Exception as e:
        return jsonify({"error": str(e)})


@app.route("/api/figma-assets", methods=["GET"])
@require_auth
def figma_assets():
    # Serve from pre-warmed in-memory cache — instant response
    if _figma_cache['data']:
        return jsonify(_figma_cache['data'])
    # Still warming up — return skeleton so picker isn't empty
    return jsonify([{
        'name':     item['name'],
        'node_id':  item['node_id'],
        'url':      '',
        'svg_url':  _svg_url_cache.get(item['node_id'], ''),
        'category': item['category'],
    } for item in ILLUSTRATIONS])


def _trim_svg_with_figma_bounds(svg_bytes, node_id, token):
    """Use Figma nodes API absoluteBoundingBox to trim SVG viewBox accurately."""
    import xml.etree.ElementTree as ET

    SVG_NS = 'http://www.w3.org/2000/svg'

    try:
        resp = _requests.get(
            f'https://api.figma.com/v1/files/{FIGMA_FILE_KEY}/nodes?ids={node_id}',
            headers={'X-Figma-Token': token},
            timeout=15
        )
        print(f'[trim] nodes API status={resp.status_code} node={node_id}', flush=True)
        if not resp.ok:
            return svg_bytes

        data = resp.json()
        nodes = data.get('nodes') or {}
        node_data = nodes.get(node_id) or nodes.get(node_id.replace('-', ':'))
        if not node_data:
            print(f'[trim] node not found in response, keys={list(nodes.keys())}', flush=True)
            return svg_bytes

        doc = node_data.get('document', {})
        frame_box = doc.get('absoluteBoundingBox')
        if not frame_box:
            print(f'[trim] no absoluteBoundingBox on frame', flush=True)
            return svg_bytes

        frame_x = frame_box['x']
        frame_y = frame_box['y']
        frame_w = frame_box['width']
        frame_h = frame_box['height']
        print(f'[trim] frame={frame_w}x{frame_h}', flush=True)

        # Collect LEAF node bounding boxes only (actual shapes, not containers).
        # Skip: invisible nodes, and any leaf spanning ≥95% of the frame in both
        # dimensions (almost certainly a background rectangle).
        content_boxes = []

        def collect_boxes(node):
            if node.get('visible') is False:
                return
            children = node.get('children', [])
            if children:
                for child in children:
                    collect_boxes(child)
            else:
                bb = node.get('absoluteBoundingBox')
                if not bb or bb.get('width', 0) <= 0 or bb.get('height', 0) <= 0:
                    return
                # Skip full-frame background nodes
                if bb['width'] >= frame_w * 0.95 and bb['height'] >= frame_h * 0.95:
                    print(f'[trim] skip full-frame leaf type={node.get("type")} name={node.get("name")} bb={bb["width"]}x{bb["height"]}', flush=True)
                    return
                content_boxes.append(bb)

        for child in doc.get('children', []):
            collect_boxes(child)

        print(f'[trim] leaf boxes found: {len(content_boxes)}', flush=True)
        if not content_boxes:
            return svg_bytes

        min_ax = min(b['x'] for b in content_boxes)
        min_ay = min(b['y'] for b in content_boxes)
        max_ax = max(b['x'] + b['width'] for b in content_boxes)
        max_ay = max(b['y'] + b['height'] for b in content_boxes)

        min_x = max(0.0, min_ax - frame_x)
        min_y = max(0.0, min_ay - frame_y)
        max_x = min(frame_w, max_ax - frame_x)
        max_y = min(frame_h, max_ay - frame_y)

        new_w = max_x - min_x
        new_h = max_y - min_y
        print(f'[trim] content bounds: x={min_x:.1f} y={min_y:.1f} w={new_w:.1f} h={new_h:.1f} (frame {frame_w}x{frame_h})', flush=True)

        if new_w <= 0 or new_h <= 0:
            return svg_bytes

        # Only trim if we're removing at least 1% in either dimension
        if new_w >= frame_w * 0.99 and new_h >= frame_h * 0.99:
            print(f'[trim] already tight, skipping', flush=True)
            return svg_bytes

        svg_text = svg_bytes.decode('utf-8')
        ET.register_namespace('', SVG_NS)
        ET.register_namespace('xlink', 'http://www.w3.org/1999/xlink')
        root = ET.fromstring(svg_text)
        root.set('viewBox', f'{min_x:.2f} {min_y:.2f} {new_w:.2f} {new_h:.2f}')
        root.set('width',  f'{new_w:.2f}')
        root.set('height', f'{new_h:.2f}')
        print(f'[trim] viewBox updated to {min_x:.2f} {min_y:.2f} {new_w:.2f} {new_h:.2f}', flush=True)
        return ET.tostring(root, encoding='unicode').encode('utf-8')

    except Exception as e:
        print(f'[trim] EXCEPTION: {e}', flush=True)
    return svg_bytes


@app.route("/api/figma-svg", methods=["GET"])
@require_auth
def figma_svg():
    """Fetch SVG for a Figma node, upload to Supabase, return persistent URL."""
    node_id = request.args.get('node_id')
    if not node_id:
        return jsonify({"error": "node_id required"}), 400
    token = os.environ.get('FIGMA_TOKEN')
    if not token:
        return jsonify({"error": "FIGMA_TOKEN not configured"}), 500

    # Instant return from pre-warmed in-memory cache
    if node_id in _svg_url_cache:
        return jsonify({"url": _svg_url_cache[node_id]})

    safe_node = node_id.replace(':', '-').replace('/', '-')
    storage_path = f"{g.user_id}/figma/t9/{safe_node}.svg"

    # Check cache — verify file actually exists before returning URL
    try:
        folder = f"{g.user_id}/figma/t9"
        files = _sb.storage.from_("abx-images").list(folder)
        if any(f.get('name') == f"{safe_node}.svg" for f in (files or [])):
            url_res = _sb.storage.from_("abx-images").create_signed_url(storage_path, 60 * 60 * 24 * 365)
            existing_url = _signed_url(url_res)
            if existing_url:
                print(f'[figma-svg] cache hit for {safe_node}', flush=True)
                return jsonify({"url": existing_url})
    except Exception as cache_err:
        print(f'[figma-svg] cache check error: {cache_err}', flush=True)

    # Fetch SVG export URL from Figma
    headers = {'X-Figma-Token': token}
    resp = _requests.get(
        f'https://api.figma.com/v1/images/{FIGMA_FILE_KEY}?ids={node_id}&format=svg',
        headers=headers, timeout=30
    )
    if not resp.ok:
        return jsonify({"error": f"Figma API error: {resp.status_code}"}), 500
    svg_url = (resp.json().get('images') or {}).get(node_id)
    if not svg_url:
        return jsonify({"error": "No SVG returned"}), 500

    # Download raw SVG — no trimming, serve as-is from Figma
    svg_resp = _requests.get(svg_url, timeout=30)
    if not svg_resp.ok:
        return jsonify({"error": "Could not download SVG"}), 500
    svg_bytes = svg_resp.content

    # Upload to Supabase storage
    try:
        _sb.storage.from_("abx-images").upload(
            path=storage_path,
            file=svg_bytes,
            file_options={"content-type": "image/svg+xml", "upsert": "true"},
        )
        url_res = _sb.storage.from_("abx-images").create_signed_url(storage_path, 60 * 60 * 24 * 365)
        signed_url = _signed_url(url_res)
        return jsonify({"url": signed_url})
    except Exception as e:
        print(f'[figma-svg] upload error: {e}', flush=True)
        # Fallback: return base64 data URL so client JSON parse succeeds
        import base64
        data_url = 'data:image/svg+xml;base64,' + base64.b64encode(svg_bytes).decode()
        return jsonify({"url": data_url})


@app.route("/api/figma-svg-debug", methods=["GET"])
@require_auth
def figma_svg_debug():
    """Return SVG + Figma nodes API info for debugging padding issues."""
    import xml.etree.ElementTree as ET
    node_id = request.args.get('node_id')
    if not node_id:
        return jsonify({"error": "node_id required"}), 400
    token = os.environ.get('FIGMA_TOKEN')
    headers = {'X-Figma-Token': token}

    # SVG structure
    resp = _requests.get(
        f'https://api.figma.com/v1/images/{FIGMA_FILE_KEY}?ids={node_id}&format=svg',
        headers=headers, timeout=30
    )
    svg_url = (resp.json().get('images') or {}).get(node_id)
    svg_resp = _requests.get(svg_url, timeout=30)
    svg_text = svg_resp.content.decode('utf-8')
    root = ET.fromstring(svg_text)

    def elem_info(e, depth=0):
        tag = e.tag.split('}')[-1] if '}' in e.tag else e.tag
        attrs = {k: v for k, v in e.attrib.items()}
        info = {'tag': tag, 'attrs': attrs}
        children = [elem_info(c, depth+1) for c in e if depth < 3]
        if children:
            info['children'] = children
        return info

    # Figma nodes API — shows absoluteBoundingBox for all nodes
    nodes_resp = _requests.get(
        f'https://api.figma.com/v1/files/{FIGMA_FILE_KEY}/nodes?ids={node_id}',
        headers=headers, timeout=15
    )
    nodes_data = nodes_resp.json() if nodes_resp.ok else {'error': nodes_resp.status_code}

    # Collect leaf bounding boxes (same logic as _trim_svg_with_figma_bounds)
    leaf_boxes = []
    try:
        doc = (nodes_data.get('nodes') or {}).get(node_id, {}).get('document', {})
        frame_box = doc.get('absoluteBoundingBox', {})

        def collect_leaves(node):
            children = node.get('children', [])
            if children:
                for child in children:
                    collect_leaves(child)
            else:
                bb = node.get('absoluteBoundingBox')
                if bb:
                    leaf_boxes.append({'type': node.get('type'), 'name': node.get('name'), 'bb': bb})
    except Exception as e:
        leaf_boxes = [{'error': str(e)}]

    for child in doc.get('children', []) if isinstance(doc, dict) else []:
        collect_leaves(child)

    return jsonify({
        'viewBox': root.get('viewBox'),
        'width': root.get('width'),
        'height': root.get('height'),
        'svg_structure': elem_info(root),
        'frame_box': frame_box if isinstance(doc, dict) else None,
        'leaf_boxes': leaf_boxes,
        'raw_svg_start': svg_text[:1000],
    })


# ── PDF generation ────────────────────────────────────────────────────────────

from builder import rich_to_rl   # noqa: E402 — imported after sys.path setup

@app.route("/api/generate", methods=["POST"])
@require_auth
def generate():
    data     = request.get_json(force=True)
    blocks   = data.get("blocks", [])
    filename = data.get("filename", "untitled.pdf") or "untitled.pdf"
    if not filename.endswith(".pdf"):
        filename += ".pdf"

    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
        tmp_path = tmp.name

    try:
        pdf = PDFBuilder(
            tmp_path,
            doc_title=data.get("docTitle", ""),
            doc_author=data.get("docAuthor", ""),
        )

        for block in blocks:
            btype       = block.get("type", "")
            use_card    = block.get("card", False)
            card_border = block.get("card_border", "")
            card_bg     = block.get("card_bg", "#FFFFFF")

            card_types = ("cover", "section-page", "page-break", "footer")
            if use_card and btype not in card_types:
                pdf.begin_card(border_color=card_border, bg_color=card_bg)

            if btype == "cover":
                pdf.cover(title=block.get("title",""), subtitle=block.get("subtitle",""),
                          author=block.get("author",""), date=block.get("date",""),
                          category=block.get("category",""))
            elif btype == "section-page":
                pdf.section_page(title=block.get("title",""), description=block.get("description",""))
            elif btype in ("h1","h2","h3","h4"):
                pdf.section(block.get("text",""), level=int(btype[1]))
            elif btype == "body":
                pdf.body(block.get("text",""), muted=block.get("muted", False))
            elif btype == "small":
                pdf.small(block.get("text",""))
            elif btype == "bullets":
                pdf.bullets(block.get("items", []))
            elif btype == "numbered":
                pdf.numbered(block.get("items", []))
            elif btype == "stats":
                pdf.stats(items=block.get("items",[]), columns=int(block.get("columns",1)),
                          section_num=block.get("section_num",""), section_title=block.get("section_title",""),
                          body=block.get("body",""))
            elif btype == "stat-cards":
                pdf.stat_cards(left=block.get("left",{}), right=block.get("right",{}))
            elif btype == "table":
                pdf.table(headers=block.get("headers",[]), rows=block.get("rows",[]),
                          caption=block.get("caption",""))
            elif btype == "callout":
                pdf.callout(block.get("text",""), style=block.get("style","brand"))
            elif btype == "two-columns":
                pdf.two_columns(left=rich_to_rl(block.get("left","")),
                                right=rich_to_rl(block.get("right","")))
            elif btype == "divider":
                pdf.divider(thick=block.get("thick", False))
            elif btype == "infographic-hero":
                pdf.infographic_hero(accent=block.get("accent",""), title=block.get("title",""),
                                     image=block.get("image",""), image_scale=float(block.get("image_scale",1.0)))
            elif btype == "ig-stats":
                pdf.ig_stats(columns=int(block.get("columns",3)), items=block.get("items",[]))
            elif btype == "abx-header":
                pdf.abx_header(title=block.get("title",""), descriptor=block.get("descriptor",""),
                               image=block.get("image",""), image_scale=float(block.get("image_scale",1.0)))
            elif btype == "page-break":
                pdf.page_break()
            elif btype == "footer":
                pdf.footer(text=block.get("text",""), button_label=block.get("button_label","Discover more"),
                           button_url=block.get("button_url",""))

            if use_card and btype not in card_types:
                pdf.end_card()

            if btype == "page-break":   pass
            elif btype == "footer":     pdf.space(20)
            else:                       pdf.space(40)

        pdf.build()

        return send_file(tmp_path, mimetype="application/pdf",
                         as_attachment=True, download_name=filename)

    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e), "traceback": traceback.format_exc()}), 500

    finally:
        try: os.unlink(tmp_path)
        except Exception: pass
        # Clean up any temp image files downloaded during build
        import builder as _builder_mod
        for _f in list(_builder_mod._tmp_image_files):
            try: os.unlink(_f)
            except Exception: pass
        _builder_mod._tmp_image_files.clear()


# ── Spark generation ──────────────────────────────────────────────────────────

@app.route("/api/spark-generate", methods=["POST"])
@require_auth
def spark_generate():
    data          = request.get_json(force=True)
    audience      = (data.get("audience")      or "").strip()
    topic         = (data.get("topic")         or "").strip()
    template_type = (data.get("template_type") or "insight-report").strip()
    if not audience or not topic:
        return jsonify({"error": "audience and topic are required"}), 400
    try:
        from spark_gwi import generate_blocks
        blocks = generate_blocks(audience, topic, template_type)
        return jsonify({"blocks": blocks})
    except ImportError as e:
        return jsonify({"error": f"spark_gwi module unavailable: {e}"}), 500
    except ValueError as e:
        return jsonify({"error": str(e)}), 422
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": f"Generation failed: {e}"}), 500


# ── Feedback ──────────────────────────────────────────────────────────────────

@app.route("/api/feedback", methods=["GET"])
@require_auth
def list_feedback():
    try:
        sb  = _sb_user()
        res = sb.table("feedback").select("*").order("created_at", desc=True).execute()
        return jsonify(res.data or [])
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/feedback", methods=["POST"])
@require_auth
def create_feedback():
    body = request.get_json(force=True) or {}
    try:
        sb  = _sb_user()
        res = sb.table("feedback").insert({
            "user_id":       g.user_id,
            "user_name":     body.get("user_name", ""),
            "user_email":    body.get("user_email", ""),
            "rating":        body.get("rating"),
            "feedback_text": body.get("feedback_text", ""),
        }).execute()
        return jsonify(res.data[0] if res.data else {}), 201
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/feedback/<fid>", methods=["PUT"])
@require_auth
def update_feedback(fid):
    body = request.get_json(force=True) or {}
    try:
        sb  = _sb_user()
        res = sb.table("feedback").update({
            "user_name":     body.get("user_name", ""),
            "user_email":    body.get("user_email", ""),
            "rating":        body.get("rating"),
            "feedback_text": body.get("feedback_text", ""),
        }).eq("id", fid).eq("user_id", g.user_id).execute()
        return jsonify(res.data[0] if res.data else {})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/feedback/<fid>", methods=["DELETE"])
@require_auth
def delete_feedback(fid):
    try:
        sb = _sb_user()
        sb.table("feedback").delete().eq("id", fid).eq("user_id", g.user_id).execute()
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ── Frontend (production) ─────────────────────────────────────────────────────

@app.route("/", defaults={"p": ""})
@app.route("/<path:p>")
def serve_frontend(p):
    if not os.path.exists(DIST_DIR):
        return "Frontend not built — run: npm run build", 503
    target = os.path.join(DIST_DIR, p)
    if p and os.path.isfile(target):
        return send_from_directory(DIST_DIR, p)
    return send_from_directory(DIST_DIR, "index.html")


@app.route("/health")
def health():
    return jsonify({"ok": True})


@app.route("/api/test/pexels")
def test_pexels():
    api_key = os.environ.get("PEXELS_API_KEY", "")
    if not api_key:
        return jsonify({"ok": False, "error": "PEXELS_API_KEY not set"}), 500
    try:
        res = _requests.get(
            "https://api.pexels.com/v1/search",
            headers={"Authorization": api_key},
            params={"query": "data analytics", "per_page": 1, "orientation": "landscape"},
            timeout=10
        )
        data = res.json()
        photo = data.get("photos", [{}])[0]
        return jsonify({"ok": True, "total_results": data.get("total_results"), "sample_image": photo.get("src", {}).get("medium")})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/test/figma")
def test_figma():
    token = os.environ.get("FIGMA_TOKEN", "")
    if not token:
        return jsonify({"ok": False, "error": "FIGMA_TOKEN not set"}), 500
    try:
        file_key = "0b47ipE59eoQ72I7ceHkPd"
        res = _requests.get(
            f"https://api.figma.com/v1/files/{file_key}",
            headers={"X-Figma-Token": token},
            timeout=15
        )
        data = res.json()
        if "err" in data:
            return jsonify({"ok": False, "error": data["err"]}), 500
        return jsonify({"ok": True, "file_name": data.get("name"), "last_modified": data.get("lastModified")})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


# ── Thumbnail generation pipeline ─────────────────────────────────────────────

import io
import random
import base64
from PIL import Image, ImageFilter, ImageEnhance

VALID_CATEGORIES = {
    'audiences', 'consumer behaviour', 'digital trends',
    'data journalism', 'talk data to me', 'product', 'strategy'
}
PEXELS_CATEGORIES  = {'audiences', 'consumer behaviour', 'digital trends', 'data journalism'}
FIGMA_CATEGORIES   = {'strategy', 'product'}
SPECIAL_CATEGORIES = {'talk data to me'}

PEXELS_API_KEY            = os.environ.get('PEXELS_API_KEY', '')
FIGMA_TOKEN_KEY           = os.environ.get('FIGMA_TOKEN', '')
GEMINI_API_KEY            = os.environ.get('GEMINI_API_KEY', '')
FIGMA_THUMBNAILS_FILE_KEY = '0b47ipE59eoQ72I7ceHkPd'

# Cache Figma file structure so we don't refetch on every request
_figma_pages_cache = {}


# Visual terms per category — used to vary queries across attempts.
# All Pexels categories use minimal/clean imagery; Audiences always favours
# a real person facing the camera on a plain solid-colour background.
_CATEGORY_VISUAL_TERMS = {
    'audiences':          ['portrait', 'person', 'facing camera', 'studio', 'solid color background', 'minimal', 'professional headshot', 'clean backdrop'],
    'consumer behaviour': ['lifestyle', 'minimal', 'clean', 'simple background', 'everyday', 'product', 'flat lay', 'modern'],
    'digital trends':     ['technology', 'minimal', 'clean desk', 'simple background', 'digital', 'modern', 'flat lay', 'mobile'],
    'data journalism':    ['data', 'charts', 'analytics', 'minimal', 'clean', 'simple background', 'flat lay', 'research'],
}

# Visual angle modifiers for non-audiences categories only.
# For audiences we always lock to portrait/person, so angles are not applied.
_VISUAL_ANGLES = [
    '',                         # attempt 0: no modifier
    'simple color background',  # attempt 1
    'studio portrait minimal',  # attempt 2
    'clean flat lay overhead',  # attempt 3
    'bright white background',  # attempt 4
    'pastel background minimal',# attempt 5
]

# Global aesthetic modifiers appended to every Pexels query to push toward
# simple, uncluttered compositions
_GLOBAL_AESTHETIC = 'minimal simple background clean'


def _build_search_query(title, meta_desc, subtitles, category, attempt=0):
    """Build a Pexels search query varied by attempt number.
    Audiences always returns a person facing camera on a plain background.
    All other categories use minimal/clean imagery.
    """
    rng = random.Random(attempt * 31337)

    # ── Audiences: bust/headshot of ONE person facing camera, plain background ──
    if category == 'audiences':
        # Pull up to 2 short keywords from the title for demographic relevance
        # (allow short words like "gen", "z", "men" that the main extractor strips)
        skip = {'the', 'a', 'an', 'and', 'or', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'is', 'are', 'how', 'why', 'what'}
        raw_title_words = [
            w.strip('.,!?:;"\'/()').lower()
            for w in title.replace('-', ' ').split()
            if len(w.strip('.,!?:;"\'/()')) >= 2
            and w.strip('.,!?:;"\'/()').lower() not in skip
        ][:2]

        # Each variant uses specific photography framing terms Pexels understands:
        # bust, headshot, upper body = head + shoulders in frame (what the user wants)
        style_variants = [
            'headshot bust single person facing camera solid color background',
            'upper body portrait one person looking at camera plain backdrop',
            'bust shot single individual front facing clean solid background',
            'headshot shoulders one person direct gaze simple plain background',
            'chest up portrait single person face forward solid backdrop',
            'studio headshot bust one individual looking straight at camera',
        ]
        style = style_variants[attempt % len(style_variants)]

        parts = raw_title_words + style.split()
        seen = set()
        unique = [w for w in parts if not (w in seen or seen.add(w))]
        return ' '.join(unique[:10])

    # ── Gemini path (if configured) ───────────────────────────────────────────
    if GEMINI_API_KEY:
        try:
            import json as _json
            angle_hint = _VISUAL_ANGLES[attempt % len(_VISUAL_ANGLES)]
            prompt = (
                f"You are helping select a stock photo for a blog thumbnail (attempt {attempt + 1}).\n"
                f"Blog title: {title}\nCategory: {category}\n"
                f"Meta description: {meta_desc or 'N/A'}\n\n"
                f"Return a JSON object with one key 'query' containing 5-8 keywords "
                f"for a Pexels image search. The image MUST be simple and minimal — "
                f"plain or solid-colour background, uncluttered composition, clean layout. "
                f"Focus on the OVERALL THEME of the title and category, not individual subtitles. "
                f"Make this attempt visually distinct "
                f"{'(' + angle_hint + ')' if angle_hint else ''}.\n"
                f"Example: {{\"query\": \"minimal technology flat lay clean white background\"}}"
            )
            res = _requests.post(
                f"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={GEMINI_API_KEY}",
                json={"contents": [{"parts": [{"text": prompt}]}]},
                timeout=10
            )
            text = res.json()['candidates'][0]['content']['parts'][0]['text'].strip()
            if '```' in text:
                text = text.split('```')[1]
                if text.startswith('json'):
                    text = text[4:]
            return _json.loads(text.strip())['query']
        except Exception:
            pass

    # ── Fallback keyword extraction ───────────────────────────────────────────
    stop_words = {'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
                  'of', 'with', 'by', 'from', 'is', 'are', 'was', 'be', 'this', 'that',
                  'how', 'why', 'what', 'its', 'it', 'as', 'into', 'state', 'data', 'new'}

    def extract(text, max_words):
        words = []
        for w in text.replace(',', ' ').replace('-', ' ').split():
            w = w.strip('.,!?:;"\'/()').lower()
            if w and w not in stop_words and len(w) > 3:
                words.append(w)
                if len(words) >= max_words:
                    break
        return words

    # Title: up to 3 words (primary subject signal)
    title_words = extract(title, 3)

    # Category visual terms: pick 2, rotated per attempt
    cat_terms = list(_CATEGORY_VISUAL_TERMS.get(category, ['minimal', 'clean', category]))
    rng.shuffle(cat_terms)
    cat_words = cat_terms[:2]

    # Visual angle for variety (non-audiences only)
    angle = _VISUAL_ANGLES[attempt % len(_VISUAL_ANGLES)]
    angle_words = angle.split() if angle else []

    # Subtitles: at most 1 word, only on first attempt
    sub_words = extract(subtitles or '', 1) if attempt == 0 else []

    # Always append global aesthetic modifiers (deduplicated below)
    aesthetic_words = _GLOBAL_AESTHETIC.split()

    combined = title_words + cat_words + sub_words + angle_words + aesthetic_words
    seen = set()
    unique = [w for w in combined if not (w in seen or seen.add(w))]
    return ' '.join(unique[:10])


def _search_pexels(query, count=3, exclude_ids=None, attempt=0):
    """Search Pexels and return image options, using different pages per attempt.
    Fetches 40 results and scores them for simplicity — prefers images with
    simple/plain backgrounds (portrait orientation is allowed for audiences).
    """
    page = (attempt // 2) + 1  # New page every 2 attempts

    # Audiences queries portrait orientation; all others landscape
    is_portrait_query = any(w in query for w in ('portrait', 'headshot', 'face'))
    orientation = 'portrait' if is_portrait_query else 'landscape'

    res = _requests.get(
        'https://api.pexels.com/v1/search',
        headers={'Authorization': PEXELS_API_KEY},
        params={'query': query, 'per_page': 40, 'page': page, 'orientation': orientation},
        timeout=10
    )
    photos = res.json().get('photos', [])

    # If portrait returned nothing useful, fall back to landscape
    if not photos and orientation == 'portrait':
        res = _requests.get(
            'https://api.pexels.com/v1/search',
            headers={'Authorization': PEXELS_API_KEY},
            params={'query': query, 'per_page': 40, 'page': page, 'orientation': 'landscape'},
            timeout=10
        )
        photos = res.json().get('photos', [])

    if exclude_ids:
        photos = [p for p in photos if str(p['id']) not in exclude_ids]

    # For portrait/audiences queries: filter out full-body shots (very tall, narrow images)
    # and prefer images closer to square (more likely to be busts/headshots).
    # A headshot or bust typically has width/height ≥ 0.55; a full-body shot is often < 0.5.
    if is_portrait_query and photos:
        headshot_photos = [p for p in photos if (p['width'] / p['height']) >= 0.55]
        # If filtering leaves too few, keep what we have rather than returning nothing
        if len(headshot_photos) >= count:
            photos = headshot_photos
        elif headshot_photos:
            photos = headshot_photos
        # Sort by aspect ratio descending — closest to square first (best for bust shots)
        photos.sort(key=lambda p: p['width'] / p['height'], reverse=True)
    else:
        # Shuffle within results for additional variety per attempt
        rng = random.Random(attempt * 999)
        rng.shuffle(photos)

    # Filter out black-and-white images using Pexels' avg_color field.
    # B&W images have R ≈ G ≈ B; if all channels differ by < 12 it's greyscale.
    def _is_color(p):
        hex_col = (p.get('avg_color') or '#888888').lstrip('#')
        if len(hex_col) != 6:
            return True
        r, g, b = int(hex_col[0:2], 16), int(hex_col[2:4], 16), int(hex_col[4:6], 16)
        return max(abs(r - g), abs(g - b), abs(r - b)) >= 12

    photos = [p for p in photos if _is_color(p)]

    selected = photos[:count]

    # For portrait/audiences queries use the Pexels 'portrait' URL (800×1200) —
    # not 'large2x' which is a landscape CDN crop and defeats portrait composition.
    def _img_url(p):
        if is_portrait_query and p['src'].get('portrait'):
            return p['src']['portrait']
        return p['src']['large2x']

    return [{'id': str(p['id']), 'url': _img_url(p), 'preview': p['src']['large'],
             'photographer': p['photographer'], 'source': 'pexels'} for p in selected]


def _get_figma_frames(page_name, count=3, exclude_ids=None):
    """Fetch random frames from a named Figma page, with caching."""
    global _figma_pages_cache
    headers = {'X-Figma-Token': FIGMA_TOKEN_KEY}

    if page_name not in _figma_pages_cache:
        res = _requests.get(
            f'https://api.figma.com/v1/files/{FIGMA_THUMBNAILS_FILE_KEY}',
            headers=headers, timeout=20
        )
        data = res.json()
        pages = data.get('document', {}).get('children', [])
        for page in pages:
            _figma_pages_cache[page['name']] = [
                {'id': c['id'], 'name': c['name']}
                for c in page.get('children', [])
                if c.get('type') == 'FRAME'
            ]

    frames = _figma_pages_cache.get(page_name, [])
    if exclude_ids:
        frames = [f for f in frames if f['id'] not in exclude_ids]
    if not frames:
        raise ValueError(f"No frames available in Figma page '{page_name}'")

    selected = random.sample(frames, min(count, len(frames)))
    node_ids = ','.join(f['id'] for f in selected)

    img_res = _requests.get(
        f'https://api.figma.com/v1/images/{FIGMA_THUMBNAILS_FILE_KEY}',
        headers=headers,
        params={'ids': node_ids, 'format': 'png', 'scale': 2},
        timeout=20
    )
    images = img_res.json().get('images', {})
    return [{'id': f['id'], 'name': f['name'], 'url': images.get(f['id'], ''),
             'preview': images.get(f['id'], ''), 'source': 'figma'}
            for f in selected if images.get(f['id'])]


def _compose_image(image_url, width=1200, height=700):
    """Download image, crop to exactly width×height, return base64 PNG.

    Portrait sources (Audiences person photos, 800×1200 from Pexels):
      Take the full image width and derive crop height from the target ratio.
      Anchor at y=0 so the head is always at the top of the frame.
      800×1200 → crop 800×467 from top → resize to 1200×700.

    Landscape wider than target: centre-crop horizontally.
    Square / landscape narrower than target: centre-crop vertically.
    """
    res = _requests.get(image_url, timeout=20)
    res.raise_for_status()
    img = Image.open(io.BytesIO(res.content)).convert('RGB')

    target_ratio = width / height   # 1200/700 ≈ 1.714
    src_w, src_h = img.size
    src_ratio    = src_w / src_h
    is_portrait  = src_h > src_w

    if is_portrait:
        # Full width from top — head is always at y=0 for Pexels portrait images
        crop_h = int(src_w / target_ratio)
        img    = img.crop((0, 0, src_w, min(crop_h, src_h)))

    elif src_ratio > target_ratio:
        # Landscape wider than target: centre-crop width
        new_w = int(src_h * target_ratio)
        left  = (src_w - new_w) // 2
        img   = img.crop((left, 0, left + new_w, src_h))

    else:
        # Square / landscape narrower than target: centre-crop height
        new_h = int(src_w / target_ratio)
        top   = (src_h - new_h) // 2
        img   = img.crop((0, top, src_w, top + new_h))

    img = img.resize((width, height), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format='PNG', optimize=True)
    buf.seek(0)
    return base64.b64encode(buf.read()).decode('utf-8')


@app.route('/api/thumbnail/generate', methods=['POST'])
@require_auth
def generate_thumbnail_options():
    data       = request.get_json(force=True)
    title      = data.get('title', '').strip()
    meta_desc  = data.get('metaDesc', '').strip()
    subtitles  = data.get('subtitles', '').strip()
    category   = data.get('category', '').strip().lower()
    exclude_ids = data.get('excludeIds', [])
    attempt     = int(data.get('attempt', 0))

    if not title:
        return jsonify({'error': 'Title is required'}), 400

    if category not in VALID_CATEGORIES:
        valid = ', '.join(c.title() for c in sorted(VALID_CATEGORIES))
        return jsonify({'error': f'Invalid category. Must be one of: {valid}'}), 400

    # Talk data to me — special flow requiring user uploads
    if category == 'talk data to me':
        return jsonify({'type': 'talk-data', 'category': category})

    # Build search query (varies by attempt)
    query = _build_search_query(title, meta_desc, subtitles, category, attempt)

    # Pexels categories
    if category in PEXELS_CATEGORIES:
        try:
            options = _search_pexels(query, count=3, exclude_ids=exclude_ids, attempt=attempt)
            return jsonify({'type': 'pexels', 'category': category,
                            'search_query': query, 'options': options})
        except Exception as e:
            return jsonify({'error': f'Pexels search failed: {e}'}), 500

    # Figma categories
    if category in FIGMA_CATEGORIES:
        page_name = 'Strategy' if category == 'strategy' else 'Product'
        try:
            options = _get_figma_frames(page_name, count=3, exclude_ids=exclude_ids)
            return jsonify({'type': 'figma', 'category': category,
                            'search_query': query, 'options': options})
        except Exception as e:
            return jsonify({'error': f'Figma fetch failed: {e}'}), 500

    return jsonify({'error': 'Unhandled category'}), 500


@app.route('/api/thumbnail/compose', methods=['POST'])
@require_auth
def compose_thumbnail():
    data      = request.get_json(force=True)
    image_url = data.get('imageUrl', '').strip()
    if not image_url:
        return jsonify({'error': 'imageUrl is required'}), 400
    try:
        b64 = _compose_image(image_url)
        return jsonify({'ok': True, 'image': f'data:image/png;base64,{b64}'})
    except Exception as e:
        return jsonify({'error': f'Compose failed: {e}'}), 500


@app.route('/api/thumbnail/save', methods=['POST'])
@require_auth
def save_thumbnail():
    """Create a dashboard record for a completed thumbnail.
    Stores the source image URL directly — no re-upload needed since the
    composed PNG is already on the user's machine from the download step.
    Pexels CDN URLs are permanent and public so they work fine as preview URLs.
    """
    data      = request.get_json(force=True) or {}
    title     = (data.get('title') or 'Untitled').strip()
    image_url = (data.get('imageUrl') or '').strip()
    blog_meta = data.get('blogMeta') or {}

    if not image_url:
        return jsonify({'error': 'imageUrl is required'}), 400

    try:
        sb = _sb_user()
        res = sb.table("templates").insert({
            "user_id":       g.user_id,
            "name":          title,
            "status":        "saved",
            "folder_id":     None,
            "template_type": "blog-thumbnail",
            "doc":           {"imageUrl": image_url, "blogMeta": blog_meta},
            "block_count":   0,
            "block_types":   [],
        }).execute()
        _templates_cache_invalidate(g.user_id)
        record = res.data[0]
        record["doc_image_url"] = image_url
        return jsonify({'ok': True, 'template': record}), 201
    except Exception as e:
        print(f'[save_thumbnail] error: {e}', flush=True)
        return jsonify({'error': f'Save failed: {e}'}), 500


# ── Talk data to me — background removal + composition ───────────────────────

REMOVE_BG_API_KEY = os.environ.get('REMOVE_BG_API_KEY', '')


def _remove_bg(img_bytes):
    """Remove background via remove.bg API. Returns RGBA PIL Image."""
    if not REMOVE_BG_API_KEY:
        raise RuntimeError('REMOVE_BG_API_KEY not set')

    # remove.bg rejects images over 50MP — downscale to ≤25MP to stay well clear
    MAX_PIXELS = 25_000_000
    src = Image.open(io.BytesIO(img_bytes))
    if src.width * src.height > MAX_PIXELS:
        scale = (MAX_PIXELS / (src.width * src.height)) ** 0.5
        new_w = int(src.width  * scale)
        new_h = int(src.height * scale)
        src = src.resize((new_w, new_h), Image.LANCZOS)
        buf = io.BytesIO()
        src.save(buf, format='PNG')
        img_bytes = buf.getvalue()

    res = _requests.post(
        'https://api.remove.bg/v1.0/removebg',
        headers={'X-Api-Key': REMOVE_BG_API_KEY},
        files={'image_file': ('image.png', img_bytes, 'image/png')},
        data={'size': 'auto'},
        timeout=30,
    )
    if res.status_code != 200:
        raise RuntimeError(f'remove.bg error {res.status_code}: {res.text[:200]}')

    return Image.open(io.BytesIO(res.content)).convert('RGBA')


@app.route('/api/thumbnail/talkdata', methods=['POST'])
@require_auth
def generate_talkdata_thumbnail():
    person_file = request.files.get('person')
    logo_file   = request.files.get('logo')
    bg_color    = (request.form.get('bgColor') or 'black').lower().strip()

    if not person_file:
        return jsonify({'error': 'Person photo is required'}), 400
    if not logo_file:
        return jsonify({'error': 'Company logo is required'}), 400

    try:
        color_map = {
            'black': (16,  23,  32),    # #101720
            'pink':  (255, 0,   119),   # #FF0077
        }
        bg_rgb = color_map.get(bg_color, (16, 23, 32))
        W, H   = 1200, 700

        # ── Remove backgrounds in parallel (saves ~10-15s vs sequential) ────────
        from concurrent.futures import ThreadPoolExecutor, as_completed
        person_bytes = person_file.read()
        logo_bytes   = logo_file.read()
        print('[talkdata] removing backgrounds in parallel…', flush=True)
        with ThreadPoolExecutor(max_workers=2) as pool:
            f_person = pool.submit(_remove_bg, person_bytes)
            f_logo   = pool.submit(_remove_bg, logo_bytes)
            person_img = f_person.result()
            logo_img   = f_logo.result()
        print('[talkdata] backgrounds removed', flush=True)

        # ── Canvas ────────────────────────────────────────────────────────────
        canvas = Image.new('RGB', (W, H), bg_rgb)

        # ── Person: scale to canvas height, anchor bottom-left ────────────────
        pw_orig, ph_orig = person_img.size
        ph = H
        pw = int(pw_orig * ph / ph_orig)

        # Cap at 55% of canvas width so the logo half stays clear
        max_pw = int(W * 0.55)   # 660 px
        if pw > max_pw:
            pw = max_pw
            ph = int(ph_orig * pw / pw_orig)

        person_resized = person_img.resize((pw, ph), Image.LANCZOS)
        py = H - ph   # bottom-align
        canvas.paste(person_resized, (0, py), person_resized)
        print(f'[talkdata] person: {pw}×{ph} at (0,{py})', flush=True)

        # ── Logo: fit centred in right half ───────────────────────────────────
        right_x = W // 2   # 600 px
        pad     = 60
        max_lw  = W - right_x - pad * 2   # 480 px
        max_lh  = H - pad * 2              # 580 px

        lw_orig, lh_orig = logo_img.size
        scale     = min(max_lw / lw_orig, max_lh / lh_orig)
        lw_scaled = max(1, int(lw_orig * scale))
        lh_scaled = max(1, int(lh_orig * scale))
        logo_resized = logo_img.resize((lw_scaled, lh_scaled), Image.LANCZOS)

        lx = right_x + (W - right_x - lw_scaled) // 2
        ly = (H - lh_scaled) // 2
        canvas.paste(logo_resized, (lx, ly), logo_resized)
        print(f'[talkdata] logo: {lw_scaled}×{lh_scaled} at ({lx},{ly})', flush=True)

        # ── Output ────────────────────────────────────────────────────────────
        buf = io.BytesIO()
        canvas.save(buf, format='PNG', optimize=True)
        buf.seek(0)
        b64 = base64.b64encode(buf.read()).decode('utf-8')
        return jsonify({'ok': True, 'image': f'data:image/png;base64,{b64}'})

    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': f'Generation failed: {e}'}), 500


if __name__ == "__main__":
    # Railway sets PORT; fallback to FLASK_PORT for local dev
    port = int(os.environ.get("PORT", os.environ.get("FLASK_PORT", 5001)))
    print(f"ABX PDF Builder server — http://localhost:{port}")
    app.run(host="0.0.0.0", port=port, debug=False)
