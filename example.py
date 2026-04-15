"""
Example: GWI branded report using PDFBuilder.
Run:  python3 example.py
"""

from builder import PDFBuilder

pdf = PDFBuilder(
    "gwi_q1_report.pdf",
    doc_title="Q1 2026 Audience Intelligence Report",
    doc_author="GWI Insights Team",
    doc_subject="Quarterly Audience Trends",
)

# ── Cover ────────────────────────────────────────────────────────────────────
pdf.cover(
    title="Q1 2026 Audience Intelligence Report",
    subtitle="Consumer trends, platform shifts, and what your audience actually wants.",
    author="GWI Insights Team",
    date="March 2026",
    category="Quarterly Report",
)

# ── Executive Summary ────────────────────────────────────────────────────────
pdf.h1("What you need to know")

pdf.stats([
    {"value": "2.4B",  "label": "Consumers surveyed",   "change": "+11%",  "up": True},
    {"value": "53",    "label": "Markets covered",       "change": "+4",    "up": True},
    {"value": "86%",   "label": "Confidence in data",   "change": "+2pts", "up": True},
    {"value": "48hrs", "label": "Avg. time to insight",  "change": "-30%",  "up": True},
])

pdf.body(
    "Q1 2026 shows a clear shift: audiences are moving faster than brands. "
    "Attention is fragmenting across platforms, values-driven purchasing is up 22%, "
    "and the gap between what brands think consumers want and what they actually "
    "want just got wider. Here's what the data shows."
)

pdf.callout(
    "Key finding: 63% of consumers say they'd switch brands for one that better "
    "reflects their values — up 9 points year-on-year.",
    style="brand"
)

pdf.space()

# ── Audience Shifts ──────────────────────────────────────────────────────────
pdf.h2("Platform behaviour")

pdf.body(
    "Short-form video isn't slowing down. But the platforms winning attention "
    "have shifted — audiences are now spending 40% more time on creator-first "
    "platforms versus algorithm-first ones."
)

pdf.two_columns(
    left=(
        "Among 18–34s, daily short-form video consumption is up to 2.4 hours. "
        "They're not passive — 71% say they've discovered a new brand through "
        "a creator they follow."
    ),
    right=(
        "35–54s are the fastest-growing segment on audio platforms. Podcast "
        "engagement grew 31% in this cohort, with true crime and business "
        "content leading. This audience converts at 2.1× the platform average."
    ),
)

# ── Purchase Drivers ─────────────────────────────────────────────────────────
pdf.h2("What drives purchase decisions")

pdf.table(
    headers=["Driver",             "Q1 2025 rank", "Q1 2026 rank", "Change"],
    rows=[
        ["Value for money",         "1",            "1",            "Unchanged"],
        ["Brand values alignment",  "4",            "2",            "▲ +2"],
        ["Product quality",         "2",            "3",            "▼ -1"],
        ["Peer recommendation",     "5",            "4",            "▲ +1"],
        ["Environmental impact",    "7",            "5",            "▲ +2"],
        ["Price promotion",         "3",            "6",            "▼ -3"],
        ["Influencer endorsement",  "6",            "7",            "▼ -1"],
    ],
    caption="Table 1 — Top purchase drivers, Q1 2025 vs Q1 2026 (global, all ages).",
)

pdf.callout(
    "Brand values alignment jumping to #2 is the headline. In 2022 it ranked #9. "
    "Consumers are making this a dealbreaker — not just a nice-to-have.",
    style="info"
)

# ── Section divider ──────────────────────────────────────────────────────────
pdf.section_page(
    title="Deep dive:\nThe values gap",
    description="Why 6 in 10 consumers feel misunderstood by brands."
)

# ── Values Gap ───────────────────────────────────────────────────────────────
pdf.h1("The values gap")

pdf.body(
    "We asked 480,000 consumers: does this brand understand what matters to me? "
    "Then we asked the same brands how well they understand their customers. "
    "The gap was striking."
)

pdf.stats([
    {"value": "78%", "label": "Brands: 'We understand our customers'", "up": True},
    {"value": "34%", "label": "Consumers: 'This brand gets me'", "up": False},
    {"value": "44pt","label": "The gap",                               "up": False},
])

pdf.h2("Where the gap is widest")

pdf.bullets([
    "Climate and sustainability: brands overestimate consumer concern by 2.3×",
    "Privacy and data use: 81% of consumers care, only 41% of brands think they do",
    "Economic anxiety: widely underestimated across all sectors",
    "Community and belonging: the fastest-rising value, least-addressed by brands",
])

pdf.h2("Who's closing the gap")

pdf.body(
    "Brands outperforming on values alignment share three traits: "
    "they surface consumer data at every major campaign decision, they test "
    "positioning with real audiences before launch, and they treat insight "
    "as a strategic asset rather than a reporting function."
)

pdf.callout(
    "Recommendation: map your current messaging against the Q1 values index. "
    "Use GWI Spark to identify the specific language your audience actually uses.",
    style="success"
)

# ── Methodology ──────────────────────────────────────────────────────────────
pdf.page_break()

pdf.h1("Methodology")

pdf.h3("Data collection")
pdf.body(
    "All data collected via GWI's proprietary online survey platform, "
    "January–March 2026. Respondents are nationally representative samples "
    "aged 16–64 across 53 markets."
)

pdf.h3("Sample")
pdf.table(
    headers=["Region",          "Markets", "Respondents",  "Margin of error"],
    rows=[
        ["North America",        "2",       "182,000",      "±0.2%"],
        ["Europe",               "19",      "620,000",      "±0.1%"],
        ["Asia Pacific",         "18",      "980,000",      "±0.1%"],
        ["Latin America",        "8",       "340,000",      "±0.2%"],
        ["Middle East & Africa", "6",       "278,000",      "±0.3%"],
    ],
    col_widths=[140, 65, 100, 110],
    caption="Table 2 — Sample breakdown by region.",
)

pdf.h3("Quality assurance")
pdf.numbered([
    "Respondents verified against national census benchmarks",
    "Duplicate and bot detection via proprietary fingerprinting",
    "Minimum 15-minute survey completion threshold enforced",
    "Independent data quality audit completed February 2026",
])

pdf.space(20)
pdf.divider()
pdf.small(
    "© 2026 GWI. All rights reserved. This report is for client use only. "
    "Reproduction or redistribution requires written permission from GWI."
)

pdf.build()
