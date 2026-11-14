// 環境の帯と印（specs/015-deploy-environments FR-040〜FR-042、contracts/ui-routes.md 1、T014）
// 帯は最初の画面（ログインなど）と読みもののページだけ。アプリの画面では、ユーザー名の横の印で示す（2026-10-31）
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, MemoryRouter, Navigate, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { EnvBadge, EnvBanner } from "@/shell/layout/EnvBanner";
import { UserMenu } from "@/shell/layout/UserMenu";
import { ReadOnlyBanner } from "@/components/billing/ReadOnlyBanner";
import { AppShell, CenteredLayout } from "@/shell/layout/AppShell";
import { DEFAULT_SETTINGS_SLUG } from "@/shell/settings/sections";
import { SettingsLayout } from "@/shell/settings/settings-layout";
import { PageHeader } from "@/shell/layout/PageHeader";
import { resetViewport, setViewport } from "./helpers/viewport";

vi.mock("@clerk/react", () => ({
  useClerk: () => ({ signOut: vi.fn() }),
  useUser: () => ({ user: { fullName: "拓海 奥家", primaryEmailAddress: { emailAddress: "t@example.com" } } }),
}));

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

// 骨格ごとの出し方（Codexレビュー1回目 P2・PR #19 で「どの骨格にも出す」にした。2026-10-31 に、
// ずっと出る帯は見にくいので、アプリの画面ではユーザー名の横の印だけにした）
describe("骨格ごとの出し方", () => {
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

  it("CenteredLayout（ログインなどの最初の画面）には帯を出す", () => {
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

  it("AppShell（アプリの画面）には帯を出さない", () => {
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
    expect(screen.queryByText(STAGING_TEXT)).not.toBeInTheDocument();
  });

  it("設定の画面（2列・スマートフォンの一覧・スマートフォンの中身）にも帯を出さない", async () => {
    vi.stubEnv("VITE_APP_ENV", "staging");
    for (const [width, path] of [
      [1280, "/settings"],
      [375, "/settings"],
      [375, "/settings/appearance"],
    ] as const) {
      setViewport(width);
      const view = renderSettings(path);
      // 描き終わるのを待つ（どの形にも「アプリに戻る」か「← 設定」のリンクがある）
      expect((await screen.findAllByRole("link")).length).toBeGreaterThan(0);
      expect(screen.queryByText(STAGING_TEXT), `${width} ${path}`).not.toBeInTheDocument();
      view.unmount();
    }
  });
});

describe("ユーザー名の横の印", () => {
  const renderMenu = (appEnv: string | undefined) => {
    vi.stubEnv("VITE_APP_ENV", appEnv as string);
    return render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <UserMenu />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  };

  it("staging では、名前の横に「テスト版」を出す", () => {
    renderMenu("staging");
    expect(screen.getByRole("button", { name: /拓海 奥家/ })).toHaveTextContent("テスト版");
  });

  it("development では「開発版」", () => {
    renderMenu("development");
    expect(screen.getByRole("button", { name: /拓海 奥家/ })).toHaveTextContent("開発版");
  });

  it("production では出さない", () => {
    renderMenu("production");
    const button = screen.getByRole("button", { name: /拓海 奥家/ });
    expect(button).not.toHaveTextContent("テスト版");
    expect(button).not.toHaveTextContent("開発版");
  });

  it("知らない値・未設定でも、本番の見た目にしない（テスト版の印を出す）", () => {
    for (const value of [undefined, "", "prod"]) {
      vi.stubEnv("VITE_APP_ENV", value as string);
      const { container, unmount } = render(<EnvBadge />);
      expect(container.textContent, String(value)).toBe("テスト版");
      unmount();
    }
  });
});
