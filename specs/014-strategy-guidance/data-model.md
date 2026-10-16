# Data Model：課題の入力を手助けする

**Feature**：[spec.md](./spec.md) | **調べ**：[research.md](./research.md)

マイグレーションは`0015_strategy_guidance`の1本。Neon（Postgres 17）＋Drizzle。新しい表は作らず、3つの表に列を足す。

## 変更の一覧

| 対象 | 変更 | 理由 |
|---|---|---|
| `strategy_designs` | 列`purpose_origin`・`purpose_self`・`purpose_others`・`purpose_future`・`purpose_stance`・`activity_axis`を足す | 活動の目的・在り方（R3） |
| `reference_posts` | 列`platform`・`posted_date_mode`・`posted_date`・`metric_likes`・`metric_replies`・`metric_views`・`metric_saves`・`metric_reposts`・`metric_followers`・`author`・`memo`を足す | 参考投稿の項目（R6） |
| `accounts` | 列`post_length_target`・`short_length`・`medium_length`・`long_length`・`short_ratio`・`medium_ratio`・`long_ratio`を足す | 文字数と長さの割合（R11） |

## strategy_designs（変更）

| 列 | 型 | 説明 |
|---|---|---|
| `purpose_origin` | `text NULL` | Q1：なぜ、この活動を始めようと思ったか |
| `purpose_self` | `text NULL` | Q2：この活動を通して、自分自身はどうなりたいか |
| `purpose_others` | `text NULL` | Q3：関わってくれた人に、どうなってほしいか |
| `purpose_future` | `text NULL` | Q4：この活動を続けた先に、どんな未来を作りたいか |
| `purpose_stance` | `text NULL` | Q5：活動するうえで、どんな在り方を大切にしたいか |
| `activity_axis` | `text NULL` | 活動の軸（任意） |

- 空白だけの値は`NULL`にする（今の列と同じ`toColumns`）。文字数の上限は2,000（アプリで確かめる。今の列と同じくCHECKは付けない）。
- 版（`version`）・最終更新者（`updated_by_user_id`）は今の行のものを共有する。
- PUTで6つのキーが省略されたら、その列は変えない（R3、FR-054）。

**共通の定義（`packages/shared/src/strategy.ts`）の変更**

- `STRATEGY_TEXT_KEYS`の先頭に6つのキーを足す（`purposeOrigin`・`purposeSelf`・`purposeOthers`・`purposeFuture`・`purposeStance`・`activityAxis`）。
- `STRATEGY_SECTIONS`の先頭に`{ id: "purpose", title: "活動の目的・在り方", chip: "目的" }`を足し、`sales`・`account`・`funnel`の`title`・`chip`から「課題①〜③」を外す（R3）。`chipShort`はやめ、`chip`1つにする。
- `STRATEGY_FIELDS`に6項目を`section: "purpose"`、`counted: false`で足す。`STRATEGY_TOTAL`（16）と`countFilled`は変えない。

## reference_posts（変更）

| 列 | 型 | 既定 | 説明 |
|---|---|---|---|
| `platform` | `text NOT NULL` | `'threads'` | 媒体。CHECKで`threads`・`instagram`・`tiktok`・`x`・`other` |
| `posted_date_mode` | `text NOT NULL` | `'unknown'` | 投稿日の選び方。CHECKで`exact`・`week`・`month`・`3months`・`unknown` |
| `posted_date` | `date NULL` | `NULL` | 投稿日。`posted_date_mode = 'exact'`のときだけ値がある（CHECK） |
| `metric_likes` | `integer NULL` | `NULL` | いいね（0以上。CHECK） |
| `metric_replies` | `integer NULL` | `NULL` | コメント（0以上） |
| `metric_views` | `integer NULL` | `NULL` | 閲覧数（0以上） |
| `metric_saves` | `integer NULL` | `NULL` | 保存数（0以上） |
| `metric_reposts` | `integer NULL` | `NULL` | リポスト（0以上） |
| `metric_followers` | `integer NULL` | `NULL` | 投稿者のフォロワー数（0以上） |
| `author` | `text NULL` | `NULL` | 投稿者（アカウント名）。100文字まで（CHECK） |
| `memo` | `text NULL` | `NULL` | なぜ気になったか。500文字まで（CHECK） |

- 今ある行は、既定値で`platform = 'threads'`・`posted_date_mode = 'unknown'`になる（SC-013）。
- `posted_date`は、今日（日本時間）より後を入れられない（APIで確かめる。DBのCHECKは日付が動くので付けない）。
- 鮮度（`latest`・`active`・`archive`・`unknown`）は保存しない。`freshnessOf`（R6）でそのつど求める。
- 「解説がまだ」は`why_good`が`NULL`か空白だけ。まとめての解説の保存は、この条件の行だけを更新する（R8）。

**共通の定義（`packages/shared/src/schemas.ts`）の変更**

- `referencePostInputSchema`に、`platform`（既定`threads`）・`postedDateMode`（既定`unknown`）・`postedDate`（`YYYY-MM-DD`か`null`。`exact`のときは必須、それ以外は`null`）・`metrics`（6つの0以上の整数か`null`）・`author`（100文字）・`memo`（500文字）を足す。どれも省略でき、省略は既定値（今のクライアントからの追加・編集を壊さない）。
- 新しい定数：`REFERENCE_AUTHOR_MAX = 100`、`REFERENCE_MEMO_MAX = 500`、`REFERENCE_BATCH_MAX = 20`、`EXPLAIN_BATCH_MAX = 10`、`KEYWORD_BATCH_MAX = 20`。

## accounts（変更）

| 列 | 型 | 既定 | 範囲（CHECK） |
|---|---|---|---|
| `post_length_target` | `smallint NOT NULL` | `150` | 50〜500 |
| `short_length` | `smallint NOT NULL` | `55` | 10〜500、`≤ post_length_target` |
| `medium_length` | `smallint NOT NULL` | `100` | 10〜500、`≤ post_length_target` |
| `long_length` | `smallint NOT NULL` | `135` | 10〜500、`≤ post_length_target` |
| `short_ratio` | `smallint NOT NULL` | `35` | 0〜100 |
| `medium_ratio` | `smallint NOT NULL` | `45` | 0〜100 |
| `long_ratio` | `smallint NOT NULL` | `20` | 0〜100、3つの合計が100 |

- 10字刻み（目標）・5字刻み（長さ）・5%刻み（割合）は、APIの検証で確かめる（CHECKは範囲と合計だけ）。
- 版・最終更新者は、作る件数の`prompt_post_count_version`・`prompt_post_count_updated_by_user_id`を共有する（R11。1つのカードの設定として一緒に保存する）。
- 初めの値は今のプロンプトの範囲（150字以内、短文40〜70字・中文80〜120字・長文120〜150字、3〜4割・4〜5割・2〜3割）に合わせた（SC-018）。

## 保存しない値（画面・APIでそのつど作る）

| 値 | 作る所 | 説明 |
|---|---|---|
| 考えるヒント・目安の文字数 | `STRATEGY_HINTS`（`strategy-guidance.ts`） | 文言は[contracts/hints.md](./contracts/hints.md) |
| 自動チェック | `checkStrategy(values)` | 項目ごとの`empty`・`short`・`ok`、完了・要確認・目的の数、次におすすめ |
| 深掘り・全体・活動の軸のプロンプト | `strategy-prompts.ts` | 画面の今の入力から作る |
| ためた投稿 | 「参考投稿を追加」の画面の状態 | 登録まで保存しない |
| まとめての解説の一覧 | `parseExplanations` | 貼り付けた答えから作る |
| キーワードの案の一覧 | `parseKeywordIdeas` | 貼り付けた答えから作る |
| 鮮度 | `freshnessOf(post, today)` | 投稿日か登録日から |
| プロンプトに入っている情報 | `GET /prompt`の`materials` | プロンプトを作るときの数え方 |
| 表示の好み | `localStorage` | はじめに読んでほしいこと・手順の案内・送り方（R15） |

## マイグレーションの確かめ（`migration-0015.test.ts`）

- 前後で、課題・参考投稿・アカウントの件数と、今の列の値が変わらない。
- 今ある参考投稿が`platform = 'threads'`・`posted_date_mode = 'unknown'`、今あるアカウントが150・55・100・135・35・45・20になる。
- CHECK：割合の合計が100でない・長さが目標を超える・`exact`で投稿日がない・数字が負・投稿者が101文字、のそれぞれが拒まれる。
