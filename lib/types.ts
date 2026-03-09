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

export interface TestCase {
  label: string;
  payload: Record<string, unknown>;
  expectedScore?: number;
  expectedIsCorrect?: boolean;
}

export interface TestResult extends TestCase {
  actualScore?: number;
  actualIsCorrect?: boolean;
  status: "pass" | "fail" | "error";
  error?: string;
  responseBody?: any;
}

export interface ReviewResult {
  itemIdentifier: string;
  itemTitle: string;
  fileName: string;
  overallScore: number;
  overallSummary: string;
  issues: Issue[];
  modelUsed: string;
  error?: string;
  /** Set when the item was fetched from the alpha-1edtech API by ID */
  sourceItemId?: string;
  /** Results of behavioral / automated testing against Alpha API */
  behavioralTests?: TestResult[];
}

// ---------------------------------------------------------------------------
// API request/response types
// ---------------------------------------------------------------------------

export interface ReviewRequest {
  xml?: string;       // raw XML content
  xmlUrl?: string;    // URL to fetch XML from (server-side)
  itemId?: string;    // alpha-1edtech assessment item ID
  fileName?: string;
  model?: string;
  batchId?: string;   // if set, result is saved to DB under this batch
}

// ---------------------------------------------------------------------------
// History types
// ---------------------------------------------------------------------------

export interface Batch {
  id: string;
  name: string;
  total: number;
  succeeded: number;
  failed: number;
  avg_score: number;
  critical: number;
  created_at: string;
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
