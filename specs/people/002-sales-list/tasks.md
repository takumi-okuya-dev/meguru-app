# Tasks：人物メモを「声かけリスト」として使う（specs/people/002）

**Input**：[spec.md](./spec.md)・[plan.md](./plan.md)。各段のテストを実装の前に書き、失敗を確かめてから作る。パスの略は 001 の tasks.md と同じ（`ppl/`＝`apps/api/src/apps/people/`、`ptest/`＝`apps/api/test/integration/people/`、`wppl/`＝`apps/web/src/apps/people/`、`wtest/`＝`apps/web/test/apps/people/`、`sp/`＝`packages/shared/src/apps/people/`）。

## PR-A：表とマイグレーション

- [x] T201 `ppl/schema.ts` に plan.md 2章の表と列を足し、`pnpm --filter api db:generate` でマイグレーションを作る（SQL を読む）。名前は `<番号>_people_sales_list.sql`。

## PR-B：API

### テスト

- [x] T202 [P] `ptest/tags.test.ts`：作る（同じ名前は nameKey で1つ・30文字・100まで）・直す・消す（外れる）・人に付ける（20まで・新しい名前で作って付ける）・一覧と候補のタグの絞り込み（どれかを持つ・候補は同意のままの絞り込み）・ほかの作り手は404。
- [x] T203 [P] `ptest/next-action.test.ts`：次にやることを決める（日付と文は両方）・ホームの今日やること・過ぎたもの・近い誕生日（7日以内・年をまたぐ）・終わった（記録に写す／写さない）・誕生日の形。
- [x] T204 [P] `ptest/contact-logs.test.ts`：足す・直す・消す・新しい順・探す欄で当たる・ほかの作り手は404・人を消すと消える。
- [x] T205 [P] `ptest/likelihood-view.test.ts`：来てくれそう度を付ける・絞る・候補を来てくれそう度の順に並べる・並べ方（5つ）とまとめた表示の返り・`personView` を覚える。
- [x] T206 [P] `ptest/outreach-board.test.ts`：進み具合ごとの人数と人・自分の会でない会は400・ほかの作り手の会は404。
- [x] T207 [P] `ptest/fields-links.test.ts`：自由な項目を足す・直す・並べ替え・消す（値も消える）・値を入れる（500文字）・探す欄で当たる・SNS のリンク（ドメインの確かめ・http は400・null で外す）。
- [x] T208 [P] `ptest/export.test.ts`：CSV の見出しと行・BOM・絞り込みが効く・式の頭の文字を逃がす・消した人は入らない・ほかの作り手の人は入らない。
- [x] T209 [P] `ptest/merge-split-002.test.ts`：まとめる（タグを合わせる・記録を移す・残す人にあればそれ）・分ける（元の人に残る）・退会でタグと自由な項目も消える。

### 実装

- [x] T210 `ppl/tags/`（サービスと道筋）・`ppl/persons/person-list.ts` の絞り込みと並べ方・`ppl/outreach/candidate-service.ts` の絞り込み。
- [x] T211 `ppl/persons/`：次にやること・誕生日・来てくれそう度の直し、`ppl/home/`（ホーム）、`ppl/contact-logs/`。
- [x] T212 `ppl/outreach/outreach-board.ts`。
- [x] T213 `ppl/fields/`（自由な項目と値）・`ppl/persons/person-links.ts`。
- [x] T214 `ppl/persons/person-export.ts`（CSV）。
- [x] T215 `ppl/persons/person-merge.ts` と `ppl/inbox/withdrawal.ts` を直す。`routes.snapshot.txt` を書き直す。

## PR-C：画面と E2E

- [ ] T216 [P] `wtest/` のテストを先に書く（ホーム・タグ・並べ方・人のページの各段・会ごとの声かけの一覧・自由な項目の設定・書き出し）。
- [ ] T217 ホーム：「今日やること・過ぎたもの・近い誕生日」（誘う候補の上か、別のタブ）。
- [ ] T218 人の一覧と誘う候補：タグ・来てくれそう度の絞り込み、並べ方とまとめた表示（覚える）、書き出す。
- [ ] T219 人のページ：タグ・次にやること・誕生日・来てくれそう度・連絡の記録・自由な項目・SNS のリンク。
- [ ] T220 会ごとの声かけの一覧（イベントのページから開く）。
- [ ] T221 設定：自由な項目とタグの直し・消す。
- [ ] T222 `e2e/tests/people-sales-list.spec.ts`：タグで絞る → 次にやることを決めてホームに出る → 会ごとの声かけの一覧 → 書き出す。
- [ ] T223 `docs/apps/people.md` の地図と使い方を直す。
