// ユーザーメニュー（specs/028-meguru-shell contracts/ui-routes.md 5-1、T049）。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";

vi.mock("@clerk/react", () => ({
  useUser: () => ({ user: { fullName: "山田 花子", primaryEmailAddress: { emailAddress: "hanako@example.com" } } }),
  useClerk: () => ({ signOut: vi.fn() }),
}));

const { UserMenu } = await import("@/shell/layout/UserMenu");

describe("ユーザーメニュー", () => {
  it("「設定」「すべてのアプリ」「ログアウト」をこの順で出し、「すべてのアプリ」で /apps へ移る", async () => {
    const user = userEvent.setup();
    const router = createMemoryRouter(
      [
        { path: "/", element: <UserMenu /> },
        { path: "/apps", element: <p>すべてのアプリの画面</p> },
      ],
      { initialEntries: ["/"] },
    );
    render(
      <QueryClientProvider client={new QueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    await user.click(screen.getByRole("button", { name: /山田 花子/ }));
    const items = await screen.findAllByRole("menuitem");
    expect(items.map((i) => i.textContent?.trim())).toEqual(["設定", "すべてのアプリ", "ログアウト"]);
    await user.click(screen.getByRole("menuitem", { name: "すべてのアプリ" }));
    expect(await screen.findByText("すべてのアプリの画面")).toBeInTheDocument();
  });
});
