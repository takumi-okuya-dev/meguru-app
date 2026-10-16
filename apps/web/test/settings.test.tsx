// 設定画面：項目の一覧・検索・外観の配色
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, Navigate, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";
import { AppearanceSettings } from "@/pages/settings/appearance";
import { DEFAULT_SETTINGS_SLUG, SETTINGS_GROUPS, filterSettingsGroups } from "@/pages/settings/sections";
import { SettingsLayout } from "@/pages/settings/settings-layout";

function renderSettings(path: string) {
  const router = createMemoryRouter(
    [
      { path: "/", element: <p>アプリのホーム</p> },
      {
        path: "/settings",
        element: <SettingsLayout />,
        children: [
          { index: true, element: <Navigate to={DEFAULT_SETTINGS_SLUG} replace /> },
          { path: "appearance", element: <AppearanceSettings /> },
          { path: "account", element: <p>アカウントの中身</p> },
        ],
      },
    ],
    { initialEntries: [path] },
  );
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

describe("設定画面", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove("dark");
  });

  it("/settings を開くと最初の項目（外観）へ移り、項目の一覧と「アプリに戻る」が出る", async () => {
    const router = renderSettings("/settings");
    expect(await screen.findByRole("heading", { name: "外観" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/settings/appearance");
    expect(screen.getByRole("link", { name: /アプリに戻る/ })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: /アカウント/ })).toHaveAttribute("href", "/settings/account");
  });

  it("検索で項目を絞り込める（検索語にも引っかかる）", async () => {
    renderSettings("/settings/appearance");
    const search = await screen.findByLabelText("設定を検索");
    await userEvent.type(search, "メール");
    expect(screen.getByRole("link", { name: /アカウント/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /外観/ })).not.toBeInTheDocument();
    await userEvent.clear(search);
    await userEvent.type(search, "存在しない設定");
    expect(screen.getByText("該当する設定はありません")).toBeInTheDocument();
  });

  it("外観で「ダーク」の見本を選ぶと、<html> に dark が付き、選択中になる", async () => {
    renderSettings("/settings/appearance");
    expect(await screen.findByRole("heading", { name: "表示スタイル" })).toBeInTheDocument();
    // 既定はライト
    expect(screen.getByRole("radio", { name: "ライト" })).toHaveAttribute("aria-checked", "true");
    await userEvent.click(screen.getByRole("radio", { name: "ダーク" }));
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(screen.getByRole("radio", { name: "ダーク" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "ライト" })).toHaveAttribute("aria-checked", "false");
  });

  it("filterSettingsGroups：空の検索語なら全部、大文字・小文字は区別しない", () => {
    expect(filterSettingsGroups(SETTINGS_GROUPS, "  ")).toEqual(SETTINGS_GROUPS);
    const r = filterSettingsGroups(SETTINGS_GROUPS, "google");
    expect(r.flatMap((g) => g.sections.map((s) => s.slug))).toEqual(["account"]);
  });
});
