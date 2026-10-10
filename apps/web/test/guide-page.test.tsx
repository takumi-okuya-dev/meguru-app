// トークンの作り方の詳しい手順（specs/010-token-account-add FR-030、contracts/ui-routes.md「トークンの作り方」）
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

vi.mock("@clerk/react", () => ({ SignIn: () => null, useAuth: () => ({ isLoaded: true, isSignedIn: false }) }));

const { GuideThreadsTokenPage } = await import("@/pages/guide-threads-token");
const { routes } = await import("@/router");

describe("トークンの作り方", () => {
  it("ログインなしで開けるルートにある", () => {
    const guide = routes.find((r) => r.path === "/guide/threads-token");
    expect(guide).toBeDefined();
    expect("children" in guide!).toBe(false);
  });

  it("はじめに・6つの手順・取り消し・うまくいかないとき、各手順の目的、確かめた日が出る", () => {
    render(
      <MemoryRouter>
        <GuideThreadsTokenPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { level: 1, name: /トークンの作り方/ })).toBeInTheDocument();
    const h2 = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(h2).toEqual([
      "はじめに",
      "1. Metaの開発者アカウントを用意する",
      "2. アプリを作る",
      "3. 権限を加える",
      "4. 自分をテスターに加える",
      "5. 長期トークンを作る",
      "6. 貼り付ける",
      "トークンを取り消すには",
      "うまくいかないとき",
    ]);
    expect(screen.getAllByText(/^この手順の目的：/)).toHaveLength(6);
    expect(screen.getByText(/この手順は2026年10月10日時点の内容です/)).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});
