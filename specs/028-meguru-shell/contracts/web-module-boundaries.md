# Webのモジュールの境界（契約）：めぐるの外枠とWebの分割

**日付**：2026-11-12 | **計画**：[../plan.md](../plan.md)

APIの境界（[specs/027 contracts/module-boundaries.md](../../027-modular-monolith/contracts/module-boundaries.md)）のWeb版。実装のあと、[docs/module-map.md](../../../docs/module-map.md)にWebの章として写し、そちらを正本にする。

## 1. 種類と入口

`apps/web/src`からのパス。

| 種類 | 置き場所 | 入口（ほかの種類が読んでよいところ） |
|---|---|---|
| 共通の部品 | `components/**`・`lib/**` | どのファイルも読んでよい |
| 外枠 | `shell/**` | `shell/index.ts`だけ |
| アプリ | `apps/<名前>/**` | `apps/<名前>/index.ts`だけ |
| 組み立て | `main.tsx`・`router.tsx`・`app-registry.ts` | （読まれない） |

- 同じ種類の中（外枠の中同士、同じアプリの中同士、共通の部品同士）は、入口を通さずに読んでよい。
- `@meguru/shared`と外部のライブラリは、どこからでも読んでよい。
- CSS（`index.css`）は組み立て（`main.tsx`）だけが読む。

## 2. 依存の向き

```text
組み立て ──▶ アプリの入口 ──┐
   │                        ▼
   └──────▶ 外枠の入口 ◀── アプリ
                │            │
                ▼            ▼
              共通の部品 ◀───┘
```

| 読む側 → 読まれる側 | 共通の部品 | 外枠 | 同じアプリ | ほかのアプリ | 組み立て |
|---|---|---|---|---|---|
| 共通の部品 | ○ | ×④ | ×④ | ×④ | ×④ |
| 外枠 | ○ | ○ | ×② | ×② | ×⑤ |
| アプリ | ○ | 入口だけ③ | ○ | ×① | ×⑤ |
| 組み立て | ○ | 入口だけ⑥ | 入口だけ⑥ | 入口だけ⑥ | ○ |

- ⑦：上のどの置き場所にも入らないファイル（例：`src/pages/foo.tsx`）は、失敗にする。
- 丸数字は、ESLintの規則（`local/web-module-boundaries`）の知らせの種類。知らせには、どのモジュールの境界を越えたかと、`docs/module-map.md`の場所を書く。
- 外枠はアプリを読まない。アプリの一覧は、組み立てが`AppRegistryProvider`で外枠に渡す（research.md R1）。

## 3. 規則のかけ方

- 対象：`apps/web/src/**/*.{ts,tsx}`。`apps/web/test/**`・設定ファイルにはかけない（テストは新しい置き場所を直接読んでよい）。
- 読みこみ先の判定：`@/…`は`src/…`、`./`・`../`はファイルの場所から求める。`import`・`export … from`・`import()`・型の`import("…")`を見る。
- アプリの判定はパスの形（`apps/<名前>/`）で行う。アプリを足しても、設定は書き足さない（spec FR-009）。
- 規則のテスト（`eslint-rules/web-module-boundaries.test.js`、`node --test`）：①〜⑦のそれぞれが失敗すること、通る例（アプリ → 外枠の入口・共通の部品、組み立て → 入口）が通ること、新しいアプリのフォルダー（`apps/sample/`）にも同じに当たること、`@/`と相対パスの両方で当たること。

## 4. 境界の例外

今すぐ直せない違反は、`eslint-disable-next-line local/web-module-boundaries -- <理由>`で止め、`docs/module-map.md`の「境界の例外」に、場所・理由・解消の予定を書く。3件以下を目標にする（spec SC-004）。

## 5. アプリを足す手順（spec FR-010。module-map.md に写す）

1. `packages/shared/src/apps.ts`の`APP_CATALOG`に1行足す（ID・名前・パス・説明・料金・`released: false`）。
2. `apps/web/src/apps/<名前>/`を作り、`index.ts`で`AppModule`を出す（ルートは`/<名前>/…`の下。ログインのいらないページも`/<名前>/…`の下）。
3. `apps/web/src/app-registry.ts`に、そのアプリを1行足す（**外枠のほかの場所は直さない**）。
4. APIは`apps/api/src/apps/<名前>/`に足す（027の手順）。`/api/me`の`using`の判定を足す（2作目では、アプリごとの利用権と一緒に決め直す）。
5. 共通のパッケージに置くものは`packages/shared/src/apps/<名前>/`に置き、`@meguru/shared/<名前>`で読む。
6. 業務の判断とデータのやりとりは、APIと共通のパッケージに置く（モバイル化を見込んだ決まり。research.md R14）。
7. 出してよくなったら、`released: true`にする。
