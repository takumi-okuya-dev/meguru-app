// 画面のルートを、外枠のルートとアプリの入口から組む（specs/028-meguru-shell research.md R3、contracts/ui-routes.md 1）。
// 外枠はアプリのコードを読まない。アプリの一覧は組み立て（router.tsx・app-registry.ts）から受け取る。
import { Outlet, type RouteObject } from "react-router";
import { AppRegistryProvider, type AppModule } from "./app-module";
import { RequireAuth } from "./guards/RequireAuth";
import { ShellLanding } from "./pages/landing";
import { LegacyRedirect } from "./pages/legacy-redirect";
import { LegalCommercePage } from "./pages/legal-commerce";
import { NotFound } from "./pages/not-found";
import { PlainPage } from "./pages/plain-page";
import { ReferralLandingPage } from "./pages/referral-landing";
import { SignInPage } from "./pages/sign-in";
import { TermsPage } from "./pages/terms";
import { TestInvitePage } from "./pages/test-invite";
import { AccountSettingsPage } from "./settings/account";
import { AppearanceSettings } from "./settings/appearance";
import { BillingSettingsPage } from "./settings/billing";
import { FeaturesPage } from "./settings/features";
import { LimitsPage } from "./settings/limits";
import { ReferralSettingsPage } from "./settings/referral";
import { SHELL_SETTINGS_SLUGS } from "./settings/sections";
import { SettingsIndex, SettingsLayout } from "./settings/settings-layout";
import { TestGroupDetailPage, TestGroupsPage } from "./settings/test-groups";

/**
 * 画面のルートを組む。認証が必要な画面は RequireAuth で包む。
 * アプリの一覧は、ルートのいちばん外の入れ物で外枠に渡す（設定の項目の一覧とルートを、同じ一覧から作るため）。
 * @param apps - 出せるアプリの入口
 * @returns ルートの一覧
 * @throws Error 設定の項目の slug が、外枠の項目やほかのアプリの項目とぶつかったとき
 */
export function buildRoutes(apps: readonly AppModule[]): RouteObject[] {
  assertUniqueSettingsSlugs(apps);
  return [
    {
      element: (
        <AppRegistryProvider value={apps}>
          <Outlet />
        </AppRegistryProvider>
      ),
      children: routesOf(apps),
    },
  ];
}

/**
 * 設定の項目の slug がぶつかっていないかを確かめる（同じパスのルートが2つあると、片方の画面が開けなくなる）。
 * @param apps - 出せるアプリの入口
 * @throws Error ぶつかっているとき
 */
function assertUniqueSettingsSlugs(apps: readonly AppModule[]): void {
  const seen = new Set(SHELL_SETTINGS_SLUGS);
  for (const app of apps) {
    for (const { slug } of app.settingsSections ?? []) {
      if (seen.has(slug)) throw new Error(`設定の項目「${slug}」がぶつかっています（${app.id}）。slug を変えてください`);
      seen.add(slug);
    }
  }
}

/**
 * 外枠とアプリのルート。
 * @param apps - 出せるアプリの入口
 * @returns ルートの一覧
 */
function routesOf(apps: readonly AppModule[]): RouteObject[] {
  return [
    { path: "/sign-in/*", element: <SignInPage /> },
    // 利用規約・特定商取引法の表記・アプリの読みもの（トークンの作り方など）はログインなしで読める（specs/010 FR-052・FR-030）
    {
      element: <PlainPage />,
      children: [
        { path: "/terms", element: <TermsPage /> },
        { path: "/legal/commerce", element: <LegalCommercePage /> },
        ...apps.flatMap((a) => a.readingRoutes ?? []),
      ],
    },
    // アプリのログインのいらないページ（Threadsならチームの招待・データ削除の確認）
    ...apps.flatMap((a) => a.publicRoutes ?? []),
    // 前のURLの転送。ログインの関所の外で移すので、ログインしていない人も新しいURLからログインへ進む（specs/028 contracts/ui-routes.md 2）
    ...apps.flatMap((a) =>
      // `<頭>/*` は頭だけのURL（/accounts）にも合う
      (a.legacyRedirects ?? []).map(({ from, to }) => ({ path: `${from}/*`, element: <LegacyRedirect to={to} /> })),
    ),
    // テスト用のグループの招待もログインなしで開ける。テスト版に入れない人も開ける（specs/016 contracts/ui-routes.md 1）
    { path: "/test-invite/:token", element: <TestInvitePage /> },
    // 紹介リンクもログインなしで開ける（specs/017 contracts/ui-routes.md 1）
    { path: "/r/:code", element: <ReferralLandingPage /> },
    {
      element: <RequireAuth />,
      children: [
        // 入口の振り分け（specs/028 contracts/ui-routes.md 3）
        { path: "/", element: <ShellLanding /> },
        ...apps.flatMap((a) => a.routes),
        {
          path: "/settings",
          element: <SettingsLayout />,
          children: [
            { index: true, element: <SettingsIndex /> },
            { path: "appearance", element: <AppearanceSettings /> },
            { path: "account", element: <AccountSettingsPage /> },
            { path: "billing", element: <BillingSettingsPage /> },
            { path: "referral", element: <ReferralSettingsPage /> },
            // 運営者だけ（specs/016 contracts/ui-routes.md 3）。運営者でなければ画面の中で断る
            { path: "features", element: <FeaturesPage /> },
            { path: "test-groups", element: <TestGroupsPage /> },
            { path: "test-groups/:groupId", element: <TestGroupDetailPage /> },
            { path: "limits", element: <LimitsPage /> },
            // アプリが足す項目（Threadsならテスター招待・アカウント一覧。specs/028 research.md R9）
            ...apps.flatMap((a) => (a.settingsSections ?? []).map((s) => ({ path: s.slug, element: s.element }))),
          ],
        },
      ],
    },
    { path: "*", element: <NotFound /> },
  ];
}
