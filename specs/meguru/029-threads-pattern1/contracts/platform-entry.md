# 取り決め：共通の入口の関数・出来事・利用の数（029）

**対象**：`apps/api/src/platform/index.ts`が出すもの。2作目・3作目のアプリも、これだけを使う。判断は[research.md](../research.md) R4〜R7。

## 1. 決まり

- アプリは、共通の**入口の関数**だけを使う。共通の表の定義（`platform/schema`）と、SQLの部品（`featureOnSql`など）は使わない（ESLintが止める。[module-boundaries.md](./module-boundaries.md)）。
- 共通は、アプリの表を読まない。共通で起きたことは**出来事**でアプリに伝える。アプリから共通へは、入口の関数（`reportUsage`など）で伝える。
- 共通とアプリは、1つのトランザクションをまたがない。入口の関数は、アプリのトランザクションの**外**で呼ぶ（読むだけの関数は、トランザクションの中で呼んでもよいが、共通の表を書き換えない）。

## 2. 入口の関数

| 関数 | 入力 | 返すもの | 使うところ（Threads） |
|---|---|---|---|
| `currentUser(c)` | Honoの文脈 | `{ id, email, displayName }`（認証のミドルウェアが入れたもの。今の`AuthUser`） | すべてのAPI |
| `loadAppEntitlement(db, mode, userId, app)` | 決済のモード・利用者の番号・アプリの番号 | `AppEntitlement`（下）。いなければ null | 権限の判定（アカウントを開く・書く） |
| `loadAppEntitlements(db, mode, userIds, app)` | 決済のモード・利用者の番号の配列（重複は1つにまとめる）・アプリの番号 | `Map<userId, AppEntitlement>`（見つからない番号は入らない） | 自動投稿・数字の取得・メンションの定期処理（持ち主をまとめて調べる） |
| `peopleNames(db, userIds)` | 利用者の番号の配列 | `Map<userId, string>`（画面に出す名前。今の`personName`の決め方） | チームの人の一覧・活動の記録・運営者のアカウント一覧 |
| `peopleProfiles(db, userIds)` | 利用者の番号の配列 | `Map<userId, { displayName, email }>`（PR2c で足した） | 運営者のテスター招待の一覧（名前とメールアドレスを分けて出す） |
| `loadAppFeatures(db, userIds, app)` | 利用者の番号の配列・アプリの番号 | `Map<userId, Set<機能の名前>>`（PR2c で足した。契約の判定が要らないところ） | チームの判定・運用状況・利用の数（チームのON/OFF・自動投稿のON/OFF） |
| `reportUsage(db, userId, app, usage)` | `usage = { quantity: number, using: boolean }` | なし | アカウントを作る・消す・持ち主が変わる・チームに入る・抜ける・毎日の数え直し |
| `operatorOnly` | — | 運営者だけを通す関所（今のまま） | 運営者のアカウント一覧・テスター招待 |

### `AppEntitlement`

```ts
type AppEntitlement = {
  /** full：すべて使える。read_only：読むだけ（未払い・テスト版に入れない人など。今の判定と同じ）。none：使えない（契約前・見つからない） */
  access: "full" | "read_only" | "none";
  /** 契約の使える状態（今の Entitlement。画面の帯・読むだけの理由に使う） */
  billing: Entitlement;
  /** 料金なし（運営者・料金なしの印・テスト用のグループ） */
  billingExempt: boolean;
  /** 運営者か */
  operator: boolean;
  /** ONの機能（アプリが登録した名前。Threadsでは autopost・strategy・team） */
  features: ReadonlySet<string>;
  /** 上限（アプリが登録した名前。値が null なら上限なし＝運営者） */
  limits: Readonly<Record<string, number | null>>;
  /** 退会を受け付けた人か（PR2b で足した）。アプリは、退会の出来事が届いて片づけるまでの間、その人の持ち物を誰にも見せず、自動の処理も止める */
  withdrawn: boolean;
  /** 画面と記録に出す名前（PR2b で足した。peopleNames と同じ決め方。利用権と一緒に読めば、名前を別に読まずに済む） */
  name: string;
};
```

- 今の判定（`loadEntitlement`・`effectiveLimits`・`featureOnSql`・`billingExemptSql`・`fullAccessSql`・`testAccessSql`・`dailyPostLimitSql`）を1つにまとめたもの。読む列は今の`loadEntitlement`と同じもの（`billingFactsColumns`）を使う。
- アカウントの数の上限は、Threadsが`billing.accountLimit`（契約の状態による上限。読むだけなら0）と`limits.accounts`（運営者が決める上限）の**小さい方**を使う（今の`accountLimitFor`と同じ）。共通は、上限の名前の意味を知らないので、この組み合わせはしない。**同じ利用者・同じ時刻なら、今の判定と同じ結果になること**を、テストで確かめる（024の前に始めた無料体験の途中の人も含む）。

## 3. 出来事

### 書く（共通）

```ts
await emitEvent(tx, "user.withdrawn", { userId });
```

- `tx`は共通のトランザクション。表の変更と同じトランザクションで書く。
- 退会（PR2b）：共通は `withdrawn_users` に書いたトランザクションで `user.withdrawn` を書き、その出来事だけをすぐ届ける（`deliverPendingEvents(env, now, { eventIds })`）。日次の続きでは、契約を止め直さず、失敗で止まった届けを戻してから届け直す（`rearmFailedDeliveries`）。`withdrawn_users` の行は、`users` の行が消えたあとにだけ片づける。`users` の行は、その出来事がすべての届け先で済んだあとで消す（`deleteUserRowIfCleaned`。PR3 で外部キーを外すまでは、先に消すとアプリの行が外部キーで消えて片づけられないため）。届かなければ、5分ごとの届けと日次の退会の続きでやり直す。
- 書いたあと、応答を返してから`ctx.waitUntil(deliverPendingEvents(env))`ですぐに届ける。届かなかった分は、5分ごとの定期処理（`*/5 * * * *`の最初）でやり直す。

### 受け取る（アプリ）

```ts
// apps/api/src/app.ts（組み立て）で登録する
registerConsumer("threads", "user.withdrawn", onUserWithdrawn);
```

```ts
// Threadsの受け取り（apps/threads の中）。受け取りには DB を渡さないので、自分でトランザクションを開く
async function onUserWithdrawn(event: PlatformEvent<"user.withdrawn">, env: Env): Promise<void> {
  const done = await withTransaction(env.DATABASE_URL, async (tx) => {
    if (!(await markReceived(tx, event.id))) return false; // もう受け取った
    // … 自分の表だけを直す
    return true;
  });
  if (done) await reportUsage(createDb(env.DATABASE_URL), event.payload.userId, "threads", { quantity: 0, using: false });
}
```

- 受け取りは、自分のトランザクションの中で`threads.received_events`に番号を書く。もうあれば、何もしないで成功を返す（2回届いても同じ結果）。
- 例外を投げたら失敗。共通がやり直す（5分・10分・20分・…・最大1時間あける。10回で止めて`failed`）。試した回数は、届ける前（借りるとき）に数え、上限に達したまま残った行は受け取りを呼ばずに`failed`にするので、受け取りの途中で Worker が止まり続けても、いつかは`failed`で止まる。
- 5分ごとの定期処理では、出来事の届けと自動投稿を同時に動かす（届けで自動投稿を待たせない）。

### 種類（このfeature）

| 種類 | 中身 | いつ書く | Threadsの受け取り |
|---|---|---|---|
| `user.withdrawn` | `{ userId }` | 退会の処理（`platform/withdrawal`）が、利用者を退会にしたのと同じトランザクション（その人の出来事がまだないときだけ。1人に1回） | 持ち主のアカウントを消す（テスター招待の片づけ・Metaのデータ削除の要求の完了を含む）・メンバーとチームから外す・作った人の欄を空にする。利用の数は伝えない（共通が、届いたあとで `users` の行と一緒に利用の数の行も消す。PR2b） |
| `limits.changed` | `{ app, userId? }`（`userId`がなければ既定の値の変更） | 運営者が上限を保存したのと同じトランザクション | 自動投稿を起こす（`notifyWake`） |

- 新しい種類を足すときは、この表と`platform_events.type`の`CHECK`の形に合うことを確かめる。中身に入れるのは番号だけ（メールアドレス・名前・本文は入れない）。

## 4. 利用の数（`reportUsage`）

- Threadsは、次のたびに、自分のトランザクションが終わったあとで、その人の数を数えて伝える：アカウントを作る・消す（Metaのデータ削除を含む）・持ち主が変わる・チームに入る・抜ける・退会の出来事を受け取る。
  - `quantity`：持ち主としてのアカウントの数（今の`countOwned`と同じ数え方）。
  - `using`：`quantity > 0`か、チームに1つ以上入っているか（今の`resolveMeApps`の判定と同じ）。
- 応答を返す**前**に呼ぶ（作った直後に契約の画面を開いても、新しい数になるように）。
- 数えた時刻（`countedAt`）を渡す。共通は、もっと新しい時刻の値がもう入っていれば書かない（同じ人の数を同時に伝えたとき、先に数えた古い値で上書きしない）。
- 共通は`app_usage`を書き、料金の数（全アプリの合計。最低1）が**最後にStripeへ送った数（`subscriptions.quantity`）と違えば**`subscriptions.quantity_sync_needed`に印を付け、今の仕組みでStripeの数を合わせる。前と比べて変わったかでは決めないので、途中で止まって印が付かなくても、同じ数を伝え直せば付き直る。
- 失敗に備えて、Threadsは毎日のまとめ処理で、全員の数を数え直して伝える（ずれを1日以内に直す）。
- 共通の`/api/me`の`apps.using`は、`app_usage.using`から決める。

## 5. 機能と上限の登録

```ts
// apps/api/src/app.ts（組み立て）
registerAppFeatures("threads", [
  { key: "autopost", label: "自動投稿", description: "投稿をつくる・投稿ストック・パフォーマンスのまとまりです" },
  { key: "strategy", label: "戦略" },
  { key: "team", label: "チーム" },
]);
registerAppLimits("threads", {
  accounts: { label: "アカウントの数", min: 1, max: 1000 },
  daily_posts: { label: "1日の投稿数", min: 1, max: 250 },
});
```

- 表示名は今の`FEATURE_LABELS`、説明（任意）は今の運営の画面の説明の文（`settings/features.tsx`の「自動投稿は、…のまとまりです」）をそのまま写す。説明のない機能は、説明を出さない。
- 外枠の運営の画面は、`GET /api/operator/app-registry`（運営者だけ）で、登録されたアプリごとの機能と上限の一覧を読んで出す（外枠にThreadsの名前を書かない）。

- 共通の運営の画面と、機能のON/OFF・上限のAPIは、登録された一覧で値を確かめる。登録していない名前は400（`VALIDATION_FAILED`）。
- 共通のコードに、Threadsの名前（`autopost`・`accounts`など）を書かない。

## 6. テスト

- `loadAppEntitlement(s)`：今の判定と同じ結果になること（契約中・未払い・契約前・料金なし・運営者・テスト用のグループ・機能のOFF・024の前の無料体験）。まとめて読んでも1人ずつと同じこと。
- 出来事：書いたトランザクションが戻ったら出来事も残らないこと。すぐに届くこと。失敗したらやり直すこと。10回で`failed`になること。同じ出来事を2回届けても結果が同じこと（受け取りの側）。
- `reportUsage`：数が変わったら`quantity_sync_needed`が付くこと。同じ数なら付かないこと。行がない人は数0・使っていないとみなすこと。
