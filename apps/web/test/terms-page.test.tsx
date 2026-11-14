// 利用規約のページ（specs/010-token-account-add FR-052、contracts/ui-routes.md「利用規約」）
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

vi.mock("@clerk/react", () => ({
  SignIn: () => <div>Googleで続ける</div>,
  useAuth: () => ({ isLoaded: true, isSignedIn: false }),
}));

const { TermsPage } = await import("@/shell/pages/terms");
const { SignInPage } = await import("@/shell/pages/sign-in");
const { routes } = await import("@/router");
const { isPublicPath } = await import("./helpers/routes");

describe("利用規約", () => {
  it("ログインなしで開けるルートにある", () => {
    expect(isPublicPath(routes, "/terms")).toBe(true);
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
    expect(screen.getByText(/最終更新日：2026年10月16日/)).toBeInTheDocument();
  });

  it("料金・無料体験・解約・未払い・退会の節を書く（specs/013 FR-070。金額は共通の定数から）", () => {
    render(
      <MemoryRouter>
        <TermsPage />
      </MemoryRouter>,
    );
    for (const heading of ["料金と支払い", "無料体験", "解約", "未払いのとき", "退会"]) {
      expect(screen.getByRole("heading", { name: new RegExp(heading) })).toBeInTheDocument();
    }
    expect(screen.getByText(/アカウント1件につき月1,000円です（税込み）/)).toBeInTheDocument();
    expect(screen.getByText(/無料体験はありません/)).toBeInTheDocument();
    expect(screen.queryByText(/500円/)).not.toBeInTheDocument();
    expect(screen.getByText(/日割りの請求・返金はしません/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "特定商取引法に基づく表記" })).toHaveAttribute("href", "/legal/commerce");
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
