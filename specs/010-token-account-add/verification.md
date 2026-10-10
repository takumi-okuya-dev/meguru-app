# 010 実装検証記録

## 自動検証（2026-10-10）

| 確認 | 結果 |
|---|---|
| `pnpm --filter shared test` | 成功。200件（トークンの形の判定`token.test.ts`、エラーの文言`errors.test.ts`を含む） |
| `pnpm --filter api test` | 成功。518件。トークンでの追加`token-connect.test.ts`（長期・期限を読めない・権限なし・無効・短期・形・一時的な失敗・上限・同時・失敗の待ち・日次の削除）、自動投稿とNGワード`token-auto-post.test.ts`（FR-042）、二重登録`token-duplicate.test.ts`（3通り・他人・大文字小文字・同時・ユーザー名だけの一致の取り直し）、接続し直し`token-reconnect.test.ts`（方法の切り替えでデータの件数が同じ・別のアカウント・確かめ直し・役割・記録）、確かめ直し`token-recheck.test.ts`（使える・使えない・一時的な失敗・世代番号・日次の延長）、`debug_token`の呼び出し`threads-debug-client.test.ts`、関所の候補`auto-post-gate.test.ts`、平文を出さない`secrets.test.ts`、役割の表`permissions-matrix.test.ts` |
| `pnpm --filter web test` | 成功。301件。追加の画面`account-new-token.test.tsx`（開かなければ今と同じ・入力欄の形・送信・待ち・登録済み・上限）、接続し直し`reconnect-dialog.test.tsx`（今の接続・2つの選択・トークン・許可・短期の補い・削除の注記・役割・バナーの文）、`token-warnings.test.tsx`、`terms-page.test.tsx`、`guide-page.test.tsx` |
| `pnpm lint` | 成功 |
| `pnpm -r typecheck` | 成功 |
| `pnpm build` | 成功 |
| マイグレーション`0011_token_connect` | ローカルのPostgres 17で適用。既存の`accounts`は`connection_method = 'app'` |
| `pnpm e2e -- token` | 成功。4件（約16秒）。偽のThreadsのトークンで追加 → 別のアプリのトークンで「すでに登録されています」と設定へのリンク → 「Threadsで許可する」で接続し直して投稿ストックが残る → トークンで接続し直して今の接続が戻る |
| `pnpm e2e -- team` | 成功。6件（008の流れが変わらない） |

### 実行時に気づいたこと

- 13:29から動いていた開発用のサーバー（偽のThreads・API・Web）が残っていて、Playwright はそれを使い回す（`reuseExistingServer`）。偽のThreadsは古いコードのままで、トークンを作る画面が404になったため、ユーザーの了承を得て3つを止めてから流した。
- テストの`beforeEach(() => mock.mockReset())`は、戻り値（モック）を後片付けの関数として呼ばれてしまう。波かっこで包む。

## 計画からの変更（実装時に決定）

- **登録の上限の判定の順**：contracts/api.md の手順3（Threadsに問い合わせる前に上限）をやめ、同じアカウントの照合の後に`completeConnection`の中で判定する。上限に達していても、登録済みのアカウントのトークンなら「すでに登録されています」と接続し直しへ案内できるようにするため（US2-1）。画面は、上限に達していれば今までどおり入力欄を出さない。
- **失敗の数え方**：research.md R9 の「users の行ロックの中で数える」はやめ、直近5件の失敗の時刻で判定する（ロックなし）。同時に送られたときに5回を少し超えて確かめることはあるが、待ちの判定は変わらない。
- **接続し直しの権限の判定**：形の確認・失敗の待ちより先に`authorizeAccount(..., "owner")`を通す。パートナー・編集者・関係のない人の要求を、失敗に数えないため。
- **偽のThreadsの制御**：`/__test/…`ではなく、既存と同じ`/__control/tokens`・`/__control/tokens/revoke`・`/__control/token-page`にした。
- **利用規約へのリンク**：「トップページ」は、ログインしていない人の最初の画面であるログイン画面（`/sign-in`）の足元に置いた（`/`はログイン後の振り分けだけのため）。
- **テストの置き場所**：T029（記録）は`token-reconnect.test.ts`、T036（日次の延長）は`token-recheck.test.ts`に置いた。
- **詳しい手順のページの日付**：「確かめました」ではなく「2026年10月10日時点の内容です」とした。実際のMetaの画面で手順を確かめるのは手動の確認（下）で行う。

## 手動確認（未実施）

- 実際のMetaアプリ（ThreadsAutomation）のトークンで、`debug_token`の応答の形を確かめる（T047。research.md R3 の末尾に書く）。
- 実際のトークンで追加にかかる時間（目標はふつう3秒以内、SC-001の2分以内）。
- `/guide/threads-token`の手順を、Metaアプリを持っていない人の目で読み、手順どおりに進められるか（SC-002）。
- スマートフォン幅での追加の画面と、接続し直しのダイアログの見た目。
