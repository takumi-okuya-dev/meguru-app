# 実装計画（Implementation Plan）：時間差のメンション

**ブランチ**：`feature/023-delayed-mention` | **日付**：2026-11-05 | **仕様**：[spec.md](./spec.md) | **UI全体設計**：[docs/ui-design.md](../../docs/ui-design.md) | **モック**：https://claude.ai/artifact/Wgz1WNWYUDdUXwn1GgS6GP

**入力**：`specs/023-delayed-mention/spec.md` の機能仕様（Clarifications 2026-11-05を含む）、Constitution 4.3.0

## 概要（Summary）

拡散してほしい投稿に、投稿から時間をおいて、自分の投稿への返信で @ユーザー名 を付ける。

- 承認のときに、下書きのカードの中で1回押して付ける。投稿済みの投稿にもあとから付けられる。
- **返信の出し方**：005の自動投稿の定期処理（5分ごと）に「メンションの返信の段階」を足す。投稿と同じ2段階（返信先を指定したコンテナー → 公開）で出す。二重に出さない仕組みも005と同じにする（research.md R2〜R4、contracts/mention-job.md）。
- **守り**：
  - 返信の文も、承認のときと出す直前の2回、NGワードを確かめる（原則I）。
  - 返信の文も、下書きと一緒に承認してから出す。投稿済みの投稿では「返信する」が承認になる（原則II）。
  - 同じ人へのメンションは24時間に1回まで（R5・R6）。
- **権限**：返信の権限（`threads_manage_replies`）は、Metaの説明が食い違っている。トークンの権限の一覧と、出したときのエラーの両方で分かるようにする。テスト版で確かめる（R1）。
- **データ**：
  - 新しい表3つ：`mention_settings`（ひとこと・時間差）・`mention_people`（メンションする人・いつも付ける）・`post_mentions`（下書きごとの返信）
  - 新しい列1つ：`accounts.replies_denied_at`
  - マイグレーション `0021_delayed_mention`（data-model.md）
- **画面**：
  - 投稿ストックのカードに `MentionPanel`（ポップアップなし）
  - 選んだときの操作に「メンションを付ける」
  - 投稿済みのカードに状態と「返信する」
  - このアカウントの設定に「時間差のメンション」（contracts/ui-routes.md）

## 技術コンテキスト（Technical Context）

**言語・バージョン**：TypeScript 6.0（フロントエンド・バックエンドとも）。Node.js 22 LTS。022と同じ。

**主な依存**：022と同じ。新しい依存は足さない。

**ストレージ**：Neon（Postgres 17）。マイグレーション `0021_delayed_mention` の1本（足すだけ）。

**テスト**：022と同じ構成（quickstart.md）。
- 定期処理は、005のテストの Threads のクライアントの差し替え（`helpers/auto-post.ts`）を使う。
- E2E は足さない。

**対象プラットフォーム**：Web＝Cloudflare Pages、API＝Cloudflare Workers（無料プラン）。Cronは足さない（今の5分ごとの処理に段階を足す）。

**プロジェクトの種類**：Webアプリ（`apps/web`・`apps/api`・`packages/shared`のpnpmモノレポ）

**性能の目標**：
- 段階の問い合わせは、対象を読むのに1回、行ごとの書き込みに1〜2回。
- 1回の処理で出す返信は10件まで（Workersの時間に収める）。
- 下書きの一覧は、メンションを結合して読むだけで、問い合わせの数を増やさない。

**制約**：
- 承認していない返信の文、NGワードを含む返信の文を出さない（SC-002）
- 同じ投稿に返信を2回出さない（SC-003）
- 同じ人を24時間に2回以上メンションしない（SC-004）
- 投稿の流れ（005の公開）の結果に影響させない（段階の失敗はログだけ）
- 解析（022）の返信率から、自分の返信を除く（R7）

**規模**：Accountごとにメンションする人20人まで、1つの返信で5人まで。

## Constitution Check

*GATE：Phase 0の前に確かめ、Phase 1の後にもう一度確かめた。Constitution 4.3.0。*

| 原則 | 確かめたこと | 結果 |
|---|---|---|
| I. NGワードの一貫性 | 返信の文も、承認のとき（`reviewDrafts`・「返信する」）と出す直前（`runMentionStage`）に、AccountのNGワードで確かめる。ひとことの保存でも確かめる。抜け道を作らない | 合格 |
| II.人間承認ゲート | 返信の文は、下書きと一緒に承認しないと出ない。承認のあとに直すと要確認に戻る。投稿済みの投稿は、人が「返信する」を押したときだけ出す | 合格 |
| III.外部LLM前提 | 返信の文は、決まったひとことと @ユーザー名 の組み合わせ。AIは呼ばない | 合格 |
| IV.契約／ロール分離 | 判定は今の `view`・`review`・`settings` と機能のまとまり「自動投稿」。新しいロールや区分を作らない | 合格 |
| V.個人運用起点のシンプルさ | 判定は `authorizeAccount` の1か所。見せてもらっている人には出さない。新しいCronを足さず、今の定期処理に段階を足す | 合格 |
| VI.改善フィードバック | 変えない（低調の投稿・却下ログの扱いはそのまま） | 合格 |
| 技術スタック・運用コスト | 新しい依存・サービス・Cronを足さない。Threadsの呼び出しは、返信1件につき2〜3回 | 合格 |
| 開発ワークフロー | spec-kitの順。`feature/023-delayed-mention`→`develop`。マイグレーションは足すだけ。環境の違いはない | 合格 |

Phase 1の後の確認：data-model・contractsに、原則に反するものはない。Constitutionの改定は要らない。

## プロジェクトの構成（Project Structure）

### 文書（このfeature）

```text
specs/023-delayed-mention/
├── spec.md
├── plan.md              # この文書
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/
│   ├── api.md           # Phase 1
│   ├── mention-job.md   # Phase 1（定期処理の段階）
│   └── ui-routes.md     # Phase 1
├── checklists/
│   └── requirements.md
└── tasks.md             # /speckit-tasks で作る
```

### ソースコード（変更する主なところ）

```text
packages/shared/src/
├── mention.ts           # 新規：normalizeMentionUsername・buildMentionText・mentionDueAt・MENTION_FAILURE_LABELS
├── limits.ts            # MENTION_* の定数
└── schemas.ts           # メンションの設定・人・付ける・まとめて付けるの入出力、PostDraft.mention、PromptSummary は変えない

apps/api/
├── drizzle/0021_delayed_mention.sql
├── src/db/schema.ts                     # mention_settings・mention_people・post_mentions・accounts.replies_denied_at
├── src/lib/threads-client.ts            # createTextContainer に replyToId
├── src/services/mention-service.ts      # 新規：設定・人・付ける・外す・やめる・選べない人
├── src/services/mention-runner.ts       # 新規：runMentionStage（contracts/mention-job.md）
├── src/services/auto-post-runner.ts     # 7. の段階と関所の候補
├── src/services/review-service.ts       # 承認で返信の文も確かめる・却下で消す
├── src/services/draft-service.ts        # 下書きの応答に mention・本文の編集と同じ版の扱い
├── src/services/token-connect.ts・account-service.ts  # replies_denied_at・no_replies_permission
├── src/services/analysis-service.ts     # 返信の数から自分の返信を引く（R7）
├── src/routes/mention.ts                # 新規
├── src/app.ts
└── test/integration/mention*.test.ts・migration/migration-0021.test.ts

apps/web/src/
├── components/stock/MentionPanel.tsx    # 新規
├── components/stock/DraftCard.tsx・PublishedCard.tsx・SelectionBar.tsx
├── components/settings/MentionSettingsSection.tsx  # 新規
├── pages/account-settings.tsx・guide-threads-token.tsx
└── lib/api-client.ts・query.ts

docs/ui-design.md・user-guide.md・architecture.md・external-services-setup.md（トークンの権限）・next-features.md
```

**構成の判断**：
- 返信を出す処理は、`publish-executor.ts`（下書きの公開）に混ぜず、`mention-runner.ts` に分ける。状態と失敗の扱いが違うので、005の複雑な公開の処理を変えずに済む。
- Threadsのクライアントだけは共有し、`createTextContainer` に返信先を足す。

## 複雑さの記録（Complexity Tracking）

Constitutionの違反はないので、記録はない。
