import { Hono } from 'hono';
import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { requireRole } from '../middleware/role-guard.js';
import type { Env } from '../index.js';

const payslips = new Hono<Env>();

// 発行・失効は owner 限定（経理機密）
payslips.use('/api/casts/:id/payslips', requireRole('owner'));
payslips.use('/api/casts/:id/payslips/*', requireRole('owner'));

const URL_VALID_DAYS = 60;
const RETENTION_YEARS = 3;
const JPY_PER_TOKEN = 8;

// Module-level font cache (per Worker instance)
let cachedFontBytes: ArrayBuffer | null = null;

async function loadJapaneseFont(): Promise<ArrayBuffer> {
  if (cachedFontBytes) return cachedFontBytes;
  // Noto Sans JP Regular (TTF, ~1.5MB) from Google Fonts repo via jsdelivr
  const url = 'https://cdn.jsdelivr.net/gh/notofonts/noto-cjk@main/Sans/SubsetOTF/JP/NotoSansJP-Regular.otf';
  const response = await fetch(url);
  if (!response.ok) throw new Error(`font fetch failed: ${response.status}`);
  cachedFontBytes = await response.arrayBuffer();
  return cachedFontBytes;
}

function generateToken(): string {
  // 32バイト = 256bit ランダム → hex 64文字
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

interface CastRow {
  id: string;
  stripchat_username: string;
  display_name: string | null;
  channel: string;
  contract_version: string;
  stage: string;
  rate_percent: number;
  status: string;
  joined_at: string | null;
}

interface DailyRow {
  date: string;
  tokens: number;
}

async function buildPayslipPdf(
  cast: CastRow,
  month: string,
  daily: DailyRow[]
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);
  const fontBytes = await loadJapaneseFont();
  const font = await pdfDoc.embedFont(fontBytes);

  const page = pdfDoc.addPage([595.28, 841.89]); // A4
  const { width, height } = page.getSize();
  const margin = 50;

  let y = height - margin;

  const drawText = (text: string, x: number, yPos: number, size = 10, color = rgb(0, 0, 0)) => {
    page.drawText(text, { x, y: yPos, size, font, color });
  };
  const drawLine = (x1: number, y1: number, x2: number, y2: number, thickness = 0.5, color = rgb(0.7, 0.7, 0.7)) => {
    page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness, color });
  };

  // ヘッダー
  drawText('キャスト報酬明細書', margin, y, 20);
  y -= 22;
  drawText('Cast Payment Statement', margin, y, 9, rgb(0.5, 0.5, 0.5));
  y -= 24;

  const issuedAt = new Date().toLocaleDateString('ja-JP', {
    year: 'numeric', month: 'long', day: 'numeric',
  });
  drawText(`対象月: ${month}      発行日: ${issuedAt}      事務所: チャトナビ`, margin, y, 10);
  y -= 14;
  drawLine(margin, y, width - margin, y, 1, rgb(0.2, 0.2, 0.2));
  y -= 24;

  // キャスト情報
  drawText('【キャスト情報】', margin, y, 12, rgb(0, 0.4, 0));
  y -= 18;
  drawText(`キャスト名: ${cast.stripchat_username}`, margin + 10, y, 11);
  y -= 16;
  drawText(`契約: ${cast.contract_version} / ${cast.stage}`, margin + 10, y, 11);
  y -= 16;
  drawText(`還元率: ${cast.rate_percent}%`, margin + 10, y, 11);
  y -= 16;
  drawText(`入店日: ${cast.joined_at ?? '-'}`, margin + 10, y, 11);
  y -= 24;

  // サマリー計算
  const totalTokens = daily.reduce((s, d) => s + d.tokens, 0);
  const workingDays = daily.filter((d) => d.tokens > 0).length;
  const castPay = Math.round((totalTokens * cast.rate_percent) / 100);
  const castPayJpy = castPay * JPY_PER_TOKEN;

  // サマリーセクション
  drawText('【報酬サマリー】', margin, y, 12, rgb(0, 0.4, 0));
  y -= 18;

  const boxX = margin + 10;
  const boxW = width - 2 * margin - 20;
  const boxStartY = y;
  drawText(`獲得チケット総数:  ${totalTokens.toLocaleString('ja-JP')} tk`, boxX, y, 11);
  y -= 16;
  drawText(`稼働日数:          ${workingDays} 日`, boxX, y, 11);
  y -= 16;
  drawText(`還元率:            ${cast.rate_percent}%`, boxX, y, 11);
  y -= 8;
  drawLine(boxX, y, boxX + boxW - 20, y, 0.5, rgb(0.7, 0.7, 0.7));
  y -= 8;
  drawText(`キャスト報酬:      ${castPay.toLocaleString('ja-JP')} tk`, boxX, y, 12);
  y -= 18;
  drawText(`円換算 (1tk = ¥${JPY_PER_TOKEN}):  ¥${castPayJpy.toLocaleString('ja-JP')}`, boxX, y, 13, rgb(0, 0.4, 0));
  y -= 24;

  // 注記
  drawText('※ 円換算は本明細発行時のレートを使用しています。', boxX, y, 9, rgb(0.4, 0.4, 0.4));
  y -= 11;
  drawText('※ 実際のお支払額は送金時の為替レートによって変動します。', boxX, y, 9, rgb(0.4, 0.4, 0.4));
  y -= 11;
  drawText('※ 振込予定: 翌月15日頃', boxX, y, 9, rgb(0.4, 0.4, 0.4));
  y -= 22;

  // 日次明細
  drawText('【日次獲得チケット明細】', margin, y, 12, rgb(0, 0.4, 0));
  y -= 18;

  // テーブルヘッダー
  drawText('日付', margin + 20, y, 10);
  drawText('獲得 (tk)', margin + 200, y, 10);
  drawText('累計 (tk)', margin + 320, y, 10);
  y -= 4;
  drawLine(margin + 10, y, width - margin - 10, y, 0.5);
  y -= 14;

  // 月の全日を表示
  const [yStr, mStr] = month.split('-');
  const yearNum = parseInt(yStr, 10);
  const monthNum = parseInt(mStr, 10);
  const lastDay = new Date(yearNum, monthNum, 0).getDate();
  const dailyMap = new Map(daily.map((d) => [d.date, d.tokens]));
  let cumulative = 0;

  // 31行収まるよう行間調整
  const rowHeight = 11;
  for (let d = 1; d <= lastDay; d++) {
    const dateStr = `${month}-${String(d).padStart(2, '0')}`;
    const tokens = dailyMap.get(dateStr) ?? 0;
    cumulative += tokens;
    const isWeekend = ((d - 1) % 7 === 5 || (d - 1) % 7 === 6); // 簡易判定（曜日計算は省略）

    drawText(dateStr.slice(5), margin + 20, y, 9);
    drawText(tokens > 0 ? tokens.toLocaleString('ja-JP') : '0', margin + 200, y, 9);
    drawText(cumulative.toLocaleString('ja-JP'), margin + 320, y, 9);
    y -= rowHeight;
  }
  y -= 4;
  drawLine(margin + 10, y, width - margin - 10, y, 0.5);
  y -= 14;
  drawText(`合計    ${totalTokens.toLocaleString('ja-JP')} tk`, margin + 20, y, 10);

  // フッター
  const footerY = 50;
  drawLine(margin, footerY + 30, width - margin, footerY + 30, 0.5, rgb(0.7, 0.7, 0.7));
  drawText('チャトナビ運営事務局', margin, footerY + 15, 9, rgb(0.4, 0.4, 0.4));
  drawText(`Token: ${cast.id}/${month}`, margin, footerY, 7, rgb(0.7, 0.7, 0.7));

  return await pdfDoc.save();
}

// POST /api/casts/:id/payslips?month=YYYY-MM  — 明細PDFを生成しR2に保存、URLを返す
payslips.post('/api/casts/:id/payslips', async (c) => {
  try {
    const castId = c.req.param('id');
    const month = c.req.query('month');
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return c.json({ success: false, error: 'month (YYYY-MM) required' }, 400);
    }

    const cast = await c.env.DB.prepare('SELECT * FROM casts WHERE id = ?')
      .bind(castId)
      .first<CastRow>();
    if (!cast) return c.json({ success: false, error: 'cast not found' }, 404);

    // 日次データ取得
    const [yStr, mStr] = month.split('-');
    const yearNum = parseInt(yStr, 10);
    const monthNum = parseInt(mStr, 10);
    const lastDay = new Date(yearNum, monthNum, 0).getDate();
    const dailyResult = await c.env.DB.prepare(
      `SELECT date, tokens FROM cast_daily_earnings
       WHERE cast_id = ? AND date BETWEEN ? AND ?
       ORDER BY date ASC`
    )
      .bind(castId, `${month}-01`, `${month}-${String(lastDay).padStart(2, '0')}`)
      .all<DailyRow>();
    const daily = dailyResult.results || [];

    // PDF生成
    const pdfBytes = await buildPayslipPdf(cast, month, daily);

    // 既存の有効トークンをrevoke
    const nowSec = Math.floor(Date.now() / 1000);
    await c.env.DB.prepare(
      `UPDATE payslip_tokens SET revoked_at = ? WHERE cast_id = ? AND month = ? AND revoked_at IS NULL`
    )
      .bind(nowSec, castId, month)
      .run();

    // 新トークン生成 & R2 保存
    const token = generateToken();
    const r2Key = `payslips/${castId}/${month}/${token}.pdf`;
    await c.env.PAYSLIPS.put(r2Key, pdfBytes, {
      httpMetadata: { contentType: 'application/pdf' },
    });

    const expiresAt = nowSec + URL_VALID_DAYS * 86400;
    const retentionUntil = nowSec + RETENTION_YEARS * 365 * 86400;
    await c.env.DB.prepare(
      `INSERT INTO payslip_tokens (token, cast_id, month, r2_key, expires_at, retention_until, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(token, castId, month, r2Key, expiresAt, retentionUntil, nowSec)
      .run();

    const origin = new URL(c.req.url).origin;
    const url = `${origin}/p/${token}`;

    return c.json({
      success: true,
      data: {
        url,
        token,
        expiresAt,
        retentionUntil,
        urlValidDays: URL_VALID_DAYS,
      },
    });
  } catch (err) {
    console.error('POST /api/casts/:id/payslips error:', err);
    return c.json({ success: false, error: err instanceof Error ? err.message : 'failed' }, 500);
  }
});

// GET /api/casts/:id/payslips?month=YYYY-MM  — そのキャスト・月の発行履歴
payslips.get('/api/casts/:id/payslips', async (c) => {
  const castId = c.req.param('id');
  const month = c.req.query('month');
  let query = `SELECT token, month, expires_at, retention_until, created_at, revoked_at, download_count, last_accessed_at
               FROM payslip_tokens WHERE cast_id = ?`;
  const params: unknown[] = [castId];
  if (month) {
    query += ` AND month = ?`;
    params.push(month);
  }
  query += ` ORDER BY created_at DESC LIMIT 50`;
  const rows = await c.env.DB.prepare(query).bind(...params).all();
  return c.json({ success: true, data: rows.results });
});

// GET /p/:token  — 公開エンドポイント（認証なし、トークン照合のみ）
payslips.get('/p/:token', async (c) => {
  const token = c.req.param('token');
  const nowSec = Math.floor(Date.now() / 1000);

  const row = await c.env.DB.prepare(
    `SELECT token, cast_id, month, r2_key, expires_at, revoked_at FROM payslip_tokens WHERE token = ?`
  )
    .bind(token)
    .first<{
      token: string;
      cast_id: string;
      month: string;
      r2_key: string;
      expires_at: number;
      revoked_at: number | null;
    }>();

  if (!row) {
    return c.html(`<!DOCTYPE html>
<html lang="ja"><head><meta charset="utf-8"><title>明細書</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font-family:system-ui;padding:40px;text-align:center;color:#374151}</style></head>
<body><h1 style="color:#dc2626">リンクが無効です</h1><p>このURLは存在しないか、すでに失効しています。</p></body></html>`, 404);
  }

  if (row.revoked_at !== null) {
    return c.html(`<!DOCTYPE html>
<html lang="ja"><head><meta charset="utf-8"><title>明細書</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font-family:system-ui;padding:40px;text-align:center;color:#374151}</style></head>
<body><h1 style="color:#dc2626">このリンクは無効化されています</h1><p>新しいURLが発行されています。事務局にお問い合わせください。</p></body></html>`, 410);
  }

  if (row.expires_at < nowSec) {
    return c.html(`<!DOCTYPE html>
<html lang="ja"><head><meta charset="utf-8"><title>明細書</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font-family:system-ui;padding:40px;text-align:center;color:#374151}</style></head>
<body><h1 style="color:#dc2626">URLの有効期限が切れています</h1><p>事務局にお問い合わせください。</p></body></html>`, 410);
  }

  const obj = await c.env.PAYSLIPS.get(row.r2_key);
  if (!obj) return c.text('PDF not found', 404);

  // ダウンロードログ更新（非同期）
  c.executionCtx.waitUntil(
    c.env.DB.prepare(
      `UPDATE payslip_tokens SET download_count = download_count + 1, last_accessed_at = ? WHERE token = ?`
    )
      .bind(nowSec, token)
      .run()
  );

  return new Response(obj.body, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="payslip-${row.month}.pdf"`,
      'Cache-Control': 'private, no-cache',
    },
  });
});

export { payslips };
