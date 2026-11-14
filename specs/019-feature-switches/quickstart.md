# Quickstart：機能のまとまりごとのON/OFF

**Feature**：[spec.md](./spec.md) | **計画**：[plan.md](./plan.md)

## 1. 自動のテスト

```bash
pnpm --filter ./apps/api test -- feature operator-flag operator-features operator-group-features test-groups-production migration-0018
pnpm --filter ./apps/web test -- feature settings-features test-groups test-invite
pnpm --filter ./packages/shared test && pnpm --filter ./apps/api test && pnpm --filter ./apps/web test && pnpm lint && pnpm -r exec tsc --noEmit
```

## 2. 手元で試す

1. `apps/api/.dev.vars`の`OPERATOR_CLERK_USER_IDS`に自分のClerkのユーザーIDを入れる（`TEST_GROUPS_ENABLED`は`"false"`のままでよい）。`pnpm dev`を起動し直す。
2. 自分でログインし、「設定 › 運営」に「使える機能」と「グループ」が出ることを確かめる。
3. 別のGoogleアカウント（Chromeの別のプロファイル）で登録し、課題を少し書き、承認した案を1件つくる。
4. 「使える機能」でその人をメールアドレスで探し、「戦略」をOFFにして保存する。「OFFの人」に出る。
   - 別のアカウントで読み込み直す：サイドバーに「戦略」の区分がない。`/accounts/:id/strategy`を開くと「この機能は今は使えません」。コピーしたプロンプトに課題が入っていない。
5. 「自動投稿」もOFFにする：サイドバーに「自動投稿」の区分がなく、このアカウントの設定に投稿のスケジュールが出ない。
6. 「すべてONに戻す」：書いた課題・承認した案がそのまま出る。「最近の変更」に、それぞれのOFF・ONが残っている。

## 3. 組織（グループ）で試す

1. 「グループ」でグループを作り、招待リンクを別のアカウントで開く。本番と同じ設定（招待制OFF）では、見出しが「（グループ名）に招待されています」で、テスト版の注意は出ない。「参加する」で入る。
2. グループの「使える機能」で「戦略」をOFFにして保存する。入っている人のサイドバーから「戦略」が消える。「使える機能」でその人を探すと、戦略に「グループでOFF」と出る。
3. その人をグループから外すと、戦略が戻る。

## 4. チームで試す

1. 人Aと人Bを同じチームに入れ、BのAccountをAに見せる（または担当にする）。
2. Aの「チーム」をOFFにすると、Aのサイドバーからチームが消え、Bのアカウントを開けない。ONに戻すと元どおり。
3. Bの「戦略」をOFFにすると、AがBのAccountを開いても戦略は見えない（オーナーBの設定に従う）。

## 5. テスト版で確かめる（マージのあと）

テスト版の運営者（今の`OPERATOR_CLERK_USER_IDS`）で、2〜4と同じことをスマートフォンでも確かめる。テスト版では招待制がONなので、グループの招待の画面にはテスト版の注意が出る。
