// 環境の帯（specs/015-deploy-environments FR-040〜FR-042、contracts/ui-routes.md 1、T014）
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, MemoryRouter, Navigate, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { EnvBanner } from "@/components/layout/EnvBanner";
import { ReadOnlyBanner } from "@/components/billing/ReadOnlyBanner";
import { AppShell, CenteredLayout } from "@/components/layout/AppShell";
import { DEFAULT_SETTINGS_SLUG } from "@/pages/settings/sections";
import { SettingsLayout } from "@/pages/settings/settings-layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { resetViewport, setViewport } from "./helpers/viewport";

/** VITE_APP_ENV を差し替えて描く。 */
function renderWith(appEnv: string | undefined, ui?: React.ReactNode) {
  vi.stubEnv("VITE_APP_ENV", appEnv as string);
  return render(
    <MemoryRouter>
      <EnvBanner />
      {ui}
    </MemoryRouter>,
  );
}

const STAGING_TEXT =
  "テスト環境です。本番のデータではありません。ここでの投稿は、つないだThreadsアカウントに実際に投稿されます";

afterEach(() => vi.unstubAllEnvs());

describe("環境の帯", () => {
  it("staging では、テスト環境だと分かる文言を出す", () => {
    renderWith("staging");
    expect(screen.getByText(STAGING_TEXT)).toBeInTheDocument();
  });

  it("development では、開発環境だと分かる文言を出す", () => {
    renderWith("development");
    expect(screen.getByText("開発環境です（手元）")).toBeInTheDocument();
  });

  it("production では出さない", () => {
    const { container } = renderWith("production");
    expect(container).toBeEmptyDOMElement();
  });

  it("知らない値・未設定でも、本番の文言を出さない（黙って本番の見た目にしない）", () => {
    for (const value of [undefined, "", "prod"]) {
      const { container, unmount } = renderWith(value);
      expect(container.textContent, String(value)).toContain("環境");
      unmount();
    }
  });

  it("閉じるボタンを持たない（ずっと出す）", () => {
    renderWith("staging");
    expect(screen.queryByRole("button", { name: "閉じる" })).not.toBeInTheDocument();
  });

  it("ほかの帯（読むだけ）より上に出る", () => {
    renderWith("staging", <ReadOnlyBanner reason="trial_ended" />);
    const env = screen.getByText(STAGING_TEXT);
    const readOnly = screen.getByText(/無料体験が終わりました/);
    // 先に出ているほうが上（DOCUMENT_POSITION_FOLLOWING = 4）
    expect(env.compareDocumentPosition(readOnly) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

// 骨格ごとに、帯が出ること（Codexレビュー1回目 P2：設定の画面などに出ていなかった）
describe("どの骨格でも帯が出る", () => {
  const renderSettings = (path: string) => {
    const router = createMemoryRouter(
      [
        {
          path: "/settings",
          element: <SettingsLayout />,
          children: [
            { index: true, element: <Navigate to={DEFAULT_SETTINGS_SLUG} replace /> },
            { path: "appearance", element: <p>外観の中身</p> },
          ],
        },
      ],
      { initialEntries: [path] },
    );
    return render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
  };

  afterEach(() => resetViewport());

  it("AppShell（上部バーを出さない画面でも出る。PR #19 のCodexレビュー）", () => {
    vi.stubEnv("VITE_APP_ENV", "staging");
    setViewport(375);
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <AppShell>
            <p>上部バーのない中身（アカウントを作る画面など）</p>
          </AppShell>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByText(STAGING_TEXT)).toBeInTheDocument();
  });

  it("AppShell（上部バーの下）", () => {
    vi.stubEnv("VITE_APP_ENV", "staging");
    // サイドバーを出さない幅にする（サイドバーは /api/me を読むので、この確認には要らない）
    setViewport(375);
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <AppShell>
            <PageHeader title="テスト" />
          </AppShell>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByText(STAGING_TEXT)).toBeInTheDocument();
  });

  it("CenteredLayout（ログインなどの1カラム）", () => {
    vi.stubEnv("VITE_APP_ENV", "staging");
    render(
      <MemoryRouter>
        <CenteredLayout>
          <p>中身</p>
        </CenteredLayout>
      </MemoryRouter>,
    );
    expect(screen.getByText(STAGING_TEXT)).toBeInTheDocument();
  });

  it("設定の画面（2列・スマートフォンの一覧・スマートフォンの中身）", async () => {
    vi.stubEnv("VITE_APP_ENV", "staging");
    setViewport(1280);
    const wide = renderSettings("/settings");
    expect(await screen.findByText(STAGING_TEXT)).toBeInTheDocument();
    wide.unmount();

    setViewport(375);
    const list = renderSettings("/settings");
    expect(await screen.findByText(STAGING_TEXT)).toBeInTheDocument();
    list.unmount();

    setViewport(375);
    renderSettings("/settings/appearance");
    expect(await screen.findByText(STAGING_TEXT)).toBeInTheDocument();
  });
});
