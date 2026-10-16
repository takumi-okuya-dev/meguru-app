// 特定商取引法に基づく表記（specs/013-billing FR-071、SC-009、T057）
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

vi.mock("@clerk/react", () => ({
  SignIn: () => <div>Googleで続ける</div>,
  useAuth: () => ({ isLoaded: true, isSignedIn: false }),
}));

const { LegalCommercePage } = await import("@/pages/legal-commerce");
const { SignInPage } = await import("@/pages/sign-in");
const { routes } = await import("@/router");

describe("特定商取引法に基づく表記", () => {
  it("ログインなしで開けるルートにある", () => {
    const page = routes.find((r) => r.path === "/legal/commerce");
    expect(page).toBeDefined();
    expect("children" in page!).toBe(false);
  });

  it("項目と価格を出し、販売者の情報が空なら「（公開の前に記入）」", () => {
    render(
      <MemoryRouter>
        <LegalCommercePage />
      </MemoryRouter>,
    );
    for (const k of ["販売事業者", "所在地", "販売価格", "支払い方法", "支払いの時期", "解約・返品"]) {
      expect(screen.getByText(k)).toBeInTheDocument();
    }
    expect(screen.getByText(/基本料金 月1,000円（アカウント1件目を含む）、2件目以降のアカウント1件につき月500円/)).toBeInTheDocument();
    expect(screen.getAllByText("（公開の前に記入）").length).toBeGreaterThan(0);
  });

  it("ログイン画面の足元から開ける。退会の後は「退会しました」を出す", () => {
    render(
      <MemoryRouter initialEntries={["/sign-in?withdrawn=1"]}>
        <SignInPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: "特定商取引法に基づく表記" })).toHaveAttribute("href", "/legal/commerce");
    expect(screen.getByText("退会しました。ご利用ありがとうございました。")).toBeInTheDocument();
  });
});
