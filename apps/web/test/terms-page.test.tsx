// 利用規約のページ（specs/010-token-account-add FR-052、contracts/ui-routes.md「利用規約」）
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

vi.mock("@clerk/react", () => ({
  SignIn: () => <div>Googleで続ける</div>,
  useAuth: () => ({ isLoaded: true, isSignedIn: false }),
}));

const { TermsPage } = await import("@/pages/terms");
const { SignInPage } = await import("@/pages/sign-in");
const { routes } = await import("@/router");

describe("利用規約", () => {
  it("ログインなしで開けるルートにある", () => {
    const terms = routes.find((r) => r.path === "/terms");
    expect(terms).toBeDefined();
    expect("children" in terms!).toBe(false);
  });

  it("トークンでの接続の扱い・禁止事項・データの削除・最終更新日を書く", () => {
    render(
      <MemoryRouter>
        <TermsPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { level: 1, name: "利用規約" })).toBeInTheDocument();
    for (const heading of ["トークンでの接続の扱い", "禁止事項", "データの削除"]) {
      expect(screen.getByRole("heading", { name: new RegExp(heading) })).toBeInTheDocument();
    }
    expect(screen.getByText(/あなたの代わりに、そのThreadsアカウントの運用のためだけに/)).toBeInTheDocument();
    expect(screen.getByText(/第三者に渡しません/)).toBeInTheDocument();
    expect(screen.getByText(/最終更新日：2026年10月10日/)).toBeInTheDocument();
  });

  it("ログイン画面の足元に「利用規約」のリンクがある", () => {
    render(
      <MemoryRouter>
        <SignInPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: "利用規約" })).toHaveAttribute("href", "/terms");
  });
});
