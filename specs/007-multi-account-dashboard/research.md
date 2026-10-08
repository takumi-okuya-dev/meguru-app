# 調査と設計判断：アカウント切り替えメニューの要確認件数

**対象**：[spec.md](./spec.md) ／ **日付**：2026-10-08

## R1. 件数の取得方法と失敗の分離

**Decision**: `GET /api/me/needs-review-counts` を追加し、ログイン中のユーザーが所有する全Accountの要確認件数を1回の読み取りで返す。既存の `GET /api/me` の応答と、Accountごとの `GET /api/accounts/:accountId/post-drafts/counts` は変更しない。

**Rationale**: spec FR-008は件数の取得失敗時も切り替えを使えることを要求する。`/api/me` に件数の集計を混ぜると、その失敗でアカウント一覧も取得できなくなる。各行で既存の件数APIを呼ぶ案は、現在の上限では動くが、spec FR-010の20件でリクエスト数が増える。独立した1回の集計なら失敗を分離し、件数が増えても呼び出しの数を一定にできる。既存の `/api/me` は所有Accountを返し、最後に使った順に並べる（`apps/api/src/routes/me.ts`）。

**Alternatives considered**:
- `/api/me` の各Accountに `needsReview` を追加：呼び出しは1回だが、件数の集計失敗が切り替え全体を止める。
- 既存のAccount別件数APIを各行で呼ぶ：既存の無効化キーを共有できるが、20件では20回のリクエストと認可確認になり、2秒以内の表示と固定費$0の制約に不利。
- 件数をAccount行に保存する：下書きの状態変更のたびに同期が必要で、現行の件数とずれる危険が増す。

## R2. 所有者の範囲と0件を含む集計

**Decision**: 認証済みの `user.id` と `Membership.role = owner` でAccountを絞り、要確認の下書きを左結合してAccountごとに数える。下書きの状態条件は結合条件側に置き、下書きがないAccountも `needsReview: 0` で返す。クライアントからAccount IDの一覧は受け取らない。

**Rationale**: `GET /api/me` と同じ所有者の境界にそろえる。既存の `countDrafts` は `status = needs_review` を要確認件数として扱う（`apps/api/src/services/draft-service.ts`）。`post_drafts` はAccountと状態の複合インデックスを持つ（`apps/api/src/db/schema.ts`）。一覧の0件は「取得できなかった」状態と異なるため、所有Account全件に数を返す。

**Alternatives considered**:
- 下書きに対する単純な `WHERE status = needs_review`：0件のAccountが消える。
- リクエストのAccount IDを信じて数える：他人のAccount IDを指定する余地を作る。

## R3. 更新時点とキャッシュ

**Decision**: 切り替えメニューを開くたびに `/api/me` を読み直し、成功した最新の所有Account一覧を確定してから件数の取得を始める。件数も毎回読み直し、読み込み中は数を「取得中」、失敗時は「取得できません」とする。前回の数がキャッシュにあっても、今回の取得が終わるまで現在の数として見せない。再試行を用意する。メニューを閉じた後は通常の画面の操作を妨げない。

**Rationale**: `apps/web/src/lib/query.ts` はフォーカス復帰時の自動再取得を無効にしている。明示的な再取得がなければ、別の画面での承認・削除、別タブでの操作、アカウントの追加・削除を反映できない。`/api/me` の前回の応答を再取得中に表示すると、削除済みのAccountが一時的に並ぶ。件数が失敗した時に前回の0件を残すと、FR-008に反する。連続した開閉では古いリクエストの結果が新しい表示を上書きしないようにする。

**Alternatives considered**:
- 画面表示中ずっと定期的に取得：メニューを見ていない間もDBを起こし、固定費$0の目標と合わない。
- 既存の下書き操作のたびに横断件数を更新するだけ：別タブ、別端末、自動投稿で要確認に戻った投稿を捕捉できない。

**Limit**: 件数は取得時点のスナップショット。取得した直後に別端末が投稿の状態を変える場合、永続的な同時一致は保証できない。spec SC-002は、操作完了後にメニューを開き直した時点で検証する。

## R4. メニューの表示と操作

**Decision**: 既存の `AccountSwitcher` とRadixのメニュー項目を使い、各行の名前・@ユーザー名・「要確認 N件」を並べる。表示中と要再接続の表示、行選択でAccountホームへ移る操作、「アカウントを追加」を保つ。狭い画面ではメニュー幅を画面内に収め、高さを画面高で制限して内部をスクロール可能にする。キーボードの上下移動・Enter・Escと、画面読み上げで各行の意味を確認する。

**Rationale**: ユーザーは専用画面ではなく既存メニューの拡張を選んだ。`apps/web/src/components/layout/AccountSwitcher.tsx` と `AppShell.tsx` に既存の切り替え、スマートフォンのドロワー、`onNavigate` によるドロワーを閉じる処理がある。ポップアップは既存のコンポーネントでポータル表示される（`apps/web/src/components/ui/dropdown-menu.tsx`）。[画面イメージ](../../docs/mockups/007-account-switcher-desktop.png)は行内に数を示す方向を確認するための参考。

**Alternatives considered**:
- 専用画面：既存の切り替え操作と場所が分かれ、今回の範囲に対して重い。
- 行を要確認件数の多い順に並べ替え：数が変わるたびに項目の位置が動き、現在の「最後に使った順」を壊す。
- 件数の数字だけを示す：状態と意味が伝わりにくい。

## R5. データの保存とマイグレーション

**Decision**: 新しいテーブル・列・マイグレーションは作らない。Account、Membership、投稿下書きの既存データを読み、メニュー内の表示だけを追加する。新しい依存パッケージも不要。

**Rationale**: 件数は `needs_review` の下書きから求められる派生値である。保存すると二重管理になる。今のHono・Drizzle・Zod・TanStack Query・Radixの構成で実現できる。

**Alternatives considered**: 集計結果の専用テーブル、KVキャッシュ。どちらも同期・無効化の追加負担があり、今回の規模では不要。
