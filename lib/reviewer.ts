/**
 * QTI Reviewer — Google Gemini integration (TypeScript)
 */

import {
  GoogleGenerativeAI,
  GenerativeModel,
  HarmCategory,
  HarmBlockThreshold,
} from "@google/generative-ai";
import type { QTIItemSummary, ReviewResult, Issue, CategoryScore } from "./types";

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are an expert QTI (Question and Test Interoperability) 3.0 assessment reviewer.
Analyse QTI 3.0 assessment items and provide a structured, detailed review across six categories:

1. content_accuracy — Question clarity, unambiguous wording, factual correctness, cultural bias.
2. scoring_logic — outcomeDeclarations, max/min/default score values, SCORE alignment with responseProcessing, partial credit correctness.
3. response_processing — Template validity for the interaction type, custom logic correctness, edge case handling.
4. answer_completeness — All correct/acceptable answers in correctResponse, distractor plausibility, rubric for open-ended items.
5. qti_compliance — QTI 3.0 required attributes (identifier, title, adaptive, timeDependent), responseIdentifier cross-references, structural validity.
6. accessibility — Alt text for images, xml:lang attribute, reading level, inclusive language.

Respond ONLY with valid JSON (no markdown, no extra text):
{
  "overall_score": <1-10>,
  "overall_summary": "<2-3 sentence summary>",
  "category_scores": [
    { "category": "<name>", "score": <1-10>, "summary": "<1-2 sentences>" }
  ],
  "issues": [
    {
      "category": "<name>",
      "severity": "<critical|major|minor|suggestion>",
      "message": "<short title>",
      "detail": "<explanation>",
      "recommendation": "<how to fix>"
    }
  ],
  "strengths": ["<strength>"]
}

Severity: critical=broken/wrong scores, major=significant quality issue, minor=small problem, suggestion=enhancement.`;

// ---------------------------------------------------------------------------
// Reviewer class
// ---------------------------------------------------------------------------

export class QTIReviewer {
  private model: GenerativeModel;
  private modelName: string;

  constructor(apiKey: string, modelName = "gemini-2.0-flash") {
    const genAI = new GoogleGenerativeAI(apiKey);
    this.modelName = modelName;
    this.model = genAI.getGenerativeModel({
      model: modelName,
      systemInstruction: SYSTEM_PROMPT,
      safetySettings: [
        { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
      ],
    });
  }

  async reviewItem(
    summary: QTIItemSummary,
    rawXml: string,
    fileName = "unknown.xml"
  ): Promise<ReviewResult> {
    const result: ReviewResult = {
      itemIdentifier: summary.identifier,
      itemTitle: summary.title,
      fileName,
      overallScore: 0,
      overallSummary: "",
      categoryScores: [],
      issues: [],
      strengths: [],
      modelUsed: this.modelName,
    };

    // Surface parse errors as critical issues without calling the API
    if (
      summary.parseErrors.length > 0 &&
      summary.interactions.length === 0 &&
      summary.responseDeclarations.length === 0
    ) {
      result.error = summary.parseErrors.join("; ");
      result.issues.push({
        category: "qti_compliance",
        severity: "critical",
        message: "XML parsing failed",
        detail: result.error,
        recommendation: "Fix the XML syntax errors in the source file.",
      });
      return result;
    }

    const userPrompt = buildUserPrompt(summary, rawXml);

    try {
      const response = await this.model.generateContent({
        contents: [{ role: "user", parts: [{ text: userPrompt }] }],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: "application/json",
        },
      });

      const rawText = response.response.text();
      const data = JSON.parse(rawText);

      result.overallScore = Number(data.overall_score ?? 0);
      result.overallSummary = String(data.overall_summary ?? "");
      result.strengths = Array.isArray(data.strengths) ? data.strengths : [];

      result.categoryScores = (data.category_scores ?? []).map(
        (cs: Record<string, unknown>): CategoryScore => ({
          category: String(cs.category ?? ""),
          score: Number(cs.score ?? 0),
          summary: String(cs.summary ?? ""),
        })
      );

      result.issues = (data.issues ?? []).map(
        (i: Record<string, unknown>): Issue => ({
          category: String(i.category ?? ""),
          severity: (i.severity as Issue["severity"]) ?? "minor",
          message: String(i.message ?? ""),
          detail: String(i.detail ?? ""),
          recommendation: String(i.recommendation ?? ""),
        })
      );

      // Append any parse warnings as minor issues
      for (const err of summary.parseErrors) {
        result.issues.push({
          category: "qti_compliance",
          severity: "minor",
          message: "XML parse warning",
          detail: err,
          recommendation: "Review XML structure to ensure QTI 3.0 compliance.",
        });
      }
    } catch (err) {
      result.error = `Gemini API error: ${err instanceof Error ? err.message : String(err)}`;
    }

    return result;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildUserPrompt(summary: QTIItemSummary, rawXml: string): string {
  const summaryJson = JSON.stringify(summary, null, 2);
  const xmlExcerpt =
    rawXml.length > 8000
      ? rawXml.slice(0, 8000) + "\n[...truncated...]"
      : rawXml;
  return [
    "Please review the following QTI 3.0 assessment item.\n",
    "## Parsed Item Summary (JSON)",
    "```json",
    summaryJson,
    "```\n",
    "## Raw QTI XML",
    "```xml",
    xmlExcerpt,
    "```\n",
    "Provide your review as the JSON schema specified in the system prompt.",
  ].join("\n");
}
