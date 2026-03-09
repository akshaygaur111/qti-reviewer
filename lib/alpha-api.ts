/**
 * Alpha-1EdTech API integration.
 *
 * Fetches OAuth2 tokens from AWS Cognito using the client_credentials grant
 * with credentials in the Authorization header (Basic auth).
 *
 * Required env vars:
 *   ALPHA1_CLIENT_ID     — Cognito app client ID
 *   ALPHA1_CLIENT_SECRET — Cognito app client secret
 */

const TOKEN_URL =
  "https://prod-beyond-timeback-api-2-idp.auth.us-east-1.amazoncognito.com/oauth2/token";
const BASE_URL = "https://qti.alpha-1edtech.ai";

interface TokenCache {
  token: string;
  expiresAt: number; // ms epoch
}

// Module-level cache — shared across requests in the same serverless instance.
let tokenCache: TokenCache | null = null;

async function getToken(): Promise<string> {
  // Return cached token if it has more than 30 s left
  if (tokenCache && Date.now() < tokenCache.expiresAt - 30_000) {
    return tokenCache.token;
  }

  const clientId = process.env.ALPHA1_CLIENT_ID;
  const clientSecret = process.env.ALPHA1_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "ALPHA1_CLIENT_ID and ALPHA1_CLIENT_SECRET environment variables are required"
    );
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${credentials}`,
    },
    body: "grant_type=client_credentials",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Token request failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return tokenCache.token;
}

/**
 * Fetch a QTI assessment item by ID from the alpha-1edtech API.
 * The API returns raw QTI XML directly.
 */
export async function fetchAlphaItemXml(id: string): Promise<string> {
  const token = await getToken();
  const url = `${BASE_URL}/api/assessment-items/${encodeURIComponent(id)}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch item "${id}" (HTTP ${res.status})`);
  }

  return res.text();
}

export const alphaApiConfigured = () =>
  Boolean(process.env.ALPHA1_CLIENT_ID && process.env.ALPHA1_CLIENT_SECRET);
