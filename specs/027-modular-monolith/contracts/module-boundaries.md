# 境界の約束：Threadsアプリをモジュラーモノリスに整理する

**日付**：2026-11-10 | **計画**：[../plan.md](../plan.md)

モジュールの種類と置き場所は[research.md](../research.md) R1、表と処理の行き先は[data-model.md](../data-model.md)。

## 1. 依存の向き

```text
組み立て（app.ts・index.ts・jobs/）
   │  すべての入口を使ってよい
   ▼
アプリ（apps/<名前>/）── アプリ同士は使わない
   │
   ▼
共通（platform/）── アプリを使わない（呼ぶときは知らせ。3）
   │
   ▼
窓口（adapters/<名前>/）── 共通・アプリを使わない
   │
   ▼
土台（kernel/）── 土台のほかは使わない
```

- 上から下へだけ使ってよい。飛ばしてもよい（アプリ → 土台）。
- 同じモジュールの中（`platform/`の小分け同士、`apps/threads/`の小分け同士）は自由に使ってよい。

## 2. 入口

| モジュール | 入口 | ほかのモジュールからの読み方 |
|---|---|---|
| 共通 | `platform/index.ts`・`platform/schema.ts` | `../../platform`・`../../platform/schema`（表の定義） |
| アプリ | `apps/<名前>/index.ts`・`apps/<名前>/schema.ts` | 組み立てからだけ（`db/schema.ts`が表の定義を読み直す） |
| 窓口 | `adapters/<名前>/index.ts` | `../../adapters/stripe` など |
| 土台 | （入口なし） | `kernel/`のファイルを直接 |

- 入口は、ほかのモジュールが使う関数・型・表の定義・APIの入口を作る関数だけを出す。
- 表の定義：持ち主のモジュールの`schema.ts`にあり、入口から出す。持ち主でないモジュールは、読むことと、data-model.md 1-3の例外の列の書き換えだけをしてよい。

## 3. 知らせ（共通 → アプリ）

```ts
// platform/hooks.ts（形の約束。名前は data-model.md 3）
registerHook(name, handler)        // 組み立てから、アプリの registerXxx() の中で呼ぶ
await runHook(name, payload)       // 共通の中で、今の呼び出しと同じ場所で await する
```

- 受け取る関数は、登録した順に1つずつ`await`する。例外は呼んだ側にそのまま返す（今の動きと同じ）。
- 受け取るものがなければ何もしない。
- 知らせの一覧（5つ）は[docs/module-map.md](../../../docs/module-map.md) 1-4。

## 4. ESLintの規則（`module-boundaries`）

- **かける範囲**：`apps/api/src/**/*.ts`。テスト・`scripts/`にはかけない。
- **違反とメッセージ**：

| 型 | 例 | メッセージ（要旨） |
|---|---|---|
| 入口の外 | `apps/threads`から`../../platform/billing/billing-service` | 「共通（platform）は入口（platform/index.ts）から読んでください」 |
| 共通 → アプリ | `platform/`から`../apps/threads` | 「共通はアプリを使えません。知らせ（platform/hooks）を使ってください」 |
| アプリ同士 | `apps/a`から`../b` | 「アプリ同士は直接使えません」 |
| 窓口・土台 → 上 | `adapters/`から`../../platform`、`kernel/`から`../adapters` | 「窓口（土台）は共通・アプリを使えません」 |

- アプリの判定は`src/apps/<名前>/`の形で行うので、アプリを足しても設定は変えない（spec FR-016）。
- `import type`・`export … from`・`import("…")`（型の中の`import("…")`・`typeof import("…")`、式のないテンプレート文字列を含む）・`import x = require("…")`も同じ規則にかける（型だけでも境界を越えるため）。
- `strictPlacement: true`（027の並べ替えのあとに有効にする）：組み立てと決めた場所（`app.ts`・`index.ts`・`jobs/`・`db/schema.ts`）のほかに、どのモジュールにも入っていないファイルがあれば知らせる。
