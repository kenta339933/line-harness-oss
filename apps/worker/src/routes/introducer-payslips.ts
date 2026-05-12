import { Hono } from 'hono';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { requireRole } from '../middleware/role-guard.js';
import type { Env } from '../index.js';

const introducerPayslips = new Hono<Env>();

// 発行・失効は owner 限定（経理機密）
introducerPayslips.use('/api/introducers/*', async (c, next) => {
  const path = new URL(c.req.url).pathname;
  if (path.includes('/payslips')) {
    return requireRole('owner')(c, next);
  }
  return next();
});

const URL_VALID_DAYS = 60;
const RETENTION_YEARS = 3;
const JPY_PER_TOKEN = 8;
const INTRODUCER_RATE = 0.10; // 紹介者報酬率 = キャスト報酬の10%

// Module-level font cache
let cachedFontBytes: ArrayBuffer | null = null;

async function loadJapaneseFont(): Promise<ArrayBuffer> {
  if (cachedFontBytes) return cachedFontBytes;
  const url = 'https://cdn.jsdelivr.net/gh/notofonts/noto-cjk@main/Sans/SubsetOTF/JP/NotoSansJP-Regular.otf';
  const response = await fetch(url);
  if (!response.ok) throw new Error(`font fetch failed: ${response.status}`);
  cachedFontBytes = await response.arrayBuffer();
  return cachedFontBytes;
}

function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

interface IntroducerRow {
  id: string;
  name: string;
  line_account_id: string;
  status: string;
  joined_at: string | null;
}

interface CastBreakdownRow {
  id: string;
  stripchat_username: string;
  rate_percent: number;
  total_tokens: number; // 当月合計
}

async function buildIntroducerPayslipPdf(
  introducer: IntroducerRow,
  month: string,
  breakdown: CastBreakdownRow[]
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);
  const fontBytes = await loadJapaneseFont();
  const jpFont = await pdfDoc.embedFont(fontBytes);
  const asciiFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const asciiBoldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const page = pdfDoc.addPage([595.28, 841.89]); // A4
  const { width, height } = page.getSize();
  const margin = 48;

  // カラーパレット（紹介者は橙系でキャスト明細との視覚的区別）
  const PRIMARY = rgb(0.95, 0.47, 0.28);       // 橙色
  const PRIMARY_DARK = rgb(0.77, 0.36, 0.21);
  const TEXT = rgb(0.13, 0.15, 0.18);
  const MUTED = rgb(0.45, 0.48, 0.52);
  const FAINT = rgb(0.72, 0.74, 0.76);
  const BORDER = rgb(0.88, 0.89, 0.90);
  const CARD_BG = rgb(0.99, 0.96, 0.93);
  const ZEBRA = rgb(0.99, 0.97, 0.94);
  const WHITE = rgb(1, 1, 1);

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

  // === ヘッダー（橙色帯） ===
  const headerH = 76;
  drawRect(0, height - headerH, width, headerH, PRIMARY);
  drawText('紹介者報酬明細書', margin, height - 38, { size: 22, color: WHITE });
  drawText('Introducer Commission Statement', margin, height - 58, { size: 9, color: rgb(0.98, 0.92, 0.88) });

  let y = height - headerH - 20;

  // メタ情報
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

  // === 紹介者情報 ===
  const sectionTitle = (title: string, yPos: number): number => {
    drawText(title, margin, yPos, { size: 11, color: PRIMARY_DARK });
    drawLine(margin, yPos - 6, width - margin, yPos - 6, 0.6, PRIMARY);
    return yPos - 18;
  };

  y = sectionTitle('紹介者情報', y);

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

  y = drawKV('氏名', introducer.name, y, { bold: true });
  y = drawKV('紹介者ID', introducer.id, y);
  y -= 10;

  // === 報酬サマリー（カード型） ===
  y = sectionTitle('報酬サマリー', y);

  const castCount = breakdown.length;
  const totalSalesTokens = breakdown.reduce((s, c) => s + c.total_tokens, 0);
  const totalCastPay = breakdown.reduce((s, c) => s + Math.round((c.total_tokens * c.rate_percent) / 100), 0);
  const introducerPay = Math.round(totalCastPay * INTRODUCER_RATE);
  const introducerPayJpy = introducerPay * JPY_PER_TOKEN;

  const cardH = 132;
  const cardX = margin;
  const cardW = width - margin * 2;
  drawRect(cardX, y - cardH + 4, cardW, cardH, CARD_BG);

  let cy = y - 16;
  const cLabelX = cardX + 18;
  const cValueRight = cardX + cardW - 18;

  drawText('紹介キャスト数', cLabelX, cy, { size: 10, color: MUTED });
  drawRightText(`${castCount} 人`, cValueRight, cy, { size: 11, color: TEXT });
  cy -= 16;
  drawText('紹介キャスト合計売上', cLabelX, cy, { size: 10, color: MUTED });
  drawRightText(`${totalSalesTokens.toLocaleString('ja-JP')} tk`, cValueRight, cy, { size: 11, color: TEXT });
  cy -= 16;
  drawText('紹介キャスト合計報酬', cLabelX, cy, { size: 10, color: MUTED });
  drawRightText(`${totalCastPay.toLocaleString('ja-JP')} tk`, cValueRight, cy, { size: 11, color: TEXT });
  cy -= 16;
  drawText('紹介報酬率', cLabelX, cy, { size: 10, color: MUTED });
  drawRightText(`${Math.round(INTRODUCER_RATE * 100)}%`, cValueRight, cy, { size: 11, color: TEXT });
  cy -= 8;
  drawLine(cLabelX, cy, cValueRight, cy, 0.4, BORDER);
  cy -= 14;
  drawText('紹介報酬', cLabelX, cy, { size: 11, color: TEXT });
  drawRightText(`${introducerPay.toLocaleString('ja-JP')} tk`, cValueRight, cy, { size: 12, color: TEXT, bold: true });
  cy -= 20;
  drawText('円換算', cLabelX, cy, { size: 11, color: PRIMARY_DARK });
  drawText(`(1tk = ¥${JPY_PER_TOKEN})`, cLabelX + widthOf('円換算', 11) + 6, cy, { size: 8, color: MUTED });
  drawRightText(`¥${introducerPayJpy.toLocaleString('ja-JP')}`, cValueRight, cy, { size: 17, color: PRIMARY_DARK, bold: true });

  y = y - cardH - 4;

  // 注記
  drawText('※ 円換算は本明細発行時のレートを使用。実際のお支払額は送金時の為替レートにより変動します。', margin, y, { size: 8, color: MUTED });
  y -= 11;
  drawText('※ 振込予定: 月末締め翌月20日払い', margin, y, { size: 8, color: MUTED });
  y -= 20;

  // === 紹介キャスト別内訳 ===
  y = sectionTitle('紹介キャスト別内訳', y);

  // カラム位置
  const colCast = margin + 8;
  const colSalesRight = margin + 220;
  const colRateRight = margin + 290;
  const colCastPayRight = margin + 390;
  const colIntroPayRight = width - margin - 8;

  drawText('キャスト', colCast, y, { size: 9, color: MUTED });
  drawRightText('売上 (tk)', colSalesRight, y, { size: 9, color: MUTED });
  drawRightText('還元率', colRateRight, y, { size: 9, color: MUTED });
  drawRightText('キャスト報酬 (tk)', colCastPayRight, y, { size: 9, color: MUTED });
  drawRightText('紹介報酬 (tk)', colIntroPayRight, y, { size: 9, color: MUTED });
  y -= 4;
  drawLine(margin, y, width - margin, y, 0.5, BORDER);
  y -= 12;

  const rowHeight = 14;
  for (let i = 0; i < breakdown.length; i++) {
    const c = breakdown[i];
    const castPay = Math.round((c.total_tokens * c.rate_percent) / 100);
    const introPay = Math.round(castPay * INTRODUCER_RATE);

    if (i % 2 === 0) {
      drawRect(margin, y - 3, width - margin * 2, rowHeight, ZEBRA);
    }

    drawText(c.stripchat_username, colCast, y, { size: 10, color: TEXT });
    drawRightText(c.total_tokens.toLocaleString('ja-JP'), colSalesRight, y, { size: 10, color: TEXT });
    drawRightText(`${c.rate_percent}%`, colRateRight, y, { size: 10, color: TEXT });
    drawRightText(castPay.toLocaleString('ja-JP'), colCastPayRight, y, { size: 10, color: TEXT });
    drawRightText(introPay.toLocaleString('ja-JP'), colIntroPayRight, y, { size: 10, color: TEXT, bold: true });
    y -= rowHeight;
  }

  y -= 2;
  drawLine(margin, y, width - margin, y, 0.6, PRIMARY);
  y -= 14;
  drawText('合計', colCast, y, { size: 10, color: TEXT });
  drawRightText(totalSalesTokens.toLocaleString('ja-JP'), colSalesRight, y, { size: 11, color: TEXT, bold: true });
  drawRightText(totalCastPay.toLocaleString('ja-JP'), colCastPayRight, y, { size: 11, color: TEXT, bold: true });
  drawRightText(introducerPay.toLocaleString('ja-JP'), colIntroPayRight, y, { size: 11, color: PRIMARY_DARK, bold: true });

  // === フッター ===
  const footerY = 36;
  drawLine(margin, footerY + 22, width - margin, footerY + 22, 0.5, BORDER);
  drawText('チャトナビ運営事務局', margin, footerY + 8, { size: 9, color: MUTED });
  drawText(`発行ID: ${introducer.id}/${month}`, margin, footerY - 6, { size: 8, color: FAINT });

  return await pdfDoc.save();
}

// POST /api/introducers/:id/payslips?month=YYYY-MM
introducerPayslips.post('/api/introducers/:id/payslips', async (c) => {
  try {
    const introducerId = c.req.param('id');
    const month = c.req.query('month');
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return c.json({ success: false, error: 'month (YYYY-MM) required' }, 400);
    }

    const introducer = await c.env.DB.prepare('SELECT * FROM introducers WHERE id = ?')
      .bind(introducerId)
      .first<IntroducerRow>();
    if (!introducer) return c.json({ success: false, error: 'introducer not found' }, 404);

    // 紹介キャスト一覧と当月合計売上を取得
    const [yStr, mStr] = month.split('-');
    const yearNum = parseInt(yStr, 10);
    const monthNum = parseInt(mStr, 10);
    const lastDay = new Date(yearNum, monthNum, 0).getDate();
    const startDate = `${month}-01`;
    const endDate = `${month}-${String(lastDay).padStart(2, '0')}`;

    const breakdownResult = await c.env.DB.prepare(
      `SELECT c.id, c.stripchat_username, c.rate_percent,
              COALESCE(SUM(d.tokens), 0) AS total_tokens
       FROM casts c
       LEFT JOIN cast_daily_earnings d
         ON d.cast_id = c.id AND d.date BETWEEN ? AND ?
       WHERE c.introducer_id = ?
       GROUP BY c.id, c.stripchat_username, c.rate_percent
       ORDER BY c.stripchat_username ASC`
    )
      .bind(startDate, endDate, introducerId)
      .all<CastBreakdownRow>();
    const breakdown = breakdownResult.results || [];

    if (breakdown.length === 0) {
      return c.json({ success: false, error: 'no introduced casts found' }, 404);
    }

    // PDF生成
    const pdfBytes = await buildIntroducerPayslipPdf(introducer, month, breakdown);

    // 既存の有効トークンをrevoke
    const nowSec = Math.floor(Date.now() / 1000);
    await c.env.DB.prepare(
      `UPDATE introducer_payslip_tokens SET revoked_at = ? WHERE introducer_id = ? AND month = ? AND revoked_at IS NULL`
    )
      .bind(nowSec, introducerId, month)
      .run();

    // 新トークン生成 & R2 保存（同じ PAYSLIPS バケットを key prefix で分離）
    const token = generateToken();
    const r2Key = `introducer-payslips/${introducerId}/${month}/${token}.pdf`;
    await c.env.PAYSLIPS.put(r2Key, pdfBytes, {
      httpMetadata: { contentType: 'application/pdf' },
    });

    const expiresAt = nowSec + URL_VALID_DAYS * 86400;
    const retentionUntil = nowSec + RETENTION_YEARS * 365 * 86400;
    await c.env.DB.prepare(
      `INSERT INTO introducer_payslip_tokens (token, introducer_id, month, r2_key, expires_at, retention_until, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(token, introducerId, month, r2Key, expiresAt, retentionUntil, nowSec)
      .run();

    const origin = new URL(c.req.url).origin;
    const url = `${origin}/p/intro/${token}`;

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
    console.error('POST /api/introducers/:id/payslips error:', err);
    return c.json({ success: false, error: err instanceof Error ? err.message : 'failed' }, 500);
  }
});

// GET /api/introducers/:id/payslips?month=YYYY-MM — 発行履歴
introducerPayslips.get('/api/introducers/:id/payslips', async (c) => {
  const introducerId = c.req.param('id');
  const month = c.req.query('month');
  let query = `SELECT token, month, expires_at, retention_until, created_at, revoked_at, download_count, last_accessed_at
               FROM introducer_payslip_tokens WHERE introducer_id = ?`;
  const params: unknown[] = [introducerId];
  if (month) {
    query += ` AND month = ?`;
    params.push(month);
  }
  query += ` ORDER BY created_at DESC LIMIT 50`;
  const rows = await c.env.DB.prepare(query).bind(...params).all();
  return c.json({ success: true, data: rows.results });
});

// GET /p/intro/:token — 公開エンドポイント（認証なし、トークン照合のみ）
introducerPayslips.get('/p/intro/:token', async (c) => {
  const token = c.req.param('token');
  const nowSec = Math.floor(Date.now() / 1000);

  const row = await c.env.DB.prepare(
    `SELECT token, introducer_id, month, r2_key, expires_at, revoked_at FROM introducer_payslip_tokens WHERE token = ?`
  )
    .bind(token)
    .first<{
      token: string;
      introducer_id: string;
      month: string;
      r2_key: string;
      expires_at: number;
      revoked_at: number | null;
    }>();

  const errorHtml = (heading: string, body: string) => `<!DOCTYPE html>
<html lang="ja"><head><meta charset="utf-8"><title>紹介者報酬明細書</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font-family:system-ui;padding:40px;text-align:center;color:#374151}</style></head>
<body><h1 style="color:#dc2626">${heading}</h1><p>${body}</p></body></html>`;

  if (!row) {
    return c.html(errorHtml('リンクが無効です', 'このURLは存在しないか、すでに失効しています。'), 404);
  }
  if (row.revoked_at !== null) {
    return c.html(errorHtml('このリンクは無効化されています', '新しいURLが発行されています。事務局にお問い合わせください。'), 410);
  }
  if (row.expires_at < nowSec) {
    return c.html(errorHtml('URLの有効期限が切れています', '事務局にお問い合わせください。'), 410);
  }

  const obj = await c.env.PAYSLIPS.get(row.r2_key);
  if (!obj) return c.text('PDF not found', 404);

  c.executionCtx.waitUntil(
    c.env.DB.prepare(
      `UPDATE introducer_payslip_tokens SET download_count = download_count + 1, last_accessed_at = ? WHERE token = ?`
    )
      .bind(nowSec, token)
      .run()
  );

  const isDownload = c.req.query('dl') === '1';
  const disposition = isDownload ? 'attachment' : 'inline';
  return new Response(obj.body, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${disposition}; filename="introducer-payslip-${row.month}.pdf"`,
      'Cache-Control': 'private, no-cache',
    },
  });
});

export { introducerPayslips };
