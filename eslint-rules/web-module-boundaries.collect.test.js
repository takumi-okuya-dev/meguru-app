// 集金管理の web-module-boundaries の例（specs/collect/001-event-day-collection tasks.md T007）。node --test eslint-rules/ で動かす。
import rule from "./web-module-boundaries.js";
import { ruleTester } from "./rule-test-helpers.js";

const { tester, at, bad } = ruleTester("apps/web/src");

tester.run("web-module-boundaries（集金管理）", rule, {
  valid: [
    at("app-list.ts", 'import { collectApp } from "@/apps/collect";'),
    at("apps/collect/pages/RosterPage.tsx", 'import { PageHeader } from "@/shell";'),
  ],
  invalid: [
    // Threads の部品を使えない（R18）
    bad(
      "apps/collect/pages/RosterPage.tsx",
      'import { QrCode } from "@/apps/threads/components/QrCode";',
      "appToApp",
    ),
  ],
});
