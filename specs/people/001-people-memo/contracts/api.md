# APIの取り決め：人物メモ（/api/people）

**対象**：[spec.md](../spec.md) | **データ**：[data-model.md](../data-model.md) | **入力と出力の形**：`@meguru/shared/people`の`schemas.ts`（zod） | **決めた理由**：[research.md](../research.md)

## 0. 共通の決まり

- **すべての道筋**：今と同じログイン（Clerk。`authMiddleware`）のあと、030の`requireAppAccess("people")`を通す。使えない人は403 `APP_NOT_AVAILABLE`（R3）。ログインのいらない道筋はない。
- **持ち主**：すべての問い合わせを今の利用者の`user_id`で絞る。ほかの作り手のイベント・人・回答・取り込み・声かけは404 `ITEM_NOT_FOUND`（あるかどうかを見せない。FR-032）。
- **エラーの形**は今のAPIと同じ（`{ error: { code, message, details? } }`）。`message`に名前・答えを入れない（R18）。
- 日付（`heldOn`など）は`YYYY-MM-DD`（日本時間の日付）、時刻はISO 8601（UTC）。画面が日本時間で出す。
- 名前の比べ方は`nameKey()`（R9）。
- 人・イベント・回答を足す・消すトランザクションのあとで、`reportUsage(…, "people", { quantity: 0, using })`を呼ぶ（R3）。

| コード | HTTP | いつ |
|---|---|---|
| `APP_NOT_AVAILABLE` | 403 | 人物メモの利用の許可がない（030） |
| `ITEM_NOT_FOUND` | 404 | ない・ほかの作り手のもの |
| `VALIDATION_FAILED` | 400 | 入力の形が違う（`details`に項目の名前） |
| `IMPORT_TOO_LARGE` | 400 | 行・列・値・本文の上限を超えた（`details`にどの上限か。data-model.md 5） |
| `IMPORT_MAPPING_INVALID` | 400 | LINE名の列がない（`details: ["line_name"]`）・同じ項目に2列（`details`にその項目） |
| `IMPORT_DECISIONS_REQUIRED` | 409 | 決めていない候補の行・重なりの行・同意の選択肢がある（`extra: { rows: number[], consentChoices: string[] }`） |
| `PEOPLE_CONFIRM_REQUIRED` | 409 | 取り消し・イベントを消すで、書き足しのある人がいるのに`keepPeopleWithNotes`がない（`extra: { count }`） |
| `CONFIRMATION_MISMATCH` | 400 | 人を消すときの名前が違う |
| `OUTREACH_NO_CONSENT` | 409 | その目的の同意がない人に声かけを始めようとした |
| `OUTREACH_NEEDS_APPROVAL` | 409 | 仕事のつなぎで「OKをもらった」の前に「つないだ」にしようとした |

## 1. 人物メモの自分の情報

| 道筋 | 説明 |
|---|---|
| `GET /api/people/me` | `{ personCount, eventCount }`（退会の確かめ・初めての案内に使う。029の`/api/<アプリ>/me`の形。R19） |

## 2. イベント（FR-002・FR-027・FR-028）

| 道筋 | 説明 |
|---|---|
| `GET /api/people/events` | 開催日の新しい順。各行`{ id, name, heldOn, isOwn, attendeeCount, importCount }` |
| `POST /api/people/events` | `{ name, heldOn, isOwn }` → 201 `{ event }`。作り手のロックの中で退会の途中でないことを確かめ、途中なら409 `WITHDRAWAL_IN_PROGRESS`（取り込みの書く方も同じ。R19） |
| `GET /api/people/events/:eventId` | `{ event, stats, imports }`。`stats`は自分の会なら`{ attendeeCount, firstTimeCount, returningCount, erasedCount }`、自分の会でなければ`{ attendeeCount, erasedCount }`（R12。PR1では`attendeeCount`・`erasedCount`だけ、PR3で初めて・前にもを足す）。`imports`は`[{ id, createdAt, rowCount, importedCount, createdPeopleCount, linkedCount, skippedCount }]` |
| `GET /api/people/events/:eventId/attendees` | その会に来た人：`[{ personId, displayName, lineName, via: "response" \| "manual", firstTime?: boolean }]`（名前の順。`firstTime`は自分の会だけ・PR3から） |
| `PATCH /api/people/events/:eventId` | `{ name?, heldOn?, isOwn? }`。開催日が変わったら、その会に回答のある人の今のLINE名と同意を決め直す（R10・R11） |
| `GET /api/people/events/:eventId/delete-preview` | 取り込みの取り消し（3章）と同じ形を、その会のすべての取り込みについてまとめて返す＋`importCount`（取り込みの数）・`outreachCount` |
| `DELETE /api/people/events/:eventId` | 本文`{ keepPeopleWithNotes?: boolean }`。書き足しのある人がいて省いたら409 `PEOPLE_CONFIRM_REQUIRED`（R14） |

## 3. 取り込み（FR-001〜FR-010）

### 3-1. `POST /api/people/imports/preview`（何も書かない）

入力：

```ts
{
  eventId: string;                       // 先に 2章で作るか選ぶ
  headers: string[];                     // 1〜60列・1列500文字まで
  rows: string[][];                      // 0〜500行・値は5,000文字まで（足りない列は空）
  columns?: Field[];                     // 列ごとの項目（省くと、覚えたもの → 初めから用意した質問文 → null の順で埋めて返す）
  consentChoices?: Record<string, "invite" | "work" | "decline" | "ignore">; // 選択肢の文 → 目的（覚えていないものだけ送ればよい）
}
// Field = "line_name" | "real_name" | "submitted_at" | "next_attendance" | "bring_friends"
//       | "wanted_connections" | "career_interests" | "contact_consent" | "other"
```

出力（200）：

```ts
{
  columns: { header: string; field: Field | null; source: "sent" | "remembered" | "preset" | "none" }[];
  mappingErrors: { code: "line_name_missing" | "duplicate_field"; field?: Field }[]; // 空でなければ下の rows は返さない
  unknownConsentChoices: string[];       // 同意の列に出てくる、対応のない選択肢（R7）
  summary: { newCount: number; candidateCount: number; duplicateInFileCount: number; skippedCount: number };
  rows: {
    row: number;                         // 0から（見出しを除く）
    status: "new" | "candidate" | "duplicate_in_file" | "already_imported" | "erased" | "invalid";
    invalidReason?: "line_name_empty" | "line_name_too_long" | "real_name_too_long";
    groupId?: number;                    // duplicate_in_file の組（同じ LINE 名）
    lineName?: string; realName?: string | null;
    answers?: { nextAttendance: string | null; wantedConnections: string[]; careerInterests: string[] };
    consent?: { invite: boolean; work: boolean };
    candidates?: {                       // 5人まで（R9）
      personId: string; displayName: string; lineName: string | null; otherLineNames: string[]; realName: string | null;
      reasons: ("line_name" | "line_name_loose" | "real_name")[];
      recentEvents: { name: string; heldOn: string }[];   // 新しい順に3つまで
      latestAnswers: { nextAttendance: string | null; wantedConnections: string[]; careerInterests: string[] } | null;
    }[];
  }[];
}
```

- `summary.newCount`＝`new`の行、`candidateCount`＝`candidate`の行、`skippedCount`＝`already_imported`・`erased`・`invalid`の行（FR-006）。
- 列の対応の誤り（`mappingErrors`）は200で返す（画面が対応を選び直すため）。書く方（3-2）では400 `IMPORT_MAPPING_INVALID`。

### 3-2. `POST /api/people/imports`（書く）

入力：3-1と同じ`eventId`・`headers`・`rows`・`columns`（すべての列に項目が必要）・`consentChoices`に、行ごとの決めを足す。

```ts
{
  ...,
  decisions: { row: number; action: "new" | "link" | "skip"; personId?: string }[];
}
```

- APIは3-1と同じ判定をやり直す（R5）。`candidate`・`duplicate_in_file`の行に決めがない、同意の列に対応のない選択肢がある → 409 `IMPORT_DECISIONS_REQUIRED`（`extra.rows`・`extra.consentChoices`）。
- `link`の`personId`は、その作り手の人でなければ404。1つの取り込みで2つの行を同じ人に`link`したら400 `VALIDATION_FAILED`（R9）。`new`の行は決めを省いてよい（省けば`new`）。`already_imported`・`erased`・`invalid`の行は決めがあっても取り込まない。
- 1つのトランザクション（作り手のロック）で：取り込みの行を作る → 列の対応・同意の選択肢の対応を覚える（R6・R7）→ 人を作る・つなぐ → 回答を書く（`ON CONFLICT (event_id, dedupe_hash) DO NOTHING`）→ 人ごとに今のLINE名・同意を決め直す（R10・R11。変わったら`consent_changes`）→ 誘った会の声かけを「来た」にする（PR3から。R16）。
- 201 `{ import: { id, rowCount, importedCount, createdPeopleCount, linkedCount, skippedCount } }`

### 3-3. 取り消し（FR-008）

| 道筋 | 説明 |
|---|---|
| `GET /api/people/imports/:importId/undo-preview` | `{ responseCount, removedPeopleCount, peopleWithNotes: [{ personId, displayName, notes: ("memo" \| "outreach" \| "manual_consent" \| "manual_attendance")[] }] }`（R14） |
| `DELETE /api/people/imports/:importId` | 本文`{ keepPeopleWithNotes?: boolean }`。書き足しのある人がいて省いたら409 `PEOPLE_CONFIRM_REQUIRED`。→ `{ removedPeopleCount, keptPeopleCount }` |

## 4. 人（FR-011〜FR-017・FR-025・FR-029）

| 道筋 | 説明 |
|---|---|
| `GET /api/people/persons?q=&eventId=&next=&wanted=&career=&lastMetFrom=&lastMetTo=&offset=` | 人の一覧（同意に関わらない。FR-017）。`next`・`wanted`・`career`は値（くり返して複数）。最後に会った日の新しい順・100人ずつ（R22）。各行`{ id, displayName, realName, lineName, lastMetOn, ownEventCount, latestAnswers, consent: { invite, work } }`＋`{ total }` |
| `GET /api/people/facets` | `{ nextAttendance: [{ value, count }], wantedConnections: [...], careerInterests: [...] }`（いちばん新しい回答に出てくる値。多い順。R22） |
| `POST /api/people/persons` | 手で足す `{ realName?, lineName?, eventId?, consent: { invite, work } }`（`realName`か`lineName`のどちらかは必須。1〜100文字）→ 201 `{ person }`。同意は手直しの事実として記録する（R11）。`eventId`があれば会ったイベントとして足す（FR-014） |
| `GET /api/people/persons/:personId` | 人のページ：`{ person: { id, realName, lineName, otherLineNames, memoAppearance, memoTalk, consent: { invite, work, source, basisOn }, lastMetOn }, attendances: [{ event: { id, name, heldOn, isOwn }, via, responses: [{ id, submittedAt, lineName, realName, nextAttendance, bringFriends, wantedConnections, careerInterests, consentChoices, answers }] }], consentChanges: [{ invite, work, source, basisOn, changedAt }], outreaches: [...] }`（来たイベントは新しい順。FR-025。`outreaches`はPR3から） |
| `PATCH /api/people/persons/:personId` | `{ realName?, memoAppearance?, memoTalk? }`（本名は1〜100文字か`null`、見た目の特徴は300文字まで、話したことは1,000文字まで。FR-015） |
| `PUT /api/people/persons/:personId/consent` | `{ invite, work }`。手直しの事実として記録し、同意を決め直す（R11）→ `{ consent }` |
| `POST /api/people/persons/:personId/attendances` | `{ eventId }`で会ったイベントを足す（もうあれば何もしない）。誘った会の声かけを「来た」にする（PR3から） |
| `DELETE /api/people/persons/:personId/attendances/:eventId` | 手で足した会ったイベントを外す（回答による来た記録は外せない） |
| `POST /api/people/persons/:personId/merge` | `{ otherPersonId }`。`:personId`に集めて相手を消す（R15）→ `{ person }` |
| `POST /api/people/responses/:responseId/split` | その回答を新しい人に分ける（R15）→ 201 `{ person }`。元の人に回答が1つしかなければ400 `VALIDATION_FAILED` |
| `DELETE /api/people/persons/:personId` | 本文`{ confirmName }`。表示名と`nameKey`で違えば400 `CONFIRMATION_MISMATCH`。消した人の数・回答の印を残してから消す（R13）→ 204 |

## 5. 誘う候補と声かけ（FR-018〜FR-023。PR3・PR4）

| 道筋 | 説明 |
|---|---|
| `GET /api/people/candidates?purpose=invite&eventId=&visitedOwn=&next=&wanted=&career=&lastMetFrom=&lastMetTo=&q=&offset=` | `purpose`（`invite`・`work`）は必須。**その目的の同意が真の人だけ**を返す（FR-018。画面では絞らない）。`visitedOwn=true`で「前に来た」だけ。並びと形は人の一覧と同じ＋`outreach`（`invite`なら`eventId`の会への声かけ、`work`なら最新の声かけ。なければ`null`） |
| `POST /api/people/outreaches` | `{ personId, purpose: "invite", eventId }`か`{ personId, purpose: "work", targetName }`（1〜100文字）。その目的の同意がなければ409 `OUTREACH_NO_CONSENT`。同じ声かけがあれば200で今のものを返し、なければ201で`asked`から始める（R16） |
| `PATCH /api/people/outreaches/:outreachId` | `{ stage }`（同じ目的の進み具合のどれか）。`work`で`approved_at`がないのに`connected`なら409 `OUTREACH_NEEDS_APPROVAL`。戻したら先の日時を空にする → `{ outreach }` |
| `DELETE /api/people/outreaches/:outreachId` | 押し間違いを消す → 204 |

- 声かけの形：`{ id, personId, purpose, event: { id, name, heldOn } | null, targetName: string | null, stage, askedAt, linkSentAt, attendedAt, approvedAt, connectedAt }`。
- 誘いの文（FR-020）は`@meguru/shared/people`の`buildInviteMessage()`で画面が作る（APIを呼ばない。R17）。

## 6. 設定と数字（FR-020・FR-026。PR3）

| 道筋 | 説明 |
|---|---|
| `GET /api/people/settings` | `{ inviteTemplate: string \| null, repeaterGoal: number \| null }`（`null`の型は初めの型を使う） |
| `PUT /api/people/settings` | `{ inviteTemplate?: string \| null, repeaterGoal?: number \| null }`（型は1〜500文字、目標は1〜10,000） |
| `GET /api/people/stats` | `{ repeaterCount, repeaterGoal, nextOwnEvent: { id, name, heldOn } \| null }`（ホームの上の段と、誘う会の初めの値。R12・R17） |

## 7. APIの入口の一覧

`apps/api/test/repo/routes.snapshot.txt`に上の道筋を足す（`pnpm --filter api routes:snapshot`）。取り込みの2本（3-1・3-2）は`bodyLimit`で本文を3MBまでにする（data-model.md 5）。
