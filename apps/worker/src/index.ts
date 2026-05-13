import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { LineClient } from '@line-crm/line-sdk';
import { getLineAccounts, getTrafficPoolBySlug, getRandomPoolAccount, getPoolAccounts, getEntryRouteByRefCode } from '@line-crm/db';
import { processStepDeliveries } from './services/step-delivery.js';
import { processScheduledBroadcasts, processQueuedBroadcasts } from './services/broadcast.js';
import { processReminderDeliveries } from './services/reminder-delivery.js';
import { checkAccountHealth } from './services/ban-monitor.js';
import { refreshLineAccessTokens } from './services/token-refresh.js';
import { processInsightFetch } from './services/insight-fetcher.js';
import { recordFriendCountSnapshots } from './services/friend-snapshot.js';
import { authMiddleware } from './middleware/auth.js';
import { accountAccessQueryMiddleware } from './middleware/account-access.js';
import { rateLimitMiddleware } from './middleware/rate-limit.js';
import { webhook } from './routes/webhook.js';
import { friends } from './routes/friends.js';
import { tags } from './routes/tags.js';
import { scenarios } from './routes/scenarios.js';
import { broadcasts } from './routes/broadcasts.js';
import { users } from './routes/users.js';
import { lineAccounts } from './routes/line-accounts.js';
import { conversions } from './routes/conversions.js';
import { affiliates } from './routes/affiliates.js';
import { openapi } from './routes/openapi.js';
import { liffRoutes } from './routes/liff.js';
// Round 3 ルート
import { webhooks } from './routes/webhooks.js';
import { calendar } from './routes/calendar.js';
import { reminders } from './routes/reminders.js';
import { scoring } from './routes/scoring.js';
import { templates } from './routes/templates.js';
import { chats } from './routes/chats.js';
import { notifications } from './routes/notifications.js';
import { stripe } from './routes/stripe.js';
import { health } from './routes/health.js';
import { automations } from './routes/automations.js';
import { richMenus } from './routes/rich-menus.js';
import { trackedLinks } from './routes/tracked-links.js';
import { forms } from './routes/forms.js';
import { adPlatforms } from './routes/ad-platforms.js';
import { staff } from './routes/staff.js';
import { images } from './routes/images.js';
import { accountSettings } from './routes/account-settings.js';
import { setup } from './routes/setup.js';
import { autoReplies } from './routes/auto-replies.js';
import { trafficPools } from './routes/traffic-pools.js';
import { meetCallback } from './routes/meet-callback.js';
import { messageTemplates } from './routes/message-templates.js';
import { overview } from './routes/overview.js';
import { casts } from './routes/casts.js';
import { castLiff } from './routes/cast-liff.js';
import { entryRoutes } from './routes/entry-routes.js';
import { payslips } from './routes/payslips.js';
import { introducerPayslips } from './routes/introducer-payslips.js';
import { paidReadings } from './routes/paid-readings.js';

export type Env = {
  Bindings: {
    DB: D1Database;
    IMAGES: R2Bucket;
    PAYSLIPS: R2Bucket;
    ASSETS: Fetcher;
    LINE_CHANNEL_SECRET: string;
    LINE_CHANNEL_ACCESS_TOKEN: string;
    API_KEY: string;
    LIFF_URL: string;
    LINE_CHANNEL_ID: string;
    LINE_LOGIN_CHANNEL_ID: string;
    LINE_LOGIN_CHANNEL_SECRET: string;
    WORKER_URL: string;
    X_HARNESS_URL?: string;  // Optional: X Harness API URL for account linking
    IG_HARNESS_URL?: string;  // Optional: IG Harness API URL for cross-platform linking
    IG_HARNESS_LINK_SECRET?: string;  // Shared secret for IG Harness link-line webhook
    DISCORD_WEBHOOK_URL?: string;  // Optional: Discord webhook for friend add notifications
    STRIPCHAT_STUDIO_API_KEY?: string;  // Stripchat Studio API key for cast earnings sync
    STRIPCHAT_STUDIO_USERNAME?: string;  // Stripchat studio username (e.g. kenta3388)
    GCAL_SA_KEY_JSON?: string;  // Google Service Account JSON for cast schedule sync
    GCAL_CALENDAR_ID?: string;  // Target Google Calendar ID for cast schedules
  };
  Variables: {
    staff: { id: string; name: string; role: 'owner' | 'admin' | 'staff' };
  };
};

const app = new Hono<Env>();

// CORS — allow all origins for MVP
app.use('*', cors({ origin: '*' }));

// Rate limiting — runs before auth to block abuse early
app.use('*', rateLimitMiddleware);

// Auth middleware — skips /webhook and /docs automatically
app.use('*', authMiddleware);

// Account access guard — non-owner staff can only access lineAccountIds they're assigned to.
// Triggers on `?lineAccountId=...` query strings only; body payloads need per-route checks.
app.use('/api/*', accountAccessQueryMiddleware);

// Mount route groups — MVP & Round 2
app.route('/', webhook);
app.route('/', friends);
app.route('/', tags);
app.route('/', scenarios);
app.route('/', broadcasts);
app.route('/', users);
app.route('/', lineAccounts);
app.route('/', conversions);
app.route('/', affiliates);
app.route('/', openapi);
app.route('/', liffRoutes);

// Mount route groups — Round 3
app.route('/', webhooks);
app.route('/', calendar);
app.route('/', reminders);
app.route('/', scoring);
app.route('/', templates);
app.route('/', chats);
app.route('/', notifications);
app.route('/', stripe);
app.route('/', health);
app.route('/', automations);
app.route('/', richMenus);
app.route('/', trackedLinks);
app.route('/', forms);
app.route('/', adPlatforms);
app.route('/', staff);
app.route('/', images);
app.route('/', setup);
app.route('/', autoReplies);
app.route('/', trafficPools);
app.route('/', accountSettings);
app.route('/', meetCallback);
app.route('/', messageTemplates);
app.route('/', overview);
app.route('/', payslips);
app.route('/', introducerPayslips);
app.route('/', paidReadings);
app.route('/', casts);
app.route('/', castLiff);
app.route('/', entryRoutes);

// Self-hosted QR code proxy — prevents leaking ref tokens to third-party services
app.get('/api/qr', async (c) => {
  const data = c.req.query('data');
  if (!data) return c.text('Missing data param', 400);
  const size = c.req.query('size') || '240x240';
  const upstream = `https://api.qrserver.com/v1/create-qr-code/?size=${encodeURIComponent(size)}&data=${encodeURIComponent(data)}`;
  const res = await fetch(upstream);
  if (!res.ok) return c.text('QR generation failed', 502);
  return new Response(res.body, {
    headers: {
      'Content-Type': res.headers.get('Content-Type') || 'image/png',
      'Cache-Control': 'public, max-age=86400',
    },
  });
});

// Cast invite short link: /i/:token → 302 to liff.line.me/{liff_id}?...&invite={token}
// 招待トークンに紐づくキャストを引き、そのキャストの所属アカウントの LIFF にリダイレクト。
app.get('/i/:token', async (c) => {
  const token = c.req.param('token');
  const cast = await c.env.DB
    .prepare(`SELECT c.id, c.line_account_id, la.liff_id AS own_liff_id
              FROM casts c
              LEFT JOIN line_accounts la ON la.id = c.line_account_id
              WHERE c.invite_token = ?`)
    .bind(token)
    .first<{ id: string; line_account_id: string; own_liff_id: string | null }>();
  let liffId: string | null = cast?.own_liff_id ?? null;
  if (!liffId) {
    const fb = await c.env.DB
      .prepare(`SELECT liff_id FROM line_accounts WHERE liff_id IS NOT NULL AND is_active = 1 LIMIT 1`)
      .first<{ liff_id: string }>();
    liffId = fb?.liff_id ?? null;
  }
  if (!liffId) return c.text('LIFF設定がありません', 500);
  const dest = `https://liff.line.me/${liffId}?liffId=${liffId}&page=cast-schedule&invite=${token}`;
  return c.redirect(dest, 302);
});

// Short link: /r/:ref → landing page with LINE open button
// Supports query params: ?form=FORM_ID (auto-push form after friend add)
// Mobile: resolves pool → button links directly to LIFF URL (triggers Universal Link)
// Desktop: QR code encodes LIFF URL
app.get('/r/:ref', async (c) => {
  const ref = c.req.param('ref');
  const formId = c.req.query('form') || '';
  const baseUrl = new URL(c.req.url).origin;

  // ─── Bypass intermediate LP for LINE in-app users ───────────
  // チャトレ業界の知見：中間LPを挟むとLINE登録CV率が落ちる。
  // LINE in-app から来たユーザーは entry_route.redirect_url が設定されてれば即302。
  // 外部ブラウザは下のロジックでランディングページを表示（Universal Link発火が必要）。
  {
    const uaEarly = (c.req.header('user-agent') || '').toLowerCase();
    const isLineInAppEarly = /\bline\//.test(uaEarly);
    const isMobileEarly = /iphone|ipad|android|mobile/.test(uaEarly);
    if (isMobileEarly && isLineInAppEarly) {
      const route = await getEntryRouteByRefCode(c.env.DB, ref);
      if (route?.redirect_url) {
        return c.redirect(route.redirect_url, 302);
      }
    }
  }

  // Resolve LIFF URL from pool (same logic as /auth/line)
  // Pool resolution priority:
  //   1. ?pool=... query param (explicit override)
  //   2. entry_route.line_account_id → matching traffic_pool (auto from ref code)
  //   3. slug=main fallback
  let liffUrl = c.env.LIFF_URL;
  let pool: { id: string; slug: string; name: string; active_account_id: string | null; is_active: number; liff_id?: string | null } | null = null;
  let resolvedAccessToken: string | null = null; // for bot_basic_id lookup
  const poolSlugQuery = c.req.query('pool');
  if (poolSlugQuery) {
    pool = await getTrafficPoolBySlug(c.env.DB, poolSlugQuery);
  } else {
    const route = await getEntryRouteByRefCode(c.env.DB, ref);
    if (route?.line_account_id) {
      pool = await c.env.DB
        .prepare(`SELECT * FROM traffic_pools WHERE active_account_id = ? AND is_active = 1 LIMIT 1`)
        .bind(route.line_account_id)
        .first();
    }
    if (!pool) pool = await getTrafficPoolBySlug(c.env.DB, 'main');
  }
  if (pool) {
    const account = await getRandomPoolAccount(c.env.DB, pool.id);
    if (account) {
      if (account.liff_id) liffUrl = `https://liff.line.me/${account.liff_id}`;
      resolvedAccessToken = (account as { channel_access_token?: string }).channel_access_token ?? null;
    } else {
      const allAccounts = await getPoolAccounts(c.env.DB, pool.id);
      if (allAccounts.length === 0) {
        if (pool.liff_id) liffUrl = `https://liff.line.me/${pool.liff_id}`;
      }
    }
  }

  // Ad click IDs and UTM params — pass through from LP so ref_tracking captures them
  const gclid = c.req.query('gclid') || '';
  const fbclid = c.req.query('fbclid') || '';
  const twclid = c.req.query('twclid') || '';
  const ttclid = c.req.query('ttclid') || '';
  const utmSource = c.req.query('utm_source') || '';
  const utmMedium = c.req.query('utm_medium') || '';
  const utmCampaign = c.req.query('utm_campaign') || '';

  // Build LIFF URL with params (direct link for Universal Link)
  const liffIdMatch = liffUrl.match(/liff\.line\.me\/([0-9]+-[A-Za-z0-9]+)/);
  const liffParams = new URLSearchParams();
  if (liffIdMatch) liffParams.set('liffId', liffIdMatch[1]);
  if (ref) liffParams.set('ref', ref);
  if (formId) liffParams.set('form', formId);
  const gate = c.req.query('gate');
  if (gate) liffParams.set('gate', gate);
  const xh = c.req.query('xh');
  if (xh) liffParams.set('xh', xh);
  const ig = c.req.query('ig');
  if (ig) liffParams.set('ig', ig);
  if (gclid) liffParams.set('gclid', gclid);
  if (fbclid) liffParams.set('fbclid', fbclid);
  if (twclid) liffParams.set('twclid', twclid);
  if (ttclid) liffParams.set('ttclid', ttclid);
  if (utmSource) liffParams.set('utm_source', utmSource);
  if (utmMedium) liffParams.set('utm_medium', utmMedium);
  if (utmCampaign) liffParams.set('utm_campaign', utmCampaign);
  const liffTarget = liffParams.toString() ? `${liffUrl}?${liffParams.toString()}` : liffUrl;

  // Build /auth/oauth fallback URL — forces OAuth flow without X detection,
  // so the X warning button doesn't loop back to this landing page
  const authParams = new URLSearchParams();
  authParams.set('ref', ref);
  if (formId) authParams.set('form', formId);
  const poolParam = c.req.query('pool');
  if (poolParam) {
    authParams.set('pool', poolParam);
  } else if (pool?.slug) {
    // entry_route 経由で解決した pool を fallback URL にも引き継ぐ
    authParams.set('pool', pool.slug);
  }
  if (gate) authParams.set('gate', gate);
  if (xh) authParams.set('xh', xh);
  if (ig) authParams.set('ig', ig);
  if (gclid) authParams.set('gclid', gclid);
  if (fbclid) authParams.set('fbclid', fbclid);
  if (twclid) authParams.set('twclid', twclid);
  if (ttclid) authParams.set('ttclid', ttclid);
  if (utmSource) authParams.set('utm_source', utmSource);
  if (utmMedium) authParams.set('utm_medium', utmMedium);
  if (utmCampaign) authParams.set('utm_campaign', utmCampaign);
  const authFallback = `${baseUrl}/auth/oauth?${authParams.toString()}`;

  const ua = (c.req.header('user-agent') || '').toLowerCase();
  const isMobile = /iphone|ipad|android|mobile/.test(ua);
  // X (Twitter) iOS in-app browser since v11.42 uses custom WKWebView that
  // blocks ALL Universal Links and deep links. Detect via UA and show
  // explicit "open in Safari" instruction to recover lost users.
  const isXInAppBrowser = /twitter|twitterandroid/i.test(c.req.header('user-agent') || '');
  // Other in-app browsers (Instagram, FB, LINE itself, etc.) — same UL limitations
  const isOtherInApp = /\b(fbav|fban|instagram|line\/|micromessenger)\b/i.test(c.req.header('user-agent') || '');
  // LINE in-app webview の場合、LIFF経由でアクセスすると LIFF→/auth/line→LIFF の無限ループに陥る。
  // 同じLINEアプリ内なので OAuth (access.line.me) も問題なく開ける → メインボタンを直接 OAuth に向ける。
  const isLineInApp = /\bline\//i.test(c.req.header('user-agent') || '');
  const primaryUrl = isLineInApp ? authFallback : liffTarget;

  if (isMobile && (isXInAppBrowser || isOtherInApp)) {
    // In-app browser path: button first, fallback steps collapsed below
    return c.html(`<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>LINE で開く</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Hiragino Sans','Helvetica Neue',system-ui,sans-serif;background:#f5f7f5;display:flex;justify-content:center;align-items:center;min-height:100vh;padding:16px}
.card{background:#fff;border-radius:20px;box-shadow:0 2px 20px rgba(0,0,0,0.06);text-align:center;max-width:380px;width:100%;padding:36px 24px 32px;border:1px solid rgba(0,0,0,0.04)}
.line-icon{width:48px;height:48px;margin:0 auto 18px}
.line-icon svg{width:48px;height:48px}
.title{font-size:16px;color:#444;font-weight:600;margin-bottom:24px;line-height:1.5}
.btn{display:block;width:100%;padding:16px;border:none;border-radius:12px;font-size:16px;font-weight:700;text-decoration:none;text-align:center;color:#fff;background:#06C755;box-shadow:0 2px 12px rgba(6,199,85,0.2);transition:all .15s;cursor:pointer}
.btn:active{transform:scale(0.98);opacity:.9}
.fallback{margin-top:24px;padding:16px;background:#f9f9f9;border-radius:10px;text-align:left}
.fallback-title{font-size:13px;font-weight:700;color:#666;margin-bottom:8px}
.fallback p{font-size:12px;color:#666;line-height:1.7;margin-bottom:8px}
.fallback ol{margin:0;padding-left:20px;font-size:12px;color:#666;line-height:1.8}
.footer{font-size:11px;color:#bbb;margin-top:20px;line-height:1.5}
</style>
</head>
<body>
<div class="card">
<div class="line-icon">
<svg viewBox="0 0 48 48" fill="none"><rect width="48" height="48" rx="12" fill="#06C755"/><path d="M24 12C17.37 12 12 16.58 12 22.2c0 3.54 2.35 6.65 5.86 8.47-.2.74-.76 2.75-.87 3.17-.14.55.2.54.42.39.18-.12 2.84-1.88 4-2.65.84.13 1.7.22 2.59.22 6.63 0 12-4.58 12-10.2S30.63 12 24 12z" fill="#fff"/></svg>
</div>
<p class="title">LINE で友だち追加します</p>
<a href="${primaryUrl}" class="btn">このまま LINE を開く</a>
<div class="fallback">
<p class="fallback-title">うまく開けない場合は</p>
<p>外部ブラウザ（Safari / Chrome）で開いてから「LINE で開く」をタップしてください。</p>
<ol>
<li>URLバー右端の「⋮」をタップ</li>
<li>表示メニューから「ブラウザで開く」を選択</li>
<li>移動先のページで「LINE で開く」をタップ</li>
</ol>
</div>
<p class="footer">友だち追加で最新情報をお届けします</p>
</div>
</body>
</html>`);
  }

  if (isMobile) {
    // Regular mobile browser (Safari/Chrome): redirect straight to LINE's native
    // add-friend URL (line.me/R/ti/p/{basicId}) — no LIFF, no login required.
    //
    // Why not LIFF: LIFF SDK forces liff.login() for users not logged into LINE
    // in their mobile browser, which throws them to access.line.me (email/password
    // login). Verified via screen recording 2026-05-13: 100% drop-off for users
    // who hadn't already logged into LINE on their browser.
    //
    // Trade-off: we lose gclid → ref_tracking persistence for these users
    // (no LIFF means no /api/liff/link call). CV1 (LINE button click via GTM)
    // remains as the primary Smart Bidding signal.
    let botBasicId = '';
    if (resolvedAccessToken) {
      try {
        const botRes = await fetch('https://api.line.me/v2/bot/info', {
          headers: { Authorization: `Bearer ${resolvedAccessToken}` },
        });
        if (botRes.ok) {
          const bot = await botRes.json() as { basicId?: string };
          botBasicId = bot.basicId || '';
        }
      } catch { /* fallthrough to LIFF */ }
    }
    if (botBasicId) {
      return c.redirect(`https://line.me/R/ti/p/${botBasicId}`, 302);
    }
    // Fallback: LIFF (still better than the legacy intermediate page).
    return c.redirect(primaryUrl, 302);
  }

  // PC: show QR code page — QR encodes LIFF URL directly
  return c.html(`<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>LINE で開く</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Hiragino Sans','Helvetica Neue',system-ui,sans-serif;background:#f5f7f5;display:flex;justify-content:center;align-items:center;min-height:100vh}
.card{background:#fff;border-radius:20px;box-shadow:0 2px 20px rgba(0,0,0,0.06);text-align:center;max-width:480px;width:90%;padding:48px;border:1px solid rgba(0,0,0,0.04)}
.line-icon{width:48px;height:48px;margin:0 auto 20px}
.line-icon svg{width:48px;height:48px}
.msg{font-size:15px;color:#444;font-weight:500;margin-bottom:32px;line-height:1.6}
.qr{background:#f9f9f9;border-radius:16px;padding:24px;display:inline-block;margin-bottom:24px;border:1px solid rgba(0,0,0,0.04)}
.qr img{display:block;width:240px;height:240px}
.hint{font-size:13px;color:#999;line-height:1.6}
.footer{font-size:11px;color:#bbb;margin-top:24px;line-height:1.5}
</style>
</head>
<body>
<div class="card">
<div class="line-icon">
<svg viewBox="0 0 48 48" fill="none"><rect width="48" height="48" rx="12" fill="#06C755"/><path d="M24 12C17.37 12 12 16.58 12 22.2c0 3.54 2.35 6.65 5.86 8.47-.2.74-.76 2.75-.87 3.17-.14.55.2.54.42.39.18-.12 2.84-1.88 4-2.65.84.13 1.7.22 2.59.22 6.63 0 12-4.58 12-10.2S30.63 12 24 12z" fill="#fff"/></svg>
</div>
<p class="msg">スマートフォンで QR コードを読み取ってください</p>
<div class="qr">
<img src="/api/qr?size=240x240&data=${encodeURIComponent(liffTarget)}" alt="QR Code">
</div>
<p class="hint">LINE アプリのカメラまたは<br>スマートフォンのカメラで読み取れます</p>
<p class="footer">友だち追加で最新情報をお届けします</p>
</div>
</body>
</html>`);
});

// Convenience redirect for /book path
app.get('/book', (c) => c.redirect('/?page=book'));

// 404 fallback — API paths return JSON 404, everything else serves from static assets (LIFF/admin)
app.notFound(async (c) => {
  const path = new URL(c.req.url).pathname;
  if (path.startsWith('/api/') || path === '/webhook' || path === '/docs' || path === '/openapi.json') {
    return c.json({ success: false, error: 'Not found' }, 404);
  }
  // Serve static assets (admin dashboard, LIFF pages)
  return c.env.ASSETS.fetch(c.req.raw);
});

// Scheduled handler for cron triggers — runs for all active LINE accounts
async function scheduled(
  _event: ScheduledEvent,
  env: Env['Bindings'],
  _ctx: ExecutionContext,
): Promise<void> {
  // Get all active accounts from DB
  const dbAccounts = await getLineAccounts(env.DB);

  // Build LineClient map for insight fetching (keyed by account id)
  const lineClients = new Map<string, LineClient>();
  for (const account of dbAccounts) {
    if (account.is_active) {
      lineClients.set(account.id, new LineClient(account.channel_access_token));
    }
  }
  const defaultLineClient = new LineClient(env.LINE_CHANNEL_ACCESS_TOKEN);

  // 配信系は1回だけ実行（内部でfriendのline_account_idから正しいlineClientを動的解決）
  // 以前はアカウントごとにループしていたが、アカウントフィルタなしのDBクエリで
  // 全アカウントの配信が各ループで重複実行されていたバグを修正
  const jobs = [];
  jobs.push(
    processStepDeliveries(env.DB, defaultLineClient, env.WORKER_URL),
    processScheduledBroadcasts(env.DB, defaultLineClient, env.WORKER_URL),
    processReminderDeliveries(env.DB, defaultLineClient, env.WORKER_URL),
  );
  // キュー処理は1回だけ実行（内部でアカウント別lineClientを解決する）
  // ロック解除: タイムアウトでstuckした配信を復旧
  const { recoverStalledBroadcasts, recoverStuckDeliveries } = await import('@line-crm/db');
  jobs.push(recoverStuckDeliveries(env.DB));
  jobs.push(recoverStalledBroadcasts(env.DB));
  jobs.push(processQueuedBroadcasts(env.DB, defaultLineClient, env.WORKER_URL));
  jobs.push(checkAccountHealth(env.DB));
  jobs.push(refreshLineAccessTokens(env.DB));
  jobs.push(recordFriendCountSnapshots(env.DB));

  // 配信予定リマインダー (キャストの30分前通知)
  const { processCastReminders } = await import('./services/cast-reminder.js');
  jobs.push(processCastReminders(env).then((r) => {
    if (r.sent > 0 || r.failed > 0) console.log('[cast-reminder]', r);
  }));

  await Promise.allSettled(jobs);

  // Fetch broadcast insights (runs daily, self-throttled)
  try {
    await processInsightFetch(env.DB, lineClients, defaultLineClient);
  } catch (e) {
    console.error('Insight fetch error:', e);
  }

  // Cross-account duplicate detection & auto-tagging
  try {
    const { processDuplicateDetection } = await import('./services/duplicate-detect.js');
    await processDuplicateDetection(env.DB);
  } catch (e) {
    console.error('Duplicate detection error:', e);
  }

  // 期限切れ payslip ファイル削除（保持期限3年経過分）
  try {
    const nowSec = Math.floor(Date.now() / 1000);
    const expired = await env.DB.prepare(
      `SELECT token, r2_key FROM payslip_tokens WHERE retention_until < ? LIMIT 100`
    ).bind(nowSec).all<{ token: string; r2_key: string }>();
    for (const row of (expired.results || [])) {
      try {
        await env.PAYSLIPS.delete(row.r2_key);
        await env.DB.prepare('DELETE FROM payslip_tokens WHERE token = ?').bind(row.token).run();
      } catch (e) {
        console.error('Payslip cleanup error:', row.token, e);
      }
    }
  } catch (e) {
    console.error('Payslip retention sweep error:', e);
  }

  // 期限切れ introducer payslip ファイル削除（保持期限3年経過分）
  try {
    const nowSec = Math.floor(Date.now() / 1000);
    const expired = await env.DB.prepare(
      `SELECT token, r2_key FROM introducer_payslip_tokens WHERE retention_until < ? LIMIT 100`
    ).bind(nowSec).all<{ token: string; r2_key: string }>();
    for (const row of (expired.results || [])) {
      try {
        await env.PAYSLIPS.delete(row.r2_key);
        await env.DB.prepare('DELETE FROM introducer_payslip_tokens WHERE token = ?').bind(row.token).run();
      } catch (e) {
        console.error('Introducer payslip cleanup error:', row.token, e);
      }
    }
  } catch (e) {
    console.error('Introducer payslip retention sweep error:', e);
  }
}

export default {
  fetch: app.fetch,
  scheduled,
};
// redeploy trigger
