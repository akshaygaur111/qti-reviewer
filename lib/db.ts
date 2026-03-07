/**
 * Database layer — MongoDB
 * Uses MONGODB_URI env var. All operations are no-ops if not configured,
 * so the app works without a DB.
 */

import { MongoClient, type Db } from "mongodb";
import type { ReviewResult, BulkReviewResponse } from "./types";

// ---------------------------------------------------------------------------
// Connection — cached across hot reloads in dev, shared across invocations
// ---------------------------------------------------------------------------

declare global {
  // eslint-disable-next-line no-var
  var _mongoClientPromise: Promise<MongoClient> | undefined;
}

let client: MongoClient | null = null;
let clientPromise: Promise<MongoClient> | null = null;

function getClientPromise(): Promise<MongoClient> | null {
  const uri = process.env.MONGODB_URI;
  if (!uri) return null;

  // In development, reuse across HMR reloads
  if (process.env.NODE_ENV === "development") {
    if (!global._mongoClientPromise) {
      client = new MongoClient(uri);
      global._mongoClientPromise = client.connect();
    }
    return global._mongoClientPromise;
  }

  if (!clientPromise) {
    client = new MongoClient(uri);
    clientPromise = client.connect();
  }
  return clientPromise;
}

async function getDb(): Promise<Db | null> {
  const promise = getClientPromise();
  if (!promise) return null;
  try {
    const c = await promise;
    return c.db(); // uses the database name from the URI
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Batch operations
// ---------------------------------------------------------------------------

export interface BatchDoc {
  _id: string;
  name: string;
  total: number;
  succeeded: number;
  failed: number;
  avg_score: number;
  critical: number;
  created_at: Date;
}

export async function createBatch(id: string, name: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  try {
    await db.collection<BatchDoc>("batches").insertOne({
      _id: id,
      name,
      total: 0,
      succeeded: 0,
      failed: 0,
      avg_score: 0,
      critical: 0,
      created_at: new Date(),
    });
    return true;
  } catch {
    return false;
  }
}

export async function updateBatchSummary(
  batchId: string,
  summary: BulkReviewResponse["summary"]
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  try {
    await db.collection<BatchDoc>("batches").updateOne(
      { _id: batchId },
      {
        $set: {
          total: summary.total,
          succeeded: summary.succeeded,
          failed: summary.failed,
          avg_score: summary.averageScore,
          critical: summary.criticalIssueCount,
        },
      }
    );
  } catch { /* best-effort */ }
}

export async function listBatches(): Promise<BatchDoc[]> {
  const db = await getDb();
  if (!db) return [];
  try {
    return await db
      .collection<BatchDoc>("batches")
      .find({})
      .sort({ created_at: -1 })
      .limit(100)
      .toArray();
  } catch {
    return [];
  }
}

export async function getBatch(batchId: string): Promise<BatchDoc | null> {
  const db = await getDb();
  if (!db) return null;
  try {
    return await db.collection<BatchDoc>("batches").findOne({ _id: batchId });
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Result operations
// ---------------------------------------------------------------------------

export interface ResultDoc extends ReviewResult {
  _id: string;
  batch_id: string;
  created_at: Date;
}

export async function saveResult(
  batchId: string,
  result: ReviewResult
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  try {
    await db.collection<ResultDoc>("results").insertOne({
      ...result,
      _id: crypto.randomUUID(),
      batch_id: batchId,
      created_at: new Date(),
    });
  } catch { /* best-effort */ }
}

export async function getBatchResults(batchId: string): Promise<ReviewResult[]> {
  const db = await getDb();
  if (!db) return [];
  try {
    const docs = await db
      .collection<ResultDoc>("results")
      .find({ batch_id: batchId })
      .sort({ created_at: 1 })
      .toArray();
    return docs.map(({ _id: _id, batch_id: _bid, created_at: _cat, ...rest }) => rest);
  } catch {
    return [];
  }
}

export const dbAvailable = () => Boolean(process.env.MONGODB_URI);
