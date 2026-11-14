# 取り決め：モジュールの境界の変更（029）

**対象**：APIのESLintの規則`module-boundaries`（`eslint-rules/module-boundaries.js`）と、Webの規則`web-module-boundaries`、[docs/module-map.md](../../../../docs/module-map.md)。判断は[research.md](../research.md) R1・R10・R11。027の取り決め（[specs/027 contracts/module-boundaries.md](../../../027-modular-monolith/contracts/module-boundaries.md)）の上に足す。

## 1. 依存の向き（変えない）

```text
組み立て → アプリ → 共通 → 窓口 → 土台   （上から下へだけ。飛ばしてもよい）
```

- 変わるのは、**共通の入口から出すもの**と、**アプリが読んでよいもの**。

## 2. APIの入口（あと）

| モジュール | 入口 | ほかのモジュールから読んでよいもの |
|---|---|---|
| 共通 | `platform/index.ts` | **入口の関数と型だけ**（[platform-entry.md](./platform-entry.md) 2〜5）。表の定義・SQLの部品は出さない |
| 共通の表の定義 | `platform/schema.ts` | **組み立て（`db/schema.ts`）だけ**。アプリは読めない（今はThreadsが読んでいる） |
| アプリ | `apps/<名前>/index.ts` | 組み立てだけ |
| アプリの表の定義 | `apps/<名前>/schema.ts` | 組み立て（`db/schema.ts`）だけ |
| 窓口 | `adapters/<名前>/index.ts` | 今のまま |
| 土台 | `kernel/` | 今のまま。招待のトークンの部品（`kernel/invite-token.ts`）を足す |

## 3. 規則に足す違反

| 型 | 例 | メッセージ（要旨） |
|---|---|---|
| アプリ → 共通の表の定義 | `apps/threads/…`から`../../platform/schema` | 「アプリは共通の表を読めません。共通の入口の関数（platform/index.ts）を使ってください（docs/app-separation.md）」 |
| 共通 → アプリの表の定義 | `platform/…`から`../apps/threads/schema`・`../db/schema` | 「共通はアプリの表を読めません。出来事でアプリに伝えてください」 |

- `db/schema.ts`（組み立て）は、drizzle-kitとテストのために、共通とThreadsの表を読み直して出す（今のまま）。共通・アプリのコードが`db/schema.ts`を経由して、ほかのモジュールの表を読むことも止める。
- 027の例外（`platform/schema.ts`がThreadsの`tester_applications`を読む1か所の`eslint-disable-next-line`）は、外部キーを外すので消す（[module-map.md](../../../../docs/module-map.md) 4章）。
- 規則のテスト（`eslint-rules/module-boundaries.test.js`）に、上の2つの型と、通る例（アプリ → `platform/index.ts`の入口の関数）を足す。

## 4. 出来事の登録（組み立て）

```ts
// apps/api/src/app.ts
registerAppFeatures("threads", THREADS_FEATURES);
registerAppLimits("threads", THREADS_LIMITS);
registerConsumer("threads", "user.withdrawn", onUserWithdrawn);
registerConsumer("threads", "limits.changed", onLimitsChanged);
```

- 今の`registerThreads()`（知らせの登録）を、この形に置き換える。登録は何度呼んでも1回だけ（今の`registerModule`と同じ）。
- `platform/hooks.ts`（`registerHook`・`runHook`）は消す。

## 5. Webの境界（028の上に足す）

- `lib/api-client.ts`・`lib/query.ts`（共通の部品）に、ThreadsのAPIの呼び出し・キーを置かない。Threadsの分は`apps/threads/lib/`に置く（[api-routes.md](./api-routes.md) 4）。
- 外枠（`shell/`）は、今どおりアプリを読まない。退会の前に見せるThreadsの中身は、Threadsが`AppModule`の`withdrawalPreview`として渡す。

```ts
// apps/web/src/shell/app-module.ts（足す項目）
type AppModule = {
  // …今の項目
  /** 退会の確かめで、このアプリについて見せる中身（なければ出さない） */
  withdrawalPreview?: {
    /** 中身を読む（TanStack Query の queryKey と queryFn） */
    query: { queryKey: readonly unknown[]; queryFn: () => Promise<unknown> };
    /** 読んだ中身を出す部品 */
    Section: ComponentType<{ data: unknown }>;
  };
};
```

- 退会のダイアログ（`components/billing/WithdrawDialog.tsx`）は、登録されたアプリの`withdrawalPreview`を並べて出す。見た目と文言は今のまま。
- Webの規則に足すもの：`lib/`からThreadsのAPIの道筋（`/api/threads/`）を書いた呼び出しを止めるのは文字列の検査になり、規則では書きにくい。そこで、共通の`api-client.ts`のテスト（道筋の一覧）で、Threadsの道筋がないことを確かめる。

## 6. 地図（docs/module-map.md）の直し

- 2章：共通の表（11＋新しい5）とThreadsの表（31＋新しい2）、処理の行き先。
- 3章「持ち主でないモジュールが書き換えてよい列」：なくなる（`accounts`がThreadsの持ち物になり、`tester_slot_capacity`も移るため）。
- 1-4「知らせ」：出来事に書き換える（種類・書くところ・受け取り）。
- 6章「アプリのモジュールを足す手順」：Threadsを実例にして、パターン①の手順にする（spec FR-023）。
