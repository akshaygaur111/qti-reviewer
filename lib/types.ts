// Shared TypeScript types for the QTI Reviewer

// ---------------------------------------------------------------------------
// Parser types
// ---------------------------------------------------------------------------

export interface SimpleChoice {
  identifier: string;
  content: string;
  fixed?: boolean;
}

export interface ResponseDeclaration {
  identifier: string;
  cardinality: "single" | "multiple" | "ordered" | "record";
  baseType: string;
  correctResponse: string[];
  mapping: Record<string, number>;
  mappingDefault?: number;
}

export interface OutcomeDeclaration {
  identifier: string;
  cardinality: string;
  baseType: string;
  defaultValue?: number;
  normalMaximum?: number;
  normalMinimum?: number;
}

export interface Interaction {
  interactionType: string;
  responseIdentifier: string;
  prompt: string;
  choices: SimpleChoice[];
  maxChoices: number;
  minChoices: number;
  shuffle: boolean;
  extra: Record<string, string>;
}

export interface QTIItemSummary {
  identifier: string;
  title: string;
  qtiVersion: string;
  adaptive: boolean;
  timeDependent: boolean;
  language?: string;
  itemBodyText: string;
  interactions: Interaction[];
  responseDeclarations: ResponseDeclaration[];
  outcomeDeclarations: OutcomeDeclaration[];
  responseProcessingTemplate?: string;
  responseProcessingCustom?: string;
  rubricText: string;
  feedbackIdentifiers: string[];
  parseErrors: string[];
}

// ---------------------------------------------------------------------------
// Reviewer types
// ---------------------------------------------------------------------------

export type Severity = "critical" | "major" | "minor" | "suggestion";

export interface Issue {
  category: string;
  severity: Severity;
  message: string;
  detail: string;
  recommendation: string;
}

export interface CategoryScore {
  category: string;
  score: number;
  summary: string;
}

export interface ReviewResult {
  itemIdentifier: string;
  itemTitle: string;
  fileName: string;
  overallScore: number;
  overallSummary: string;
  categoryScores: CategoryScore[];
  issues: Issue[];
  strengths: string[];
  modelUsed: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// API request/response types
// ---------------------------------------------------------------------------

export interface ReviewRequest {
  xml: string;
  fileName?: string;
}

export interface BulkReviewRequest {
  items: { xml: string; fileName: string }[];
}

export interface BulkReviewResponse {
  results: ReviewResult[];
  summary: {
    total: number;
    succeeded: number;
    failed: number;
    averageScore: number;
    criticalIssueCount: number;
  };
}
