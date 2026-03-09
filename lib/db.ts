/**
 * Database layer — MongoDB
 * Uses MONGODB_URI env var. All operations are no-ops if not configured,
 * so the app works without a DB.
 */

import { MongoClient, type Db } from "mongodb";
import bcrypt from "bcryptjs";
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

export interface JobDoc {
  _id: string;
  batch_id: string;
  status: "pending" | "running" | "completed" | "failed";
  progress: {
    current: number;
    total: number;
    currentFileName: string;
  };
  error?: string;
  created_at: Date;
  updated_at: Date;
}

export async function createJob(jobId: string, batchId: string, total: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  try {
    await db.collection<JobDoc>("jobs").insertOne({
      _id: jobId,
      batch_id: batchId,
      status: "pending",
      progress: {
        current: 0,
        total,
        currentFileName: "",
      },
      created_at: new Date(),
      updated_at: new Date(),
    });
    return true;
  } catch {
    return false;
  }
}

export async function updateJobProgress(
  jobId: string,
  progress: JobDoc["progress"],
  status: JobDoc["status"] = "running",
  error?: string
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  try {
    await db.collection<JobDoc>("jobs").updateOne(
      { _id: jobId },
      {
        $set: {
          progress,
          status,
          error,
          updated_at: new Date(),
        },
      }
    );
  } catch { /* best-effort */ }
}

export async function getJob(jobId: string): Promise<JobDoc | null> {
  const db = await getDb();
  if (!db) return null;
  try {
    return await db.collection<JobDoc>("jobs").findOne({ _id: jobId });
  } catch {
    return null;
  }
}

export async function listActiveJobs(): Promise<JobDoc[]> {
  const db = await getDb();
  if (!db) return [];
  try {
    return await db
      .collection<JobDoc>("jobs")
      .find({ status: { $in: ["pending", "running"] } })
      .sort({ created_at: -1 })
      .toArray();
  } catch {
    return [];
  }
}

export async function updateJobStatus(jobId: string, status: JobDoc["status"]): Promise<void> {
  const db = await getDb();
  if (!db) return;
  try {
    await db.collection<JobDoc>("jobs").updateOne(
      { _id: jobId },
      { $set: { status, updated_at: new Date() } }
    );
  } catch { /* best-effort */ }
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

// ---------------------------------------------------------------------------
// Users collection
// ---------------------------------------------------------------------------

export interface UserDoc {
  _id: string;           // UUID
  username: string;      // unique login name
  password: string;      // bcrypt hash
  role: "admin" | "user";
  created_at: Date;
  created_by: string | null;   // admin user id who created this account
}

export async function findUserByUsername(username: string): Promise<UserDoc | null> {
  const db = await getDb();
  if (!db) return null;
  try {
    return await db.collection<UserDoc>("users").findOne({ username });
  } catch {
    return null;
  }
}

export async function createUser(user: Omit<UserDoc, "created_at">): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  try {
    await db.collection<UserDoc>("users").insertOne({
      ...user,
      created_at: new Date(),
    });
    return true;
  } catch {
    return false;
  }
}

export async function listUsers(): Promise<Omit<UserDoc, "password">[]> {
  const db = await getDb();
  if (!db) return [];
  try {
    const docs = await db
      .collection<UserDoc>("users")
      .find({}, { projection: { password: 0 } })
      .sort({ created_at: 1 })
      .toArray();
    return docs as Omit<UserDoc, "password">[];
  } catch {
    return [];
  }
}

export async function deleteUser(id: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  try {
    const res = await db.collection<UserDoc>("users").deleteOne({ _id: id });
    return res.deletedCount > 0;
  } catch {
    return false;
  }
}

export async function userCount(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  try {
    return await db.collection<UserDoc>("users").countDocuments();
  } catch {
    return 0;
  }
}

export async function updateUserPassword(id: string, hash: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  try {
    const res = await db
      .collection<UserDoc>("users")
      .updateOne({ _id: id }, { $set: { password: hash } });
    return res.modifiedCount > 0;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Settings collection (single global document)
// ---------------------------------------------------------------------------

export interface SettingsDoc {
  _id: "global";
  active_model: string;
  updated_at: Date;
  updated_by: string;   // admin user id
}

const DEFAULT_MODEL = process.env.DEFAULT_MODEL ?? "gemini-2.0-flash";

export async function getSettings(): Promise<SettingsDoc> {
  const db = await getDb();
  if (!db) {
    return { _id: "global", active_model: DEFAULT_MODEL, updated_at: new Date(), updated_by: "" };
  }
  try {
    const doc = await db.collection<SettingsDoc>("settings").findOne({ _id: "global" });
    return doc ?? { _id: "global", active_model: DEFAULT_MODEL, updated_at: new Date(), updated_by: "" };
  } catch {
    return { _id: "global", active_model: DEFAULT_MODEL, updated_at: new Date(), updated_by: "" };
  }
}

export async function updateSettings(
  model: string,
  adminId: string
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  try {
    await db.collection<SettingsDoc>("settings").updateOne(
      { _id: "global" },
      { $set: { active_model: model, updated_at: new Date(), updated_by: adminId } },
      { upsert: true }
    );
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Bootstrap — seed default admin on first run
// ---------------------------------------------------------------------------

/** Called at startup by auth routes. Creates the admin account from env vars
 *  if no users exist yet. Safe to call multiple times.
 *  Also updates the admin password if the env var changed since last seed. */
export async function ensureDefaultAdmin(): Promise<void> {
  const db = await getDb();
  if (!db) {
    console.error("[ensureDefaultAdmin] No DB connection — MONGODB_URI may be missing or unreachable");
    return;
  }

  const username = (process.env.ADMIN_USERNAME ?? "admin").toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? "changeme";

  const existing = await findUserByUsername(username);
  if (!existing) {
    console.log(`[ensureDefaultAdmin] Creating admin user: ${username}`);
    const hash = await bcrypt.hash(password, 10);
    await createUser({
      _id: crypto.randomUUID(),
      username,
      password: hash,
      role: "admin",
      created_by: null,
    });
    return;
  }

  // If the env-var password no longer matches the stored hash, resync it.
  const passwordMatches = await bcrypt.compare(password, existing.password);
  if (!passwordMatches) {
    console.log(`[ensureDefaultAdmin] Admin password env var changed — updating hash for: ${username}`);
    const hash = await bcrypt.hash(password, 10);
    await updateUserPassword(existing._id, hash);
  }
}
