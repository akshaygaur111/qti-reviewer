/**
 * QTI 3.0 XML Parser (TypeScript)
 * Supports QTI 3.0 / 2.2 / 2.1 assessmentItem elements.
 */

import { XMLParser } from "fast-xml-parser";
import type {
  QTIItemSummary,
  ResponseDeclaration,
  OutcomeDeclaration,
  Interaction,
  SimpleChoice,
} from "./types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const QTI_NAMESPACES: Record<string, string> = {
  "http://www.imsglobal.org/xsd/imsqtiasi_v3p0": "qti30",
  "http://www.imsglobal.org/xsd/imsqti_v2p2": "qti22",
  "http://www.imsglobal.org/xsd/imsqti_v2p1": "qti21",
};

const RP_TEMPLATES: Record<string, string> = {
  "https://purl.imsglobal.org/spec/qti/v3p0/rptemplates/match_correct": "match_correct",
  "https://purl.imsglobal.org/spec/qti/v3p0/rptemplates/map_response": "map_response",
  "https://purl.imsglobal.org/spec/qti/v3p0/rptemplates/map_response_point": "map_response_point",
  "http://www.imsglobal.org/question/qti/v2p1/rptemplates/match_correct": "match_correct",
  "http://www.imsglobal.org/question/qti/v2p1/rptemplates/map_response": "map_response",
  "http://www.imsglobal.org/question/qti/v2p2/rptemplates/match_correct": "match_correct",
  "http://www.imsglobal.org/question/qti/v2p2/rptemplates/map_response": "map_response",
};

const INTERACTION_TYPES = new Set([
  "choiceInteraction",
  "textEntryInteraction",
  "extendedTextInteraction",
  "matchInteraction",
  "orderInteraction",
  "associateInteraction",
  "gapMatchInteraction",
  "inlineChoiceInteraction",
  "hotspotInteraction",
  "selectPointInteraction",
  "graphicGapMatchInteraction",
  "sliderInteraction",
  "uploadInteraction",
  "drawingInteraction",
  "customInteraction",
  "hottextInteraction",
  "mediaInteraction",
]);

// ---------------------------------------------------------------------------
// XML Parser setup
// ---------------------------------------------------------------------------

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseAttributeValue: false, // keep as strings
  trimValues: true,
  parseTagValue: true,
  processEntities: true,
  htmlEntities: true,
  isArray: (tagName) => {
    // These elements can repeat — always treat as arrays
    const repeatableTags = [
      "responseDeclaration",
      "outcomeDeclaration",
      "value",
      "mapEntry",
      "simpleChoice",
      "inlineChoice",
      "simpleAssociableChoice",
      "modalFeedback",
      "rubricBlock",
    ];
    return repeatableTags.includes(tagName);
  },
  // Strip namespace prefixes from tag names
  transformTagName: (tagName: string) =>
    tagName.includes(":") ? tagName.split(":").pop()! : tagName,
});

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

function safeFloat(val: unknown): number | undefined {
  if (val === undefined || val === null || val === "") return undefined;
  const n = parseFloat(String(val));
  return isNaN(n) ? undefined : n;
}

function safeInt(val: unknown, defaultVal = 0): number {
  if (val === undefined || val === null || val === "") return defaultVal;
  const n = parseInt(String(val), 10);
  return isNaN(n) ? defaultVal : n;
}

function detectVersion(xmlString: string): string {
  for (const [uri, short] of Object.entries(QTI_NAMESPACES)) {
    if (xmlString.includes(uri)) return short;
  }
  return "unknown";
}

/** Extract all text content from a parsed XML node (recursive). */
function extractText(node: unknown): string {
  if (node === null || node === undefined) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (typeof node === "object") {
    const parts: string[] = [];
    for (const [key, val] of Object.entries(node as Record<string, unknown>)) {
      if (key === "@_identifier" || key.startsWith("@_")) continue;
      if (key === "#text") {
        parts.push(String(val));
      } else {
        parts.push(extractText(val));
      }
    }
    return parts.filter(Boolean).join(" ");
  }
  return "";
}

function findAll<T = unknown>(
  obj: Record<string, unknown>,
  tagName: string
): T[] {
  const results: T[] = [];

  function walk(node: unknown) {
    if (!node || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    if (tagName in record) {
      const val = record[tagName];
      if (Array.isArray(val)) {
        results.push(...(val as T[]));
      } else {
        results.push(val as T);
      }
    }
    for (const val of Object.values(record)) {
      if (typeof val === "object") walk(val);
    }
  }

  walk(obj);
  return results;
}

// ---------------------------------------------------------------------------
// Sub-parsers
// ---------------------------------------------------------------------------

function parseResponseDeclaration(
  rd: Record<string, unknown>
): ResponseDeclaration {
  const decl: ResponseDeclaration = {
    identifier: String(rd["@_identifier"] ?? ""),
    cardinality: String(rd["@_cardinality"] ?? "single") as ResponseDeclaration["cardinality"],
    baseType: String(rd["@_baseType"] ?? "identifier"),
    correctResponse: [],
    mapping: {},
  };

  // correctResponse > value[]
  const cr = rd["correctResponse"] as Record<string, unknown> | undefined;
  if (cr) {
    const values = Array.isArray(cr["value"])
      ? cr["value"]
      : cr["value"] !== undefined
        ? [cr["value"]]
        : [];
    decl.correctResponse = values
      .map((v: unknown) =>
        typeof v === "object" ? String((v as Record<string, unknown>)["#text"] ?? extractText(v)) : String(v)
      )
      .filter(Boolean);
  }

  // mapping
  const mappingEl = rd["mapping"] as Record<string, unknown> | undefined;
  if (mappingEl) {
    decl.mappingDefault = safeFloat(mappingEl["@_defaultValue"]);
    const entries = Array.isArray(mappingEl["mapEntry"])
      ? mappingEl["mapEntry"]
      : mappingEl["mapEntry"]
        ? [mappingEl["mapEntry"]]
        : [];
    for (const entry of entries as Record<string, unknown>[]) {
      const key = String(entry["@_mapKey"] ?? "");
      const val = safeFloat(entry["@_mappedValue"]) ?? 0;
      if (key) decl.mapping[key] = val;
    }
  }

  return decl;
}

function parseOutcomeDeclaration(
  od: Record<string, unknown>
): OutcomeDeclaration {
  const decl: OutcomeDeclaration = {
    identifier: String(od["@_identifier"] ?? ""),
    cardinality: String(od["@_cardinality"] ?? "single"),
    baseType: String(od["@_baseType"] ?? "float"),
    normalMaximum: safeFloat(od["@_normalMaximum"]),
    normalMinimum: safeFloat(od["@_normalMinimum"]),
  };

  const dv = od["defaultValue"] as Record<string, unknown> | undefined;
  if (dv) {
    const v = dv["value"];
    decl.defaultValue = safeFloat(
      typeof v === "object" ? (v as Record<string, unknown>)["#text"] : v
    );
  }
  return decl;
}

function parseInteraction(
  interactionType: string,
  el: Record<string, unknown>
): Interaction {
  const interaction: Interaction = {
    interactionType,
    responseIdentifier: String(el["@_responseIdentifier"] ?? ""),
    shuffle: String(el["@_shuffle"] ?? "false").toLowerCase() === "true",
    maxChoices: safeInt(el["@_maxChoices"], 1),
    minChoices: safeInt(el["@_minChoices"], 0),
    prompt: "",
    choices: [],
    extra: {},
  };

  // prompt
  const promptEl = el["prompt"] as Record<string, unknown> | undefined;
  if (promptEl) {
    interaction.prompt = extractText(promptEl).trim();
  }

  // simpleChoice
  const simpleChoices = Array.isArray(el["simpleChoice"])
    ? (el["simpleChoice"] as Record<string, unknown>[])
    : el["simpleChoice"]
      ? [el["simpleChoice"] as Record<string, unknown>]
      : [];

  for (const c of simpleChoices) {
    const content = typeof c === "object"
      ? extractText(c).trim()
      : String(c);
    interaction.choices.push({
      identifier: String((c as Record<string, unknown>)["@_identifier"] ?? ""),
      content,
      fixed: String((c as Record<string, unknown>)["@_fixed"] ?? "false").toLowerCase() === "true",
    });
  }

  // inlineChoice
  const inlineChoices = Array.isArray(el["inlineChoice"])
    ? (el["inlineChoice"] as Record<string, unknown>[])
    : el["inlineChoice"]
      ? [el["inlineChoice"] as Record<string, unknown>]
      : [];
  for (const c of inlineChoices) {
    interaction.choices.push({
      identifier: String((c as Record<string, unknown>)["@_identifier"] ?? ""),
      content: extractText(c).trim(),
    });
  }

  // Extra attributes
  for (const attr of ["expectedLength", "expectedLines", "format", "patternMask", "placeholderText"]) {
    const val = el[`@_${attr}`];
    if (val !== undefined) interaction.extra[attr] = String(val);
  }

  return interaction;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function parseQTIXml(xmlString: string, fileName = "unknown.xml"): QTIItemSummary {
  const summary: QTIItemSummary = {
    identifier: "",
    title: "",
    qtiVersion: detectVersion(xmlString),
    adaptive: false,
    timeDependent: false,
    itemBodyText: "",
    interactions: [],
    responseDeclarations: [],
    outcomeDeclarations: [],
    rubricText: "",
    feedbackIdentifiers: [],
    parseErrors: [],
  };

  let parsed: Record<string, unknown>;
  try {
    parsed = xmlParser.parse(xmlString) as Record<string, unknown>;
  } catch (err) {
    summary.parseErrors.push(`XML parse error: ${err}`);
    return summary;
  }

  // Find assessmentItem root (may be nested under namespace prefix)
  const assessmentItem = (
    parsed["assessmentItem"] ??
    Object.values(parsed).find(
      (v) => typeof v === "object" && v !== null
    )
  ) as Record<string, unknown> | undefined;

  if (!assessmentItem) {
    summary.parseErrors.push("Could not locate assessmentItem element");
    return summary;
  }

  summary.identifier = String(assessmentItem["@_identifier"] ?? "");
  summary.title = String(assessmentItem["@_title"] ?? "");
  summary.adaptive = String(assessmentItem["@_adaptive"] ?? "false").toLowerCase() === "true";
  summary.timeDependent = String(assessmentItem["@_timeDependent"] ?? "false").toLowerCase() === "true";
  summary.language = String(assessmentItem["@_lang"] ?? assessmentItem["@_xml:lang"] ?? "");

  // responseDeclaration[]
  const rdList = Array.isArray(assessmentItem["responseDeclaration"])
    ? (assessmentItem["responseDeclaration"] as Record<string, unknown>[])
    : assessmentItem["responseDeclaration"]
      ? [assessmentItem["responseDeclaration"] as Record<string, unknown>]
      : [];
  summary.responseDeclarations = rdList.map(parseResponseDeclaration);

  // outcomeDeclaration[]
  const odList = Array.isArray(assessmentItem["outcomeDeclaration"])
    ? (assessmentItem["outcomeDeclaration"] as Record<string, unknown>[])
    : assessmentItem["outcomeDeclaration"]
      ? [assessmentItem["outcomeDeclaration"] as Record<string, unknown>]
      : [];
  summary.outcomeDeclarations = odList.map(parseOutcomeDeclaration);

  // itemBody — extract text + interactions
  const itemBody = assessmentItem["itemBody"] as Record<string, unknown> | undefined;
  if (itemBody) {
    const bodyParts: string[] = [];
    for (const [key, val] of Object.entries(itemBody)) {
      if (key.startsWith("@_")) continue;
      if (INTERACTION_TYPES.has(key)) {
        const ixList = Array.isArray(val)
          ? (val as Record<string, unknown>[])
          : [val as Record<string, unknown>];
        for (const ix of ixList) {
          summary.interactions.push(parseInteraction(key, ix));
        }
      } else {
        bodyParts.push(extractText(val));
      }
    }
    summary.itemBodyText = bodyParts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  }

  // responseProcessing
  const rp = assessmentItem["responseProcessing"] as Record<string, unknown> | undefined;
  if (rp) {
    const templateUri = String(rp["@_template"] ?? "");
    if (templateUri) {
      summary.responseProcessingTemplate =
        RP_TEMPLATES[templateUri] ?? templateUri.split("/").pop();
    } else {
      // Custom logic — stringify the node keys as a rough summary
      const keys = Object.keys(rp).filter((k) => !k.startsWith("@_"));
      summary.responseProcessingCustom = keys.length
        ? `Custom logic with elements: ${keys.join(", ")}`
        : "Empty custom responseProcessing";
    }
  }

  // rubricBlock
  const rubrics = findAll<Record<string, unknown>>(assessmentItem, "rubricBlock");
  summary.rubricText = rubrics.map((r) => extractText(r)).filter(Boolean).join("\n");

  // modalFeedback identifiers
  const feedbacks = findAll<Record<string, unknown>>(assessmentItem, "modalFeedback");
  summary.feedbackIdentifiers = feedbacks
    .map((f) => String(f["@_identifier"] ?? ""))
    .filter(Boolean);

  return summary;
}
