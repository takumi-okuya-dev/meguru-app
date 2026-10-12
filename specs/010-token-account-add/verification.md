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
- **失敗の数え方**：待ちの判定と、確認中の予約（`reason = pending`の行）を、users の行ロックの中で行う。確認が終わったら、数える失敗なら理由に書き換え、成功・数えない失敗なら予約を消す。並べて送っても5回を超えて確かめない（PR #12 のCodexレビュー）。
- **接続し直しの権限の判定**：形の確認・失敗の待ちより先に`authorizeAccount(..., "owner")`を通す。パートナー・編集者・関係のない人の要求を、失敗に数えないため。
- **偽のThreadsの制御**：`/__test/…`ではなく、既存と同じ`/__control/tokens`・`/__control/tokens/revoke`・`/__control/token-page`にした。
- **利用規約へのリンク**：「トップページ」は、ログインしていない人の最初の画面であるログイン画面（`/sign-in`）の足元に置いた（`/`はログイン後の振り分けだけのため）。
- **テストの置き場所**：T029（記録）は`token-reconnect.test.ts`、T036（日次の延長）は`token-recheck.test.ts`に置いた。
- **詳しい手順のページの日付**：「確かめました」ではなく「2026年10月10日時点の内容です」とした。実際のMetaの画面で手順を確かめるのは手動の確認（下）で行う。

## PR #12 のCodexレビュー（1回目、74355e5）

| 指摘 | 直したこと | テスト |
|---|---|---|
| P1 トークンを mutation cache に保持しない | `TokenConnectForm`でトークンを mutation の変数にせず、ref に置いて mutationFn で読んだらすぐ消す | `account-new-token.test.tsx`「送ったトークンを mutation cache に残さない」 |
| P2 wake には接続完了後の時刻を使う | `notifyWake`に確定の後の`new Date()`を渡す | `token-connect.test.ts`「関所への知らせは、確定した後の時刻」 |
| P2 失敗回数の確認と記録をユーザー単位で直列化する | 行ロックの中で待ちを判定し、pending の予約を入れる | `token-connect.test.ts`「並べて送っても…5回を超えて確かめない」「成功した確認の予約は残らない」 |
| P2 ユーザー名の更新も同じアドバイザリーロックで保護する | 名前の取り直しの更新を、新しい名前のロックと重なりの再照合と同じトランザクションで行う | `token-duplicate.test.ts`「名前を新しくした後に…照合で見つかる」「新しい名前が先に別のAccountで登録されていても…」 |
| P2 非オーナーには再接続ダイアログを開かせない | `ReconnectButton`が、Accountの役割がオーナーでなければ何も出さない | `reconnect-dialog.test.tsx`「ReconnectButton」 |

## PR #12 のCodexレビュー（2回目、4d88f5d）

| 指摘 | 直したこと | テスト |
|---|---|---|
| P2 JSON のオーバーヘッドを本文上限に含める | 本文の上限を2KBから8KBにする（トークンは2,048文字、スキーマは前後込みで4,096文字まで） | `token-connect.test.ts`「2,048文字のトークン…」 |
| P2 共通の再接続ボタンでも権限警告を表示する | 呼び出し側が結果を受け取らないときは、ダイアログの中で権限の案内と「閉じる」を出す | `reconnect-dialog.test.tsx`「共通のボタンから接続し直しても…」 |
| P2 予約の後処理で接続結果を上書きしない | 予約の書き換え・削除の失敗は記録だけにし、確定した結果・本来のエラーを返す | `token-connect.test.ts`「予約の後片付けに失敗しても…」（DBのトリガーで削除・更新を失敗させる） |
| P2 日次トークン更新もユーザー名ロックに参加させる | 名前を書き換える処理（日次の更新・名前の取り直し）で、共通の`lockUsernameForUpdate`（新しい名前のロックと重なりの照合）を同じトランザクションで呼ぶ | `token-duplicate.test.ts`「日次のトークン更新でユーザー名が変わるとき」 |

## PR #12 のCodexレビュー（3回目、bd621fa）

| 指摘 | 直したこと | テスト |
|---|---|---|
| P1 Firefoxでもトークンを確実にマスクする | CSSの`-webkit-text-security`をやめ、隠している間は欄に「•」だけを出して本当の値は部品の状態で持つ（貼り付けで置き換え、1文字でも消すと全部を消す）。パスワード欄にはしない | `account-new-token.test.tsx`「隠している間は欄に「•」だけを出し…」「隠している間に1文字でも消すと、全部を消す」 |
| P2 本文を読み込む前に8KB制限を適用する | Honoの`bodyLimit`で、読み込みの途中で上限を当てる | `token-connect.test.ts`「長さを名乗らずに流し込まれた大きな本文も…」 |
| P2 プロフィール取得の通信失敗を503へ変換する | `getProfile`の`fetch`の例外（DNS・タイムアウト・接続のリセット）を`ThreadsTransientError`にし、10秒のタイムアウトを付ける | `token-connect.test.ts`「最初のプロフィールの取得で通信が失敗したら THREADS_UNAVAILABLE…」 |

## 手動確認（未実施）

- 実際のMetaアプリ（ThreadsAutomation）のトークンで、`debug_token`の応答の形を確かめる（T047。research.md R3 の末尾に書く）。
- 実際のトークンで追加にかかる時間（目標はふつう3秒以内、SC-001の2分以内）。
- `/guide/threads-token`の手順を、Metaアプリを持っていない人の目で読み、手順どおりに進められるか（SC-002）。
- スマートフォン幅での追加の画面と、接続し直しのダイアログの見た目。
