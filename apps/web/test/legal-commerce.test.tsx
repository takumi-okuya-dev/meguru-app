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
const { isPublicPath } = await import("./helpers/routes");

describe("特定商取引法に基づく表記", () => {
  it("ログインなしで開けるルートにある", () => {
    expect(isPublicPath(routes, "/legal/commerce")).toBe(true);
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
    expect(screen.getByText("アカウント1件につき月1,000円（税込み）")).toBeInTheDocument();
    expect(screen.getByText("契約の手続きをしたとき。以後、毎月")).toBeInTheDocument();
    expect(screen.queryByText(/無料体験|500円/)).not.toBeInTheDocument();
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
