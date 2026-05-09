# Deployment Guide

本リポジトリの自動デプロイ・運用ルール。

## 概要

```
[ローカル] git push origin main
   ↓
[GitHub Actions]
   ├── deploy-web.yml      → apps/web → Cloudflare Pages (line-harness-web)
   └── deploy-worker.yml   → apps/worker → Cloudflare Worker (line-crm-worker)
   ↓
[本番反映 約2〜3分]
   ├── https://app.line-crm.org (管理画面)
   └── https://api.line-crm.org (API)
```

## ブランチ戦略

| ブランチ | 役割 |
|---|---|
| **main** | 本番ブランチ。push で自動デプロイ。 |
| feature/* | 大規模変更時に作成。動作確認後 main へ merge。 |

**通常運用**: `main` で直接 commit & push。  
**緊急ロールバック**: `git revert HEAD && git push origin main`。

## デプロイの仕組み

### apps/web (Cloudflare Pages)
- Workflow: `.github/workflows/deploy-web.yml`
- Trigger: `apps/web/`, `packages/shared/`, `pnpm-lock.yaml` の変更
- Build: `pnpm --filter web build` (Next.js Static Export → `apps/web/out/`)
- Deploy: `wrangler pages deploy apps/web/out --project-name=line-harness-web`

### apps/worker (Cloudflare Worker)
- Workflow: `.github/workflows/deploy-worker.yml`
- Trigger: `apps/worker/`, `packages/db/`, `packages/shared/`, `packages/line-sdk/` の変更
- Build: `pnpm --filter worker build`
- Deploy: `wrangler deploy` (wrangler.toml の `name = line-crm-worker` を使う)

## GitHub Secrets

| 名前 | 用途 |
|---|---|
| CLOUDFLARE_API_TOKEN | Pages/Worker デプロイ |
| CLOUDFLARE_ACCOUNT_ID | Cloudflare アカウント識別 (`6ec6966a5c19a5a4f21394264fd29527`) |
| NEXT_PUBLIC_API_URL | apps/web ビルド時 (`https://api.line-crm.org`) |
| NEXT_PUBLIC_API_KEY | apps/web ビルド時 |

## GitHub Variables (worker build用・任意)

| 名前 | 用途 |
|---|---|
| VITE_LIFF_ID | LIFF ID デフォルト |
| VITE_BOT_BASIC_ID | LINE Bot basic ID |
| VITE_CALENDAR_CONNECTION_ID | カレンダー連携 ID |

## 本番リソース

| 種類 | 名前 | URL/識別子 |
|---|---|---|
| Cloudflare Pages | line-harness-web | `app.line-crm.org` (custom) / `line-harness-web-29m.pages.dev` (default) |
| Cloudflare Worker | line-crm-worker | `api.line-crm.org` |
| D1 Database | line-crm | `4b93f990-6dc4-4a8e-8624-bb1173150887` |
| R2 (画像) | line-harness-images | - |
| R2 (明細) | line-harness-payslips | - |

## マイグレーション運用

DB の migration は `packages/db/migrations/` にSQLファイルとして置く。

### 適用方法（手動）
```bash
cd /tmp
npx wrangler d1 execute line-crm \
  --file /path/to/migration.sql \
  --remote \
  --config /tmp/wrangler-line-crm.toml
```

`/tmp/wrangler-line-crm.toml` の中身（最小設定）:
```toml
name = "line-crm-worker"
account_id = "6ec6966a5c19a5a4f21394264fd29527"

[[d1_databases]]
binding = "DB"
database_name = "line-crm"
database_id = "4b93f990-6dc4-4a8e-8624-bb1173150887"
```

## 緊急時の対応

### ロールバック
```bash
git revert HEAD
git push origin main
# → 自動再デプロイで元の状態に戻る (2-3分)
```

### 動作確認
- Web: https://app.line-crm.org (強制リロード Cmd+Shift+R)
- Worker: `curl -sI https://api.line-crm.org/api/health` で200確認

### ログ確認
```bash
npx wrangler tail line-crm-worker --config /tmp/wrangler-line-crm.toml --format pretty
```

## 開発フロー

### 通常の修正
```bash
# 1. main で作業
git checkout main && git pull
# 2. 編集
# 3. push（自動デプロイ）
git add . && git commit -m "..."
git push origin main
```

### 大規模変更
```bash
# 1. feature ブランチ作成
git checkout -b feature/xxx
# 2. 編集 & push（preview deployment が走る）
git push origin feature/xxx
# 3. preview URL で動作確認
# 4. main に merge
git checkout main && git merge feature/xxx
git push origin main
```
