#!/usr/bin/env python3
"""
QTI Reviewer CLI — AI-powered QTI 3.0 assessment item reviewer using Google Gemini.

Commands:
  review  <file.xml> [options]        Review a single QTI item
  bulk    <path> [path ...] [options] Review all QTI items in directories/files
  parse   <file.xml>                  Parse and dump item structure (no API call)

Environment:
  GEMINI_API_KEY   Required. Your Google Gemini API key.

Examples:
  python main.py review item.xml
  python main.py review item.xml --output report.json --format json
  python main.py bulk ./items/ --output bulk_report.txt --workers 4
  python main.py bulk item1.xml item2.xml --format json
  python main.py parse item.xml
"""

import argparse
import json
import os
import sys
from pathlib import Path

# Ensure src/ is importable
sys.path.insert(0, str(Path(__file__).parent))

from src.parser import parse_qti_file, summarize_item
from src.reviewer import QTIReviewer
from src.bulk import run_bulk_review, discover_qti_files, BulkProgress
from src.report import (
    item_report_text,
    item_report_json,
    bulk_report_text,
    bulk_report_json,
    save_report,
)


# ---------------------------------------------------------------------------
# Progress callback for bulk mode
# ---------------------------------------------------------------------------

def _progress_cb(progress: BulkProgress, result):
    done = progress.completed + progress.failed
    icon = "✓" if result.error is None else "✗"
    score = f"[{result.overall_score}/10]" if result.error is None else "[ERR]"
    name = result.item_title or result.item_identifier or Path(result.file_path).stem
    print(
        f"  {icon} ({done}/{progress.total}) {score} {name}",
        flush=True,
    )


# ---------------------------------------------------------------------------
# Subcommand: review
# ---------------------------------------------------------------------------

def cmd_review(args):
    file_path = args.file
    if not Path(file_path).is_file():
        print(f"Error: File not found: {file_path}", file=sys.stderr)
        sys.exit(1)

    api_key = args.api_key or os.environ.get("GEMINI_API_KEY")
    if not api_key:
        print(
            "Error: GEMINI_API_KEY environment variable not set.\n"
            "  Set it with: export GEMINI_API_KEY=<your-key>",
            file=sys.stderr,
        )
        sys.exit(1)

    reviewer = QTIReviewer(api_key=api_key, model=args.model)

    print(f"Reviewing: {file_path}", flush=True)
    result = reviewer.review_file(file_path)

    # Choose output format
    fmt = args.format.lower()
    if fmt == "json":
        content = item_report_json(result)
    else:
        content = item_report_text(result)

    if args.output:
        save_report(content, args.output)
        print(f"Report saved to: {args.output}")
    else:
        print(content)

    # Exit with non-zero if critical issues found
    if result.error or any(i.severity == "critical" for i in result.issues):
        sys.exit(2)


# ---------------------------------------------------------------------------
# Subcommand: bulk
# ---------------------------------------------------------------------------

def cmd_bulk(args):
    api_key = args.api_key or os.environ.get("GEMINI_API_KEY")
    if not api_key:
        print(
            "Error: GEMINI_API_KEY environment variable not set.\n"
            "  Set it with: export GEMINI_API_KEY=<your-key>",
            file=sys.stderr,
        )
        sys.exit(1)

    # Discover files upfront so we can print a count
    all_files = []
    for p in args.paths:
        all_files.extend(discover_qti_files(p, recursive=not args.no_recursive))

    if not all_files:
        print("No QTI XML files found in the specified paths.", file=sys.stderr)
        sys.exit(1)

    print(f"Found {len(all_files)} QTI file(s). Starting review...\n", flush=True)

    reviewer = QTIReviewer(api_key=api_key, model=args.model)

    bulk = run_bulk_review(
        paths=args.paths,
        reviewer=reviewer,
        max_workers=args.workers,
        progress_callback=_progress_cb,
        recursive=not args.no_recursive,
    )

    print(
        f"\nCompleted: {len(bulk.succeeded)} succeeded, "
        f"{len(bulk.failed_results)} failed. "
        f"Average score: {bulk.average_score}/10\n",
        flush=True,
    )

    fmt = args.format.lower()
    if fmt == "json":
        content = bulk_report_json(bulk)
    else:
        content = bulk_report_text(bulk)

    if args.output:
        save_report(content, args.output)
        print(f"Report saved to: {args.output}")
    else:
        print(content)

    if bulk.critical_issue_count > 0:
        sys.exit(2)


# ---------------------------------------------------------------------------
# Subcommand: parse
# ---------------------------------------------------------------------------

def cmd_parse(args):
    """Parse a QTI file and print its structure without calling the API."""
    file_path = args.file
    if not Path(file_path).is_file():
        print(f"Error: File not found: {file_path}", file=sys.stderr)
        sys.exit(1)

    item = parse_qti_file(file_path)
    summary = summarize_item(item)
    print(json.dumps(summary, indent=2, ensure_ascii=False))


# ---------------------------------------------------------------------------
# Argument parser
# ---------------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="qti-reviewer",
        description="AI-powered QTI 3.0 assessment item reviewer (Google Gemini)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )

    common = argparse.ArgumentParser(add_help=False)
    common.add_argument(
        "--api-key",
        default=None,
        metavar="KEY",
        help="Gemini API key (overrides GEMINI_API_KEY env var)",
    )
    common.add_argument(
        "--model",
        default="gemini-1.5-pro",
        metavar="MODEL",
        help="Gemini model to use (default: gemini-1.5-pro)",
    )
    common.add_argument(
        "--format",
        choices=["text", "json"],
        default="text",
        help="Output format: text (default) or json",
    )
    common.add_argument(
        "--output", "-o",
        default=None,
        metavar="FILE",
        help="Save report to FILE instead of stdout",
    )

    subparsers = parser.add_subparsers(dest="command", required=True)

    # review
    p_review = subparsers.add_parser(
        "review",
        parents=[common],
        help="Review a single QTI item file",
    )
    p_review.add_argument("file", help="Path to QTI XML file")
    p_review.set_defaults(func=cmd_review)

    # bulk
    p_bulk = subparsers.add_parser(
        "bulk",
        parents=[common],
        help="Review multiple QTI items (directories or files)",
    )
    p_bulk.add_argument(
        "paths",
        nargs="+",
        metavar="PATH",
        help="File paths or directories containing QTI XML files",
    )
    p_bulk.add_argument(
        "--workers", "-w",
        type=int,
        default=3,
        metavar="N",
        help="Number of concurrent API calls (default: 3, max recommended: 5)",
    )
    p_bulk.add_argument(
        "--no-recursive",
        action="store_true",
        help="Do not search subdirectories when PATH is a directory",
    )
    p_bulk.set_defaults(func=cmd_bulk)

    # parse
    p_parse = subparsers.add_parser(
        "parse",
        help="Parse QTI file and print structure (no API call)",
    )
    p_parse.add_argument("file", help="Path to QTI XML file")
    p_parse.set_defaults(func=cmd_parse)

    return parser


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    parser = build_parser()
    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
