// 境界のルールのテストの共通の部品（specs/meguru/031-conflict-free-composition）。アプリごとのテスト（*.<アプリ>.test.js）が使う。
// アプリごとにテストのファイルを分けると、並行開発で同じファイルに行を足し合わずに済む。
import { describe, it } from "node:test";
import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";

// RuleTester を node:test の describe・it で動かす
RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

/**
 * ルールのテストを作る。
 * @param src - 例のファイルを置く場所（apps/api/src・apps/web/src）
 * @returns テストの道具（tester・at・bad）
 */
export function ruleTester(src) {
  const tester = new RuleTester({
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: 2022,
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  });
  /**
   * テストの1件を作る。
   * @param file - src からのファイルのパス
   * @param code - コード
   * @returns RuleTester のテストの1件
   */
  const at = (file, code) => ({ filename: `/repo/${src}/${file}`, code });
  /**
   * 違反するテストの1件を作る。
   * @param file - src からのファイルのパス
   * @param code - コード
   * @param messageId - 期待するメッセージ
   * @returns RuleTester のテストの1件
   */
  const bad = (file, code, messageId) => ({ ...at(file, code), errors: [{ messageId }] });
  return { tester, at, bad };
}
