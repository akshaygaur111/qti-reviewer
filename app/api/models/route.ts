import { NextResponse } from "next/server";

export interface GeminiModel {
  name: string;          // e.g. "models/gemini-2.5-flash"
  displayName: string;
  description: string;
  supportedGenerationMethods: string[];
}

// Exclude models not useful for text-based QTI review
const EXCLUDE_PATTERNS = [
  "tts", "image", "robotics", "computer-use", "deep-research",
  "gemma", "nano-banana", "embedding", "aqa",
];

function isTextModel(model: GeminiModel): boolean {
  const id = model.name.toLowerCase();
  return EXCLUDE_PATTERNS.every((p) => !id.includes(p));
}

/** Returns a numeric sort key — lower = shown first */
function modelSortKey(name: string): number {
  if (name.includes("gemini-3.1")) return 0;
  if (name.includes("gemini-3-"))   return 1;
  if (name.includes("gemini-2.5-pro")) return 2;
  if (name.includes("gemini-2.5-flash-lite")) return 4;
  if (name.includes("gemini-2.5-flash")) return 3;
  if (name.includes("gemini-2.0-flash-lite")) return 6;
  if (name.includes("gemini-2.0-flash")) return 5;
  if (name.includes("gemini-pro-latest")) return 7;
  if (name.includes("gemini-flash-latest")) return 8;
  if (name.includes("gemini-flash-lite-latest")) return 9;
  return 99;
}

export async function GET() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "GEMINI_API_KEY is not configured on the server." },
      { status: 500 }
    );
  }

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}&pageSize=200`,
      { next: { revalidate: 300 } } // cache 5 min
    );
    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json(
        { error: `Gemini ListModels failed: ${res.status} ${text.slice(0, 200)}` },
        { status: res.status }
      );
    }

    const data = (await res.json()) as { models: GeminiModel[] };
    const models = (data.models ?? [])
      .filter(
        (m) =>
          m.supportedGenerationMethods?.includes("generateContent") &&
          isTextModel(m)
      )
      .sort((a, b) => {
        const diff = modelSortKey(a.name) - modelSortKey(b.name);
        return diff !== 0 ? diff : a.name.localeCompare(b.name);
      });

    return NextResponse.json({ models });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
