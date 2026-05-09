/**
 * Service Account 認証で Google API access_token を取得する。
 * Cloudflare Workers の Web Crypto API で JWT (RS256) 署名 → OAuth トークン交換。
 *
 * 使い方:
 *   const token = await getServiceAccountAccessToken(saKeyJson, ['https://www.googleapis.com/auth/calendar.events']);
 */

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

interface CachedToken {
  accessToken: string;
  expiresAt: number; // epoch ms
}

// プロセス内キャッシュ（Worker isolate 単位）
const tokenCache = new Map<string, CachedToken>();

function base64UrlEncode(input: string | Uint8Array): string {
  let str: string;
  if (typeof input === 'string') {
    str = btoa(unescape(encodeURIComponent(input)));
  } else {
    str = btoa(String.fromCharCode(...input));
  }
  return str.replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const cleaned = pem
    .replace(/-----BEGIN [A-Z ]+-----/, '')
    .replace(/-----END [A-Z ]+-----/, '')
    .replace(/\s/g, '');
  const binary = atob(cleaned);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function signJwt(saKey: ServiceAccountKey, scopes: string[]): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const tokenUri = saKey.token_uri || 'https://oauth2.googleapis.com/token';

  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: saKey.client_email,
    scope: scopes.join(' '),
    aud: tokenUri,
    iat: now,
    exp: now + 3600,
  };

  const headerB64 = base64UrlEncode(JSON.stringify(header));
  const claimsB64 = base64UrlEncode(JSON.stringify(claims));
  const signingInput = `${headerB64}.${claimsB64}`;

  const keyBuf = pemToArrayBuffer(saKey.private_key);
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    keyBuf,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sigBuf = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    new TextEncoder().encode(signingInput),
  );
  const sigB64 = base64UrlEncode(new Uint8Array(sigBuf));
  return `${signingInput}.${sigB64}`;
}

export async function getServiceAccountAccessToken(
  saKeyJson: string,
  scopes: string[],
): Promise<string> {
  let saKey: ServiceAccountKey;
  try {
    saKey = JSON.parse(saKeyJson);
  } catch {
    throw new Error('GCAL_SA_KEY_JSON: invalid JSON');
  }
  if (!saKey.client_email || !saKey.private_key) {
    throw new Error('GCAL_SA_KEY_JSON: missing client_email or private_key');
  }

  const cacheKey = `${saKey.client_email}::${scopes.sort().join(',')}`;
  const cached = tokenCache.get(cacheKey);
  // 期限の60秒前まで使い回す
  if (cached && cached.expiresAt - 60_000 > Date.now()) {
    return cached.accessToken;
  }

  const jwt = await signJwt(saKey, scopes);
  const tokenUri = saKey.token_uri || 'https://oauth2.googleapis.com/token';
  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: jwt,
  });
  const res = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Google OAuth token exchange failed ${res.status}: ${text}`);
  }
  const json = (await res.json()) as { access_token?: string; expires_in?: number; error?: string };
  if (!json.access_token) {
    throw new Error(`Google OAuth response missing access_token: ${JSON.stringify(json)}`);
  }

  const expiresAt = Date.now() + (json.expires_in ?? 3600) * 1000;
  tokenCache.set(cacheKey, { accessToken: json.access_token, expiresAt });
  return json.access_token;
}
