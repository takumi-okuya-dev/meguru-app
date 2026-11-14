# API の約束：売上・経費・紹介と、運営メンバーへの分配

**対象**：[spec.md](./spec.md)・[data-model.md](../data-model.md) | 道筋の頭は `/api/collect`。形は `packages/shared/src/apps/collect/sharing.ts`。

## 1. 主催者（ログイン＋集金管理の利用の許可。001 の `collectOwner`）

ほかの主催者のイベントは 404 `ITEM_NOT_FOUND`。

### 1-1. 分配の画面

- `GET /events/:eventId/sharing` → `SharingSnapshot`

```ts
{
  event: { id, name, startsAt },
  revenue: { paid: number, awaiting: number, awaitingConfirmation: number },
  expenses: Expense[],              // { id, name, amount, payer: { memberId: string | null, name: string } | null }
  expenseTotal: number,
  members: SharingMember[],            // { id, name, role, ratioTenths: number | null, isOwner, linked: boolean, invite: { expiresAt } | null }
  maxRatioTenths: number | null,    // リーダーの傾斜の合計の上限（メンバーがいないときは null）
  current: Distribution,            // A＝支払い済み − 経費
  projected: Distribution,          // A′＝支払い済み＋振込待ち − 経費
  reimbursements: { memberId: string | null, name: string, amount: number }[],
}
// Distribution
{ amount: number, deficit: boolean, count: number, leaderCount: number, memberCount: number,
  shares: { memberId, base: number, remainder: number, total: number }[],   // total = base + remainder
  remainderTo: string | null }
```

- 運営メンバーが1人もいないイベント（003 の前に作ったもの）では、初めて読んだときに主催者の行を作る。

### 1-2. 経費

- `POST /events/:eventId/expenses` `{ name, amount, payerMemberId?: string | null, payerName?: string | null }` → `SharingSnapshot`
- `PATCH /events/:eventId/expenses/:expenseId`（同じ形の一部）→ `SharingSnapshot`
- `DELETE /events/:eventId/expenses/:expenseId` → `SharingSnapshot`
- 101件めは 400 `LIMIT_EXCEEDED`。`payerMemberId` がほかのイベントの運営メンバーなら 404。両方入れたら 400。

### 1-3. 運営メンバー

- `POST /events/:eventId/members` `{ name, role, ratioTenths?: number | null }` → `SharingSnapshot`
- `PATCH /events/:eventId/members/:memberId` `{ name?, role?, ratioTenths? }` → `SharingSnapshot`
- `DELETE /events/:eventId/members/:memberId` → `SharingSnapshot`（立て替えた経費の `payer_member_id` は空になる）
- `DELETE /events/:eventId/members/:memberId/link` → `SharingSnapshot`（つながりを外す。主催者の行は 400 `VALIDATION_FAILED`）
- 21人めは 400 `LIMIT_EXCEEDED`。リーダーの傾斜の合計が上限を超えると 400 `RATIO_TOO_HIGH`（`details.max` に上限）。リーダーで `ratioTenths` がなければ 12。

### 1-4. 招待

- `POST /events/:eventId/members/:memberId/invite` → `{ url: string, expiresAt: string }`（出し直し：前のリンクは使えなくなる。つながっている運営メンバー・主催者の行は 409 `ALREADY_LINKED`）
- `DELETE /events/:eventId/members/:memberId/invite` → `SharingSnapshot`（止める）
- URL は `${WEB_ORIGIN}/collect/join/ci_…`。

### 1-5. 紹介経由の売上

- `GET /events/:eventId/referrals` → `{ rows: { name: string | null, people: number, attended: number, paid: number, awaiting: number }[] }`（`name: null` は「紹介なし」。人数の多い順、「紹介なし」は最後）
- `GET /referrers` → `{ names: string[] }`（候補：この主催者が使った紹介した人の名前、新しい順に20件）
- 名簿の道筋（001）の人の形に `referrer: string | null` を足す。足す・まとめて貼る・直すで受ける（40文字まで、空は null）。

### 1-6. 書き出しとまとめ

- CSV（001 の `export.csv`）に列「紹介した人」を足す（「メモ」の前）。
- イベントのまとめ（001 の `GET /summaries`）の行に `expenseTotal`・`referred { count, paid, awaiting }` を足す。

### 1-7. 精算の手順（User Story 4。PR4）

- `GET /events/:eventId/settlement` → `SettlementSnapshot`

```ts
{
  parties: { key: string, name: string, kind: "member" | "helper" | "payer" | "former", isOwner: boolean,
             holding: number, target: number }[],       // holding＝渡したものを足し引きしたあと
  helpers: { helperId: string, name: string, cash: number, memberId: string | null, chosen: boolean }[],
  steps: { fromKey, fromName, toKey, toName, amount: number }[],   // 残りの手順
  done: { id, fromKey, fromName, toKey, toName, amount: number, doneAt: string }[],
  mismatch: number,                                     // 0 でなければ合わない（手順は空）
}
```

- `PUT /events/:eventId/settlement/helpers/:helperId` `{ memberId: string | null }` → `SettlementSnapshot`（ほかのイベントの手伝う人・運営メンバーは 404）
- `POST /events/:eventId/settlement/transfers` `{ fromKey, toKey, amount }` → `SettlementSnapshot`（今の人の鍵でなければ 404。同じ鍵は 400。201件めは 409 `ITEM_LIMIT_REACHED`）
- `DELETE /events/:eventId/settlement/transfers/:transferId` → `SettlementSnapshot`
- 主催者だけ。つながった運営メンバーの道筋には出さない。

## 2. 招待を受ける・つながった運営メンバー（ログインだけ。利用の許可は見ない）

- `GET /invites/:token` → `{ event: { name, startsAt }, memberName: string, ownerIsYou: boolean, alreadyLinked: boolean }`（使えないリンクは 404 `INVITE_INACTIVE`）
- `POST /invites/:token/accept` → `{ eventId }`（主催者自身・同じイベントでつながっている人は 409 `ALREADY_LINKED`）
- `GET /shares` → `{ events: { eventId, name, startsAt, memberName, total: number, deficit: boolean }[] }`（日の新しい順）
- `GET /shares/:eventId` → `MemberSharingView`：`SharingSnapshot` から次を除いたもの：招待の情報・`reimbursements` の運営メンバーでない人の名前以外はそのまま。加えて `you: memberId`。名簿・参加者・紹介は含めない。つながっていなければ 404。

## 3. エラーのコード（集金管理の `errors.ts` に足す）

| コード | HTTP | 言葉 |
|---|---|---|
| `RATIO_TOO_HIGH` | 400 | リーダーの倍率が大きすぎて、メンバーの分がなくなります。合計を〇倍以下にしてください。 |
| `ALREADY_LINKED` | 409 | この人はもうつながっています。 |
| `INVITE_INACTIVE` | 404 | この招待のリンクは使えません。主催者に聞いてください。 |

`LIMIT_EXCEEDED`・`VALIDATION_FAILED`・`ITEM_NOT_FOUND` は今のもの。
