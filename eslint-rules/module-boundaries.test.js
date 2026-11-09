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
  ],
  invalid: [
    bad("apps/threads/drafts/draft-service.ts", 'import { x } from "../../../platform/billing/billing-service";', "notEntry"),
    bad("apps/threads/drafts/draft-service.ts", 'import { x } from "../../../adapters/stripe/stripe-client";', "notEntry"),
    bad("app.ts", 'import { x } from "./apps/threads/drafts/draft-service";', "notEntry"),
    bad("platform/accounts/account-service.ts", 'import { x } from "../../apps/threads";', "platformToApp"),
    bad("apps/sample/index.ts", 'import { x } from "../threads";', "appToApp"),
    bad("adapters/stripe/stripe-client.ts", 'import { x } from "../../platform";', "lowerToUpper"),
    bad("kernel/config.ts", 'import { x } from "../adapters/stripe";', "lowerToUpper"),
    bad("kernel/config.ts", 'import { x } from "../platform";', "lowerToUpper"),
    bad("platform/accounts/account-service.ts", 'import { x } from "../../services/tester-application-service";', "lowerToUpper"),
    bad("platform/accounts/account-service.ts", 'import type { X } from "../../apps/threads";', "platformToApp"),
    bad("platform/index.ts", 'export { x } from "../apps/threads";', "platformToApp"),
    bad("platform/index.ts", 'export * from "../apps/threads";', "platformToApp"),
    bad("platform/accounts/account-service.ts", 'const m = await import("../../apps/threads");', "platformToApp"),
  ],
});
