"""
Report Generator — produces JSON and human-readable text reports
from ReviewResult / BulkResult objects.
"""

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Union

from .reviewer import ReviewResult
from .bulk import BulkResult

# Severity ordering for sorting issues
_SEVERITY_ORDER = {"critical": 0, "major": 1, "minor": 2, "suggestion": 3}

# Score → grade label
def _grade(score: int) -> str:
    if score >= 9:
        return "Excellent"
    if score >= 7:
        return "Good"
    if score >= 5:
        return "Fair"
    if score >= 3:
        return "Poor"
    return "Critical"


def _score_bar(score: int, width: int = 20) -> str:
    """Simple ASCII progress bar."""
    filled = round(score / 10 * width)
    return "[" + "█" * filled + "░" * (width - filled) + f"] {score}/10"


# ---------------------------------------------------------------------------
# Single item report
# ---------------------------------------------------------------------------

def item_report_text(result: ReviewResult) -> str:
    """Render a single ReviewResult as a human-readable text report."""
    lines = []
    sep = "=" * 70
    thin = "-" * 70

    lines.append(sep)
    lines.append(f"  QTI ITEM REVIEW REPORT")
    lines.append(sep)
    lines.append(f"  Item ID   : {result.item_identifier}")
    lines.append(f"  Title     : {result.item_title}")
    lines.append(f"  File      : {result.file_path}")
    lines.append(f"  Model     : {result.model_used}")
    lines.append(f"  Generated : {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}")
    lines.append(sep)

    if result.error:
        lines.append(f"\n  ⚠  ERROR: {result.error}\n")
        return "\n".join(lines)

    # Overall score
    lines.append(f"\n  OVERALL SCORE  {_score_bar(result.overall_score)}  [{_grade(result.overall_score)}]")
    lines.append(f"\n  {result.overall_summary}\n")

    # Category scores
    lines.append(thin)
    lines.append("  CATEGORY SCORES")
    lines.append(thin)
    for cs in result.category_scores:
        label = cs.category.replace("_", " ").title().ljust(25)
        lines.append(f"  {label} {_score_bar(cs.score, 15)}  [{_grade(cs.score)}]")
        lines.append(f"    {cs.summary}")
    lines.append("")

    # Strengths
    if result.strengths:
        lines.append(thin)
        lines.append("  STRENGTHS")
        lines.append(thin)
        for s in result.strengths:
            lines.append(f"  ✓  {s}")
        lines.append("")

    # Issues sorted by severity
    if result.issues:
        lines.append(thin)
        lines.append("  ISSUES")
        lines.append(thin)
        sorted_issues = sorted(result.issues, key=lambda i: _SEVERITY_ORDER.get(i.severity, 99))
        for issue in sorted_issues:
            sev_icon = {"critical": "🔴", "major": "🟠", "minor": "🟡", "suggestion": "🔵"}.get(
                issue.severity, "⚪"
            )
            cat_label = issue.category.replace("_", " ").upper()
            lines.append(f"\n  {sev_icon} [{issue.severity.upper()}] {issue.message}")
            lines.append(f"     Category    : {cat_label}")
            if issue.detail:
                lines.append(f"     Detail      : {issue.detail}")
            if issue.recommendation:
                lines.append(f"     Fix         : {issue.recommendation}")
    else:
        lines.append(f"\n  ✓  No issues found.\n")

    lines.append("\n" + sep + "\n")
    return "\n".join(lines)


def item_report_json(result: ReviewResult, indent: int = 2) -> str:
    """Render a single ReviewResult as JSON."""
    return json.dumps(result.to_dict(), indent=indent, ensure_ascii=False)


# ---------------------------------------------------------------------------
# Bulk report
# ---------------------------------------------------------------------------

def bulk_report_text(bulk: BulkResult) -> str:
    """Render a BulkResult as a human-readable summary + per-item details."""
    lines = []
    sep = "=" * 70
    thin = "-" * 70
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    lines.append(sep)
    lines.append("  QTI BULK REVIEW REPORT")
    lines.append(sep)
    lines.append(f"  Generated    : {now}")
    lines.append(f"  Total items  : {bulk.progress.total}")
    lines.append(f"  Succeeded    : {len(bulk.succeeded)}")
    lines.append(f"  Failed       : {len(bulk.failed_results)}")
    lines.append(f"  Average score: {bulk.average_score} / 10")
    lines.append(f"  Critical issues: {bulk.critical_issue_count}")
    lines.append(sep)

    # Score distribution
    lines.append("\n  SCORE DISTRIBUTION")
    lines.append(thin)
    score_buckets = {"Excellent (9-10)": 0, "Good (7-8)": 0, "Fair (5-6)": 0, "Poor (3-4)": 0, "Critical (1-2)": 0}
    for r in bulk.succeeded:
        s = r.overall_score
        if s >= 9:
            score_buckets["Excellent (9-10)"] += 1
        elif s >= 7:
            score_buckets["Good (7-8)"] += 1
        elif s >= 5:
            score_buckets["Fair (5-6)"] += 1
        elif s >= 3:
            score_buckets["Poor (3-4)"] += 1
        else:
            score_buckets["Critical (1-2)"] += 1
    for label, count in score_buckets.items():
        bar = "█" * count + "░" * max(0, 20 - count)
        lines.append(f"  {label:<20} {bar} {count}")

    # Issue summary by category
    lines.append("\n")
    lines.append(thin)
    lines.append("  ISSUES BY CATEGORY")
    lines.append(thin)
    cat_counts: dict[str, dict[str, int]] = {}
    for r in bulk.succeeded:
        for issue in r.issues:
            cat_counts.setdefault(issue.category, {"critical": 0, "major": 0, "minor": 0, "suggestion": 0})
            cat_counts[issue.category][issue.severity] = cat_counts[issue.category].get(issue.severity, 0) + 1
    for cat, counts in sorted(cat_counts.items()):
        lines.append(
            f"  {cat.replace('_', ' ').title():<30} "
            f"Critical:{counts.get('critical',0)}  Major:{counts.get('major',0)}  "
            f"Minor:{counts.get('minor',0)}  Suggestions:{counts.get('suggestion',0)}"
        )

    # Items needing attention (score ≤ 5 or critical issues)
    attention_items = [
        r for r in bulk.succeeded
        if r.overall_score <= 5 or any(i.severity == "critical" for i in r.issues)
    ]
    if attention_items:
        lines.append("\n")
        lines.append(thin)
        lines.append("  ITEMS NEEDING IMMEDIATE ATTENTION")
        lines.append(thin)
        for r in sorted(attention_items, key=lambda x: x.overall_score):
            crit = sum(1 for i in r.issues if i.severity == "critical")
            lines.append(
                f"  [{r.overall_score}/10] {r.item_title or r.item_identifier}"
                f"  ({crit} critical)  {r.file_path}"
            )

    # Failed items
    if bulk.failed_results:
        lines.append("\n")
        lines.append(thin)
        lines.append("  FAILED ITEMS")
        lines.append(thin)
        for r in bulk.failed_results:
            lines.append(f"  ✗ {r.file_path}")
            lines.append(f"    {r.error}")

    # Per-item detail
    lines.append("\n\n" + sep)
    lines.append("  PER-ITEM DETAILS")
    lines.append(sep + "\n")
    for r in bulk.results:
        lines.append(item_report_text(r))

    return "\n".join(lines)


def bulk_report_json(bulk: BulkResult, indent: int = 2) -> str:
    """Render a BulkResult as JSON."""
    data = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "summary": {
            "total": bulk.progress.total,
            "succeeded": len(bulk.succeeded),
            "failed": len(bulk.failed_results),
            "average_score": bulk.average_score,
            "critical_issue_count": bulk.critical_issue_count,
        },
        "items": [r.to_dict() for r in bulk.results],
    }
    return json.dumps(data, indent=indent, ensure_ascii=False)


# ---------------------------------------------------------------------------
# Save helpers
# ---------------------------------------------------------------------------

def save_report(content: str, output_path: str) -> None:
    """Write report content to a file, creating parent dirs as needed."""
    p = Path(output_path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content, encoding="utf-8")
