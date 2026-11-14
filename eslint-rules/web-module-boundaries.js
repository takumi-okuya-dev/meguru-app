// Webのモジュールの境界を守るESLintの規則（specs/028-meguru-shell contracts/web-module-boundaries.md、research.md R2）。
// apps/web/src を 共通の部品（components・lib）・外枠（shell）・アプリ（apps/<名前>）・組み立て（main・router・app-registry）に分け、
// 依存の向き（組み立て → アプリ → 外枠 → 共通の部品。外枠はアプリを読まない）と、ほかのモジュールは入口（index.ts）から読む決まりを確かめる。
// Webは `@/…`（src の別名）で読むことが多いので、別名と相対パスの両方を src からのパスに直して判定する。
// アプリの判定はパスの形（apps/<名前>/）で行うので、アプリを足しても設定は要らない。
import path from "node:path";

/** 組み立てのファイル（src からの相対のパス、拡張子なし）。 */
const COMPOSITION = new Set(["main", "router", "app-registry", "app-list"]);

/**
 * src からの相対のパス（拡張子なし）から、モジュールを求める。
 * @param rel - src からの相対のパス（区切りは /）
 * @returns 種類と単位と、単位の中のパス。どの種類にも入らなければ kind は "unplaced"
 */
export function webModuleOf(rel) {
  const parts = rel.split("/");
  if (parts[0] === "components" || parts[0] === "lib") return { kind: "common", unit: "common", inner: parts };
  if (parts[0] === "shell") return { kind: "shell", unit: "shell", inner: parts.slice(1) };
  // アプリは apps/<名前>/ の中（読みこみ先の `apps/<名前>` はそのフォルダーの入口）。apps/index.ts のような apps の直下のファイルは、どの種類にも入らない
  if (parts[0] === "apps" && (parts.length >= 3 || (parts.length === 2 && parts[1] !== "index"))) {
    return { kind: "app", unit: `apps/${parts[1]}`, inner: parts.slice(2) };
  }
  if (parts.length === 1 && COMPOSITION.has(parts[0])) return { kind: "composition", unit: "composition", inner: parts };
  return { kind: "unplaced", unit: rel, inner: parts };
}

/**
 * 単位の入口か（`shell`・`shell/index`・`apps/x`・`apps/x/index`）。
 * @param target - 読みこみ先のモジュール
 * @returns 入口なら true
 */
function isEntry(target) {
  return target.inner.length === 0 || (target.inner.length === 1 && target.inner[0] === "index");
}

/**
 * パスを src からの相対（拡張子なし・区切りは /）にする。src の外なら null。
 * @param srcDir - src の絶対パス
 * @param abs - 絶対パス
 * @returns 相対のパス
 */
function relFromSrc(srcDir, abs) {
  const rel = path.relative(srcDir, abs).split(path.sep).join("/");
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return rel.replace(/\.d\.(ts|mts|cts)$/, "").replace(/\.(ts|tsx|mts|cts|js|jsx|mjs)$/, "");
}

/** @type {import("eslint").Rule.RuleModule} */
export default {
  meta: {
    type: "problem",
    docs: { description: "Webのモジュールの境界（依存の向きと入口）を守る" },
    schema: [
      {
        type: "object",
        properties: { srcDir: { type: "string" }, strictPlacement: { type: "boolean" } },
        additionalProperties: false,
      },
    ],
    messages: {
      appToApp: "アプリ同士（{{from}} → {{unit}}）は直接使えません（docs/module-map.md「Webの境界」）。",
      shellToApp: "外枠（shell）はアプリ（{{unit}}）を使えません。アプリの一覧は組み立て（app-registry.ts）から受け取ってください（docs/module-map.md「Webの境界」）。",
      notEntry: "{{unit}} は入口（{{unit}}/index.ts）から読んでください（docs/module-map.md「Webの境界」）。",
      commonToUpper: "共通の部品（components・lib）は {{toKind}}（{{unit}}）を使えません（docs/module-map.md「Webの境界」）。",
      toComposition: "{{fromKind}}（{{from}}）は組み立て（{{unit}}）を使えません（docs/module-map.md「Webの境界」）。",
      unplaced:
        "{{from}} はどのモジュールにも入っていません。components・lib・shell・apps/<名前> のどれかに置いてください（組み立ては main・router・app-registry・app-list だけ。docs/module-map.md「Webの境界」）。",
    },
  },
  create(context) {
    const srcDirOption = context.options[0]?.srcDir ?? "apps/web/src";
    const filename = context.filename.split(path.sep).join("/");
    const marker = `/${srcDirOption}/`;
    const at = filename.lastIndexOf(marker);
    if (at < 0) return {};
    const srcDir = filename.slice(0, at + marker.length - 1);
    const fromRel = relFromSrc(srcDir, filename);
    if (fromRel === null) return {};
    const from = webModuleOf(fromRel);
    const strict = context.options[0]?.strictPlacement === true;
    const kindName = { common: "共通の部品", shell: "外枠", app: "アプリ", composition: "組み立て", unplaced: "置き場所の外" };

    /**
     * 読みこみ先の文字列を、src からの相対のパスにする。別名でも相対パスでもなければ null。
     * @param spec - 読みこみ先の文字列
     * @returns 相対のパス
     */
    function targetOf(spec) {
      if (spec.startsWith("@/")) return relFromSrc(srcDir, path.join(srcDir, spec.slice(2)));
      if (spec.startsWith(".")) return relFromSrc(srcDir, path.resolve(path.dirname(filename), spec));
      return null;
    }

    /**
     * 読みこみ先を確かめる。
     * @param node - 報告する場所
     * @param spec - 読みこみ先の文字列
     */
    function check(node, spec) {
      if (typeof spec !== "string") return;
      const targetRel = targetOf(spec);
      if (targetRel === null) return;
      const to = webModuleOf(targetRel);
      if (to.unit === from.unit || to.kind === "unplaced") return;
      const data = { unit: to.unit, from: from.unit, fromKind: kindName[from.kind], toKind: kindName[to.kind] };
      if (from.kind === "common") {
        if (to.kind !== "common") context.report({ node, messageId: "commonToUpper", data });
        return;
      }
      if (to.kind === "common") return;
      if (to.kind === "composition") return context.report({ node, messageId: "toComposition", data });
      if (from.kind === "shell" && to.kind === "app") return context.report({ node, messageId: "shellToApp", data });
      if (from.kind === "app" && to.kind === "app") return context.report({ node, messageId: "appToApp", data });
      if (!isEntry(to)) context.report({ node, messageId: "notEntry", data });
    }

    /**
     * 文字列か、式のないテンプレート文字列なら、その値を返す。
     * @param node - 読みこみ先の式
     * @returns 値（決まらなければ undefined）
     */
    function literalValue(node) {
      if (!node) return undefined;
      if (node.type === "Literal") return node.value;
      if (node.type === "TemplateLiteral" && node.expressions.length === 0) return node.quasis[0]?.value.cooked;
      if (node.type === "TSLiteralType") return literalValue(node.literal);
      return undefined;
    }

    return {
      Program: (node) => {
        // 型の宣言のファイル（vite-env.d.ts など）は、どこに置いてもよい
        const declaration = /\.d\.(ts|mts|cts)$/.test(filename);
        if (strict && from.kind === "unplaced" && !declaration) context.report({ node, messageId: "unplaced", data: { from: fromRel } });
      },
      ImportDeclaration: (node) => check(node.source, node.source.value),
      ExportNamedDeclaration: (node) => node.source && check(node.source, node.source.value),
      ExportAllDeclaration: (node) => check(node.source, node.source.value),
      ImportExpression: (node) => check(node.source, literalValue(node.source)),
      // 型の中の import("…")・typeof import("…")
      TSImportType: (node) => check(node, literalValue(node.argument ?? node.source)),
    };
  },
};
