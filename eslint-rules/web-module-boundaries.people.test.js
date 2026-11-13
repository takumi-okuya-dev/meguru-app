// 人物メモの web-module-boundaries の例（specs/people/001-people-memo tasks.md T004）。node --test eslint-rules/ で動かす。
import rule from "./web-module-boundaries.js";
import { ruleTester } from "./rule-test-helpers.js";

const { tester, at, bad } = ruleTester("apps/web/src");

tester.run("web-module-boundaries（人物メモ）", rule, {
  valid: [at("app-list.ts", 'import { peopleApp } from "@/apps/people";')],
  invalid: [
    // Threadsを直接使えない
    bad(
      "apps/people/pages/ImportPage.tsx",
      'import { threadsApp } from "@/apps/threads";',
      "appToApp",
    ),
  ],
});
