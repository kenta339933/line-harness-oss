import { Hono } from 'hono';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { requireRole } from '../middleware/role-guard.js';
import type { Env } from '../index.js';

const payslips = new Hono<Env>();

// 発行・失効は owner 限定（経理機密）— ワイルドカード方式で確実にミドルウェア適用
payslips.use('/api/casts/*', async (c, next) => {
  const path = new URL(c.req.url).pathname;
  if (path.includes('/payslips')) {
    return requireRole('owner')(c, next);
  }
  return next();
});

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
  const jpFont = await pdfDoc.embedFont(fontBytes);
  // ASCII専用にHelveticaを併用（NotoSansJPサブセットの英数字グリフが小サイズで字間ガタつくため）
  const asciiFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const asciiBoldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const page = pdfDoc.addPage([595.28, 841.89]); // A4
  const { width, height } = page.getSize();
  const margin = 48;

  // カラーパレット
  const PRIMARY = rgb(0.04, 0.55, 0.34);
  const PRIMARY_DARK = rgb(0.02, 0.4, 0.25);
  const TEXT = rgb(0.13, 0.15, 0.18);
  const MUTED = rgb(0.45, 0.48, 0.52);
  const FAINT = rgb(0.72, 0.74, 0.76);
  const BORDER = rgb(0.88, 0.89, 0.90);
  const CARD_BG = rgb(0.96, 0.97, 0.96);
  const ZEBRA = rgb(0.97, 0.99, 0.97);
  const WHITE = rgb(1, 1, 1);

  // ASCII (英数字記号のみ) かどうかでフォントを切り替えて描画ガタつきを回避
  const isAscii = (s: string): boolean => /^[\x20-\x7E]*$/.test(s);
  const drawText = (text: string, x: number, yPos: number, opts: {
    size?: number;
    color?: ReturnType<typeof rgb>;
    bold?: boolean;
  } = {}) => {
    const size = opts.size ?? 10;
    const color = opts.color ?? TEXT;
    const font = isAscii(text)
      ? (opts.bold ? asciiBoldFont : asciiFont)
      : jpFont;
    page.drawText(text, { x, y: yPos, size, font, color });
  };
  const widthOf = (text: string, size: number, bold = false): number => {
    const font = isAscii(text) ? (bold ? asciiBoldFont : asciiFont) : jpFont;
    return font.widthOfTextAtSize(text, size);
  };
  const drawRightText = (text: string, rightX: number, yPos: number, opts: {
    size?: number;
    color?: ReturnType<typeof rgb>;
    bold?: boolean;
  } = {}) => {
    const size = opts.size ?? 10;
    const w = widthOf(text, size, opts.bold);
    drawText(text, rightX - w, yPos, opts);
  };
  const drawRect = (x: number, yPos: number, w: number, h: number, color: ReturnType<typeof rgb>) => {
    page.drawRectangle({ x, y: yPos, width: w, height: h, color });
  };
  const drawLine = (x1: number, y1: number, x2: number, y2: number, thickness = 0.5, color = BORDER) => {
    page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness, color });
  };

  // === ヘッダー（緑色帯） ===
  const headerH = 76;
  drawRect(0, height - headerH, width, headerH, PRIMARY);
  drawText('キャスト報酬明細書', margin, height - 38, { size: 22, color: WHITE });
  drawText('Cast Payment Statement', margin, height - 58, { size: 9, color: rgb(0.85, 0.95, 0.88) });

  let y = height - headerH - 20;

  // メタ情報（対象月・発行日・事務所）
  const issuedAt = new Date().toLocaleDateString('ja-JP', {
    year: 'numeric', month: 'long', day: 'numeric',
  });
  drawText('対象月', margin, y, { size: 8, color: MUTED });
  drawText(month, margin + 36, y, { size: 10, color: TEXT, bold: true });
  drawText('発行日', margin + 130, y, { size: 8, color: MUTED });
  drawText(issuedAt, margin + 166, y, { size: 10, color: TEXT });
  drawText('事務所', margin + 290, y, { size: 8, color: MUTED });
  drawText('チャトナビ', margin + 326, y, { size: 10, color: TEXT });
  y -= 26;

  // === キャスト情報 ===
  const sectionTitle = (title: string, yPos: number): number => {
    drawText(title, margin, yPos, { size: 11, color: PRIMARY_DARK });
    drawLine(margin, yPos - 6, width - margin, yPos - 6, 0.6, PRIMARY);
    return yPos - 18;
  };

  y = sectionTitle('キャスト情報', y);

  const labelX = margin + 4;
  const valueX = margin + 90;
  const drawKV = (label: string, value: string, yPos: number, valueOpts: {
    size?: number;
    color?: ReturnType<typeof rgb>;
    bold?: boolean;
  } = {}): number => {
    drawText(label, labelX, yPos, { size: 9, color: MUTED });
    drawText(value, valueX, yPos, { size: 11, ...valueOpts });
    return yPos - 16;
  };

  y = drawKV('キャスト名', cast.stripchat_username, y, { bold: true });
  y = drawKV('還元率', `${cast.rate_percent}%`, y);
  y -= 10;

  // === 報酬サマリー（カード型） ===
  y = sectionTitle('報酬サマリー', y);

  const totalTokens = daily.reduce((s, d) => s + d.tokens, 0);
  const workingDays = daily.filter((d) => d.tokens > 0).length;
  const castPay = Math.round((totalTokens * cast.rate_percent) / 100);
  const castPayJpy = castPay * JPY_PER_TOKEN;

  const cardH = 120;
  const cardX = margin;
  const cardW = width - margin * 2;
  drawRect(cardX, y - cardH + 4, cardW, cardH, CARD_BG);

  let cy = y - 16;
  const cLabelX = cardX + 18;
  const cValueRight = cardX + cardW - 18;

  drawText('獲得チケット総数', cLabelX, cy, { size: 10, color: MUTED });
  drawRightText(`${totalTokens.toLocaleString('ja-JP')} tk`, cValueRight, cy, { size: 11, color: TEXT });
  cy -= 16;
  drawText('稼働日数', cLabelX, cy, { size: 10, color: MUTED });
  drawRightText(`${workingDays} 日`, cValueRight, cy, { size: 11, color: TEXT });
  cy -= 16;
  drawText('還元率', cLabelX, cy, { size: 10, color: MUTED });
  drawRightText(`${cast.rate_percent}%`, cValueRight, cy, { size: 11, color: TEXT });
  cy -= 8;
  drawLine(cLabelX, cy, cValueRight, cy, 0.4, BORDER);
  cy -= 14;
  drawText('キャスト報酬', cLabelX, cy, { size: 11, color: TEXT });
  drawRightText(`${castPay.toLocaleString('ja-JP')} tk`, cValueRight, cy, { size: 12, color: TEXT, bold: true });
  cy -= 20;
  drawText('円換算', cLabelX, cy, { size: 11, color: PRIMARY_DARK });
  drawText(`(1tk = ¥${JPY_PER_TOKEN})`, cLabelX + widthOf('円換算', 11) + 6, cy, { size: 8, color: MUTED });
  drawRightText(`¥${castPayJpy.toLocaleString('ja-JP')}`, cValueRight, cy, { size: 17, color: PRIMARY_DARK, bold: true });

  y = y - cardH - 4;

  // 注記
  drawText('※ 円換算は本明細発行時のレートを使用。実際のお支払額は送金時の為替レートにより変動します。', margin, y, { size: 8, color: MUTED });
  y -= 11;
  drawText('※ 振込予定: 月末締め翌月20日払い', margin, y, { size: 8, color: MUTED });
  y -= 20;

  // === 日次獲得チケット明細 ===
  y = sectionTitle('日次獲得チケット明細', y);

  const colDate = margin + 8;
  const colTokensRight = margin + 240;
  const colCumRight = margin + 380;

  drawText('日付', colDate, y, { size: 9, color: MUTED });
  drawRightText('獲得 (tk)', colTokensRight, y, { size: 9, color: MUTED });
  drawRightText('累計 (tk)', colCumRight, y, { size: 9, color: MUTED });
  y -= 4;
  drawLine(margin, y, width - margin, y, 0.5, BORDER);
  y -= 12;

  const [yStr, mStr] = month.split('-');
  const yearNum = parseInt(yStr, 10);
  const monthNum = parseInt(mStr, 10);
  const lastDay = new Date(yearNum, monthNum, 0).getDate();
  const dailyMap = new Map(daily.map((d) => [d.date, d.tokens]));
  let cumulative = 0;

  const rowHeight = 11;
  for (let d = 1; d <= lastDay; d++) {
    const dateStr = `${month}-${String(d).padStart(2, '0')}`;
    const tokens = dailyMap.get(dateStr) ?? 0;
    cumulative += tokens;
    const isWorking = tokens > 0;

    if (isWorking) {
      drawRect(margin, y - 3, width - margin * 2, rowHeight, ZEBRA);
    }

    const dateColor = isWorking ? TEXT : MUTED;
    const valueColor = isWorking ? TEXT : FAINT;

    drawText(dateStr.slice(5), colDate, y, { size: 9, color: dateColor });
    drawRightText(tokens.toLocaleString('ja-JP'), colTokensRight, y, { size: 9, color: valueColor, bold: isWorking });
    drawRightText(cumulative.toLocaleString('ja-JP'), colCumRight, y, { size: 9, color: valueColor });
    y -= rowHeight;
  }

  y -= 2;
  drawLine(margin, y, width - margin, y, 0.6, PRIMARY);
  y -= 14;
  drawText('合計', colDate, y, { size: 10, color: TEXT });
  drawRightText(`${totalTokens.toLocaleString('ja-JP')} tk`, colTokensRight, y, { size: 11, color: PRIMARY_DARK, bold: true });

  // === フッター ===
  const footerY = 36;
  drawLine(margin, footerY + 22, width - margin, footerY + 22, 0.5, BORDER);
  drawText('チャトナビ運営事務局', margin, footerY + 8, { size: 9, color: MUTED });
  drawText(`発行ID: ${cast.id}/${month}`, margin, footerY - 6, { size: 8, color: FAINT });

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

  // ?dl=1 で強制ダウンロード、デフォルトはブラウザ内閲覧
  const isDownload = c.req.query('dl') === '1';
  const disposition = isDownload ? 'attachment' : 'inline';
  return new Response(obj.body, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${disposition}; filename="payslip-${row.month}.pdf"`,
      'Cache-Control': 'private, no-cache',
    },
  });
});

export { payslips };
