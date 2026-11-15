// 人物メモの module-boundaries の例（specs/people/001-people-memo tasks.md T003）。node --test eslint-rules/ で動かす。
import rule from "./module-boundaries.js";
import { ruleTester } from "./rule-test-helpers.js";

const { tester, at, bad } = ruleTester("apps/api/src");

tester.run("module-boundaries（人物メモ）", rule, {
  valid: [
    // 共通の入口は読める
    at("apps/people/imports/import-service.ts", 'import { reportUsage } from "../../../platform";'),
    at("db/schema.ts", 'export * from "../apps/people/schema";'),
    at("app-modules.ts", 'import { peopleModule } from "./apps/people";'),
  ],
  invalid: [
    // 共通の表の定義と、Threadsを読めない
    bad(
      "apps/people/persons/person-list.ts",
      'import { users } from "../../../platform/schema";',
      "appToPlatformSchema",
    ),
    bad(
      "apps/people/imports/import-service.ts",
      'import { accounts } from "../../threads/schema";',
      "appToApp",
    ),
  ],
});
