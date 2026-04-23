-- Per-LINE-account Discord webhook URL for follow notifications
-- NULL = fallback to env.DISCORD_WEBHOOK_URL (global default)
-- NON-NULL = account-specific webhook (overrides global)

ALTER TABLE line_accounts
  ADD COLUMN discord_webhook_url TEXT;
