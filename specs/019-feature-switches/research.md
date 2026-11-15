# Research：機能のまとまりごとのON/OFF

**Feature**：[spec.md](./spec.md) | **計画**：[plan.md](./plan.md) | **日付**：2026-11-04

技術コンテキストに「要確認」は残っていない。以下は、今のコードを読んで決めたこと。2026-11-04 の見直し（まとまりを自動投稿・戦略・チームに、グループごとの設定を足す）を反映した。

## R1. 判定を足す場所

- **決定**：`authorizeAccount`（`apps/api/src/services/access.ts`）に、5つ目の引数 `opts.feature`（`"autopost" | "strategy" | "team"`）を足す。同じ1回の問い合わせで、オーナーと見る人の使えないまとまりを、相関サブクエリ（`disabledFeaturesSql`、R10）で配列として読む。
  - 関わりを決めたあと（404を先に返し、Accountの有無を漏らさない）、ロール・決済の判定の前に、`opts.feature` がオーナーの使えないまとまりなら `403 FEATURE_DISABLED`（details に `[feature]`）。
  - 関わりが担当・見せてもらう（チーム経由）なら、オーナーか見る人のどちらかで `team` が使えなければ `404 ACCOUNT_NOT_FOUND`（チームを抜けたのと同じに見せる。FR-009）。
  - 結果の `AccountAccess` に `features`（オーナーの使えるまとまりの集合）を足す。
  - チームの判定（`authorizeTeamMember`）も、同じサブクエリで見る人の `team` を見て、使えなければ `403 FEATURE_DISABLED`。
- **理由**：Constitution原則V（判定は1か所）。オーナーの契約を読んでいるのと同じ結合に足すだけで、問い合わせは増えない。
- **ほかの案**：ルートごとのミドルウェア（判定が2か所になる）、`Permission` にまとまりを足す（ロールと機能を混ぜる）。

## R2. OFFの持ち方

- **決定**：OFFのまとまりだけを行として持つ（人は `feature_disables`、グループは `group_feature_disables`）。行がなければON。
- **理由**：FR-003（設定がなければすべてON）がそのまま表になる。既存の利用者に行を作るマイグレーションが要らない。「どちらかがOFFならOFF」（FR-018）は、2つの表の和をとるだけで決まる。
- **ほかの案**：ON/OFFの両方を行で持つ（「個人の設定を優先」にするなら要るが、2026-11-04 に「どちらかがOFFならOFF」と決めたので要らない）。

## R3. 守るAPIとまとまり

contracts/api.md「守るAPI」の表のとおり。決めたこと：
- `strategy.ts` の `/profile-status` は守らない。ホームの準備の一覧と「次にやること」が使う数だけで、中身は返さない。守ると、戦略が使えない人のホームが開けなくなる。
- 考えるヒント・深掘り・壁打ち・全体の整理のプロンプトは画面の中で作るので、APIでは止まらない。課題の画面ごと「この機能は今は使えません」に替わり、課題の読み込みも拒まれるので使えない。参考投稿のAI解説は `research.ts` を通るので止まる。
- `autopost` は、投稿ストック（`post-drafts.ts`）・プロンプト・パフォーマンス・投稿のスケジュール・投稿ルール（NGワード・CORE RULES）・自動投稿の状態を守る。どれも「投稿をつくって出す」流れの中だけで使う。
- `team` は、チームのAPI（`teams.ts`・`invites.ts` の参加）・アカウントのチームの区分（`account-team.ts` の `/team`）・操作の記録（`activity.ts`）を守る。`/access` は守らない（画面の出し分けに使う）。

## R4. プロンプトから外す方法

- **決定**：`getPrompt(db, account, count, features)` にする。`strategy` が使えなければ、課題・宣伝内容・参考投稿を読まず、`buildPrompt` に空の課題（`emptyStrategyValues()`）・空の宣伝・空の参考投稿を渡す。空の節は `buildPrompt` が入れない。`materials` は `null`。
- **理由**：プロンプトの組み立て（`packages/shared/src/prompt.ts`）を変えずに済む。
- パフォーマンスは `autopost` に入ったので、低調な投稿を外す扱いはなくした（`autopost` が使えなければプロンプト自体を作らない。原則VIの例外も外した）。

## R5. 運営者の判定

- **決定**：認証のミドルウェアで、`OPERATOR_CLERK_USER_IDS` に入っているかを、`TEST_GROUPS_ENABLED` にかかわらず `user.operator` に載せる。016の `testAccess.operator`（テスト版に入れる・料金なし）は今のまま、`TEST_GROUPS_ENABLED` がONのときだけ。`/api/me` に `operator` を足す。
- **理由**：機能の設定とグループの管理は本番でも使う。運営者の料金なしはテスト版だけ。
- 016の運営者のAPI（`/api/operator/test-groups*`）の守りも、`testAccess.operator` から `user.operator` に替え、招待制がOFFでも使えるようにする（R11）。

## R6. 画面での出し分け

- **決定**：`GET /api/accounts/:id/access` に `features`（オーナーの使えるまとまり）、`GET /api/me` に `features`（自分の使えるまとまり）を足す。サイドバーの「自動投稿」「戦略」は `access.features`、「チーム」は `me.features`（と `me.teams`）で出し分ける。直接開いたときは、ルートの `RequireFeature` と、APIの `FEATURE_DISABLED` を受けた `ApiErrorScreen` が `FeatureUnavailable` に替える。
- **理由**：画面の出し分けは、すでに `/access`（関わり・権限・読むだけ）で行っている。守りはAPIにある。

## R7. 記録

- **決定**：`feature_setting_events` に、変わったまとまりごとに1行。人かグループの一方を持つ（CHECK）。同じ値への保存は記録しない。運営者の画面の「最近の変更」に新しい順で50件。
- 退会した人・消えたグループの行は消す（cascade）。操作した運営者が退会したときは、名前を残して `actor_user_id` を NULL にする（016と同じ）。

## R8. 運営者のAPIの形

contracts/api.md「運営者のAPI」のとおり。メールアドレスは完全一致で探す（部分一致は、運営者でも利用者のメールアドレスを広く見せることになるので避ける）。運営者は今1人なので、版の照合は置かない。同じ人の保存は、利用者の行に鍵をかけて順にする（記録が実際の変化と食い違わないように）。

## R9. 画面の形

モック（https://claude.ai/artifact/XbnRAoVcfS7HCprqHfrrqi 、2026-11-04 OK）のとおり。設定の「運営」の区分に「使える機能」と「グループ」。グループの詳しい画面に「使える機能」。

## R10. 使えないまとまりのSQL（人とグループ）

- **決定**：`apps/api/src/services/feature-sql.ts` に `disabledFeaturesSql(userId)`（使えないまとまりの配列）と `featureOnSql(userId, feature)`（使えるかの真偽）を置く。どちらも「人の設定のOFF ∪ 入っている閉じていないグループの設定のOFF」（data-model.md「判定」）。`authorizeAccount`・`authorizeTeamMember`・認証のミドルウェア・定期処理は、すべてこれを使う。
- **理由**：判定の条件を1か所に置く（016の `testAccessSql` と同じ考え方）。`access.ts` と `feature-service.ts` の間で読み込みが回らないよう、別のファイルにする。

## R11. グループを本番でも使う（016を変える）

- **決定**：
  - 招待の確認・参加（`test-invites.ts`）と運営者のグループのAPI（`operator-test-groups.ts`）から「招待制がOFFなら使えない」守りを外す。
  - 参加したときに料金なしの印を付けるのは、招待制がONのときだけ（`joinTestGroup` に決済のモードを渡す）。外す・閉じるときに印を戻すのは `granted_billing_exempt` のとおりなので、そのまま。
  - 「テスト版に入れる人」の判定（`testAccessSql`）は、今までどおり招待制がONのときだけ。
  - 招待の確認の応答に `testVersion` を足し、画面はOFFならテスト版のための注意を出さない。
  - 設定の項目名は「グループ」にそろえる。
- **理由**：ユーザーの決定（spec.md Clarifications：本番では機能の設定だけ）。テスト版の振る舞いは変えない。

## R12. 定期処理で自動投稿を止める

- **決定**：自動投稿の時刻の処理（`auto-post-runner.ts` の予定の読み込み）と反応の取り込み（`metrics-runner.ts` の候補）に `featureOnSql(owner, "autopost")` を足す。公開の直前の確かめ（`publish-claim.ts`・`publish-executor.ts`）でも、オーナーの `autopost` が使えなければ新しく公開しない（理由は今ある `auto_post_off`。公開の結果がわからない途中だけは確かめる）。
- **理由**：FR-008。決済で読むだけになったときと同じ場所で止める（013 research.md R8）。`fullAccessSql`（決済）には混ぜない（契約と機能の設定を分ける。原則IV）。

## R13. チームが使えない人

- **決定**：
  - `/api/me` の `teams` を空にし、`accounts` から担当しているAccountを外す（`features` に `team` がないとき）。
  - `authorizeTeamMember` で見る人の `team` を見る（R1）。チームを作る・招待から入るは、ルートで `user.features`（認証のミドルウェアが読む）を見て `403 FEATURE_DISABLED`。
  - オーナーの `team` が使えないAccountは、チーム経由の関わりを `404`（R1）。チームの行・担当・見せる設定は消さない。
- **理由**：FR-009。チームの記録を消さないので、ONに戻すと元どおり。
