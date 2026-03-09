import { NextRequest, NextResponse } from "next/server";

export interface SheetItem {
  name: string;
  xmlUrl?: string;
  itemId?: string;
}

/** Extract sheet ID and optional gid from a Google Sheets URL */
function parseSheetUrl(url: string): { id: string; gid?: string } | null {
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (!match) return null;
  const gidMatch = url.match(/[?&#]gid=(\d+)/);
  return { id: match[1], gid: gidMatch?.[1] };
}

/** Minimal CSV parser — handles double-quoted fields with embedded commas */
function parseCsv(text: string): string[][] {
  return text.trim().split(/\r?\n/).map((line) => {
    const fields: string[] = [];
    let field = "";
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuote && line[i + 1] === '"') { field += '"'; i++; }
        else inQuote = !inQuote;
      } else if (ch === "," && !inQuote) {
        fields.push(field.trim()); field = "";
      } else {
        field += ch;
      }
    }
    fields.push(field.trim());
    return fields;
  });
}

// POST /api/sheets — { url } → { items: SheetItem[] }
export async function POST(req: NextRequest) {
  const { url } = (await req.json()) as { url: string };
  if (!url) {
    return NextResponse.json({ error: "No URL provided." }, { status: 400 });
  }

  const parsed = parseSheetUrl(url);
  if (!parsed) {
    return NextResponse.json(
      { error: "Could not extract a Google Sheet ID from the URL. Make sure it's a valid Google Sheets link." },
      { status: 400 }
    );
  }

  const csvUrl = `https://docs.google.com/spreadsheets/d/${parsed.id}/export?format=csv${parsed.gid ? `&gid=${parsed.gid}` : ""}`;

  let csvText: string;
  try {
    const res = await fetch(csvUrl);
    if (!res.ok) {
      return NextResponse.json(
        { error: `Could not read sheet (${res.status}). Make sure the sheet is publicly shared (Anyone with the link → Viewer).` },
        { status: 400 }
      );
    }
    csvText = await res.text();
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to fetch sheet: ${err instanceof Error ? err.message : err}` },
      { status: 500 }
    );
  }

  const rows = parseCsv(csvText);
  if (rows.length === 0) {
    return NextResponse.json({ error: "Sheet appears to be empty." }, { status: 400 });
  }

  // Detect format:
  // - Single column: just XML URLs (no header or header == "url"/"xml_url")
  // - Two+ columns: name, url/id — with or without header row
  const firstRow = rows[0].map((c) => c.toLowerCase());
  const hasHeader =
    firstRow.some((c) => ["name", "url", "xml_url", "id", "item_id", "file_name", "filename"].includes(c));

  const dataRows = hasHeader ? rows.slice(1) : rows;
  const nameCol = hasHeader ? firstRow.findIndex((c) => ["name", "file_name", "filename"].includes(c)) : -1;
  const urlCol  = hasHeader ? firstRow.findIndex((c) => ["url", "xml_url"].includes(c)) : 0;
  const idCol   = hasHeader ? firstRow.findIndex((c) => ["id", "item_id"].includes(c)) : -1;

  const items: SheetItem[] = [];
  for (const row of dataRows) {
    const rawName = nameCol >= 0 ? row[nameCol] : "";

    // Prefer item ID column if present
    if (idCol >= 0) {
      const itemId = row[idCol]?.trim();
      if (!itemId) continue;
      const name = rawName || itemId;
      items.push({ name, itemId });
      continue;
    }

    const xmlUrl = urlCol >= 0 ? row[urlCol] : row[0];
    if (!xmlUrl || !xmlUrl.startsWith("http")) continue;
    const name = rawName || xmlUrl.split("/").pop() || xmlUrl;
    items.push({ name, xmlUrl });
  }

  if (items.length === 0) {
    return NextResponse.json(
      { error: "No valid items found. Each row must have a URL starting with http (url/xml_url column) or an item ID (id/item_id column)." },
      { status: 400 }
    );
  }

  return NextResponse.json({ items });
}
