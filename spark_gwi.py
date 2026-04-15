"""
spark_gwi.py  –  GWI Spark → ABX PDF blocks

Makes 3 sequential Claude API calls to build a rich, multi-section report:
  Call 1 – Primary stats (attitudes, usage, preferences)
  Call 2 – Behavioural / contextual data
  Call 3 – Brand / purchase intent signals

Each call returns 4-6 structured GWI-style insights.
All insights are then mapped to ABX blocks.

Supports two template types:
  insight-report  →  abx-header + stat-cards sections
  infographic     →  infographic-hero + ig-stats

Upgrade path: replace _query_gwi_via_claude() with a direct GWI REST API
call when the endpoint + key are available. The mapping layer stays unchanged.

Required env var:  ANTHROPIC_API_KEY
"""

import os
import json
import re
import uuid

# ── Anthropic client ──────────────────────────────────────────────────────────

def _get_client():
    try:
        from anthropic import Anthropic
        key = os.environ.get("ANTHROPIC_API_KEY", "")
        if not key:
            raise ValueError("ANTHROPIC_API_KEY not set")
        return Anthropic(api_key=key)
    except ImportError:
        raise ImportError("anthropic package not installed. Run: pip install anthropic")


def _make_id():
    return uuid.uuid4().hex[:8]


# ── GWI insight generation ────────────────────────────────────────────────────

_SYSTEM = """You are a GWI data analyst producing structured audience insight data.

Return ONLY a valid JSON object with these keys:
  headline  – one punchy sentence (max 120 chars) summarising the key finding
  insights  – array of insight objects, each containing:
      value       – integer (just the number, no % symbol)
      unit        – "%" for percentages, "x" for multipliers, "" if none
      description – max 12 words starting with "of [audience]" or a concise stat label
      index       – one sentence vs average e.g. "18% more likely than the average person"
      theme       – 2-4 word section label grouping related stats

Return ONLY valid JSON. No prose, no markdown fences.
Aim for 4-6 insights per call that tell a coherent story.
Use realistic, plausible GWI-style data that reflects genuine audience behaviour patterns."""

_ANGLES = [
    "attitudes, opinions and key behaviours",
    "digital behaviour, media habits and platform usage",
    "brand affinity, purchase intent and spending patterns",
]

def _call_claude(client, audience: str, topic: str, angle: str) -> tuple[list[dict], str]:
    """Single Claude call for one angle. Returns (insights, headline)."""
    prompt = (
        f"Audience: {audience}\n"
        f"Topic: {topic}\n"
        f"Focus on: {angle}\n\n"
        "Return structured GWI insight data as JSON."
    )
    msg = client.messages.create(
        model="claude-opus-4-5",
        max_tokens=1200,
        system=_SYSTEM,
        messages=[{"role": "user", "content": prompt}],
    )
    raw = msg.content[0].text.strip()
    raw = re.sub(r"^```[a-z]*\n?", "", raw)
    raw = re.sub(r"\n?```$",       "", raw)
    data     = json.loads(raw)
    insights = data.get("insights", [])
    headline = data.get("headline", "")
    return insights, headline


def _query_all_angles(client, audience: str, topic: str) -> tuple[list[dict], str]:
    """Run 3 sequential calls across different angles, return combined insights + headline."""
    all_insights = []
    first_headline = ""

    for i, angle in enumerate(_ANGLES):
        insights, headline = _call_claude(client, audience, topic, angle)
        if i == 0:
            first_headline = headline
        # Tag each insight with its angle index so the mapper can section them
        for ins in insights:
            ins["_angle"] = i
        all_insights.extend(insights)

    return all_insights, first_headline


# ── Insight → blocks mapping ──────────────────────────────────────────────────

def _make_stat_item(ins: dict) -> dict:
    return {
        "value_type":  "stat",
        "value":       str(ins.get("value", "00")),
        "unit":        ins.get("unit", "%"),
        "icon":        "",
        "description": ins.get("description", ""),
    }

def _body_from_insights(ins_list: list[dict]) -> str:
    lines = [i.get("index", "") for i in ins_list if i.get("index")]
    return "  ".join(lines[:2])   # max 2 index lines per body

_ANGLE_TITLES = [
    "Attitudes & behaviour",
    "Digital & media habits",
    "Brand & purchase intent",
]


def _map_insight_report(audience: str, topic: str, all_insights: list[dict], headline: str) -> list[dict]:
    blocks = []

    # Header
    blocks.append({
        "id":         _make_id(),
        "type":       "abx-header",
        "title":      f"{audience} & {topic}",
        "descriptor": headline or f"Key GWI data on {audience} attitudes toward {topic}.",
        "image":      "",
    })

    # Group insights by angle
    by_angle: dict[int, list[dict]] = {}
    for ins in all_insights:
        a = ins.get("_angle", 0)
        by_angle.setdefault(a, []).append(ins)

    section_num = 1
    for angle_idx in sorted(by_angle):
        chunk = by_angle[angle_idx]
        # Split into left (first 2) and right (next 2)
        left_items  = chunk[:2]
        right_items = chunk[2:4]

        left_theme  = left_items[0].get("theme",  _ANGLE_TITLES[angle_idx]) if left_items  else _ANGLE_TITLES[angle_idx]
        right_theme = right_items[0].get("theme", _ANGLE_TITLES[angle_idx]) if right_items else left_theme

        blocks.append({
            "id":   _make_id(),
            "type": "stat-cards",
            "left": {
                "section_num":   str(section_num).zfill(2),
                "section_title": left_theme,
                "items":         [_make_stat_item(x) for x in left_items],
                "body":          _body_from_insights(left_items),
            },
            "right": {
                "section_num":   str(section_num + 1).zfill(2),
                "section_title": right_theme,
                "items":         [_make_stat_item(x) for x in right_items] if right_items else [],
                "body":          _body_from_insights(right_items),
            },
        })
        blocks.append({"id": _make_id(), "type": "divider"})
        section_num += 2

    # Footer
    blocks.append({
        "id":           _make_id(),
        "type":         "footer",
        "text":         f"Want to go deeper on {audience}?",
        "button_label": "Explore on GWI",
        "button_url":   "https://www.gwi.com",
    })
    return blocks


def _map_infographic(audience: str, topic: str, all_insights: list[dict], headline: str) -> list[dict]:
    blocks = []

    # Hero
    blocks.append({
        "id":          _make_id(),
        "type":        "infographic-hero",
        "accent":      topic.title(),
        "title":       f"{audience}\n& {topic}",
        "image":       "",
        "image_scale": 1.0,
    })

    # ig-stats — use all insights as a flat grid (3 columns)
    ig_items = []
    for ins in all_insights[:9]:   # max 9 for a clean 3-col grid
        val = str(ins.get("value", "00"))
        unit = ins.get("unit", "%")
        ig_items.append({
            "stat_type":   "simple",
            "eyebrow":     "",
            "value":       val,
            "unit":        unit,
            "description": ins.get("description", ""),
        })

    blocks.append({
        "id":      _make_id(),
        "type":    "ig-stats",
        "columns": 3,
        "items":   ig_items,
    })

    # Footer
    blocks.append({
        "id":           _make_id(),
        "type":         "footer",
        "text":         headline or f"Key data on {audience} & {topic}.",
        "button_label": "Explore on GWI",
        "button_url":   "https://www.gwi.com",
    })
    return blocks


# ── Public API ────────────────────────────────────────────────────────────────

def generate_blocks(audience: str, topic: str, template_type: str = "insight-report") -> list[dict]:
    """
    Entry point. Returns a list of ABX PDF blocks populated with GWI insights.

    Parameters
    ----------
    audience      : str  e.g. "Gen Z", "Millennial parents"
    topic         : str  e.g. "fast food", "sustainability"
    template_type : str  "insight-report" | "infographic"
    """
    client = _get_client()
    all_insights, headline = _query_all_angles(client, audience, topic)

    if template_type == "infographic":
        return _map_infographic(audience, topic, all_insights, headline)
    else:
        return _map_insight_report(audience, topic, all_insights, headline)


# ── CLI smoke test ────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import sys
    audience      = sys.argv[1] if len(sys.argv) > 1 else "Gen Z"
    topic         = sys.argv[2] if len(sys.argv) > 2 else "fast food"
    template_type = sys.argv[3] if len(sys.argv) > 3 else "insight-report"
    blocks = generate_blocks(audience, topic, template_type)
    print(json.dumps(blocks, indent=2))
