# 契約：デプロイのワークフロー

**Feature**：[spec.md](../spec.md) | **調べ**：[research.md](../research.md) R2・R4

## 1. ワークフローの一覧

| ファイル | いつ動くか | 何をするか |
|---|---|---|
| `.github/workflows/ci.yml`（既存） | PR（`develop`・`main`向け）、`develop`と`main`へのpush | lint・型チェック・テスト |
| `.github/workflows/deploy.yml`（新規） | `develop`へのpush → ステージング／`main`へのpush → 本番 | マイグレーション → API → Web |

## 2. `deploy.yml`の形

- **起動**：`on: push: branches: [develop, main]`
- **環境**：`environment: ${{ github.ref_name == 'main' && 'production' || 'staging' }}`（GitHubのEnvironmentのSecretsと変数を使う）
- **1つずつ**：`concurrency: { group: deploy-${{ github.ref_name }}, cancel-in-progress: false }`（FR-013。途中で打ち切らない）
- **手順**（上から順に。1つでも失敗したら、そこで止める）

| # | 手順 | 失敗したときに起きること |
|---|---|---|
| 1 | チェックアウト・pnpm・Node 22・依存の用意 | 何も出ない |
| 2 | `pnpm build`（shared・web・api） | 何も出ない |
| 3 | `pnpm --filter api db:migrate`（`DATABASE_URL`はEnvironmentのSecrets） | **DBだけが新しく、アプリは前の版のまま**（R4の「前の版でも壊れない形」で安全） |
| 4 | `wrangler deploy --env staging\|production`（`wrangler-action`） | DBは新しく、APIとWebは前の版 |
| 5 | `wrangler pages deploy ./apps/web/dist --branch develop\|main` | APIだけ新しく、Webは前の版 |

- **手で動かせるようにする**：`workflow_dispatch`も付ける（やり直し用）。
- **記録**：Actionsの実行履歴が、デプロイの記録（いつ・どの変更・結果）になる（FR-014）。

## 3. ブランチのきまり（GitHubのruleset）

| ブランチ | 直接のpush | PR | CIの必須 |
|---|---|---|---|
| `main` | 禁止 | 必須 | `ci.yml`の成功 |
| `develop` | 禁止 | 必須 | `ci.yml`の成功 |

- GitHubの既定のブランチは`develop`にする（新しいPRの行き先が既定で`develop`になる）。
- `main`へのPRは、`develop`からのリリースと、`main`から分けた急ぎの修正だけ。

## 4. リリースの手順（人がやること）

1. `develop`→`main`のPRを作る（タイトルは「リリース：…」）。
2. CIの成功を確かめてマージする。
3. `deploy.yml`（production）の成功を確かめる。
4. 本番のURLで、変更が出ていることを確かめる。

## 5. 急ぎの修正の手順（人がやること）

1. `main`から`fix/…`を作り、`main`へのPRでマージする（本番に出る）。
2. 同じ修正を`develop`にも入れる（`main`→`develop`のPR、または同じ変更のPR）。
3. `main`と`develop`の差が残っていないことを確かめる（`git log --oneline main ^develop`が空）。
