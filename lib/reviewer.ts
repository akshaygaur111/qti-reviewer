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

## Always check these explicitly

### Content check
- Verify the question text (item body) is factually correct, clearly worded, and unambiguous.
- Verify the question makes sense in isolation and does not rely on external context that is not provided.

### Correct answer check
- Verify that the value(s) listed in each correctResponse element are genuinely the right answer(s) to the question.
- For choice interactions: confirm the identified correct choice text is actually correct based on the question content.
- If the marked correct answer is factually wrong or does not match the question, raise a **critical** answer_completeness issue.

### QTI correctResponse vs choices cross-check
- For every correctResponse identifier, verify it resolves to a simpleChoice (or inlineChoice) that exists in the interaction.
- A correctResponse referencing a non-existent choice identifier is always a **critical** answer_completeness issue.
- Verify no choice identifiers are duplicated within the same interaction.

### All possible answers check
- For choice interactions, verify that all plausible and expected answer options are present as choices.
- Flag as a **major** answer_completeness issue if obvious distractors are missing or if the set of choices is implausibly sparse or trivially easy.
- For multiple-response interactions (cardinality=multiple), verify ALL correct answers are listed in the correctResponse—not just some of them.

## Always raise these as critical issues
- Missing SCORE outcomeDeclaration: if no outcomeDeclaration with identifier="SCORE" exists, raise a critical scoring_logic issue — the item has no declared score outcome and scoring will not function.

## Personalisation rules — CRITICAL
Every issue MUST reference specific details from THIS item:
- Quote the actual question text or choice content when relevant
- Name actual identifiers (e.g. "RESPONSE_1", "SCORE maxValue 10")
- Reference actual score values and element names found in the XML
- Do NOT write generic statements unless they apply to something actually present in the XML

## Do NOT raise issues for these — they are valid design choices
- Absence of modalFeedback for correct answers (correct-answer feedback is optional)
- Absence of modalFeedback entirely (feedback is always optional)
- Having only incorrect-answer feedback with no correct-answer feedback
- Simple response processing templates when the interaction type suits them
- Low distractor count when the item type justifies it

## What to raise issues for
Only raise an issue if you can point to a specific, concrete problem in THIS item's actual XML.
If something is absent but not required, do not raise it.

Respond ONLY with valid JSON (no markdown, no extra text):
{
  "overall_score": <1-10>,
  "overall_summary": "<2-3 sentence summary specific to THIS item's content>",
  "issues": [
    {
      "category": "<name>",
      "severity": "<critical|major|minor|suggestion>",
      "message": "<short title referencing the specific element>",
      "detail": "<explanation citing specific XML content, identifiers, or values>",
      "recommendation": "<concrete fix for this specific item>"
    }
  ]
}

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
          detail: `The ${interaction.interactionType} with responseIdentifier '${rid}' has no simpleChoice/inlineChoice elements. Learners will have nothing to select.`,
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
            detail: `Multiple simpleChoice elements share the identifier '${choice.identifier}' in interaction '${rid}'. All choice identifiers must be unique.`,
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
            detail: `The responseDeclaration '${rid}' has no correctResponse values. The item cannot be automatically scored.`,
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
                detail: `The correctResponse references '${respId}' in responseDeclaration '${rd.identifier}', but no simpleChoice with that identifier exists. Available choice identifiers: ${available}.`,
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
              detail: `The mapping in responseDeclaration '${rd.identifier}' references '${mapKey}', which does not match any simpleChoice identifier. Available: ${available}.`,
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
    "Provide your personalised review as the JSON schema specified in the system prompt.",
    "Remember: every issue and strength must cite specific content from THIS item.",
    "Do NOT raise issues for missing correct-answer feedback — it is intentionally absent in many items.",
  ].join("\n");
}
