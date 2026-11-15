import js from "@eslint/js";
import jsdoc from "eslint-plugin-jsdoc";
import globals from "globals";
import tseslint from "typescript-eslint";
import moduleBoundaries from "./eslint-rules/module-boundaries.js";
import webModuleBoundaries from "./eslint-rules/web-module-boundaries.js";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/coverage/**",
      "**/.wrangler/**",
      "apps/api/drizzle/**",
      "e2e/test-results/**",
      "e2e/playwright-report/**",
      "_bmad/**",
      "_bmad-output/**",
      "agent/**",
      ".claude/**",
      ".specify/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  // APIのモジュールの境界（specs/027-modular-monolith、docs/module-map.md）。
  // 土台・窓口・共通・アプリ・組み立ての依存の向きと、ほかのモジュールは入口から読む決まりを守る。テスト・scripts にはかけない。
  {
    files: ["apps/api/src/**/*.ts"],
    plugins: { local: { rules: { "module-boundaries": moduleBoundaries } } },
    rules: { "local/module-boundaries": ["error", { strictPlacement: true }] },
  },
  // Webのモジュールの境界（specs/028-meguru-shell、docs/module-map.md「Webの境界」）。
  // 共通の部品・外枠・アプリ・組み立ての依存の向きと、ほかのモジュールは入口から読む決まりを守る。テストにはかけない。
  {
    files: ["apps/web/src/**/*.{ts,tsx}"],
    plugins: { local: { rules: { "web-module-boundaries": webModuleBoundaries } } },
    rules: { "local/web-module-boundaries": ["error", { strictPlacement: true }] },
  },
  // ドキュメントコメント（JSDoc）。外部に公開している関数・クラス・型には説明を付ける。
  // TypeScript では型はコードに書くので、JSDoc には型（{string} など）を書かない。
  {
    files: ["apps/*/src/**/*.{ts,tsx}", "apps/api/scripts/**/*.ts", "packages/*/src/**/*.ts"],
    ignores: ["apps/web/src/components/ui/**"],
    plugins: { jsdoc },
    settings: { jsdoc: { mode: "typescript" } },
    rules: {
      "jsdoc/require-jsdoc": [
        "error",
        {
          publicOnly: true,
          require: { FunctionDeclaration: true, ClassDeclaration: true, ArrowFunctionExpression: true, MethodDefinition: false },
          contexts: ["TSTypeAliasDeclaration", "TSInterfaceDeclaration", "ExportNamedDeclaration > VariableDeclaration"],
        },
      ],
      "jsdoc/require-description": ["error", { contexts: ["any"] }],
      "jsdoc/require-param": ["error", { checkDestructured: false, unnamedRootBase: ["props"] }],
      "jsdoc/require-param-description": "error",
      "jsdoc/check-param-names": ["error", { checkDestructured: false }],
      // React のコンポーネントの props は分割代入で受け取るので、まとめて @param props で説明する
      "jsdoc/require-returns": ["error", { checkGetters: false, forceReturnsWithAsync: false }],
      "jsdoc/require-returns-description": "error",
      "jsdoc/no-types": "error",
      "jsdoc/check-tag-names": "error",
    },
  },
);
