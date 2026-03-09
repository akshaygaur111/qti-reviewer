/**
 * QTI Reviewer — Google Gemini integration (TypeScript)
 */

import {
  GoogleGenerativeAI,
  GenerativeModel,
  HarmCategory,
  HarmBlockThreshold,
} from "@google/generative-ai";
import type { QTIItemSummary, ReviewResult, Issue } from "./types";

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are an expert QTI (Question and Test Interoperability) 3.0 assessment reviewer.
Analyse QTI 3.0 assessment items and report issues across six categories:

1. content_accuracy — Question clarity, unambiguous wording, factual correctness, cultural bias.
2. scoring_logic — outcomeDeclarations, max/min/default score values, SCORE alignment with responseProcessing, partial credit correctness.
3. response_processing — Template validity for the interaction type, custom logic correctness, edge case handling.
4. answer_completeness — Correctness and completeness of correctResponse values, distractor plausibility, rubric for open-ended items.
5. qti_compliance — QTI 3.0 required attributes (identifier, title, adaptive, timeDependent), responseIdentifier cross-references, structural validity.
6. accessibility — Alt text for images that are actually present, xml:lang, reading level, inclusive language.

## QTI 3.0 Strict Compliance Rules (CRITICAL)
The renderer now operates in strict mode. You MUST flag these as issues:
- **Missing Response Processing**: If <qti-feedback-block> or <qti-feedback-inline> exists, there MUST be <qti-response-processing> that sets the corresponding outcome variable.
- **Missing outcome-identifier**: Every <qti-feedback-block> and <qti-feedback-inline> MUST have an 'outcome-identifier' attribute.
- **match_correct Template**: The 'match_correct' template ONLY works for a single response declaration named 'RESPONSE'. If there are multiple response declarations (e.g. RESPONSE1, RESPONSE2), flag the use of match_correct and recommend custom inline <qti-response-processing>.
- **SCORE Correctness**: The <qti-outcome-declaration identifier="SCORE"> MUST have a 'normalMaximum' attribute for correctness to be determined accurately.
- **Mandatory Answers**: In strict mode, MCQ is optional unless 'min-choices="1"' is set, and Extended Text is optional unless 'required="true"' is set. Recommend adding these if the question intent is clearly mandatory.

## Behavioral Verification (NEW)
As part of your review, you must generate a set of test cases to verify the item behaves as expected when submitted to a scoring engine.
Generate 3-5 logical test cases covering:
- The correct answer(s)
- Common misconceptions or plausible distractors
- Edge cases (e.g., partial credit if applicable)

The "payload" for each test case MUST be a flat object mapping response identifiers to values. 
DO NOT wrap it in a "responses" key yourself; the system will handle that.
Example: { "RESPONSE_1": "A", "RESPONSE_2": "B" }

Respond ONLY with valid JSON (no markdown, no extra text):
{
  "overall_score": <1-10>,
  "overall_summary": "<2-3 sentence summary specific to THIS item's content>",
  "issues": [
    {
      "category": "<name>",
      "severity": "<critical|major|minor|suggestion>",
      "message": "<short title>",
      "detail": "<explanation citing specific XML content>",
      "recommendation": "<concrete fix>"
    }
  ],
  "test_cases": [
    {
      "label": "<short description, e.g. 'Partial credit for choice A'>",
      "payload": { "RESPONSE_ID": "VALUE", ... },
      "expected_score": <number>,
      "expected_is_correct": <boolean>
    }
  ]
}

## Personalisation rules — CRITICAL
Every issue and test case MUST reference specific details from THIS item (identifiers, values, text).

Severity: critical=broken/wrong scores, major=significant quality issue, minor=small problem, suggestion=enhancement.
If there are no real issues, return an empty issues array. Do not invent issues to fill the list.`;

// ---------------------------------------------------------------------------
// Reviewer class
// ---------------------------------------------------------------------------

export class QTIReviewer {
  private model: GenerativeModel;
  private modelName: string;

  constructor(apiKey: string, modelName = "gemini-2.5-flash") {
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
      issues: [],
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

    // Run deterministic checks before calling the AI
    result.issues.push(...staticAnswerChecks(summary));

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

      result.issues = (data.issues ?? []).map(
        (i: Record<string, unknown>): Issue => ({
          category: String(i.category ?? ""),
          severity: (i.severity as Issue["severity"]) ?? "minor",
          message: String(i.message ?? ""),
          detail: String(i.detail ?? ""),
          recommendation: String(i.recommendation ?? ""),
        })
      );

      // Parse AI-generated test cases
      const aiTestCases = (data.test_cases ?? []).map(
        (tc: Record<string, unknown>): any => ({
          label: String(tc.label ?? "AI Generated Test"),
          payload: tc.payload ?? {},
          expectedScore: tc.expected_score !== undefined ? Number(tc.expected_score) : undefined,
          expectedIsCorrect: tc.expected_is_correct !== undefined ? Boolean(tc.expected_is_correct) : undefined,
        })
      );

      // Add deterministic test cases
      const deterministicCases = generateDeterministicTestCases(summary);

      // Combine and filter duplicates by label
      const allCases = [...deterministicCases, ...aiTestCases];
      const seenLabels = new Set<string>();

      result.behavioralTests = allCases
        .filter((tc) => {
          if (seenLabels.has(tc.label)) return false;
          seenLabels.add(tc.label);
          return true;
        })
        .map((tc) => ({
          ...tc,
          status: "pass" as const, // Placeholder status
        }));

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
// Static (non-AI) answer / content checks
// ---------------------------------------------------------------------------

const CHOICE_INTERACTIONS = new Set([
  "choiceInteraction",
  "inlineChoiceInteraction",
]);

function staticAnswerChecks(summary: QTIItemSummary): Issue[] {
  const issues: Issue[] = [];

  const rdMap = new Map(summary.responseDeclarations.map((rd) => [rd.identifier, rd]));
  const interactionIds = new Set(summary.interactions.map((ix) => ix.responseIdentifier));

  for (const interaction of summary.interactions) {
    const rid = interaction.responseIdentifier;
    const rd = rdMap.get(rid);

    if (CHOICE_INTERACTIONS.has(interaction.interactionType)) {
      const choiceIds = new Set(interaction.choices.map((c) => c.identifier));

      // Check: choices list must not be empty
      if (interaction.choices.length === 0) {
        issues.push({
          category: "answer_completeness",
          severity: "critical",
          message: `No choices in interaction '${rid}'`,
          detail: `The ${interaction.interactionType} with responseIdentifier '${rid}' has no simpleChoice / inlineChoice elements.Learners will have nothing to select.`,
          recommendation: "Add simpleChoice (or inlineChoice) elements to the interaction.",
        });
      }

      // Check: duplicate choice identifiers
      const seen = new Set<string>();
      for (const choice of interaction.choices) {
        if (seen.has(choice.identifier)) {
          issues.push({
            category: "qti_compliance",
            severity: "major",
            message: `Duplicate choice identifier '${choice.identifier}' in '${rid}'`,
            detail: `Multiple simpleChoice elements share the identifier '${choice.identifier}' in interaction '${rid}'.All choice identifiers must be unique.`,
            recommendation: "Assign a unique identifier to each simpleChoice element.",
          });
        }
        seen.add(choice.identifier);
      }

      if (rd) {
        // Check: correctResponse must be defined
        if (rd.correctResponse.length === 0) {
          issues.push({
            category: "answer_completeness",
            severity: "critical",
            message: `No correctResponse for '${rid}'`,
            detail: `The responseDeclaration '${rid}' has no correctResponse values.The item cannot be automatically scored.`,
            recommendation: "Add a <correctResponse> element with the correct choice identifier(s).",
          });
        } else {
          // Check: every correctResponse value resolves to a real choice
          for (const respId of rd.correctResponse) {
            if (choiceIds.size > 0 && !choiceIds.has(respId)) {
              const available = [...choiceIds].sort().join(", ");
              issues.push({
                category: "answer_completeness",
                severity: "critical",
                message: `Correct answer '${respId}' not found in choices of '${rid}'`,
                detail: `The correctResponse references '${respId}' in responseDeclaration '${rd.identifier}', but no simpleChoice with that identifier exists.Available choice identifiers: ${available}.`,
                recommendation: `Update the correctResponse to use one of the valid choice identifiers: ${available}.`,
              });
            }
          }
        }

        // Check: mapping keys must resolve to real choices
        for (const mapKey of Object.keys(rd.mapping)) {
          if (choiceIds.size > 0 && !choiceIds.has(mapKey)) {
            const available = [...choiceIds].sort().join(", ");
            issues.push({
              category: "scoring_logic",
              severity: "major",
              message: `Mapping key '${mapKey}' not found in choices of '${rid}'`,
              detail: `The mapping in responseDeclaration '${rd.identifier}' references '${mapKey}', which does not match any simpleChoice identifier.Available: ${available}.`,
              recommendation: `Update the mapping to use valid choice identifiers: ${available}.`,
            });
          }
        }
      }
    }
  }

  // Check: responseDeclarations without a matching interaction
  for (const rd of summary.responseDeclarations) {
    if (!interactionIds.has(rd.identifier)) {
      issues.push({
        category: "qti_compliance",
        severity: "minor",
        message: `Unused responseDeclaration '${rd.identifier}'`,
        detail: `The responseDeclaration '${rd.identifier}' is not referenced by any interaction in the itemBody.`,
        recommendation: "Remove the unused responseDeclaration or add the matching interaction.",
      });
    }
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Behavioral Test Generation
// ---------------------------------------------------------------------------

function generateDeterministicTestCases(summary: QTIItemSummary): any[] {
  const cases: any[] = [];

  // 1. Full Correct Answer
  const correctPayload: Record<string, any> = {};
  summary.responseDeclarations.forEach((rd) => {
    if (rd.correctResponse.length > 0) {
      correctPayload[rd.identifier] = rd.cardinality === "single"
        ? rd.correctResponse[0]
        : rd.correctResponse;
    }
  });

  if (Object.keys(correctPayload).length > 0) {
    cases.push({
      label: "Deterministic: Full Correct Response",
      payload: correctPayload,
      expectedIsCorrect: true,
      // expectedScore: we don't know exactly unless we check outcomeDeclarations, which can be complex.
      // But we can assume it should be > 0.
    });
  }

  // 2. All Incorrect (if choices exist)
  const incorrectPayload: Record<string, any> = {};
  summary.interactions.forEach((ix) => {
    const rd = summary.responseDeclarations.find(d => d.identifier === ix.responseIdentifier);
    if (rd && ix.choices.length > 0) {
      const wrongChoice = ix.choices.find(c => !rd.correctResponse.includes(c.identifier));
      if (wrongChoice) {
        incorrectPayload[ix.responseIdentifier] = wrongChoice.identifier;
      }
    }
  });

  if (Object.keys(incorrectPayload).length > 0) {
    cases.push({
      label: "Deterministic: All Incorrect Response",
      payload: incorrectPayload,
      expectedIsCorrect: false,
    });
  }

  return cases;
}

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
    "Provide your personalised review AND logical test cases as the JSON schema specified in the system prompt.",
    "Remember: every issue and test case must cite specific content from THIS item.",
    "Do NOT raise issues for missing correct-answer feedback — it is intentionally absent in many items.",
  ].join("\n");
}
