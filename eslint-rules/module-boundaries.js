// APIのモジュールの境界を守るESLintの規則（specs/027-modular-monolith contracts/module-boundaries.md、research.md R3）。
// apps/api/src を 土台（kernel）・窓口（adapters/<名前>）・共通（platform）・アプリ（apps/<名前>）・組み立て（それ以外）に分け、
// 依存の向き（組み立て → アプリ → 共通 → 窓口 → 土台）と、ほかのモジュールは入口（index.ts）から読む決まりを確かめる。
// アプリの判定はパスの形（apps/<名前>/）で行うので、アプリを足しても設定は要らない。
import path from "node:path";

/** 種類の上下（大きいほど上。上から下へだけ読んでよい）。 */
const LEVEL = { kernel: 0, adapter: 1, platform: 2, app: 3, composition: 4 };

/**
 * src からの相対のパス（拡張子なし）から、モジュールを求める。
 * @param rel - src からの相対のパス（区切りは /）
 * @returns 種類と単位（入口の判定に使う）。単位の中のパスも返す
 */
export function moduleOf(rel) {
  const parts = rel.split("/");
  if (parts[0] === "kernel") return { kind: "kernel", unit: "kernel", inner: parts.slice(1) };
  if (parts[0] === "platform") return { kind: "platform", unit: "platform", inner: parts.slice(1) };
  if ((parts[0] === "adapters" || parts[0] === "apps") && parts.length >= 2) {
    return { kind: parts[0] === "apps" ? "app" : "adapter", unit: `${parts[0]}/${parts[1]}`, inner: parts.slice(2) };
  }
  return { kind: "composition", unit: "composition", inner: parts };
}

/**
 * 単位の入口か（`platform`・`platform/index`・`apps/x`・`apps/x/index` など）。
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
  return rel.replace(/\.(ts|tsx|js|mjs)$/, "");
}

/** @type {import("eslint").Rule.RuleModule} */
export default {
  meta: {
    type: "problem",
    docs: { description: "APIのモジュールの境界（依存の向きと入口）を守る" },
    schema: [{ type: "object", properties: { srcDir: { type: "string" } }, additionalProperties: false }],
    messages: {
      notEntry: "{{unit}} は入口（{{unit}}/index.ts）から読んでください（docs/module-map.md）。",
      platformToApp: "共通（platform）はアプリ（{{unit}}）を使えません。知らせ（platform/hooks）を使ってください（docs/module-map.md）。",
      appToApp: "アプリ同士（{{from}} → {{unit}}）は直接使えません（docs/module-map.md）。",
      lowerToUpper: "{{fromKind}}（{{from}}）は {{toKind}}（{{unit}}）を使えません。依存は 組み立て → アプリ → 共通 → 窓口 → 土台 の向きだけです（docs/module-map.md）。",
    },
  },
  create(context) {
    const srcDirOption = context.options[0]?.srcDir ?? "apps/api/src";
    const filename = context.filename;
    const marker = `/${srcDirOption}/`;
    const at = filename.split(path.sep).join("/").lastIndexOf(marker);
    if (at < 0) return {};
    const srcDir = filename.slice(0, at + marker.length - 1);
    const fromRel = relFromSrc(srcDir, filename);
    if (fromRel === null) return {};
    const from = moduleOf(fromRel);
    const kindName = { kernel: "土台", adapter: "窓口", platform: "共通", app: "アプリ", composition: "組み立て" };

    /**
     * 読みこみ先を確かめる。
     * @param node - 報告する場所
     * @param spec - 読みこみ先の文字列
     */
    function check(node, spec) {
      if (typeof spec !== "string" || !spec.startsWith(".")) return;
      const targetRel = relFromSrc(srcDir, path.resolve(path.dirname(filename), spec));
      if (targetRel === null) return;
      const to = moduleOf(targetRel);
      if (to.unit === from.unit) return;
      const data = { unit: to.unit, from: from.unit, fromKind: kindName[from.kind], toKind: kindName[to.kind] };
      if (from.kind === "platform" && to.kind === "app") return context.report({ node, messageId: "platformToApp", data });
      if (from.kind === "app" && to.kind === "app") return context.report({ node, messageId: "appToApp", data });
      if (LEVEL[to.kind] > LEVEL[from.kind] || (from.kind === "adapter" && to.kind === "adapter")) {
        return context.report({ node, messageId: "lowerToUpper", data });
      }
      if (to.kind !== "kernel" && to.kind !== "composition" && !isEntry(to)) {
        context.report({ node, messageId: "notEntry", data });
      }
    }

    return {
      ImportDeclaration: (node) => check(node.source, node.source.value),
      ExportNamedDeclaration: (node) => node.source && check(node.source, node.source.value),
      ExportAllDeclaration: (node) => check(node.source, node.source.value),
      ImportExpression: (node) => node.source.type === "Literal" && check(node.source, node.source.value),
    };
  },
};
