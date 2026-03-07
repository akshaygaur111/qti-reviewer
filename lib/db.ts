/**
 * Database layer — Neon (serverless Postgres)
 * All writes/reads are no-ops if DATABASE_URL is not configured,
 * so the app works without a DB (results just aren't persisted).
 */

import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import type { ReviewResult, BulkReviewResponse } from "./types";

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

let _sql: NeonQueryFunction<false, false> | null = null;

function getSql(): NeonQueryFunction<false, false> | null {
  if (!process.env.DATABASE_URL) return null;
  if (!_sql) _sql = neon(process.env.DATABASE_URL);
  return _sql;
}

// ---------------------------------------------------------------------------
// Schema initialisation (idempotent)
// ---------------------------------------------------------------------------

let _schemaReady = false;

async function ensureSchema() {
  const sql = getSql();
  if (!sql || _schemaReady) return;
  await sql`
    CREATE TABLE IF NOT EXISTS batches (
      id          TEXT PRIMARY KEY,
      name        TEXT,
      total       INTEGER DEFAULT 0,
      succeeded   INTEGER DEFAULT 0,
      failed      INTEGER DEFAULT 0,
      avg_score   NUMERIC(4,2) DEFAULT 0,
      critical    INTEGER DEFAULT 0,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS results (
      id               TEXT PRIMARY KEY,
      batch_id         TEXT REFERENCES batches(id) ON DELETE CASCADE,
      file_name        TEXT NOT NULL,
      item_identifier  TEXT,
      item_title       TEXT,
      overall_score    INTEGER DEFAULT 0,
      overall_summary  TEXT,
      issues           JSONB DEFAULT '[]',
      model_used       TEXT,
      error            TEXT,
      created_at       TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS results_batch_idx ON results(batch_id)
  `;
  _schemaReady = true;
}

// ---------------------------------------------------------------------------
// Batch operations
// ---------------------------------------------------------------------------

export async function createBatch(id: string, name: string): Promise<boolean> {
  const sql = getSql();
  if (!sql) return false;
  try {
    await ensureSchema();
    await sql`INSERT INTO batches (id, name) VALUES (${id}, ${name})`;
    return true;
  } catch {
    return false;
  }
}

export async function updateBatchSummary(
  batchId: string,
  summary: BulkReviewResponse["summary"]
): Promise<void> {
  const sql = getSql();
  if (!sql) return;
  try {
    await sql`
      UPDATE batches SET
        total     = ${summary.total},
        succeeded = ${summary.succeeded},
        failed    = ${summary.failed},
        avg_score = ${summary.averageScore},
        critical  = ${summary.criticalIssueCount}
      WHERE id = ${batchId}
    `;
  } catch { /* best-effort */ }
}

export async function listBatches() {
  const sql = getSql();
  if (!sql) return [];
  try {
    await ensureSchema();
    return await sql`
      SELECT id, name, total, succeeded, failed, avg_score, critical, created_at
      FROM batches
      ORDER BY created_at DESC
      LIMIT 100
    `;
  } catch {
    return [];
  }
}

export async function getBatch(batchId: string) {
  const sql = getSql();
  if (!sql) return null;
  try {
    const rows = await sql`SELECT * FROM batches WHERE id = ${batchId}`;
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Result operations
// ---------------------------------------------------------------------------

export async function saveResult(
  batchId: string,
  result: ReviewResult
): Promise<void> {
  const sql = getSql();
  if (!sql) return;
  try {
    await ensureSchema();
    const id = crypto.randomUUID();
    await sql`
      INSERT INTO results
        (id, batch_id, file_name, item_identifier, item_title,
         overall_score, overall_summary, issues, model_used, error)
      VALUES
        (${id}, ${batchId}, ${result.fileName}, ${result.itemIdentifier},
         ${result.itemTitle}, ${result.overallScore}, ${result.overallSummary},
         ${JSON.stringify(result.issues)}, ${result.modelUsed},
         ${result.error ?? null})
    `;
  } catch { /* best-effort */ }
}

export async function getBatchResults(batchId: string): Promise<ReviewResult[]> {
  const sql = getSql();
  if (!sql) return [];
  try {
    const rows = await sql`
      SELECT * FROM results WHERE batch_id = ${batchId} ORDER BY created_at ASC
    `;
    return rows.map((r) => ({
      itemIdentifier: r.item_identifier ?? "",
      itemTitle: r.item_title ?? "",
      fileName: r.file_name,
      overallScore: Number(r.overall_score),
      overallSummary: r.overall_summary ?? "",
      issues: Array.isArray(r.issues) ? r.issues : JSON.parse(r.issues ?? "[]"),
      modelUsed: r.model_used ?? "",
      error: r.error ?? undefined,
    }));
  } catch {
    return [];
  }
}

export const dbAvailable = () => Boolean(process.env.DATABASE_URL);
