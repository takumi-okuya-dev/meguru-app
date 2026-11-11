// 紹介リンクの画面（specs/017-referral-links contracts/ui-routes.md 1、US1・US3）
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

let signedIn = false;
vi.mock("@clerk/react", () => ({
  useAuth: () => ({ isLoaded: true, isSignedIn: signedIn }),
}));
const referralPage = vi.fn();
vi.mock("@/lib/api-client", async (orig) => {
  const actual = await orig<typeof import("@/lib/api-client")>();
  return { ...actual, api: { ...actual.api, referralPage } };
});

const { currentReferral } = await import("@/lib/referral-store");
const { ReferralLandingPage } = await import("@/shell/pages/referral-landing");

const CODE = `r_${"a".repeat(22)}`;
const NOTICE = "テスト版は、招待された方だけが使えます。招待のリンクを受け取った方は、そちらから始めてください。";

function renderAt(code = CODE) {
  const router = createMemoryRouter(
    [
      { path: "/r/:code", element: <ReferralLandingPage /> },
      { path: "/sign-in", element: <p>ログイン画面</p> },
      { path: "/", element: <p>最初の画面</p> },
    ],
    { initialEntries: [`/r/${code}`] },
  );
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

beforeEach(() => {
  signedIn = false;
  localStorage.clear();
  referralPage.mockReset();
  referralPage.mockResolvedValue({ testGroups: false });
});

describe("紹介リンクの画面", () => {
  it("ログイン前：紹介の3行と「Googleで始める」を出し、紹介の文字列を覚える。「Googleで始める」でログインへ", async () => {
    const user = userEvent.setup();
    const router = renderAt();
    expect(await screen.findByRole("heading", { name: "ThreadsGrowerに招待されています" })).toBeInTheDocument();
    expect(screen.getByText("Threadsの投稿案を、戦略に沿って作れます")).toBeInTheDocument();
    expect(screen.getByText("承認した投稿だけを、決めた時刻に自動で投稿します")).toBeInTheDocument();
    expect(screen.getByText("投稿の反応を取り込み、次の案に生かせます")).toBeInTheDocument();
    expect(currentReferral()).toBe(CODE);
    await user.click(screen.getByRole("button", { name: "Googleで始める" }));
    expect(router.state.location.pathname).toBe("/sign-in");
    expect(router.state.location.search).toBe("");
  });

  it("紹介した人を問い合わせない（名前を出さない）", async () => {
    renderAt();
    await screen.findByRole("heading", { name: "ThreadsGrowerに招待されています" });
    expect(referralPage).toHaveBeenCalledWith();
  });

  it("ログインしている人は、覚えずに最初の画面へ移る", async () => {
    signedIn = true;
    renderAt();
    expect(await screen.findByText("最初の画面")).toBeInTheDocument();
    expect(currentReferral()).toBeNull();
  });

  it("形に合わない文字列は覚えないが、画面は出す", async () => {
    renderAt("nope");
    expect(await screen.findByRole("button", { name: "Googleで始める" })).toBeInTheDocument();
    expect(currentReferral()).toBeNull();
  });

  it("テスト用のグループがONなら注意を出す。OFF・失敗なら出さない", async () => {
    referralPage.mockResolvedValue({ testGroups: true });
    renderAt();
    expect(await screen.findByText(NOTICE)).toBeInTheDocument();
  });

  it("OFFなら注意を出さない", async () => {
    renderAt();
    await screen.findByRole("button", { name: "Googleで始める" });
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
  });

  it("情報が読めなくても、注意なしで画面を出す", async () => {
    referralPage.mockRejectedValue(new Error("network"));
    renderAt();
    expect(await screen.findByRole("button", { name: "Googleで始める" })).toBeInTheDocument();
    expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
  });
});
