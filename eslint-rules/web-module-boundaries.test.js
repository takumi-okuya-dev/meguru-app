// web-module-boundaries のテスト（specs/028-meguru-shell contracts/web-module-boundaries.md 3、T003・T059）。node --test eslint-rules/ で動かす。
import { describe, it } from "node:test";
import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";
import rule from "./web-module-boundaries.js";

// RuleTester を node:test の describe・it で動かす
RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({
  languageOptions: {
    parser: tseslint.parser,
    ecmaVersion: 2022,
    sourceType: "module",
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

const SRC = "/repo/apps/web/src";
/**
 * テストの1件を作る。
 * @param file - src からのファイルのパス
 * @param code - コード
 * @returns RuleTester のテストの1件
 */
const at = (file, code) => ({ filename: `${SRC}/${file}`, code });
/**
 * 違反するテストの1件を作る。
 * @param file - src からのファイルのパス
 * @param code - コード
 * @param messageId - 期待するメッセージ
 * @returns RuleTester のテストの1件
 */
const bad = (file, code, messageId) => ({ ...at(file, code), errors: [{ messageId }] });
/** ⑦を確かめるときのオプション。 */
const strict = [{ strictPlacement: true }];

tester.run("web-module-boundaries", rule, {
  valid: [
    // アプリ → 外枠の入口・共通の部品・共有のパッケージ
    at("apps/threads/pages/stock.tsx", 'import { PageHeader } from "@/shell";'),
    at("apps/threads/pages/stock.tsx", 'import { PageHeader } from "@/shell/index";'),
    at("apps/threads/pages/stock.tsx", 'import { Button } from "@/components/ui/button";'),
    at("apps/threads/pages/stock.tsx", 'import { cn } from "@/lib/utils";'),
    at("apps/threads/pages/stock.tsx", 'import { errorMessage } from "@meguru/shared";'),
    at("apps/threads/pages/stock.tsx", 'import { useQuery } from "@tanstack/react-query";'),
    // 同じアプリの中は、相対パスでも別名でもよい
    at("apps/threads/pages/stock.tsx", 'import { DraftList } from "../components/stock/DraftList";'),
    at("apps/threads/pages/stock.tsx", 'import { DraftList } from "@/apps/threads/components/stock/DraftList";'),
    at("apps/threads/index.ts", 'export { threadsRoutes } from "./routes";'),
    // 仮のアプリにも同じに当たる
    at("apps/sample/pages/home.tsx", 'import { AppShell } from "@/shell";'),
    at("apps/sample/pages/home.tsx", 'import { x } from "../lib/x";'),
    // 外枠 → 外枠の中・共通の部品
    at("shell/layout/Sidebar.tsx", 'import { UserMenu } from "./UserMenu";'),
    at("shell/layout/Sidebar.tsx", 'import { useAppRegistry } from "@/shell/app-module";'),
    at("shell/layout/Sidebar.tsx", 'import { Button } from "@/components/ui/button";'),
    at("shell/settings/billing.tsx", 'import { api } from "../../lib/api-client";'),
    // 共通の部品 → 共通の部品
    at("lib/query.ts", 'import { api } from "./api-client";'),
    at("components/ApiErrorScreen.tsx", 'import { ErrorScreen } from "@/components/ErrorScreen";'),
    at("components/ui/sonner.tsx", 'import { useTheme } from "@/lib/theme";'),
    // 組み立て → 入口
    at("app-registry.ts", 'import { threadsApp } from "@/apps/threads";'),
    at("app-registry.ts", 'import { threadsApp } from "./apps/threads/index";'),
    at("router.tsx", 'import { RequireAuth } from "@/shell";'),
    at("main.tsx", 'import { router } from "./router";'),
    at("main.tsx", 'import "./index.css";'),
    // strictPlacement：決めた置き場所はよい
    { ...at("shell/pages/apps.tsx", "export const x = 1;"), options: strict },
    { ...at("apps/threads/routes.tsx", "export const x = 1;"), options: strict },
    { ...at("components/ui/button.tsx", "export const x = 1;"), options: strict },
    { ...at("lib/utils.ts", "export const x = 1;"), options: strict },
    { ...at("router.tsx", "export const x = 1;"), options: strict },
    { ...at("app-registry.ts", "export const x = 1;"), options: strict },
    { ...at("main.tsx", "export const x = 1;"), options: strict },
    // テストなど src の外にはかけない
    { filename: "/repo/apps/web/test/stock.test.tsx", code: 'import { DraftList } from "@/apps/threads/components/stock/DraftList";' },
  ],
  invalid: [
    // ① アプリ同士
    bad("apps/sample/pages/home.tsx", 'import { threadsApp } from "@/apps/threads";', "appToApp"),
    bad("apps/threads/pages/stock.tsx", 'import { x } from "../../sample/lib/x";', "appToApp"),
    bad("apps/sample/index.ts", 'export * from "@/apps/threads/routes";', "appToApp"),
    // ② 外枠 → アプリ（入口も）
    bad("shell/layout/Sidebar.tsx", 'import { threadsApp } from "@/apps/threads";', "shellToApp"),
    bad("shell/layout/Sidebar.tsx", 'import { Body } from "../../apps/threads/sidebar/Body";', "shellToApp"),
    bad("shell/pages/apps.tsx", 'const m = await import("@/apps/threads");', "shellToApp"),
    // ③ アプリ → 外枠の入口でないところ
    bad("apps/threads/pages/stock.tsx", 'import { Sidebar } from "@/shell/layout/Sidebar";', "notEntry"),
    bad("apps/threads/pages/stock.tsx", 'import { x } from "../../../shell/settings/sections";', "notEntry"),
    bad("apps/sample/pages/home.tsx", 'type T = import("@/shell/app-module").AppModule;', "notEntry"),
    // ④ 共通の部品 → 外枠・アプリ・組み立て
    bad("lib/api-client.ts", 'import { x } from "@/shell";', "commonToUpper"),
    bad("components/ApiErrorScreen.tsx", 'import { RequireFeature } from "@/apps/threads";', "commonToUpper"),
    bad("components/ui/button.tsx", 'import { x } from "../../router";', "commonToUpper"),
    bad("lib/query.ts", 'export { x } from "../apps/threads/lib/query-keys";', "commonToUpper"),
    // ⑤ 外枠・アプリ → 組み立て
    bad("shell/layout/Sidebar.tsx", 'import { router } from "@/router";', "toComposition"),
    bad("apps/threads/pages/stock.tsx", 'import { registeredApps } from "@/app-registry";', "toComposition"),
    // ⑥ 組み立て → 入口でないところ
    bad("router.tsx", 'import { Sidebar } from "@/shell/layout/Sidebar";', "notEntry"),
    bad("app-registry.ts", 'import { threadsRoutes } from "./apps/threads/routes";', "notEntry"),
    // ⑦ 置き場所の外
    { ...bad("pages/foo.tsx", "export const x = 1;", "unplaced"), options: strict },
    { ...bad("hooks/use-x.ts", "export const x = 1;", "unplaced"), options: strict },
  ],
});
