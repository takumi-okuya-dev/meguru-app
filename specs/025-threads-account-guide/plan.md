# 実装計画（Implementation Plan）：Threadsで許可するときのアカウントの取り違えを減らす案内

**ブランチ**：`feature/025-threads-account-guide` | **日付**：2026-11-08 | **仕様**：[spec.md](./spec.md) | **モック**：[025 アカウントの取り違えの案内 モック](https://claude.ai/artifact/9hc14FMaeTytHEAkuNiaLH)

**入力**：`specs/025-threads-account-guide/spec.md`（Clarifications 2026-11-08を含む）、Constitution 4.4.0

## 概要（Summary）

Threadsの許可の画面は、ブラウザでthreads.comにログインしているアカウントを使い、アプリから切り替える手段がない。そこで、画面の案内で取り違えを防ぎ、起きたときにすぐやり直せるようにする。つなぐ動きとトークンの貼り付けは変えない。

- **押す前の案内（US1）**：
  - 新しい部品`ThreadsAccountGuide`を、「Threadsで許可する」を出す3か所（`ConnectMethods`・`TesterApplicationPanel`の招待済み・`ReconnectDialog`）に置く。
  - 使うべき@ユーザー名を受け取り、短い文と閉じたトグル（手順とthreads.comのリンク）を出す。
- **違うアカウントで戻ったとき（US2）**：
  - 新しい部品`AccountSwitchSteps`を作る。今のエラーの文に、3つの手順と「threads.comを開く」を足す。
  - 出す相手：`RECONNECT_ACCOUNT_MISMATCH`・`THREADS_ACCOUNT_TAKEN`・`ACCOUNT_ALREADY_REGISTERED`。
  - **今の不具合も直す**：つながっているアカウントの「Threadsとの接続」は、接続し直しのエラーを受け取っても画面に出していなかった（`useCallbackResult({ silent: true })`で読んで、使っていない）。ここにエラーの文を出し、上の3つでは手順も出す（research.md R2）。
- **招待済みで違うアカウントでつながったとき（US3）**：
  - 024の申し込みの記録（`removal_reason = username_mismatch`・`connected_username`）を使う。
  - 「閉じた」を`tester_applications.mismatch_notice_dismissed_at`に持つ（マイグレーション`0023`、足すだけ）。
  - API`GET/POST /api/accounts/:id/connection-notice`で読み書きする。

## 技術コンテキスト（Technical Context）

**言語・バージョン**：TypeScript 6.0（フロントエンド・バックエンドとも）。Node.js 22 LTS。024と同じ。

**主な依存**：024と同じ。新しい依存は足さない。

**ストレージ**：Neon（Postgres 17）。マイグレーション`0023_connection_notice`で`tester_applications`に1列を足すだけ（[data-model.md](./data-model.md)）。

**テスト**：024と同じ構成。
- **API**：Vitest＋ローカルのPostgres。
  - 違うアカウントでつながった知らせ：出す条件（`username_mismatch`・今つながっている名前と一致・閉じていない）、閉じる、オーナーだけ（権限の表）
  - マイグレーション（足すだけ、既定値はNULL）
- **Web**：Vitest＋Testing Library。
  - `ThreadsAccountGuide`：使うべき名前があるとき・ないとき・トグルの開閉・リンクが新しいタブ
  - 3か所の置き場所：接続し直す・招待済み・つなぐ前（招待の管理がOFF）
  - `AccountSwitchSteps`：3つのエラーで出る、ほかのエラーでは出ない、`ACCOUNT_ALREADY_REGISTERED`のリンクが残る
  - つながっているアカウントの「Threadsとの接続」で、エラーが出る（今は出ていない）
  - 違うアカウントでつながった知らせと「閉じる」
  - トークンの貼り付けの画面に案内が出ない
- **E2E**：足さない。

**対象プラットフォーム**：Web＝Cloudflare Pages、API＝Cloudflare Workers。

**プロジェクトの種類**：Webアプリ（`apps/web`・`apps/api`・`packages/shared`のpnpmモノレポ）

**性能の目標**：つながっているアカウントの設定の画面の問い合わせは、知らせを読む1回だけ増える（オーナーで、招待の申し込みの記録があるときだけ意味のある結果を返す）。

**制約**：
- **案内の文と手順は1か所**：`packages/shared`の定数に置き、画面はそれを出すだけにする。
- **案内を出す相手**：オーナーにだけ出す（今の出し分けのまま。FR-010）。
- **つなぐ動きと判定は変えない**：001・010・024の振る舞いを変えない（SC-004）。
- **見た目**：新しい強調の色や形は使わない。注意の枠・トグル・ボタンは今の部品（`Alert`・`Toggle`・`Button`）にそろえる。
- **threads.comのリンク**：`https://www.threads.com/`を、`target="_blank"`と`rel="noreferrer"`で開く。

**規模**：画面の部品2つと、API 2本、1列。

## Constitution Check

*GATE：Phase 0の前に確かめ、Phase 1の後にもう一度確かめた。Constitution 4.4.0。*

| 原則 | 確かめたこと | 結果 |
|---|---|---|
| I. NGワードの一貫性 | 変更なし（投稿に触れない） | 合格 |
| II. 人間承認ゲート | 変更なし | 合格 |
| III. 外部LLM前提 | 変更なし | 合格 |
| IV. 契約／ロール分離 | 接続はオーナーだけ（オーナーがAccountの接続を持つ）。案内もオーナーにだけ出す | 合格 |
| V. 個人運用起点のシンプルさ | 個人運用の画面に足すのは、短い文と閉じたトグルだけ。判定は今の権限の判定（`authorizeAccount`・owner）を通す | 合格 |
| VI. 改善フィードバック | 変更なし | 合格 |
| 技術スタック・運用コスト | 新しい依存・サービスを足さない | 合格 |
| 開発ワークフロー | spec-kitの順、モックを先に見せた。`feature/025-threads-account-guide`→`develop`。マイグレーションは足すだけ | 合格 |

**Phase 1の後の確認**：data-model・contractsに、原則に反するものはない。

## プロジェクトの構成（Project Structure）

### 文書（このfeature）

```text
specs/025-threads-account-guide/
├── spec.md
├── plan.md              # この文書
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/
│   ├── api.md           # Phase 1
│   └── ui-routes.md     # Phase 1
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks で作る
```

### ソースコード（変更する主なところ）

```text
packages/shared/src/
├── threads-account-guide.ts   # 新規：案内の文・手順・threads.comのURL・手順を出すエラーの一覧
└── schemas.ts                 # connection-notice の応答

apps/api/
├── drizzle/0023_connection_notice.sql
├── src/db/schema.ts                              # tester_applications.mismatch_notice_dismissed_at
├── src/services/tester-application-service.ts    # connectionNotice・dismissConnectionNotice
├── src/routes/tester-applications.ts             # GET/POST /api/accounts/:id/connection-notice
└── test/                                         # 知らせ・権限の表・マイグレーション

apps/web/src/
├── components/connect/ThreadsAccountGuide.tsx    # 新規：押す前の案内（US1）
├── components/connect/AccountSwitchSteps.tsx     # 新規：違うアカウントで戻ったときの手順（US2）
├── components/connect/ConnectionNotice.tsx       # 新規：違うアカウントでつながった知らせ（US3）
├── components/connect/ConnectMethods.tsx         # 案内と、戻ったときの手順
├── components/connect/TesterApplicationPanel.tsx # 招待済みの案内
├── components/connect/ReconnectDialog.tsx        # 接続し直しの案内
└── pages/account-settings.tsx                    # つながっているアカウントのエラーの表示（R2）と知らせ
```

**構成の判断**：
- 文と手順は共有の定数にまとめ、3つの部品はそれを並べるだけにする。
- 知らせの読み書きは、024の申し込みのサービスに置く（記録が申し込みの行にあるため）。

## 複雑さの記録（Complexity Tracking）

Constitutionの違反はないので、記録はない。
