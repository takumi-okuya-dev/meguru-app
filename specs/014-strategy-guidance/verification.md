# 検証の記録：課題の入力を手助けする

**日付**：2026-10-17 | **タスク**：[tasks.md](./tasks.md) T094 | **手順**：[quickstart.md](./quickstart.md)

## 1. 自動の確認

| コマンド | 結果 |
|---|---|
| `pnpm --filter api db:migrate` | 0015_strategy_guidance をローカルのDBに当てた |
| `pnpm lint` | エラーなし |
| `pnpm typecheck` | shared・api・web・e2e とも通る |
| `pnpm build` | 通る（Webの1つのチャンクが500kBを超える警告は前からのもの） |
| `pnpm test` | shared 25ファイル・303件、web 55ファイル・470件、api 86ファイル・790件がすべて通る（1回目の`pnpm test`でapiの1件が落ちたが、名前を控える前に流れ、その後の3回は通った。E2Eの直後で、ローカルのDBを使う処理が重なったためとみている） |
| `pnpm e2e` | 18件すべて通る（決済OFFの17件。014で足した`create.spec.ts`・`research.spec.ts`・`phone-width.spec.ts`・`strategy.spec.ts`の1件を含む。決済ONの1件） |

E2E は、013と同じく`E2E_CLERK_USER_EMAIL`にオーナー役（`e2e/.env.local`の`E2E_OWNER_EMAIL`）を渡して流した（渡さないとログインで止まる）。コピーの確かめは、Playwright にクリップボードの読み書きを許して、コピーした全文を読む。

成功の基準ごとのテスト：

| 基準 | テスト |
|---|---|
| SC-001（21項目すべてにヒント） | `packages/shared/test/strategy-guidance.test.ts`、`apps/web/test/strategy-hints.test.tsx` |
| SC-002・SC-003（印と数がその場で変わる、次におすすめで1回） | `apps/web/test/strategy-progress.test.tsx` |
| SC-004・SC-005（深掘りは3回の操作、目印の内側を反映） | `packages/shared/test/strategy-prompts.test.ts`、`apps/web/test/strategy-deepen.test.tsx`、`e2e/tests/strategy.spec.ts` |
| SC-006・SC-007（目的の5問・活動の軸の扱い、今のデータと数が変わらない） | `apps/api/test/integration/strategy-purpose.test.ts`、`apps/api/test/migration/migration-0015.test.ts`、`packages/shared/test/strategy.test.ts` |
| SC-008（見せてもらっている人・読むだけにAIの操作が出ない） | `apps/web/test/strategy-deepen.test.tsx`・`strategy-progress.test.tsx`（直せない人）、`create-steps.test.tsx`、`research-keywords.test.tsx`、APIの権限の表（`permissions-matrix.test.ts`） |
| SC-009（375pxではみ出さない） | `e2e/tests/phone-width.spec.ts`（ホーム・課題（ヒントと深掘りを開く）・リサーチ（読み物・追加の欄・キーワード）・投稿をつくる（情報の一覧・文字数・2つに分ける）・投稿ストック） |
| SC-010〜SC-014（ためて登録・まとめての解説・今の参考投稿） | `reference-posts-batch.test.ts`、`reference-posts-fields.test.ts`、`reference-posts-explain.test.ts`、`packages/shared/test/research.test.ts`、`apps/web/test/research-add.test.tsx`・`research-explain.test.tsx`、`e2e/tests/research.spec.ts` |
| SC-015・SC-016・SC-018（件数がそろう、空の材料の節が入らない、初めの値の範囲） | `packages/shared/test/prompt.test.ts`、`apps/api/test/integration/prompt-materials.test.ts` |
| SC-017（情報の一覧の数え方） | `prompt-materials.test.ts`（materials）、`apps/web/test/create-materials.test.tsx` |
| SC-019（内訳の合計） | `packages/shared/test/prompt.test.ts`（1〜50件×5%刻みのすべての割合）、`apps/web/test/create-length.test.tsx` |
| SC-020（2つに分けた節） | `packages/shared/test/prompt.test.ts`、`apps/web/test/create-parts.test.tsx` |
| SC-021（コードブロック） | `packages/shared/test/drafts.test.ts`、`e2e/tests/create.spec.ts` |
| SC-022・SC-023（投稿をつくるから確かめるまで、投稿ストックが変わらない） | `apps/web/test/create.test.tsx`・`stock.test.tsx`・`sidebar-create.test.tsx`、`e2e/tests/create.spec.ts`・`onboarding.spec.ts`・`team.spec.ts` |

## 2. 手で確かめること（まだ）

自動の確認では、AIの答えは偽のもの（目印・【ID】・コードブロックつき）を貼っている。次は、本物のChatGPT・Claudeを使って手で確かめる（quickstart.md 2）。

- 深掘り・全体の整理・活動の軸・まとめての解説・キーワードの案を、実際のAIに送り、答えを貼って反映・保存する（2 の1・3）。
- 長いプロンプトを2つに分けて無料のChatGPTに送り、1つ目に「受け取りました」が返り、2つ目で投稿が作られる（2 の4）。
- 生成の質：014の前と後のプロンプトで10件ずつ作り、課題の話題・目的・宣伝の件数・リサーチの型が表れているかを見比べる（2 の8）。
- 考えるヒントの文言（contracts/hints.md）を確かめてもらう（T095）。

## 3. 計画からの変更

- **文字数の範囲（SC-018）**：FR-171のとおり、各長さの±20%（上限は目標）と「目標×0.85前後、超えても目標×1.35まで」から作る。初めの値では、短文44〜66字・中文80〜120字・長文108〜150字、1投稿は128字前後で203字まで（今の「150字以内、40〜70・80〜120・120〜150」と比べ、短文と長文の幅が少し違い、上限は「目標150字」の指示に加えて「どうしても収まらないときも203字まで」になる）。
- **宣伝の行**：タイトルが空の宣伝内容はないが（DBで必須）、関数としては空なら【】を出さない。今日の日付を渡さないときは残り日数を書かない。
- **1日の投稿数（005）**：宣伝の節の見出しを「ちょうどN件」に変えたので、1日の投稿数の文は見出しの次の行に移した。
- **参考投稿の数字**：契約の閲覧・いいね・コメント・フォロワーに加え、分かっていればリポスト・保存も添える。
- **権限の表**：US7・US8・US9の5つのAPIを `apps/api/test/helpers/routes.ts` に足した（足し忘れで権限の表のテストが落ちていたのを直した）。
- **エラーの形**：契約の`details.remaining`・`details.keywords`・`details.reason`は、今のエラーの形（`details`は項目名などの文字列の一覧、ほかの値は`error`の上に足す）に合わせ、`error.remaining`・`details`（重なった言葉）・`error.reason`にした（contracts/api.md を直した）。
- **貼り付け欄と削除の確定**：投稿ストックで削除して確定を待っている下書きは、画面を離れるときに確定する（今のまま）。「投稿をつくる」は別の画面になったので、貼り付けの前に削除を確定する処理（003のCodexレビュー）はなくした。
- **リサーチの手順**：002の「リサーチの手順」（折りたたみ）は、「伸びる投稿を見つけるリサーチ」の④にまとめた。
- **自分で1件書く**：貼り付け欄そのものに書く入口にした（押すと欄に移り、案内が「投稿の本文を1件書く…」になり、区切りがない注意を出さない）。別のダイアログは作らなかった。
- **操作の記録（作る件数）**：文字数・割合を足したので、件数が変わらず文字数・割合だけ変わった保存では`prompt_count_saved`を記録しない。
