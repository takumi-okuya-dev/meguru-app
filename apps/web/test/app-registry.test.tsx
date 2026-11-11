// アプリの登録とルートの組み立て（specs/028-meguru-shell research.md R3、T010）。
// PR2 で Threads の画面を /threads の下へ移した（contracts/ui-routes.md 1）。公開ページのURLとログインの要否は、分割の前（checklists/routes-before.md）のまま。
import { isValidElement } from "react";
import type { RouteObject } from "react-router";
import { describe, expect, it } from "vitest";

const { threadsApp } = await import("@/apps/threads");
const { buildRoutes } = await import("@/shell");
const { settingsGroupsFor } = await import("@/shell/settings/sections");
const { RequireAuth } = await import("@/shell/guards/RequireAuth");

/**
 * ルートの木を、絶対パスの一覧にする（入れ物だけのルートは数えない）。ログイン（RequireAuth）の中のルートには「 [auth]」を付ける。
 * @param routes - ルート
 * @param base - 親のパス
 * @param auth - ログインの関所の中か
 * @returns パスの一覧
 */
function flatten(routes: readonly RouteObject[], base = "", auth = false): string[] {
  return routes.flatMap((r) => {
    const inAuth = auth || (isValidElement(r.element) && r.element.type === RequireAuth);
    const here = r.index ? `${base} (index)` : r.path === undefined ? base : r.path.startsWith("/") || r.path === "*" ? r.path : `${base}/${r.path}`;
    const self = r.index || r.path !== undefined ? [inAuth ? `${here} [auth]` : here] : [];
    return [...self, ...(r.children ? flatten(r.children, r.index ? base : here, inAuth) : [])];
  });
}

/** ログインのいらないルート（contracts/ui-routes.md 1-1）。公開ページのURLは分割の前と同じで、前のURLの転送を足した。 */
const PUBLIC = [
  "/sign-in/*",
  "/data-deletion/:code",
  "/terms",
  "/legal/commerce",
  "/guide/threads-token",
  "/invite/:token",
  "/test-invite/:token",
  "/r/:code",
  "/accounts/*",
  "/teams/*",
  "*",
];

/** ログインの要るルート（contracts/ui-routes.md 1-2）。Threadsの画面は /threads の下。 */
const AUTH = [
  "/",
  "/apps",
  "/threads",
  "/threads/accounts/new",
  "/threads/complete",
  "/settings",
  "/settings (index)",
  ...["appearance", "account", "billing", "referral", "features", "test-groups", "test-groups/:groupId", "tester-invites", "operator-accounts", "limits"].map((p) => `/settings/${p}`),
  "/threads/teams/:teamId",
  "/threads/teams/:teamId (index)",
  "/threads/teams/:teamId/assign",
  "/threads/teams/:teamId/status",
  "/threads/teams/:teamId/accounts/:accountId",
  "/threads/accounts/:accountId",
  "/threads/accounts/:accountId (index)",
  ...["settings", "strategy", "promotions", "external-media", "external-media/:promotionId/:media", "research", "create", "stock", "performance", "analysis", "activity"].map(
    (p) => `/threads/accounts/:accountId/${p}`,
  ),
];

/** ルートの一覧。ログインの要るものに「 [auth]」を付ける。 */
const EXPECTED = [...PUBLIC, ...AUTH.map((p) => `${p} [auth]`)];

describe("ルートの組み立て", () => {
  it("Threadsを登録すると、契約どおりのルートになる（Threadsは /threads の下、公開ページのURLとログインの要否は分割の前のまま）", () => {
    expect(flatten(buildRoutes([threadsApp])).sort()).toEqual([...EXPECTED].sort());
  });

  it("アプリを登録しなければ、Threadsの画面はない（外枠のルートだけ）", () => {
    const paths = flatten(buildRoutes([]));
    expect(paths).not.toContain("/threads/accounts/:accountId [auth]");
    expect(paths).toContain("/settings/billing [auth]");
    expect(paths).toContain("*");
  });
});

describe("設定の項目のぶつかり", () => {
  it("アプリの項目の slug が外枠の項目とぶつかると、ルートを組むときに知らせる", () => {
    const clash = { ...threadsApp, settingsSections: [{ ...threadsApp.settingsSections![0]!, slug: "limits" }] };
    expect(() => buildRoutes([clash])).toThrow("limits");
  });

  it("アプリ同士の項目の slug がぶつかっても知らせる", () => {
    const other = { ...threadsApp, id: "sample", routes: [], publicRoutes: [], readingRoutes: [] };
    expect(() => buildRoutes([threadsApp, other])).toThrow("tester-invites");
  });
});

describe("設定の項目", () => {
  it("運営の区分は、使える機能 → グループ → テスター招待 → アカウント一覧 → 上限 の順（Threadsの項目を混ぜる）", () => {
    const groups = settingsGroupsFor(true, threadsApp.settingsSections);
    expect(groups.find((g) => g.label === "運営")!.sections.map((s) => s.slug)).toEqual([
      "features",
      "test-groups",
      "tester-invites",
      "operator-accounts",
      "limits",
    ]);
  });

  it("個人設定は、外観 → アカウント → 契約と支払い → 紹介 のまま。運営者でなければ運営の区分はない", () => {
    const groups = settingsGroupsFor(false, threadsApp.settingsSections);
    expect(groups.map((g) => g.label)).toEqual(["個人設定"]);
    expect(groups[0]!.sections.map((s) => s.slug)).toEqual(["appearance", "account", "billing", "referral"]);
  });
});
