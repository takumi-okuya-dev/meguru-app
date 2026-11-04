# 実装計画（Implementation Plan）：機能のまとまりごとのON/OFF

**ブランチ**：`feature/019-feature-switches` | **日付**：2026-11-04 | **仕様**：[spec.md](./spec.md) | **UI全体設計**：[docs/ui-design.md](../../docs/ui-design.md)

**入力**：`specs/019-feature-switches/spec.md`の機能仕様（Clarifications 2026-11-04を含む）、Constitution 4.2.0

## 概要（Summary）

運営者が、人ごとと、組織（グループ）ごとに「自動投稿」「戦略」「チーム」をON/OFFできるようにする。どちらかでOFFなら使えない。プランの中身と料金は決めず、あとで「ONにする組み合わせ」として決める。初めは全員すべてON。2026-11-04 に、まとまりを自動投稿・戦略・チームに見直し、グループごとの設定と本番でのグループを足した。

- **持ち方**：OFFのまとまりだけを行で持つ（人は`feature_disables`、グループは`group_feature_disables`）。行がなければON（research.md R2）。
- **判定**：使えないまとまり＝人のOFF ∪ 閉じていないグループのOFF を、SQLの条件1つ（`disabledFeaturesSql`）にまとめる（R10）。`authorizeAccount`に`opts.feature`を足し、同じ問い合わせでオーナーと見る人の使えないまとまりを読む。OFFなら`403 FEATURE_DISABLED`。チーム経由の関わりは、オーナーと見る人の両方で`team`が使えるときだけ（R1）。
- **プロンプト**：戦略が使えなければ課題・宣伝内容・参考投稿を渡さない。組み立て（共有の関数）は変えない（R4）。
- **定期処理**：自動投稿の時刻の処理・公開・反応の取り込みで、オーナーの`autopost`が使えないAccountを飛ばす（R12）。
- **画面**：サイドバーを「ホーム → 自動投稿 → 戦略 → チーム」の見出しに並べ替え、区分ごと出し分ける。直接開いたら「この機能は今は使えません」（R6）。
- **運営者**：`OPERATOR_CLERK_USER_IDS`を、招待制に関わらず運営者の判定に使う。設定の「運営 › 使える機能」と「運営 › グループ」（016を本番でも使う。グループに「使える機能」を足す）。本番では、グループは機能の設定にだけ使う（R5・R11）。

## 技術コンテキスト（Technical Context）

**言語・バージョン**：TypeScript 6.0（フロントエンド・バックエンドとも）。Node.js 22 LTS。018と同じ。

**主な依存**：018と同じ。新しい依存は足さない。

**ストレージ**：Neon（Postgres 17）。[data-model.md](./data-model.md)のとおり、マイグレーション`0018_feature_switches`の1本（表を3つ足すだけ）。

**テスト**：018と同じ構成。
- API：Vitest＋`@cloudflare/vitest-pool-workers`＋ローカルのPostgres。確かめるのは次のとおり。
  - 判定：使えないまとまりのAPIが`403 FEATURE_DISABLED`、まとまりに含めないAPI（ホーム・設定）は通る。関わりのないAccountは404が先。オーナーの設定に従う。チーム経由の関わりは、オーナーか見る人のチームが使えなければ404。グループでOFFなら全員が使えない、外れると戻る。決済の読むだけと重なったときの順
  - プロンプト：戦略が使えないと課題・宣伝内容・参考投稿の節がなく`materials`が`null`。設定のない人では前と同じ文（SC-003）
  - 定期処理：自動投稿が使えないAccountは、時刻の処理・公開・反応の取り込みをしない。ONに戻すと続きから
  - チーム：作る・入る・チームの画面が`FEATURE_DISABLED`、`/api/me`の`teams`と担当のAccountが消える。ONで元どおり
  - グループ：招待制がOFFでも参加・管理できる、料金なしは付かない、グループの使える機能の保存と記録
  - 運営者のAPI：運営者でない（`OPERATOR_ONLY`）、招待制がOFFでも使える、探す（完全一致・グループ）、保存（変わった分だけ記録）、すべてONに戻す、一覧の並び、ONに戻すと内容がそのまま（SC-004）
  - 運営者の料金なしが、招待制がOFFの環境で付かないこと（016の振る舞いを変えない）
  - マイグレーション（足すだけ・退会・グループの削除で行と記録が消える）
- Web：Vitest＋Testing Library。サイドバー（並び・区分ごと消える）、ホーム、投稿をつくる、このアカウントの設定、チームで見せてもらっている画面、`FeatureUnavailable`、運営者の画面（探す・切り替え・グループでOFF・一覧・すべてONに戻す・記録のトグル）、グループの使える機能、招待の画面（本番の文）、設定の「運営」の区分の出し分け
- E2E：足さない（既定はすべてONなので、今のE2Eがそのまま通ることで確かめる）

**対象プラットフォーム**：Web＝Cloudflare Pages、API＝Cloudflare Workers（無料プラン）。Cronは足さない。

**プロジェクトの種類**：Webアプリ（`apps/web`・`apps/api`・`packages/shared`のpnpmモノレポ）

**性能の目標**：`authorizeAccount`の問い合わせは1回のまま（オーナーのOFFを相関サブクエリで同じSELECTに足す）。

**制約**：
- 判定は1か所（Constitution原則V）。OFFの判定は`authorizeAccount`の外に書かない。画面の出し分けは見た目だけで、守りはAPI
- 設定のない人で、001〜018の振る舞い・プロンプトの文・E2Eが変わらない（SC-003）
- 書いた内容・集めたデータは、OFFにしても消さない（FR-010）
- NGワードのチェックと承認してから投稿する流れは、まとまりを見ない（FR-015）
- 定数：まとまりは`FEATURES`の3つ、記録の表示50件

**規模**：運営者は1人。OFFにする人は数人〜数十人。

## Constitution Check

*GATE：Phase 0の前に確かめ、Phase 1の後にもう一度確かめた。Constitution 4.2.0。*

| 原則 | 確かめたこと | 結果 |
|---|---|---|
| I. NGワードの一貫性 | 戦略が使えないときだけ、戦略をプロンプトに入れない（4.2.0の例外）。NGワードのチェックは飛ばさない（自動投稿が使えなければ投稿自体をしない。FR-015） | 合格 |
| II.人間承認ゲート | 承認していない案を投稿する経路は作らない。自動投稿が使えないAccountは、承認済みの案も投稿しない | 合格 |
| III.外部LLM前提 | 変更なし | 合格 |
| IV.契約／ロール分離 | 機能の設定は、契約（`subscriptions`）ともロール（`Permission`）とも別の表・別の判定。決済の制限をゆるめない（`fullAccessSql` に混ぜない）。人とグループのどちらかでOFFなら使えない。チームではオーナーの設定に従う（チームのまとまりは両方） | 合格 |
| V.個人運用起点のシンプルさ | 判定は`authorizeAccount`の1か所に足す。個人運用の画面には何も足さない（運営者の区分は運営者にだけ出る） | 合格 |
| VI.改善フィードバック | 変更なし。パフォーマンスは自動投稿のまとまりに入り、自動投稿が使えなければプロンプト自体を作らないので、作るプロンプトには必ず反映される | 合格 |
| 技術スタック・運用コスト | 新しい依存・サービス・Cronを足さない | 合格 |
| 開発ワークフロー | spec-kitの順。`feature/019-feature-switches`→`develop`。マイグレーションは足すだけ。環境の違いは設定に置く（`OPERATOR_CLERK_USER_IDS`の意味の変更は docs/environment-switches.md を同じPRで直す） | 合格 |

Phase 1の後の確認：data-model・contractsに、原則に反するものはない。Constitutionの改定（4.2.0）は、このfeatureのPRに入れる。

## プロジェクトの構成（Project Structure）

### 文書（このfeature）

```text
specs/019-feature-switches/
├── spec.md
├── plan.md              # この文書
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/
│   ├── api.md           # Phase 1
│   └── ui-routes.md     # Phase 1
├── checklists/
│   └── requirements.md
└── tasks.md             # /speckit-tasks で作る
```

### ソースコード（変更する主なところ）

```text
packages/shared/src/
├── features.ts        # 新規：FEATURES（autopost・strategy・team）・画面の名前・記録の種類
├── schemas.ts         # me の operator・features、access の features、prompt の materials を null 可に、招待の testVersion、運営者のAPIの入出力
└── errors.ts          # FEATURE_DISABLED・USER_NOT_FOUND

apps/api/
├── drizzle/0018_feature_switches.sql
├── src/db/schema.ts                         # feature_disables・group_feature_disables・feature_setting_events
├── src/middleware/auth.ts                   # user.operator（招待制に関わらない）・user.features
├── src/services/feature-sql.ts              # 新規：disabledFeaturesSql・featureOnSql（人 ∪ グループ）
├── src/services/access.ts                   # opts.feature、AccountAccess.features、チーム経由の関わりの team、authorizeTeamMember の team
├── src/services/feature-service.ts          # 新規：探す・保存・すべてONに戻す・一覧・記録、グループの設定
├── src/services/prompt-service.ts           # getPrompt に features
├── src/services/auto-post-runner.ts・metrics-runner.ts・publish-claim.ts・publish-executor.ts  # autopost が使えないAccountを飛ばす
├── src/services/test-group-service.ts       # 本番でも参加・管理できる。料金なしは招待制がONのときだけ。グループの設定
├── src/routes/operator-features.ts          # 新規：運営者の機能の設定のAPI
├── src/routes/operator-test-groups.ts・test-invites.ts  # 招待制がOFFでも使える、グループの使える機能
├── src/routes/（守るAPIの各ファイル）         # opts.feature（contracts/api.md「守るAPI」）
├── src/routes/teams.ts・invites.ts          # チームを作る・入るで user.features を見る
├── src/routes/account-team.ts・me.ts         # features、チームが使えない人の teams・accounts
└── test/                                    # 019のテスト、016のOFFの環境のテストの書き換え

apps/web/src/
├── components/layout/Sidebar.tsx            # 見出しの並べ替えと区分ごとの出し分け
├── components/FeatureUnavailable.tsx        # 新規：使えない画面と RequireFeature
├── components/ApiErrorScreen.tsx            # FEATURE_DISABLED なら使えない画面
├── pages/account-home.tsx                   # 次にやること・カード・次の投稿の出し分け
├── pages/create.tsx・components/stock/PromptCard.tsx・components/create/CreateSteps.tsx  # 戦略の出し分け
├── pages/account-settings.tsx               # 自動投稿・チームの区分の出し分け
├── pages/team-shared-account.tsx            # タブの出し分け
├── pages/settings/features.tsx              # 新規：運営者の「使える機能」
├── pages/settings/test-groups.tsx           # 「グループ」に改名、使える機能のスイッチ、テスト版だけの文
├── pages/test-invite.tsx                    # 本番ではテスト版の注意を出さない
├── pages/settings/sections.ts・settings-layout.tsx  # 「運営」の区分（me.operator）
└── router.tsx                               # /settings/features、RequireFeature

docs/environment-switches.md・staging-setup-record.md  # OPERATOR_CLERK_USER_IDS・TEST_GROUPS_ENABLED の意味
docs/ui-design.md・user-guide.md・architecture.md・next-features.md
.specify/memory/constitution.md              # 4.2.0
```

**構成の判断**：機能の設定の読み書きは`feature-service.ts`だけに置く（016の`test-group-service.ts`と同じ分け方）。OFFの判定は`authorizeAccount`の中だけ。画面は`/access`の`features`を見るだけで、自分では判定しない。

## 複雑さの記録（Complexity Tracking）

Constitutionの違反はないので、記録はない（4.2.0の改定で、原則I・IV・V・VIの例外を明文化した）。
