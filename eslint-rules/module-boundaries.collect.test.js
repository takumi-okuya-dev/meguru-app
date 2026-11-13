// 集金管理の module-boundaries の例（specs/collect/001-event-day-collection tasks.md T006）。node --test eslint-rules/ で動かす。
import rule from "./module-boundaries.js";
import { ruleTester } from "./rule-test-helpers.js";

const { tester, at, bad } = ruleTester("apps/api/src");

tester.run("module-boundaries（集金管理）", rule, {
  valid: [
    // 共通の入口と自分のフォルダーは読んでよい
    at(
      "apps/collect/events/event-service.ts",
      'import { requireAppAccess } from "../../../platform";',
    ),
    at("apps/collect/events/event-service.ts", 'import { loadOwnedEvent } from "../access";'),
    at("db/schema.ts", 'export * from "../apps/collect/schema";'),
    at("app-modules.ts", 'import { collectModule } from "./apps/collect";'),
  ],
  invalid: [
    // 共通の表の定義・Threadsのモジュールを読めない
    bad(
      "apps/collect/events/event-service.ts",
      'import { users } from "../../../platform/schema";',
      "appToPlatformSchema",
    ),
    bad(
      "apps/collect/events/event-service.ts",
      'import { accounts } from "../../threads/schema";',
      "appToApp",
    ),
    bad("apps/collect/index.ts", 'import { x } from "../threads";', "appToApp"),
    bad("app.ts", 'import { x } from "./apps/collect/events/event-service";', "notEntry"),
  ],
});
