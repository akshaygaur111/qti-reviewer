"""
QTI Reviewer — Uses Google Gemini to review QTI 3.0 assessment items.

Review categories:
  1. Content Accuracy      — question clarity, factual correctness
  2. Scoring Logic         — outcome declarations, max score alignment
  3. Response Processing   — template validity, custom logic correctness
  4. Answer Completeness   — correct responses defined, distractor quality
  5. QTI 3.0 Compliance    — required attributes, structural correctness
  6. Accessibility         — alt text, language attributes, inclusive language
"""

import json
import os
from dataclasses import dataclass, field
from typing import Optional

import google.generativeai as genai

from .parser import QTIItem, summarize_item

# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------

SEVERITY_LEVELS = ("critical", "major", "minor", "suggestion")

REVIEW_CATEGORIES = (
    "content_accuracy",
    "scoring_logic",
    "response_processing",
    "answer_completeness",
    "qti_compliance",
    "accessibility",
)


@dataclass
class Issue:
    category: str
    severity: str           # critical | major | minor | suggestion
    message: str
    detail: str = ""
    recommendation: str = ""


@dataclass
class CategoryScore:
    category: str
    score: int              # 1–10
    summary: str


@dataclass
class ReviewResult:
    item_identifier: str
    item_title: str
    file_path: str
    overall_score: int          # 1–10
    overall_summary: str
    category_scores: list[CategoryScore] = field(default_factory=list)
    issues: list[Issue] = field(default_factory=list)
    strengths: list[str] = field(default_factory=list)
    model_used: str = ""
    error: Optional[str] = None

    def to_dict(self) -> dict:
        return {
            "item_identifier": self.item_identifier,
            "item_title": self.item_title,
            "file_path": self.file_path,
            "overall_score": self.overall_score,
            "overall_summary": self.overall_summary,
            "model_used": self.model_used,
            "category_scores": [
                {"category": cs.category, "score": cs.score, "summary": cs.summary}
                for cs in self.category_scores
            ],
            "issues": [
                {
                    "category": i.category,
                    "severity": i.severity,
                    "message": i.message,
                    "detail": i.detail,
                    "recommendation": i.recommendation,
                }
                for i in self.issues
            ],
            "strengths": self.strengths,
            "error": self.error,
        }


# ---------------------------------------------------------------------------
# Prompt construction
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """You are an expert QTI (Question and Test Interoperability) 3.0 assessment reviewer.
Your task is to analyse QTI 3.0 assessment items and provide a structured, detailed review.

You will evaluate each item across six categories:

1. **content_accuracy** — Is the question stem clear and unambiguous? Are the correct answers factually accurate? Is the item free from cultural bias and trick wording?

2. **scoring_logic** — Do the outcomeDeclarations define appropriate max/min/default values? Does the SCORE outcome align with what the responseProcessing awards? Is partial credit implemented correctly where needed?

3. **response_processing** — Is the responseProcessing template correct for the interaction type? If custom responseProcessing is used, is the logic correct, complete, and handles all edge cases?

4. **answer_completeness** — Are all correct/acceptable answers included in the correctResponse? For multiple choice, are distractors plausible but clearly wrong? For open-ended items, is a rubric or sample response provided?

5. **qti_compliance** — Does the item follow QTI 3.0 specification? Are required attributes present (identifier, title, adaptive, timeDependent)? Do responseIdentifiers match between interactions and responseDeclarations?

6. **accessibility** — Are images accompanied by alt text? Is the language attribute set? Is the reading level appropriate? Is the item free from accessibility barriers?

Respond ONLY with a valid JSON object using the following schema (no markdown, no extra text):

{
  "overall_score": <integer 1-10>,
  "overall_summary": "<2-3 sentence summary>",
  "category_scores": [
    {
      "category": "<one of the six category names>",
      "score": <integer 1-10>,
      "summary": "<1-2 sentence summary for this category>"
    }
  ],
  "issues": [
    {
      "category": "<category name>",
      "severity": "<critical|major|minor|suggestion>",
      "message": "<short issue title>",
      "detail": "<explanation of the problem>",
      "recommendation": "<how to fix it>"
    }
  ],
  "strengths": ["<strength 1>", "<strength 2>"]
}

Severity definitions:
- critical: The item will not function correctly or will produce wrong scores.
- major: Significant quality problem that will impact learner experience or scoring fairness.
- minor: Small problem that should be addressed but does not break functionality.
- suggestion: Enhancement that would improve but is not required.
"""


def _build_user_prompt(summary: dict, raw_xml: str) -> str:
    summary_json = json.dumps(summary, indent=2)
    # Truncate raw XML if very large to stay within token limits
    xml_excerpt = raw_xml[:8000] + ("\n[...truncated...]" if len(raw_xml) > 8000 else "")
    return (
        "Please review the following QTI 3.0 assessment item.\n\n"
        "## Parsed Item Summary (JSON)\n"
        f"```json\n{summary_json}\n```\n\n"
        "## Raw QTI XML\n"
        f"```xml\n{xml_excerpt}\n```\n\n"
        "Provide your review as the JSON schema specified in the system prompt."
    )


# ---------------------------------------------------------------------------
# Gemini client
# ---------------------------------------------------------------------------

class QTIReviewer:
    """
    Reviews QTI 3.0 items using Google Gemini.

    Args:
        api_key: Gemini API key. Falls back to GEMINI_API_KEY env var.
        model:   Gemini model name (default: gemini-1.5-pro).
    """

    DEFAULT_MODEL = "gemini-1.5-pro"

    def __init__(
        self,
        api_key: Optional[str] = None,
        model: str = DEFAULT_MODEL,
    ):
        key = api_key or os.environ.get("GEMINI_API_KEY")
        if not key:
            raise ValueError(
                "Gemini API key is required. Set GEMINI_API_KEY environment variable "
                "or pass api_key= to QTIReviewer()."
            )
        genai.configure(api_key=key)
        self._model_name = model
        self._model = genai.GenerativeModel(
            model_name=model,
            system_instruction=SYSTEM_PROMPT,
        )

    def review_item(self, item: QTIItem) -> ReviewResult:
        """Review a single parsed QTI item. Returns a ReviewResult."""
        result = ReviewResult(
            item_identifier=item.identifier,
            item_title=item.title,
            file_path=item.file_path,
            overall_score=0,
            overall_summary="",
            model_used=self._model_name,
        )

        # Surface parse errors as critical issues without calling the API
        if item.parse_errors and not item.interactions and not item.response_declarations:
            result.error = "; ".join(item.parse_errors)
            result.issues.append(Issue(
                category="qti_compliance",
                severity="critical",
                message="XML parsing failed",
                detail=result.error,
                recommendation="Fix the XML syntax errors in the source file.",
            ))
            return result

        summary = summarize_item(item)
        user_prompt = _build_user_prompt(summary, item.raw_xml)

        try:
            response = self._model.generate_content(
                user_prompt,
                generation_config=genai.GenerationConfig(
                    temperature=0.2,    # low temperature for consistent structured output
                    response_mime_type="application/json",
                ),
            )
            raw_text = response.text
        except Exception as exc:
            result.error = f"Gemini API error: {exc}"
            return result

        try:
            data = json.loads(raw_text)
        except json.JSONDecodeError as exc:
            result.error = f"Failed to parse Gemini response as JSON: {exc}\nRaw: {raw_text[:500]}"
            return result

        result.overall_score = int(data.get("overall_score", 0))
        result.overall_summary = data.get("overall_summary", "")
        result.strengths = data.get("strengths", [])

        for cs_data in data.get("category_scores", []):
            result.category_scores.append(CategoryScore(
                category=cs_data.get("category", ""),
                score=int(cs_data.get("score", 0)),
                summary=cs_data.get("summary", ""),
            ))

        for issue_data in data.get("issues", []):
            result.issues.append(Issue(
                category=issue_data.get("category", ""),
                severity=issue_data.get("severity", "minor"),
                message=issue_data.get("message", ""),
                detail=issue_data.get("detail", ""),
                recommendation=issue_data.get("recommendation", ""),
            ))

        # Inject parse errors that didn't block the review as minor issues
        for err in item.parse_errors:
            result.issues.append(Issue(
                category="qti_compliance",
                severity="minor",
                message="XML parse warning",
                detail=err,
                recommendation="Review XML structure to ensure QTI 3.0 compliance.",
            ))

        return result

    def review_file(self, file_path: str) -> ReviewResult:
        """Parse a QTI file and review it. Convenience wrapper."""
        from .parser import parse_qti_file
        item = parse_qti_file(file_path)
        return self.review_item(item)
