"""
Bulk QTI Reviewer — processes multiple QTI files (sequential or concurrent).

Usage patterns:
  - Pass a directory: all *.xml files are found recursively.
  - Pass a list of file paths directly.
  - Optional concurrency via ThreadPoolExecutor.
"""

import concurrent.futures
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from .parser import parse_qti_file
from .reviewer import QTIReviewer, ReviewResult


@dataclass
class BulkProgress:
    """Tracks progress during a bulk review run."""
    total: int = 0
    completed: int = 0
    failed: int = 0

    @property
    def remaining(self) -> int:
        return self.total - self.completed - self.failed


@dataclass
class BulkResult:
    results: list[ReviewResult] = field(default_factory=list)
    progress: BulkProgress = field(default_factory=BulkProgress)

    @property
    def succeeded(self) -> list[ReviewResult]:
        return [r for r in self.results if r.error is None]

    @property
    def failed_results(self) -> list[ReviewResult]:
        return [r for r in self.results if r.error is not None]

    @property
    def average_score(self) -> float:
        scores = [r.overall_score for r in self.succeeded if r.overall_score > 0]
        return round(sum(scores) / len(scores), 2) if scores else 0.0

    @property
    def critical_issue_count(self) -> int:
        return sum(
            1 for r in self.succeeded
            for i in r.issues if i.severity == "critical"
        )


def discover_qti_files(path: str, recursive: bool = True) -> list[str]:
    """Find all .xml files under a path (file or directory)."""
    p = Path(path)
    if p.is_file():
        return [str(p)] if p.suffix.lower() == ".xml" else []
    if p.is_dir():
        pattern = "**/*.xml" if recursive else "*.xml"
        return sorted(str(f) for f in p.glob(pattern) if f.is_file())
    return []


def run_bulk_review(
    paths: list[str],
    reviewer: QTIReviewer,
    max_workers: int = 3,
    progress_callback=None,   # callable(progress: BulkProgress, result: ReviewResult)
    recursive: bool = True,
) -> BulkResult:
    """
    Review multiple QTI files.

    Args:
        paths:             File paths or directory paths to review.
        reviewer:          Configured QTIReviewer instance.
        max_workers:       Concurrent API calls (keep ≤ 5 to respect rate limits).
        progress_callback: Optional function called after each item completes.
        recursive:         Whether to recurse into subdirectories.

    Returns:
        BulkResult with all ReviewResult objects.
    """
    # Expand directories to file lists
    all_files: list[str] = []
    for p in paths:
        all_files.extend(discover_qti_files(p, recursive=recursive))

    if not all_files:
        return BulkResult()

    bulk = BulkResult()
    bulk.progress.total = len(all_files)

    def _review_one(file_path: str) -> ReviewResult:
        return reviewer.review_file(file_path)

    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_to_path = {
            executor.submit(_review_one, fp): fp for fp in all_files
        }
        for future in concurrent.futures.as_completed(future_to_path):
            file_path = future_to_path[future]
            try:
                result = future.result()
                if result.error:
                    bulk.progress.failed += 1
                else:
                    bulk.progress.completed += 1
                bulk.results.append(result)
            except Exception as exc:
                bulk.progress.failed += 1
                # Create a minimal error result
                from .reviewer import ReviewResult, Issue
                err_result = ReviewResult(
                    item_identifier="unknown",
                    item_title=Path(file_path).name,
                    file_path=file_path,
                    overall_score=0,
                    overall_summary="",
                    error=str(exc),
                    model_used=reviewer._model_name,
                )
                bulk.results.append(err_result)

            if progress_callback:
                progress_callback(bulk.progress, bulk.results[-1])

    # Sort results by file path for deterministic ordering
    bulk.results.sort(key=lambda r: r.file_path)
    return bulk
