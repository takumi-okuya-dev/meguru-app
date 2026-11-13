// module-boundaries のテスト（specs/027-modular-monolith contracts/module-boundaries.md 4、T003）。node --test eslint-rules/ で動かす。
import { describe, it } from "node:test";
import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";
import rule from "./module-boundaries.js";

// RuleTester を node:test の describe・it で動かす
RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({ languageOptions: { parser: tseslint.parser, ecmaVersion: 2022, sourceType: "module" } });

const SRC = "/repo/apps/api/src";
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

tester.run("module-boundaries", rule, {
  valid: [
    at("apps/threads/drafts/draft-service.ts", 'import { authorizeAccount } from "../../../platform";'),
    at("apps/threads/drafts/draft-service.ts", 'import { authorizeAccount } from "../../../platform/index";'),
    at("apps/threads/drafts/draft-service.ts", 'import { AppError } from "../../../kernel/errors";'),
    at("apps/threads/drafts/draft-service.ts", 'import { stripe } from "../../../adapters/stripe";'),
    at("apps/threads/drafts/draft-service.ts", 'import { x } from "../publish/publish-claim";'),
    at("platform/billing/billing-service.ts", 'import { x } from "../teams/team-service";'),
    at("platform/billing/billing-service.ts", 'import { logger } from "../../kernel/logger";'),
    at("platform/billing/billing-service.ts", 'import { createStripe } from "../../adapters/stripe";'),
    at("adapters/stripe/stripe-client.ts", 'import type { Env } from "../../kernel/env";'),
    at("adapters/stripe/index.ts", 'export * from "./stripe-client";'),
    at("kernel/config.ts", 'import { createTokenCipher } from "./crypto";'),
    at("app.ts", 'import { threadsRoutes } from "./apps/threads";'),
    at("jobs/daily-jobs.ts", 'import { runDaily } from "../platform";'),
    // 並べ替えの前の場所（組み立てとみなす）は、どこを読んでもよい
    at("services/account-service.ts", 'import { x } from "./tester-application-service";'),
    at("apps/threads/drafts/draft-service.ts", 'import { z } from "zod";'),
    // 表の定義（schema.ts）は入口として読んでよい（db/schema.ts が共通とThreadsの表を読み直して出す）
    at("db/schema.ts", 'export * from "../platform/schema";'),
    at("db/schema.ts", 'export * from "../apps/threads/schema";'),
    // 人物メモ（specs/people/001-people-memo tasks.md T003）：共通の入口は読める
    at("apps/people/imports/import-service.ts", 'import { reportUsage } from "../../../platform";'),
    at("db/schema.ts", 'export * from "../apps/people/schema";'),
    // strictPlacement：組み立ての場所はよい
    { ...at("jobs/daily-jobs.ts", 'import { x } from "../platform";'), options: [{ strictPlacement: true }] },
    { ...at("app.ts", 'import { x } from "./platform";'), options: [{ strictPlacement: true }] },
  ],
  invalid: [
    // アプリは共通の表の定義を読めない（入口の関数だけを使う。specs/meguru/029-threads-pattern1 contracts/module-boundaries.md 3、T038）
    bad("apps/threads/drafts/draft-service.ts", 'import { users } from "../../../platform/schema";', "appToPlatformSchema"),
    bad("apps/threads/schema.ts", 'import { users } from "../../platform/schema";', "appToPlatformSchema"),
    bad("apps/threads/drafts/draft-service.ts", 'import { users } from "../../../db/schema";', "lowerToUpper"),
    bad("platform/billing/billing-service.ts", 'import { accounts } from "../../apps/threads/schema";', "platformToApp"),
    bad("platform/billing/billing-service.ts", 'import { accounts } from "../../db/schema";', "lowerToUpper"),
    bad("apps/threads/drafts/draft-service.ts", 'import { x } from "../../../platform/billing/billing-service";', "notEntry"),
    bad("apps/threads/drafts/draft-service.ts", 'import { x } from "../../../adapters/stripe/stripe-client";', "notEntry"),
    bad("app.ts", 'import { x } from "./apps/threads/drafts/draft-service";', "notEntry"),
    bad("platform/accounts/account-service.ts", 'import { x } from "../../apps/threads";', "platformToApp"),
    bad("apps/sample/index.ts", 'import { x } from "../threads";', "appToApp"),
    // 人物メモは共通の表の定義と、Threadsを読めない（T003）
    bad("apps/people/persons/person-list.ts", 'import { users } from "../../../platform/schema";', "appToPlatformSchema"),
    bad("apps/people/imports/import-service.ts", 'import { accounts } from "../../threads/schema";', "appToApp"),
    bad("adapters/stripe/stripe-client.ts", 'import { x } from "../../platform";', "lowerToUpper"),
    bad("kernel/config.ts", 'import { x } from "../adapters/stripe";', "lowerToUpper"),
    bad("kernel/config.ts", 'import { x } from "../platform";', "lowerToUpper"),
    bad("platform/accounts/account-service.ts", 'import { x } from "../../services/tester-application-service";', "lowerToUpper"),
    bad("platform/accounts/account-service.ts", 'import type { X } from "../../apps/threads";', "platformToApp"),
    bad("platform/index.ts", 'export { x } from "../apps/threads";', "platformToApp"),
    bad("platform/index.ts", 'export * from "../apps/threads";', "platformToApp"),
    bad("platform/accounts/account-service.ts", 'const m = await import("../../apps/threads");', "platformToApp"),
    bad("platform/accounts/account-service.ts", "const m = await import(`../../apps/threads`);", "platformToApp"),
    bad("platform/accounts/account-service.ts", 'type T = import("../../apps/threads").Foo;', "platformToApp"),
    bad("platform/accounts/account-service.ts", 'type T = typeof import("../../apps/threads/drafts/draft-service");', "platformToApp"),
    bad("platform/accounts/account-service.ts", 'import x = require("../../apps/threads");', "platformToApp"),
    bad("apps/threads/drafts/draft-service.ts", 'type T = import("../../../platform/billing/billing-service").X;', "notEntry"),
    // strictPlacement：どのモジュールにも入っていないファイル
    { ...bad("services/foo.ts", 'export const x = 1;', "unplaced"), options: [{ strictPlacement: true }] },
    { ...bad("lib/bar.ts", 'export const y = 1;', "unplaced"), options: [{ strictPlacement: true }] },
  ],
});
