import { Hono } from 'hono';
import { requireRole } from '../middleware/role-guard.js';
import type { Env } from '../index.js';

const paidReadings = new Hono<Env>();

const URL_VALID_DAYS = 365;
const RETENTION_YEARS = 5;
const MAX_PDF_BYTES = 10 * 1024 * 1024; // 10MB上限

// 発行・失効は owner 限定（クライアント機密 / 個人情報含む）
paidReadings.use('/api/paid-readings/*', requireRole('owner'));

function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function publicBaseUrl(c: { req: { url: string }; env: { WORKER_URL?: string } }): string {
  if (c.env.WORKER_URL) return c.env.WORKER_URL.replace(/\/$/, '');
  const u = new URL(c.req.url);
  return `${u.protocol}//${u.host}`;
}

// POST /api/paid-readings/upload  — multipart/form-data でPDFアップロード
//   form fields:
//     file               : application/pdf (required)
//     account_id         : string (required)
//     client_username    : string (required)
//     client_real_name   : string (optional)
//     filename           : string (optional, default "鑑定書.pdf")
interface UploadedFile {
  readonly type: string;
  readonly size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

function isUploadedFile(v: unknown): v is UploadedFile {
  return (
    typeof v === 'object' &&
    v !== null &&
    'arrayBuffer' in v &&
    'size' in v &&
    'type' in v
  );
}

paidReadings.post('/api/paid-readings/upload', async (c) => {
  try {
    const form = await c.req.formData();
    const fileRaw = form.get('file');
    const accountId = String(form.get('account_id') ?? '').trim();
    const clientUsername = String(form.get('client_username') ?? '').trim();
    const clientRealName = String(form.get('client_real_name') ?? '').trim() || null;
    const filename = String(form.get('filename') ?? '鑑定書.pdf').trim();

    if (!isUploadedFile(fileRaw)) {
      return c.json({ success: false, error: 'file is required' }, 400);
    }
    const file = fileRaw;
    if (!accountId || !clientUsername) {
      return c.json({ success: false, error: 'account_id and client_username are required' }, 400);
    }
    if (file.type !== 'application/pdf') {
      return c.json({ success: false, error: 'file must be application/pdf' }, 400);
    }
    if (file.size > MAX_PDF_BYTES) {
      return c.json({ success: false, error: `file too large (max ${MAX_PDF_BYTES} bytes)` }, 413);
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const expiresAt = nowSec + URL_VALID_DAYS * 86400;
    const retentionUntil = nowSec + RETENTION_YEARS * 365 * 86400;

    // 同 client への過去の有効URLを revoke
    await c.env.DB.prepare(
      `UPDATE paid_reading_tokens SET revoked_at = ? WHERE account_id = ? AND client_username = ? AND revoked_at IS NULL`,
    )
      .bind(nowSec, accountId, clientUsername)
      .run();

    const token = generateToken();
    const r2Key = `paid-readings/${accountId}/${clientUsername}/${token}.pdf`;

    const buf = await file.arrayBuffer();
    await c.env.PAYSLIPS.put(r2Key, buf, {
      httpMetadata: { contentType: 'application/pdf' },
    });

    await c.env.DB.prepare(
      `INSERT INTO paid_reading_tokens
        (token, account_id, client_username, client_real_name, r2_key, filename,
         expires_at, retention_until, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(token, accountId, clientUsername, clientRealName, r2Key, filename, expiresAt, retentionUntil, nowSec)
      .run();

    const url = `${publicBaseUrl(c)}/k/${token}`;
    return c.json({
      success: true,
      token,
      url,
      expires_at: expiresAt,
      url_valid_days: URL_VALID_DAYS,
    });
  } catch (err) {
    console.error('POST /api/paid-readings/upload error:', err);
    return c.json({ success: false, error: 'upload failed' }, 500);
  }
});

// GET /api/paid-readings  — 発行履歴 (account_id / client_username で絞り込み)
paidReadings.get('/api/paid-readings', async (c) => {
  const accountId = c.req.query('account_id');
  const clientUsername = c.req.query('client_username');

  let sql = `SELECT token, account_id, client_username, client_real_name, filename,
                    expires_at, retention_until, created_at, revoked_at,
                    download_count, last_accessed_at
             FROM paid_reading_tokens WHERE 1=1`;
  const params: (string | number)[] = [];
  if (accountId) {
    sql += ` AND account_id = ?`;
    params.push(accountId);
  }
  if (clientUsername) {
    sql += ` AND client_username = ?`;
    params.push(clientUsername);
  }
  sql += ` ORDER BY created_at DESC LIMIT 200`;

  const result = await c.env.DB.prepare(sql)
    .bind(...params)
    .all();
  return c.json({ success: true, tokens: result.results });
});

// POST /api/paid-readings/:token/revoke  — 個別URL失効
paidReadings.post('/api/paid-readings/:token/revoke', async (c) => {
  const token = c.req.param('token');
  const nowSec = Math.floor(Date.now() / 1000);

  const result = await c.env.DB.prepare(
    `UPDATE paid_reading_tokens SET revoked_at = ? WHERE token = ? AND revoked_at IS NULL`,
  )
    .bind(nowSec, token)
    .run();

  if (!result.meta.changes) {
    return c.json({ success: false, error: 'token not found or already revoked' }, 404);
  }
  return c.json({ success: true });
});

// GET /k/:token  — 公開エンドポイント（auth.ts で `/k/` を認証スキップに追加済み）
paidReadings.get('/k/:token', async (c) => {
  const token = c.req.param('token');
  const nowSec = Math.floor(Date.now() / 1000);

  const row = await c.env.DB.prepare(
    `SELECT token, r2_key, filename, expires_at, revoked_at FROM paid_reading_tokens WHERE token = ?`,
  )
    .bind(token)
    .first<{
      token: string;
      r2_key: string;
      filename: string;
      expires_at: number;
      revoked_at: number | null;
    }>();

  const errorPage = (title: string, message: string, status: 404 | 410) =>
    c.html(
      `<!DOCTYPE html>
<html lang="ja"><head><meta charset="utf-8"><title>${title}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font-family:system-ui;padding:40px;text-align:center;color:#374151}h1{color:#dc2626}</style></head>
<body><h1>${title}</h1><p>${message}</p></body></html>`,
      status,
    );

  if (!row) {
    return errorPage('リンクが無効です', 'このURLは存在しないか、すでに失効しています。', 404);
  }
  if (row.revoked_at !== null) {
    return errorPage('このリンクは無効化されています', '新しいURLが発行されている可能性があります。お問い合わせください。', 410);
  }
  if (row.expires_at < nowSec) {
    return errorPage('URLの有効期限が切れています', 'お手数ですが、再発行をご依頼ください。', 410);
  }

  const obj = await c.env.PAYSLIPS.get(row.r2_key);
  if (!obj) return c.text('PDF not found', 404);

  // ダウンロードログ更新（非同期）
  c.executionCtx.waitUntil(
    c.env.DB.prepare(
      `UPDATE paid_reading_tokens SET download_count = download_count + 1, last_accessed_at = ? WHERE token = ?`,
    )
      .bind(nowSec, token)
      .run(),
  );

  // ?dl=1 で強制ダウンロード、デフォルトはブラウザ内閲覧
  const isDownload = c.req.query('dl') === '1';
  const disposition = isDownload ? 'attachment' : 'inline';
  // RFC 5987: 日本語ファイル名は filename* で UTF-8 指定
  const encodedName = encodeURIComponent(row.filename);
  return new Response(obj.body, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${disposition}; filename="reading.pdf"; filename*=UTF-8''${encodedName}`,
      'Cache-Control': 'private, no-cache',
    },
  });
});

export { paidReadings };
