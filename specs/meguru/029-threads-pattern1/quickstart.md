# 確かめ方（Quickstart）：029 Threadsをパターン①にそろえる

**日付**：2026-11-12 | **仕様**：[spec.md](./spec.md) | **計画**：[plan.md](./plan.md)

## 1. 手元で、PRごとに

どのPRでも、手元で次をすべて通してからPRを出す。

```bash
pnpm lint && pnpm typecheck
pnpm test                       # 共通・Web・API（結合テストとマイグレーションのテストを含む）
pnpm e2e                        # 19件（手元だけ。CIでは流していない）
pnpm --filter api routes:snapshot && git diff --stat apps/api/test/repo/routes.snapshot.txt
```

| PR | 足して確かめること |
|---|---|
| PR1 共通の土台 | `loadEntitlement(s)`が今の判定と同じ結果になる（[contracts/platform-entry.md](./contracts/platform-entry.md) 6）。出来事のテスト（すぐ届く・やり直し・10回で`failed`・2回届いても同じ）。`app_usage`の写しが今の`countOwned`と全員で一致する。機能と上限の「アプリ・名前」化のマイグレーションのテスト。道筋の一覧は変わらない |
| PR2 持ち主の移動（コード） | 知らせ（`runHook`）の呼び出しが0か所。退会のテストで、退会がすぐ終わり、出来事でThreadsのデータが消える。料金の数が`app_usage`から決まり、今と同じ金額になる。`/api/threads/me`が今の`/api/me`のThreadsの部分と同じ値を返す。道筋の一覧に`/api/threads/me`・`withdrawal-preview`が足される |
| PR3 置き場所の移動（DB） | マイグレーションのテスト：前の番号まで当ててデータを入れ、当てたあとに31表の件数と中身が残る・共通 ⇄ Threadsの外部キーが0本。ESLintの規則が、アプリ → `platform/schema`と、共通 → アプリの表を止める（規則のテスト）。`pnpm db:generate`が「変更なし」 |
| PR4 道筋とWeb | 道筋の一覧に`/api/threads/…`が足され、古い道筋も残る。Webの共通の部品にThreadsの道筋がない。Webのテストが、期待する結果を変えずに通る |
| PR5 片づけ | 道筋の一覧から古い道筋が消える。`/api/me`にThreadsのデータがない。上限の古い列のマイグレーションのテスト。`platform/hooks.ts`がない |

外部キーの本数は、手元のDBで次のように数える（PR3のあと、0になる）。

```sql
SELECT count(*) FROM pg_constraint c
JOIN pg_class s ON s.oid = c.conrelid JOIN pg_namespace sn ON sn.oid = s.relnamespace
JOIN pg_class t ON t.oid = c.confrelid JOIN pg_namespace tn ON tn.oid = t.relnamespace
WHERE c.contype = 'f' AND sn.nspname <> tn.nspname;
```

## 2. 作業場所（git worktree）でも

PR3のあと、`pnpm worktree:new probe`で作業場所を作り、マイグレーションがその作業場所のDBに当たり（スキーマ`threads`ができる）、`pnpm --filter api test`が通ることを確かめてから、`pnpm worktree:remove probe`で片付ける（spec FR-020）。

## 3. テスト環境（ステージング）で：PR3のマージの前と後

PR3（置き場所の移動）だけは、前の版のAPIが新しいDBで壊れる（data-model.md 5）。テスト環境のデータを残すため、次の順で行う。

1. **マージの前**：テスト環境のDBの件数を控える。Neonのコンソールか`psql`で、data-model.md 6の表ごとに`SELECT count(*)`を流し、結果を保存する。あわせて、マージの直前の時刻（UTC）を控える（戻すときに使う。[release-runbook.md](../../../docs/release-runbook.md) 6-3）。
2. **テストユーザーに知らせる**：デプロイの間の数分、画面が失敗することがある、と伝える（本番がないので受け入れる例外。spec FR-019）。
3. **マージする**：デプロイ（マイグレーション → API → Web）が成功したことを、Actionsの「Deploy」で確かめる。
4. **マージの後**：同じ表の件数を、スキーマ`threads`の表で数え、1の結果と一致することを確かめる（spec SC-005）。共通 ⇄ Threadsの外部キーの本数が0であることも、1章のSQLで確かめる。
5. **主な流れを手で通す**：ログイン → アカウントを開く → 投稿の登録 → 承認 → 予約 → 自動投稿（5分ごと）→ パフォーマンス、チームの画面、契約の画面、運営の画面（使える機能・上限・テスター招待・アカウント一覧）。前と同じに動くこと。
6. 結果をPR3の説明に書く。

## 4. テスト環境で：PR5のあと

1. PR4のあと、テスト環境の画面が新しい道筋だけを呼んでいることを、ブラウザの開発者ツールのネットワークで確かめる（古い道筋を消す前の確認。[contracts/api-routes.md](./contracts/api-routes.md) 3）。
2. PR5をマージしたら、3章の5（主な流れ）をもう一度通す。退会は、テスト用の利用者を1人作って退会し、10分以内にThreadsのデータ（アカウント）が消えることを確かめる。
3. 結果をPR5の説明に書き、tasks.mdの確かめる作業に印を付ける。

## 5. 困ったとき

- PR3のデプロイが途中で止まった：[release-runbook.md](../../../docs/release-runbook.md) 6の戻し方（APIとWebを前の版に戻し、DBはマージの直前の時刻に戻す）。DBを戻すと、マイグレーションの記録も戻るので、直したあとにもう一度当たる。
- 出来事が`failed`になった：`platform_event_deliveries`の`last_error`とAPIのログ（`wrangler tail`）で原因を見る。直したら、`status`を`pending`・`attempts`を0に戻せば、次の5分ごとの処理でやり直す。
