# 開発の流れの決まり（ブランチ・PR・レビュー・CI・マージ）

**対象**：このリポジトリで作業するすべての人とAI（Claude Code・Codex）。入口は[CLAUDE.md](../../CLAUDE.md)。

ステージングと本番を壊さずに、小さく出し続けるための決まり。出したあとのリリース・戻し方の手順は[リリースの手順書](../release-runbook.md)。

## 1. ブランチ

`main`（本番）／`develop`（ステージング）／`feature/*`（追加実装）の3段構成（[Constitution](../../.specify/memory/constitution.md)「開発ワークフロー」、[contracts/deploy.md](../../specs/015-deploy-environments/contracts/deploy.md)）。

| ブランチ | 何の場所か | マージすると |
|---|---|---|
| `main` | 本番（一般のお客さま） | 本番に出る |
| `develop` | ステージング（テストユーザー。**既定のブランチ**） | ステージングに出る |
| `feature/*`・`fix/*`・`docs/*` | 開発（手元） | — |

- ふだんのPRは`feature/*`→`develop`に向ける。ブランチは`develop`の最新から切る（`git switch -c <ブランチ> origin/develop`）。名前の付け方は[仕様と名前の決まり](./specs.md)。
- リリースは`develop`→`main`のPR（タイトルは「リリース：…」。[リリースの手順書](../release-runbook.md) 5）。
- 本番の急ぎの修正は`main`から`fix/*`を分け、`main`へマージしたあと、同じ変更を`develop`にも戻す（`git log --oneline main ^develop`が空になること。[リリースの手順書](../release-runbook.md) 7）。
- `main`・`develop`への直接のpushは禁止（PR必須）。
- マージ済みのブランチは、手元とGitHubの両方から消す。

## 2. PRとレビュー

- **PRは小さく**。1つのリリースに混ざる変更が少ないほど、壊れたときに原因を探しやすく、戻しやすい。マイグレーションのあるPRは、とくに小さく切って先に入れる（[並行開発の決まり](./parallel-development.md) 11-4）。
- PRの説明の「チェック」の欄（[.github/pull_request_template.md](../../.github/pull_request_template.md)）を埋める。どう確かめたか（流したテストと結果）を書く。
- **レビューは「セルフレビュー → Codexレビュー」の順**（Codexが使えないときは、セルフレビューだけでよい）。Codex（`chatgpt-codex-connector`）はPRを開くと自動でレビューを始めるので、先にセルフレビューで見つかるものを直してから回す。
  1. PRは**下書き（draft）**で出す（`gh pr create --draft`）。下書きのあいだはCodexは動かない。
  2. セルフレビュー（Claude Codeの`/code-review`など）をして、指摘を直してpushする。
  3. **「Ready for review」**にする（`gh pr ready <番号>`）。ここでCodexのレビューが始まる。直したあとにもう一度見てもらうときは、PRに `@codex review` とコメントする。
- 見つけたバグが今のPRの目的と別なら、別のPRで直す。

## 3. CI

- **CIは、PRにラベル「run-ci」を付けると流れる**（付け直すと、もう一度流れる。[.github/workflows/ci.yml](../../.github/workflows/ci.yml)）。付けないと流れない。GitHubのCIは量に限りがあるので、節約する。
- **`run-ci`を付けるのは、次のPRだけ**。
  - マイグレーションのあるPRなど、慎重に入れるもの。
  - 手元で確かめられないもの（`.github/workflows/`・デプロイの流れ）。
  - リリースのPR（`develop`→`main`）。コードを含むので、必ず流す。
  - ユーザーが頼んだとき。
- **ほかのコードのPR**は、手元で全部の確かめ（型チェック・lint・`eslint-rules`のテスト・共通・Web・APIの全テスト、E2Eは関わるもの）を流して結果をPRに書き、セルフレビューのあとマージする。
- 文書（`docs/`・`specs/`・`*.md`）・`.specify/`・スキルの本文だけのPRは、CIを流さない。
- CIの成功が要るブランチの規則は、管理者がPRから`gh pr merge --merge --admin`でマージして通す。

## 4. マージ

- **マージしてよいかは、ユーザーが決める**（最終の承認はユーザー）。AIは、確かめずにPRまで進めてよいが、コミット・push・PRのマージは、ユーザーに頼まれたときだけ行う。
- マージは merge commit（`gh pr merge --merge`）。積み重ねたPR（あるPRの上に作ったPR）は、下から順にマージし、上のPRの向き先を`develop`に直してからマージする。
- マージの前に`develop`を取り込み、ぶつかりがないことを確かめる（[並行開発の決まり](./parallel-development.md) 11-5）。

## 5. デプロイ

- デプロイは[.github/workflows/deploy.yml](../../.github/workflows/deploy.yml)が自動で行う（**マイグレーション → API → Web**の順。1つでも失敗したらそこで止まる）。
- **出すものが変わらない変更だけなら動かない**。文書（`docs/`・`specs/`・`*.md`）・`.specify/`・AIのスキル・E2Eだけを変えたマージでは、ステージング・本番へのデプロイを飛ばす（`paths-ignore`）。出し直したいときは、Actionsの画面から手で動かす。
- マージしたら、Actionsの「Deploy」が成功したかを確かめる。

## 6. この文書の更新

- 決まりを変えたら、同じPRでこの文書を直す。AIのメモリーだけに書かない（ほかのセッションから読めないため）。
