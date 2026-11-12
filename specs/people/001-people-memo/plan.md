# 実装計画（Implementation Plan）：人物メモ（アンケートから人を覚え、次の会に誘う）

**ブランチ**：`feature/people-001-people-memo` | **日付**：2026-11-13 | **仕様**：[spec.md](./spec.md)

**入力**：`specs/people/001-people-memo/spec.md`（Clarifications 2026-11-13を含む）、Constitution 4.9.0、[docs/app-separation.md](../../../docs/app-separation.md)、[docs/module-map.md](../../../docs/module-map.md)（6章・7-6）、[docs/product-structure.md](../../../docs/product-structure.md) 5〜7、[docs/parallel-development.md](../../../docs/parallel-development.md)、[029 contracts/platform-entry.md](../../meguru/029-threads-pattern1/contracts/platform-entry.md)（入口の関数・出来事・登録）、specs/meguru/030-app-access（アプリの利用の許可。まだ`develop`に入っていない）、[specs/collect/001-event-day-collection](../../collect/001-event-day-collection/plan.md)（計画の形・`nameKey`）

**実装の時期**：029は`develop`に入った（Threadsはパターン①）。**030（アプリの利用の許可）が`develop`に入ってから、PR1を始める**。人物メモの側で利用権の仕組みは作らない（research.md R3）。

## まだ決めていないこと（ユーザーに確かめたい）

計画は、下の「とりあえずの決め」で進められる形にしてある。違えば、該当の所（括弧の中）を直す。

1. **タブレットの縦（幅768〜1023px）は、サイドバーではなく引き出しになる**。今の外枠（`AppShell`）は1024px以上でだけサイドバーを出すため。docs/product-structure.md 5章は「パソコン・タブレットは左のサイドバー」と書いている。→ とりあえずの決め：001では外枠を直さず、768〜1023pxは引き出しのまま。下のバーは767px以下だけ（research.md R20）。タブレットでもサイドバーにしたいなら、外枠の区切りを変える小さなPR（`specs/meguru`）が要る。
2. **実際のCSVの見出しの行**（10/11と11/25のアンケートの質問文。答えの行は要らない）。初めから当てる質問文（`QUESTION_PRESETS`）を、addendum.mdの質問文の書き方で作るが、Googleの書き出しの文字（全角・半角・句読点）と完全に同じでないと当たらない。あわせて、複数選択の答えのつなぎ方（spec Assumptionsは「、」、Googleのスプレッドシートは実際には「, 」）も、見出しと1行の見本で確かめたい。→ とりあえずの決め：両方を区切りにする（R7）。当たらない質問は、初めの1回だけ作り手が選ぶ（2回目からは覚える）。
3. **消した人の回答の印（ハッシュ）を残すこと**。人を消したあと、同じCSVを上げ直しても、その人の回答が戻らないように、回答の時刻とLINE名から作ったハッシュだけを残す（research.md R13）。名前そのものは残らないが、時刻とLINE名が分かる人には照らし合わせられる形ではある。→ とりあえずの決め：残す（消してほしいと言った人の記録が戻る方が困るため）。
4. **人物メモのエラーのコードを、共通の`ERROR_CODES`（`packages/shared/src/errors.ts`）に足すこと**。`AppError`が共通の一覧のコードしか受けないため（research.md R21）。足すだけの共通の変更を、人物メモのPR1に入れてよいか。→ とりあえずの決め：PR1に入れる（6つ足すだけ。集金管理も同じ形で足すことになる）。
5. （spec Assumptionsから引き継ぎ）仕事の相談先へつなぐときの本人の同意の残し方と、つないだことにお礼がある場合の扱いは、**ほかの主催者へ広げる前に専門家に確かめる**。001は「聞いた → OK → つないだ」と日時を記録するまで。

## 概要（Summary）

めぐるの新しいアプリ「人物メモ」（`people`）を、パターン①のアプリとして足す。作り手がGoogleフォームのアンケートの回答のCSVを上げると、人の一覧ができ、人ごとにイベントをまたいで回答・メモ・声かけがつながる。次の会では、目的ごとに同意した人だけが誘う候補に並び、誘いの文をコピーしてLINEで送る。

- **置き場所**：API`apps/api/src/apps/people/`（`/api/people/…`）、Web`apps/web/src/apps/people/`（`/people/…`）、共通のパッケージ`packages/shared/src/apps/people/`（`@meguru/shared/people`）、Postgresのスキーマ`people`（R1・R2）。
- **だれが使えるか**：030に乗る。`registerAppAccess("people", "granted")`・`APP_CATALOG`に`people`・すべての道筋に`requireAppAccess("people")`。料金なし（`reportUsage`の数は0）（R3）。
- **取り込み**：CSVはブラウザで読み（UTF-8、だめならShift_JIS。ZIPは案内）、APIには見出しと行だけを送る。プレビューと書くの2段階で、途中の状態を持たない。書く直前に判定をやり直し、決めていない候補があれば取り込まない（R4・R5）。
- **列の対応と同意**：質問文（整えたもの）ごと・同意の選択肢ごとに覚える。10/11のフォームの質問文は初めから当てる。同意は「日付のいちばん新しい事実」で決め、変わるたびに記録する（R6・R7・R11）。
- **同じ人**：LINE名（今・別名）・本名の`nameKey`が同じ、または記号を除くと同じ人を候補に出し、作り手が「つなぐ／別の人」を選ぶまでつながない（R9）。
- **消す**：人を消すと、名前と答えはすべて消え、会ごとの参加者数だけを「消した人の来た記録」の行で残す（R13）。
- **PRは4つ**：PR1 土台・イベント・取り込み・同じ人の候補・退会 → PR2 人の一覧・人のページ・手で足す・まとめる・分ける・消す → PR3 誘う候補・声かけ・誘いの文・リピーター・会の数字 → PR4 仕事の相談先へのつなぎ・仕上げ。マイグレーションはPR1とPR3だけ（R23）。

## 技術コンテキスト（Technical Context）

**言語・バージョン**：TypeScript 6.0。Node.js 22 LTS。今と同じ。

**主な依存**：今と同じ（Web：React 19・React Router 8・TanStack Query 5・Clerk・shadcn/ui・lucide。API：Hono・Drizzle・zod）。**新しいnpmの依存は足さない**（CSVの読み方は100行ほどの関数を共通のパッケージに書く。R4）。Cloudflareの新しい機能も使わない。

**ストレージ**：Neon（Postgres 17）の新しいスキーマ`people`に13の表（PR1で11、PR3で2。[data-model.md](./data-model.md)）。マイグレーションは2つ（番号は作るときの`develop`の次）。ファイルは保存しない。

**テスト**（docs/ai-skills.md：作業の一覧はテストを先に書く）：
- 共通のパッケージ（vitest）：`decodeCsvBytes`（UTF-8・印つき・Shift_JIS・ZIP・読めない）・`parseCsv`（囲みの中のカンマ・改行・`""`・空の行・足りない列）・`questionKey`・`nameKey`・`looseKey`・`splitChoices`・`consentFromChoices`・`resolveConsent`・`parseSubmittedAt`・`buildInviteMessage`・初めから用意した質問文と選択肢。
- API（vitestのWorkersの中の結合テスト。`apps/api/test/integration/people/`）：利用の許可がない人の403・ほかの作り手の404・イベント・取り込みのプレビュー（列の対応の順番・誤り・候補・重なり・もう取り込んだ・消した人）・取り込み（決めがないと409・覚える・同意・二重にしない・同時に2つ送っても1回）・取り消し（書き足しのある人の409）・人の一覧（探す・絞る・並び）・手で足す・まとめる・分ける・人を消す（参加者数が変わらない・回答の印）・誘う候補（同意のない人が出ない。すべての絞り込みで）・声かけ（1つにまとまる・OKの前につなげない・自動で来た）・数字（リピーター・初めて／前にも）・退会の出来事を2回受け取る・ログに名前が出ない。
- Web（vitest。`apps/web/test/apps/people/`）：取り込みの段（列の対応・LINE名がないと進めない・候補のカード・409で戻る）・人のページ・誘う候補（文のコピー・興味を聞いたにする）・下のバー（767px以下だけ）・使えない人の画面。
- E2E（Playwright。`e2e/tests/people-*.spec.ts`）：CSVを2回取り込んで候補をつなぎ、誘う候補で文をコピーするまで。スマートフォンの幅で、誘う候補から文のコピーまで3回のタップ以内。
- 境界：ESLintの規則（APIとWeb）が`apps/people`に当たること。`routes.snapshot.txt`に道筋を足す。

**対象プラットフォーム**：Web＝Cloudflare Pages、API＝Cloudflare Workers（今のデプロイのまま）。取り込みはパソコンが主、誘う候補はスマートフォンが主（addendum.md「使い分けの想定」）。

**プロジェクトの種類**：Webアプリ（pnpmモノレポ：`apps/web`・`apps/api`・`packages/shared`・`e2e`）。

**性能の目標**：
- 20行のCSVの取り込み：初めての質問の列を選ぶところまで含めて5分以内、2回目以降2分以内（SC-001）。プレビュー・書くの呼び出しは、それぞれ1回で済む（20行で1秒以内を目安）。
- 誘う候補：人2,000人までで、絞り込みの結果を1回の呼び出しで返す（目安1秒以内。SC-002）。
- スマートフォンで、誘う候補を開いてから文のコピーまで3回のタップ以内（SC-005）。

**制約**：
- パターン①：共通の表を読まない・外部キーを張らない・アプリ同士は使わない（Constitution「アプリのデータの分け方」）。共通は入口の関数（`currentUser`・`requireAppAccess`・`registerAppAccess`・`registerConsumer`・`registerModule`・`reportUsage`）だけ。
- 運用コスト：月額固定のインフラ費用$0から（Workers Free・Neon Free・Clerk Free）。Workersの無料プランのCPU時間に収めるため、ファイルの読み分けはブラウザで行い、取り込みは500行まで（R4）。ポーリングをしない。
- モバイル化を見込む：判断（列の対応・同じ人の候補・同意・数え方・名前の確かめ）はAPI、読み方・正規化・誘いの文は`@meguru/shared/people`に置く。
- 個人の情報：生のファイルをAPIに送らない・ブラウザの保存に書かない・ログに名前と答えを出さない・一意の印に名前を入れない（R18）。
- LINEへの送信・連携をしない（FR-024）。相手の情報を外へ送らない（FR-023）。

**規模**：テスト版の作り手は1人〜数人。作り手1人あたり、イベントは月に1〜数件、1回の取り込みは10〜50行、人は年に100〜数千人。新しいファイルは、API約22・Web約28・共通約8・テスト約22を見込む。

## Constitution Check

*GATE：Phase 0の前に確かめ、Phase 1の後にもう一度確かめた。Constitution 4.9.0。*

| 原則 | 確かめたこと | 結果 |
|---|---|---|
| I. 人格・トーン・NGワードの一貫性 | Threadsへ配信するものを作らない。Threadsの投稿の処理には触らない | 合格（当てはまらない） |
| II. 人間承認ゲート | 自動で送る処理を持たない。誘いの文はコピーだけで、LINEへは作り手が自分で送る（FR-024）。仕事のつなぎは「OKをもらった」を記録しないと「つないだ」にできない（FR-023） | 合格 |
| III. 外部LLM前提・API依存ゼロ | AIを呼ばない。似ている質問文や名前をAIで推し量らない | 合格 |
| IV. 契約／ロール分離 | 使えるか（利用の許可）は共通（030）の関所で確かめ、人物メモの中では持ち主（`user_id`）だけを見る。001は料金なし（`reportUsage`の数は0。原則IVの「料金なし」と同じ考え方で、請求しない）。チーム・ロールは持たない（作り手ごとに閉じる。FR-032）。2作目以降の利用権と料金の書き方の改定は、集金管理の計画と同じく別に行う（このfeatureでは改定しない） | 合格（根拠つき） |
| V. 個人運用起点のシンプルさ | 001の範囲を、CSVの取り込み・人の一覧・誘う候補・声かけの記録に絞った（写真・LINEの連携・参加者のログイン・共有・課金は作らない）。持ち主の判定は`apps/people/access.ts`の1か所（`loadOwnedEvent`・`loadOwnedPerson`など）に集める。取り込みの途中の状態を持たない（R5） | 合格 |
| VI. 改善フィードバックループ | 当てはまらない | 合格 |
| 技術スタック | React＋Vite（Pages）・Workers＋Hono・Neon＋Drizzle・Clerk（ログインだけ）・shadcn/ui。新しいnpmの依存なし。新しいCloudflareの機能なし | 合格 |
| モジュール構成・データの分け方 | `apps/people`（API・Web）に閉じる。共通は入口の関数と出来事だけ。表は専用のスキーマ`people`。ほかのアプリとはつながない（集金管理・Threadsとのつなぎは、あとのfeatureで出来事で行う） | 合格 |
| モバイル化を見込んだ技術の選び方 | 判断はAPI、読み方・正規化・誘いの文は`@meguru/shared/people`。CSVの読み方は共通のパッケージの関数なので、モバイルの画面からも使える | 合格 |
| 運用コスト | ポーリングなし。ファイルを保存しない。重い処理をWorkerに置かない（R4） | 合格 |
| 開発ワークフロー | `specs/people/001-…`・`feature/people-001-…`。共通の変更（030）は先に別のPRで入る。組み立てへの1行の追加（`app.ts`・`index.ts`・`jobs/daily-jobs.ts`・`db/schema.ts`・`app-registry.ts`・`APP_CATALOG`）はdocs/module-map.md 6章・7-6の「アプリを足す手順」どおり。`ERROR_CODES`への追加はまだ決めていないこと4 | 合格（記録あり） |

**Phase 1の後の見直し**：データの形・取り決めを書いたあとも、上の判定は変わらない。共通の変更（030）は人物メモのPRに混ぜないことを、tasksでも前提として書く。

## プロジェクトの構成（Project Structure）

### 文書（このfeature）

```text
specs/people/001-people-memo/
├── spec.md
├── plan.md              # この文書
├── research.md          # 調べて決めたこと（R1〜R23）
├── data-model.md        # 表・状態の移り変わり・数え方・入力の上限
├── quickstart.md        # 確かめ方
├── contracts/
│   ├── api.md           # /api/people の道筋
│   ├── events.md        # 受け取る出来事（退会）
│   └── ui-routes.md     # 画面のURL・下のバー
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks で作る
```

### ソースコード

```text
packages/shared/src/apps/people/
├── index.ts             # 入口（@meguru/shared/people）
├── schemas.ts           # 入力と出力の形（zod）・項目・目的・進み具合の値
├── csv.ts               # decodeCsvBytes・parseCsv・上限
├── names.ts             # nameKey・looseKey・questionKey
├── answers.ts           # splitChoices・parseSubmittedAt・consentFromChoices
├── presets.ts           # QUESTION_PRESETS・CONSENT_CHOICE_PRESETS
├── consent.ts           # resolveConsent（日付のいちばん新しい事実）
└── invite.ts            # buildInviteMessage・DEFAULT_INVITE_TEMPLATE
packages/shared/package.json         # exports に "./people" を足す
packages/shared/src/apps/catalog.ts  # APP_CATALOG に people を1行
packages/shared/src/errors.ts        # 人物メモのコードを6つ足す（まだ決めていないこと4）

apps/api/src/apps/people/
├── index.ts             # 入口（peopleRoutes・registerPeople）
├── register.ts          # registerAppAccess・registerConsumer
├── schema.ts            # pgSchema("people") の表
├── access.ts            # 持ち主の確かめ（loadOwnedEvent・loadOwnedPerson・loadOwnedImport）と作り手のロック
├── usage.ts             # reportUsage（数は0・using）
├── routes.ts            # /api/people の Hono（authed → requireAppAccess("people") → 各道筋）
├── me/                  # GET /api/people/me
├── events/              # イベント・数字・参加者・消す
├── imports/             # 列の対応・判定（preview）・書く（commit）・取り消し
├── persons/             # 人の一覧・facets・人のページ・手で足す・直す・同意・まとめる・分ける・消す・person-query.ts
├── outreach/            # 誘う候補・声かけ（PR3・PR4）
├── settings/            # 誘いの文の型・目標・stats（PR3）
└── inbox/               # 退会の出来事の受け取り

apps/api/src/db/schema.ts            # export * from "../apps/people/schema" を1行
apps/api/src/app.ts                  # registerPeople() と .route("/people", peopleApi)
apps/api/src/index.ts / jobs/daily-jobs.ts   # registerPeople() を registerThreads() の隣に
apps/api/test/integration/people/    # 結合テスト
apps/api/test/helpers/app.ts         # TRUNCATE に人物メモの表

apps/web/src/apps/people/
├── index.ts             # AppModule（peopleApp）
├── routes.tsx
├── shell/               # PeopleShell（AppShell＋下のバー）・AppSidebar の中身
├── pages/               # candidates・list・person・person-new・import・events・event・event-new・settings
├── components/          # 取り込みの段・候補のカード・人の行・絞り込み・声かけ・誘いの文
└── lib/                 # api.ts（人物メモの呼び出し）・query-keys.ts・paths.ts・read-csv-file.ts
apps/web/src/app-registry.ts         # 1行足す

e2e/tests/people-*.spec.ts           # 取り込みから文のコピーまで
e2e/tests/helpers.ts                 # 片づけの schemaname に 'people'
```

**構成の決め方**：docs/module-map.md 6章（APIにアプリを足す手順）と7-6（Webにアプリを足す手順）のとおり。外枠・共通のほかの場所は直さない。

## 複雑さの記録（Complexity Tracking）

| 増えるもの | なぜ要るか | もっと単純な案を選ばなかった理由 |
|---|---|---|
| 取り込みの2段階（プレビューと書くで、同じ行を2回送る） | 書く直前に判定をやり直し、候補を勝手につながない（FR-010）。途中の状態を残さない（R5・R18） | 下書きの表は、途中でやめた取り込みの名前と答えがDBに残り、片づけが要る |
| 消した人の来た記録・回答の印（`erased_attendances`・`erased_responses`） | 人を消しても会ごとの参加者数を残す（FR-029・SC-006）。同じCSVの上げ直しで消した人を戻さない（R13） | イベントに数の列を持つと、取り消しのときに減らす数を別に数える必要がある。印を残さないと、消した人が戻る |
| 同意の決め方（日付のいちばん新しい事実）と`consent_changes` | 回答の同意（FR-009）・手直し（FR-015）・新しい回答での上書き（Edge Cases）を、まとめる・分ける・取り消しのあとでも同じ答えにする（R11） | 「手直しをいつも優先」「回答をいつも優先」は、どちらもspecのどれかに反する |
| 共通の`ERROR_CODES`に6つ足す | `AppError`が共通の一覧のコードしか受けない（R21） | `AppError`をアプリごとのコードに広げるのは共通の作り変えで、人物メモのPRに混ぜない |
| 人物メモの中の下のバー（`PeopleShell`） | スマートフォンでは下のバーにする（docs/product-structure.md 5章・FR-033） | 外枠に下のバーの仕組みを足すのは共通の変更。3作目でも要るとわかってから外枠に移す（R20） |

## 次の段階

- `/speckit-tasks`：PR1〜PR4に分けて、テストを先に書く形で作業の一覧を作る。030は前提として書く（人物メモでは作らない）。
- 030がマージされたら、`registerAppAccess`・`requireAppAccess`・`APP_NOT_AVAILABLE`の名前と置き場所を確かめ、違えば research.md R3・contracts/api.md 0・tasks.md の該当のタスクを直す。
- 「まだ決めていないこと」1〜4の答えをもらったら、research.md R20・R6/R7・R13・R21を直す。
