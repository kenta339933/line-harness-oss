/**
 * Discord Webhook通知サービス
 *
 * LINE 友だち追加時などのイベントを Discord チャンネルに通知する。
 *
 * WebhookURLは環境変数 (Cloudflare secrets) に保存:
 *   wrangler secret put DISCORD_WEBHOOK_URL
 *
 * ⚠️ セキュリティ:
 * - WebhookURLは機密情報。コード・Git履歴・ログに含めない
 * - env経由でのみ取得
 * - 失敗しても例外を上位に投げない（通知は副次的機能）
 */

const DISCORD_COLOR_SUCCESS = 0x57f287; // green
const DISCORD_COLOR_INFO = 0x5865f2; // blurple
const DISCORD_COLOR_WARNING = 0xfee75c; // yellow

export type DiscordEmbed = {
  title?: string;
  description?: string;
  color?: number;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  thumbnail?: { url: string };
  author?: { name: string; icon_url?: string };
  footer?: { text: string };
  timestamp?: string;
};

/**
 * Discord Webhookに通知を送信
 * @param webhookUrl Cloudflare secret 経由のWebhook URL
 * @param embed 通知内容
 */
export async function sendDiscordNotification(
  webhookUrl: string | undefined,
  embed: DiscordEmbed,
): Promise<void> {
  if (!webhookUrl) {
    console.log('[discord] DISCORD_WEBHOOK_URL not set, skipping notification');
    return;
  }

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embed] }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error(
        `[discord] webhook failed: status=${res.status} body=${text.slice(0, 200)}`,
      );
    }
  } catch (err) {
    console.error('[discord] webhook error:', err);
  }
}

/**
 * LINE 友だち追加イベントを Discord に通知
 */
export async function notifyNewFriend(
  webhookUrl: string | undefined,
  params: {
    displayName: string | null;
    pictureUrl: string | null;
    statusMessage: string | null;
    lineAccountName?: string | null;
    lineUserId: string;
    friendId: string;
  },
): Promise<void> {
  const displayName = params.displayName || '(名前未設定)';
  const fields: DiscordEmbed['fields'] = [];

  if (params.lineAccountName) {
    fields.push({
      name: 'LINEアカウント',
      value: params.lineAccountName,
      inline: true,
    });
  }
  fields.push({
    name: 'Friend ID',
    value: `\`${params.friendId}\``,
    inline: true,
  });
  if (params.statusMessage) {
    fields.push({
      name: 'ステータスメッセージ',
      value: params.statusMessage.slice(0, 200),
      inline: false,
    });
  }

  const embed: DiscordEmbed = {
    title: '🎉 新しい友だち追加',
    description: `**${displayName}** さんが友だちになりました`,
    color: DISCORD_COLOR_SUCCESS,
    fields,
    timestamp: new Date().toISOString(),
    footer: { text: 'LINE Harness' },
  };

  if (params.pictureUrl) {
    embed.thumbnail = { url: params.pictureUrl };
  }

  await sendDiscordNotification(webhookUrl, embed);
}
