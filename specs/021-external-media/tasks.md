---

description: "Task list for feature 021 external media"
---

# Tasks:外部媒体展開

**Input**: [spec.md](./spec.md)、[plan.md](./plan.md)、[research.md](./research.md)、[data-model.md](./data-model.md)、[contracts/api.md](./contracts/api.md)、[contracts/media.md](./contracts/media.md)、[contracts/ui-routes.md](./contracts/ui-routes.md)、[quickstart.md](./quickstart.md)

**Tests**: 001〜020と同じく、テストを先に書いて失敗を確かめてから実装する（TDD）。特に次を自動テストで確かめる。
- SC-003：媒体のルールで禁止の行（外部のURL・連絡先・紹介の特典）が、その媒体の掲載内容に残らない（こくちーずプロを除く）
- SC-004：掲載内容を直しても、宣伝内容が1文字も変わらない
- SC-005：戦略が使えない人・関わりのない人・見せてもらっている人に、掲載内容と状況が返らない
- イベントの情報がない宣伝内容で、宣伝投稿のプロンプトの文が変わらない

**Organization**: spec.md の User Story ごと。媒体の決まりは、媒体ごとにタスクを分ける（contracts/media.md の節ごと）。MVPはUS1・US2（P1）。

## Format: `[ID] [P?] [Story] Description`

- **[P]**：別ファイルで、未完了のタスクに依存せず並行できる。
- **[Story]**：[US1]〜[US4]はspec.mdのUser Storyに対応する。
- 媒体の決まりのテストは `packages/shared/test/media/<媒体>.test.ts` に書く。材料は `packages/shared/test/media/fixtures.ts` の「IT交流会」（港で読んだもの。開催日時 2026-11-25 20:00〜22:00・会場「バー SHITEN」・東京都台東区上野4-1-8 3階・御徒町駅 徒歩3分・定員25・参加費5,000円・キャンセルの決まり・本文に地図のURL／LINEの案内／紹介割引／「完全紹介・会員制」／「人脈づくり」）と、無料・オンライン・終了なしの変わり種。
- APIのテストは `apps/api/test/integration/external-media.test.ts`。チームの関わりは `apps/api/test/helpers/team.ts`、機能のOFFは `apps/api/test/helpers/features.ts` を使う。
- Webのテストは `apps/web/test/external-media.test.tsx`（一覧・入力・作業）と `apps/web/test/promotions.test.tsx`（イベントの情報）。
- 画面はモック（https://claude.ai/artifact/78VBSVeE19t3EqqvjckMRZ ）のとおり。使いながらシンプルにする（spec Clarifications）。印の色は今の色（`destructive`・`warning`・`success`・`muted`）だけを使う。

## Phase 1: Setup

- [X] T001 `packages/shared/src/media/types.ts` を作る：`MEDIA = ["kokuchpro", "peatix", "tsunagate", "jmty", "youtrust"] as const`・`MEDIA_LABELS`（こくちーずプロ・Peatix・つなげーと・ジモティー・YOUTRUST）・`LISTING_STATUSES = ["not_started", "drafting", "posted", "stopped"]` と表示名（未着手・作成中・掲載済み・掲載停止）・`MediaField`（`key`・`label`・`step`・`kind`（`text`・`textarea`・`select`・`datetime`・`number`）・`options`・`required`・`immutable`・`max`・`help`・`defaultable`）・`MediaDefinition`（`steps`・`fields`・`workSteps`・`image`・`build`・`rules`・`fixRules`）・`ListingCheck`（`level: "red" | "yellow" | "info"`・`field?`・`message`）・`ListingFix`（`field`・`excerpt`（40字まで）・`reason`）・`ListingSource`（宣伝内容・イベントの情報・既定値）。`packages/shared/src/index.ts` から出す。
- [X] T002 [P] `packages/shared/src/schemas.ts` に `promotionEventSchema` を足す（data-model.md の表のとおり：`startAt` は `YYYY-MM-DDTHH:mm` で必須、`endAt` は同じ形で `startAt` 以後、`format` は `"venue" | "online"`、`venueName` 100文字・`prefecture` は47都道府県・`address` 200文字・`building` 100文字・`station` 60文字・`capacity` 1〜100000の整数・`feeYen` 0〜1000000の整数・`feeNote` 500文字・`cancelPolicy` 1000文字・`audience` 300文字・`organizer` 100文字、どれもNULL可）。`promotionInputSchema` に `event: promotionEventSchema.nullable().optional()`、宣伝内容の応答に `event` を足す。外部媒体展開のAPIの入出力（contracts/api.md）を足す。`packages/shared/test/media-schemas.test.ts` で形を確かめる。

## Phase 2: Foundational

### Tests（先に書いて失敗を確かめる）

- [X] T003 [P] `apps/api/test/migration/migration-0019.test.ts`：`promotions.event`（jsonb、NULL可）、`promotion_listings`（主キー `(promotion_id, media)`、`media` と `status` と `image_style` の CHECK、`posted_url` の CHECK、宣伝内容の削除で消える）、`media_defaults`（主キー `(account_id, media)`、Accountの削除で消える）。
- [X] T004 [P] `apps/api/test/integration/promotions.test.ts` に足す：`event` の保存・応答・省略で今のまま・`null` で消える・形の違い（終了が開始より前・都道府県が違う）で `VALIDATION_FAILED`。
- [X] T005 [P] `packages/shared/test/prompt.test.ts` と `apps/api/test/integration/prompt.test.ts` に足す：宣伝内容に `event` があるときだけ「日時・場所（最寄り駅）・参加費・定員」の1行が入り、ないときは今と同じ文（research.md R9）。
- [X] T006 [P] `packages/shared/test/media/common.test.ts`：日時の分け方（`YYYY-MM-DD`・`HH:mm`・`YYYY-MM-DD HH:mm`）、行の直し（URL・地図のURL・LINE・メールアドレス・電話番号・口座・PayPayの行が外れ、`{ field, excerpt（40字まで）, reason }` が残る）、文字数の数え方（絵文字を1文字）。
- [X] T007 [P] `apps/api/test/integration/external-media.test.ts` に守りを書く（contracts/api.md「守り」）：オーナーと担当の人は読める、見せてもらっている人は `403 ROLE_FORBIDDEN`、関わりのない人は `404 ACCOUNT_NOT_FOUND`、戦略がOFFは `403 FEATURE_DISABLED`、決済で読むだけは書き込みが `BILLING_REQUIRED`、ほかのAccountの宣伝内容は `404 ITEM_NOT_FOUND`、知らない媒体は `404 ITEM_NOT_FOUND`。

### Implementation

- [X] T008 `apps/api/src/db/schema.ts` に `promotions.event`・`promotionListings`・`mediaDefaults` を足し（data-model.md）、`apps/api/drizzle/0019_external_media.sql` と `drizzle/meta` を作る（T003を通す）。
- [X] T009 `apps/api/src/routes/promotions.ts` と、宣伝内容の保存・応答で `event` を扱う（T004を通す）。
- [X] T010 `packages/shared/src/prompt.ts` の `PromptPromotion` に `event` を足し、`promotionLine` に1行を足す。`apps/api/src/services/prompt-service.ts` の `toPromptPromotion` で渡す（T005を通す）。
- [X] T011 `packages/shared/src/media/common.ts` に共通の関数（日時の分け方・行の直し・文字数・共通のルール）を作る（T006を通す）。
- [X] T012 `apps/api/src/services/external-media.ts` と `apps/api/src/routes/external-media.ts` の枠を作り、`authorizeAccount(..., "view" | "content", { feature: "strategy" })` を通す。`apps/api/src/app.ts` に足す。`apps/api/test/integration/permissions-matrix.test.ts` の表に新しいルートを足す（T007を通す）。

**Checkpoint**: 宣伝内容にイベントの情報を入れられ、プロンプトにも入る。外部媒体展開のAPIの守りが通る。

## Phase 3: User Story 1 - 媒体の登録画面の順に、コピーして貼るだけで載せられる（P1）🎯 MVP

### Tests（媒体ごと。先に書いて失敗を確かめる）

各テストで確かめる：欄の並び・区切り・必須・固・上限・既定値にできる欄が contracts/media.md の表と同じ／IT交流会の材料から各欄の値と、選ぶ欄の値と理由が決まる／タイトルの形と候補／作業のSTEPの数と見出し・最初と最後のSTEP／参加費の金額がない（`feeYen` が空）と金額の欄は空・住所の欄が空のときの扱い（spec Edge Cases）。

- [X] T013 [P] [US1] `packages/shared/test/media/kokuchpro.test.ts`：①〜⑦の欄、オフライン・有料・人脈／交流会・ITエンジニア交流会、イベント名100・概要80の上限、STEP 15（最初は「登録の最初の画面で、2つを選ぶ」、最後は「ルールの確認 → 最終確認 → 公開」と「1日に登録できるのは3件まで」）。
- [X] T014 [P] [US1] `packages/shared/test/media/peatix.test.ts`：①〜⑤の欄、イベント名45の上限と日付を先頭に置く形（`【11/25(水)20時〜】…`）と候補2案、当日払い（無料チケット＋チケット名に金額）、STEP 10。
- [X] T015 [P] [US1] `packages/shared/test/media/tsunagate.test.ts`：①〜⑤の欄、イベント名60の上限と30字以上の形・人数を入れない、紹介文の冒頭3行（場所・日時・参加費）、事前決済のみ、男女比調整は設定しない、STEP 9（最後に「自分も参加申し込み」）。
- [X] T016 [P] [US1] `packages/shared/test/media/jmty.test.ts`：①〜④の欄、カテゴリー（パーティー）、タイトルに日付と駅を前に「〜しませんか？」、内容の最初に日時・場所・参加費・最後に「詳細・お申し込み」と専用URL、STEP 8。
- [X] T017 [P] [US1] `packages/shared/test/media/youtrust.test.ts`：①〜⑤の欄、タイトルの絵文字を外し「＠エリア」、対象者の箇条書き、オフラインの会場名・住所が必須、STEP 12。
- [X] T018 [P] [US1] `packages/shared/test/media/index.test.ts`：`buildListing`（既定値が入る・イベントの情報がない欄は空）、`workSteps`（値を差し込む）、まとめてコピーの文（欄の名前つき）、`polishPrompt`（媒体の決まり・宣伝内容・今のタイトルと本文が入る）と `parsePolishAnswer`（`【タイトル】`・`【本文】`・`【ここまで】` の目印あり・なし・片方だけ。018の読み取りと同じく前後の文を無視）。

### Implementation（媒体ごと）

- [X] T019 [US1] `packages/shared/src/media/kokuchpro.ts`（contracts/media.md「こくちーずプロ」の欄・選択肢・組み立て・STEP）（T013を通す）。
- [X] T020 [US1] `packages/shared/src/media/peatix.ts`（T014を通す）。
- [X] T021 [US1] `packages/shared/src/media/tsunagate.ts`（T015を通す）。
- [X] T022 [US1] `packages/shared/src/media/jmty.ts`（T016を通す）。
- [X] T023 [US1] `packages/shared/src/media/youtrust.ts`（T017を通す）。
- [X] T024 [US1] `packages/shared/src/media/index.ts`：`MEDIA_DEFINITIONS`・`buildListing`・`workSteps`・`listingAsText`（まとめてコピー）・`polishPrompt`・`parsePolishAnswer`（T018を通す）。

### Tests（API。先に書いて失敗を確かめる）

- [X] T025 [P] [US1] `apps/api/test/integration/external-media.test.ts` に足す（contracts/api.md）：
  - 一覧：開催日時の近い順、開催日時のない宣伝内容は最後、`listings` は行のある媒体だけ
  - 入力の画面：まだ作っていなければ `fields: null`、`defaults` が返る
  - 作る：`fields`・`fixes`・`generated_at`・`source_version` が入り、状況が `drafting` になる。開催日時がなければ `422 VALIDATION_FAILED`（details `["event"]`）。操作の記録 `listing_generated`
  - 保存：欄を直す・知らない key は `400`・欄の上限を超えると `400`・`expectedVersion` が違えば `409 STALE_UPDATE`
  - 掲載内容を直しても宣伝内容は1文字も変わらない（SC-004）。宣伝内容を直しても掲載内容は変わらない
  - 媒体の既定値：保存（`defaultable` の key だけ）・作るときに入る

### Implementation（API）

- [X] T026 [US1] `apps/api/src/services/external-media.ts` に一覧・入力の画面の読み出し（宣伝内容・掲載内容・既定値を1回の問い合わせで読む）・作る・保存・既定値の保存を作る。`updateWithVersion` で衝突を検知する。操作の記録を残す（T025を通す）。

### Tests（Web。先に書いて失敗を確かめる）

- [X] T027 [P] [US1] `apps/web/test/external-media.test.tsx`（contracts/ui-routes.md 2〜4）：
  - サイドバーの「戦略」に、宣伝内容の下に「外部媒体展開」。戦略がOFFなら出ない（`apps/web/test/sidebar-create.test.tsx` に足す）
  - 一覧：イベントの選ぶ欄（「［掲載済み：〇〇］」つき）・開催日時のない宣伝内容しかなければ案内・5つの媒体の行（「掲載内容を作る」／「開く」）
  - 入力の画面：区切りの見出しと欄のカード（欄の名前・必須・文字数／上限・「コピー」・説明・選ぶ欄のチップと理由・タイトルのほかの案）・宣伝内容の元の情報（読むだけ）・保存
  - 作業の画面（`?view=work`）：「上から順番にコピーして、〇〇に貼り付けてください。」とSTEPのカード・値ごとの「コピー」・保存も状況の変更もしない（APIを呼ばない）・入力の画面に戻る
  - 「まとめてコピー」で欄の名前つきの文がコピーされる
  - 「AIと整える」：プロンプトをコピー → 答えを貼る → タイトル・本文の候補 → 「反映する」で欄に入る
  - スマートフォンの幅で、表を使わず縦に積む（横にスクロールしない。FR-063）
  - 保存がぶつかったら（`STALE_UPDATE`）知らせ、上書きするか読み直すかを選べる（002・018と同じ部品。FR-064）
  - 見せてもらっている人が開いたら「この画面は、オーナーと担当の人だけが使えます」
- [X] T028 [P] [US1] `apps/web/test/promotions.test.tsx` に足す：閉じた区分「イベントの情報（任意）」、開くと欄が並ぶ、入れずに保存できる、入れると `event` が送られる、中身があるときは最初から開いている。

### Implementation（Web）

- [X] T029 [US1] `apps/web/src/components/external-media/CopyValueButton.tsx`（`SwapLabel` を使い、押すと「コピーしました」。位置を動かさない）・`FieldCard.tsx`・`WorkSteps.tsx`・`PolishDialog.tsx`（`FormDialogFrame`。018の `SparringDialog` と同じ流れ）を作る。
- [X] T030 [US1] `apps/web/src/pages/external-media.tsx`（一覧）と `apps/web/src/pages/external-media-listing.tsx`（入力の画面と作業の画面）を作り、`apps/web/src/router.tsx` に `/accounts/:accountId/external-media` と `…/:promotionId/:media` を `RequireFeature feature="strategy"` で足す。`apps/web/src/lib/api-client.ts`・`apps/web/src/lib/query.ts` に呼び出しとキーを足す。`apps/web/src/components/layout/Sidebar.tsx` の戦略に足す（T027を通す）。
- [X] T031 [US1] `apps/web/src/components/promotions/PromotionFormDialog.tsx` に「イベントの情報（任意）」を足す（T028を通す）。

**Checkpoint**: 宣伝内容から5つの媒体の掲載内容を作り、作業の画面で上から順にコピーできる（SC-001・SC-002の一部）。

## Phase 4: User Story 2 - 媒体のルールに合わないところを、先に直してくれる（P1）

### Tests（媒体ごと。先に書いて失敗を確かめる）

各テストで、IT交流会の材料から：自動の直しで外れる行と理由／ルールのチェックの赤・黄・参考の項目。

- [X] T032 [P] [US2] `packages/shared/test/media/kokuchpro.test.ts` に足す：自動の直しは**しない**（地図のURL・紹介割引が本文に残る）、黄（必須の欄が空）、参考（1日3件まで）。
- [X] T033 [P] [US2] `packages/shared/test/media/peatix.test.ts` に足す：地図のURL・LINEの行が外れる、赤（イベント名が45文字を超える）、参考（冒頭の100〜200文字・当日払い・カバー画像は必須・グループ）。
- [X] T034 [P] [US2] `packages/shared/test/media/tsunagate.test.ts` に足す：地図のURL・紹介割引・LINE・人数の表記が外れる（集合場所の地図のURLは残る）、黄（「人脈づくり」などビジネス・勧誘の言葉）、参考（手数料の目安・自分も参加申し込み・重複の禁止・人気の時間から外れている）。
- [X] T035 [P] [US2] `packages/shared/test/media/jmty.test.ts` に足す：LINE・電話番号・「出会い」の行が外れ、URLは最後の1か所だけ残る、参考（重複投稿の禁止・審査・画像500×500・連絡先を書けない）。
- [X] T036 [P] [US2] `packages/shared/test/media/youtrust.test.ts` に足す：「完全紹介・会員制」と他サイトのURLの行が外れる、黄（住所が空）、参考（サムネイル必須・主催は切り替えられない・公開後に下書きに戻せない・22時〜8時の通知）。
- [X] T037 [P] [US2] `packages/shared/test/media/index.test.ts` に足す：`checkListing` が直した値で出し直される、AIの答えを反映したあとも自動の直しが通る。

### Implementation（媒体ごと）

- [X] T038 [US2] `packages/shared/src/media/kokuchpro.ts` に `rules`（T032を通す）。
- [X] T039 [US2] `packages/shared/src/media/peatix.ts` に `rules`・`fixRules`（T033を通す）。
- [X] T040 [US2] `packages/shared/src/media/tsunagate.ts` に `rules`・`fixRules`（T034を通す）。
- [X] T041 [US2] `packages/shared/src/media/jmty.ts` に `rules`・`fixRules`（T035を通す）。
- [X] T042 [US2] `packages/shared/src/media/youtrust.ts` に `rules`・`fixRules`（T036を通す）。
- [X] T043 [US2] `packages/shared/src/media/index.ts` に `checkListing` と、`buildListing`・反映のあとに `fixRules` を通す流れ（T037を通す）。

### Tests・Implementation（API・Web）

- [X] T044 [P] [US2] `apps/api/test/integration/external-media.test.ts` に足す：保存で禁止の行を貼ると外れて `fixes` に足される（SC-003）。
- [X] T045 [P] [US2] `apps/web/test/external-media.test.tsx` に足す：「ルールのチェック」の枠（赤・黄・参考の件数と項目）、直すと出し直す、閉じたトグル「自動で直した内容（n件）」、作業の画面の最初のSTEPに赤・黄の件数。
- [X] T046 [US2] `apps/api/src/services/external-media.ts` の保存で `fixRules` を通す（T044を通す）。
- [X] T047 [US2] `apps/web/src/components/external-media/RuleCheck.tsx` を作り、入力の画面と作業の画面に置く（T045を通す）。

**Checkpoint**: 媒体ごとのルールに合わない行が外れ、ルールのチェックが出る（SC-003）。

## Phase 5: User Story 3 - 媒体ごとの画像を、外のAIで作れる（P2）

- [X] T048 [P] [US3] `packages/shared/test/media/image.test.ts`：媒体ごとの `imagePrompt` に、イベントの情報（名前・日時・場所・対象者・参加費）・大きさ（こくちーず 4:3 と中央75%・Peatix 1840×900・つなげーと 4:3・ジモティー 500×500・YOUTRUST 1200×630）・入れてはいけないもの（URL・QRコード・連絡先・他サイトの名前・口座）が入る。イラスト型と写真を使う型で文が変わる。
- [X] T049 [US3] `packages/shared/src/media/common.ts` に画像のプロンプトの共通部分、各媒体のファイルに `image` を足し、`packages/shared/src/media/index.ts` に `imagePrompt` を足す（T048を通す）。
- [X] T050 [P] [US3] `apps/web/test/external-media.test.tsx` に足す：入力の画面の画像の枠（大きさと注意・イラスト／写真を使う・「画像のプロンプトをコピー」）と、作業の画面の画像のSTEP。画像の種類を変えて保存すると `imageStyle` が送られる。
- [X] T051 [US3] `apps/web/src/pages/external-media-listing.tsx` に画像の枠を足す（T050を通す）。

## Phase 6: User Story 4 - どの媒体に載せたかを残す（P2）

- [X] T052 [P] [US4] `apps/api/test/integration/external-media.test.ts` に足す：状況と掲載URLの保存（URLの形が違うと `400`）・操作の記録 `listing_status_changed`・一覧の `listings`・宣伝内容を直すと `sourceChanged`・作り直すと欄が入れ直され状況は変わらない・宣伝内容を消すと掲載内容も消える。
- [X] T053 [P] [US4] `apps/web/test/external-media.test.tsx` に足す：状況の選ぶ欄と掲載URL、一覧の状況の印（未着手・作成中・掲載済み・掲載停止）と選択肢の「［掲載済み：〇〇］」、「宣伝内容が変わりました」の帯、「作り直す」の確かめ、閉じたトグル「媒体の既定値」。
- [X] T054 [US4] `apps/api/src/services/external-media.ts` に状況・掲載URL・作り直し・`sourceChanged` を足す（T052を通す）。
- [X] T055 [US4] `apps/web/src/pages/external-media.tsx` と `external-media-listing.tsx` に状況・掲載URL・帯・作り直しの確かめ・媒体の既定値を足す（T053を通す）。

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T056 [P] `docs/ui-design.md` に、外部媒体展開（一覧・入力の画面・作業の画面）、宣伝内容の「イベントの情報」、ルールのチェックの色を書く。
- [X] T057 [P] `docs/user-guide.md`（「戦略」に外部媒体展開）・`docs/architecture.md`（媒体の決まりを shared に置く判断）・`docs/next-features.md` を直す（共有用の文書なので、アカウントのID・テスト版のURL・秘密の値は書かない）。
- [X] T058 全体のテスト・lint・型チェック・Webのビルドを通す（`pnpm --filter ./packages/shared test`、`pnpm --filter ./apps/api test`、`pnpm --filter ./apps/web test`、`pnpm lint`、`pnpm -r exec tsc --noEmit`、`pnpm --filter ./apps/web build`）。
- [ ] T059 quickstart.md の「テスト版で確かめる」を、マージのあとにユーザーとテスト版で通す（5つの媒体それぞれに、作業の画面だけを見ながら登録する。SC-002）。

## Dependencies & Execution Order

- Phase 1（T001・T002）が最初。
- Phase 2：T003〜T007（テスト）は並行できる → T008（表）→ T009〜T012。US1〜US4の前。
- US1：媒体ごとのテスト T013〜T018 は並行できる → T019〜T023（媒体ごと。別ファイルなので並行できる）→ T024。API の T025 → T026。Web の T027・T028 → T029 → T030・T031。
- US2：US1 の媒体のファイルのあと（同じファイルに足す）。T032〜T037 は並行できる → T038〜T042（媒体ごと）→ T043 → T044〜T047。
- US3：US2 の T038〜T043 のあと（同じ媒体のファイルに `image` を足すため）。
- US4：US1 の T026・T030 のあと。
- Polish は最後。T056・T057 は並行できる。T059 はマージのあと。

## Parallel Example

```text
# US1 の媒体ごとのテストを一緒に書く
T013 こくちーずプロ / T014 Peatix / T015 つなげーと / T016 ジモティー / T017 YOUTRUST

# US1 の媒体ごとの実装（別ファイル）
T019 kokuchpro.ts / T020 peatix.ts / T021 tsunagate.ts / T022 jmty.ts / T023 youtrust.ts
```

## Implementation Strategy

1. Phase 1・2 で、イベントの情報・表・プロンプトの1行・共通の関数・APIの守りを作る。
2. US1 で、5つの媒体の欄と作業のSTEP、APIと画面を作る（MVP）。
3. US2 で、媒体ごとのルールのチェックと自動の直しを足す。
4. US3 で、画像のプロンプトを足す。US4 で、状況・掲載URL・作り直しを足す。
5. Polish で文書と全体のテスト。マージの直前に最新の develop を取り込み、PR の CI を通してから、マージのOKをもらう。テスト版で使いながら、画面をシンプルにする次の直しを決める。
