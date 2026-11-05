# Quickstart：時間差のメンション

**Feature**：[spec.md](./spec.md) | **計画**：[plan.md](./plan.md)

## 1. 自動のテスト

```bash
pnpm --filter ./packages/shared test -- mention
pnpm --filter ./apps/api test -- mention migration-0021 review token-connect auto-post analysis
pnpm --filter ./apps/web test -- mention stock settings
pnpm --filter ./packages/shared test && pnpm --filter ./apps/api test && pnpm --filter ./apps/web test && pnpm lint && pnpm -r exec tsc --noEmit
```

確かめること：

- **shared**：
  - `normalizeMentionUsername`：@・空白・大文字をそろえ、形が違えば null
  - `buildMentionText`：ひとことが空のとき
  - `mentionDueAt`：時間差と `send_after`
- **API（設定）**：
  - 初めの値・保存・衝突
  - ひとことのNGワード
  - 人の追加：20人まで・同じ人・自分
  - 人を消すと予定から外れる
- **API（付ける）**：
  - 要確認に付ける → `version` が上がる
  - 承認済みに付ける → 要確認に戻る
  - 選べない人（予定・24時間以内）
  - まとめて付ける
  - 外す
  - 投稿済みに付ける（7日以内・1つまで・返信の権限なし・NGワード）
  - やめる
- **API（承認）**：返信の文のNGワード・500文字・規約に注意で `skipped`。却下すると消える（SC-002）
- **API（定期処理）**（contracts/mention-job.md）：
  - 時間差の前は出さない。過ぎた最初の回に、返信先を指定して出す
  - 二重に出さない：結果が分からない → 確かめる（SC-003）
  - 理由ごとの `failed`
  - 要再接続・まとまりOFFは待つ
  - 24時間で `expired`
  - 同じ人の24時間：当たれば文を書き換えずに出さない（SC-002・SC-004）
  - 関所の候補と `notifyWake`
- **API（守り）**：
  - 見せてもらっている人には `mention` が null
  - `review` のない人は付けられない、`settings` のない人は設定を変えられない
  - 自動投稿がOFFは FEATURE_DISABLED（SC-006）
- **API（解析）**：出した返信のぶん、返信の数から1を引く
- **マイグレーション**：足すだけ、下書きの削除で消える
- **Web**：
  - 「メンションを付ける」の1回で付く（SC-007）
  - 丸いボタン・文を直す・外す
  - NGワードの枠
  - 選んだときの「メンションを付ける」
  - 投稿済みの状態と「返信する」「やめる」
  - 設定の区分（権限なしの帯・時間差・ひとこと・人・いつも付ける・消すときの確認）

## 2. テスト版で確かめる（develop に入れたあと、本番に出す前に、ユーザーと行う）

1. トークンを作るとき、`threads_manage_replies` を付けた場合と付けない場合で、つなぎ直す。付けないときに設定に注意の帯が出ることを確かめる（research.md R1。Metaの説明の食い違いを確かめる）。
2. 設定で、時間差を10分、ひとことを決め、メンションする人に協力してくれる人（テスト用のアカウント）を足して「いつも付ける」にする。
3. 投稿ストックの要確認の下書きで「メンションを付ける」を1回押し、承認する。投稿されて10分後の回に、その投稿への返信が出て、相手に通知が届くことを確かめる（SC-001）。
4. 投稿済みの投稿で「メンションを付ける」→「返信する」を押し、数分以内に返信が出ることを確かめる。
5. スマートフォンの幅（390px）で、カードの中の操作が横にスクロールせずにできることを確かめる。
