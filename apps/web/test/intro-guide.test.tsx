// US6：ホームの「はじめに読んでほしいこと」（specs/014-strategy-guidance FR-061・FR-062、research.md R15）
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ProfileStatus } from "@meguru/shared";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OWNER_ACCESS } from "./helpers/access";
import { ME_BILLING_OFF, type MeWithThreads } from "./helpers/billing";
import { account } from "./helpers/stock";

let userId = "u1";
vi.mock("@/lib/api-client", async (orig) => {
  const actual = await orig<typeof import("@/lib/api-client")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      me: async (): Promise<MeWithThreads> => ({
          user: { id: userId, email: "t@example.com", displayName: "Takumi" },
          accounts: [account],
          landingAccountId: "a1",
          accountLimit: { max: 5, used: 1 },
          ...ME_BILLING_OFF,
          threadsAccessMode: "testers",
          threadsConnectMethods: ["app", "token"] as const,
          teams: [],
      }),
    },
  };
});
vi.mock("@/apps/threads/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/apps/threads/lib/api")>();
  return {
    ...actual,
    threadsApi: {
      ...actual.threadsApi,
      getAutoPost: async () => ({ autoPost: { enabled: false, slotCount: 0, stoppedReason: null }, next: null, approvedCount: 0, daysLeft: null, notices: [] }),
      getDraftCounts: async () => ({ needsReview: 0, approved: 0, rejected: 0, published: 0, publishFailed: 0 }),
      accountAccess: async () => OWNER_ACCESS,
      getProfileStatus: async (): Promise<ProfileStatus> => ({
          strategy: { filledCount: 0, totalCount: 16 },
          promotions: { targetableCount: 0, totalCount: 0 },
          research: { referencePostCount: 0, keywordCount: 0 },
          access: { canEdit: true, inTrial: false, trialEndsAt: null, trialDaysLeft: null },
      }),
    },
  };
});

const { AccountHome } = await import("@/apps/threads/pages/account-home");

function renderHome() {
  const router = createMemoryRouter(
    [{ path: "/threads/accounts/:accountId", element: <Outlet context={{ account }} />, children: [{ index: true, element: <AccountHome /> }] }],
    { initialEntries: ["/threads/accounts/a1"] },
  );
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  userId = "u1";
});

describe("はじめに読んでほしいこと", () => {
  it("ホームの一番上に、初めは開いた状態で出る。成果を約束する言い方をしない", async () => {
    renderHome();
    const guide = await screen.findByRole("region", { name: "はじめに読んでほしいこと" });
    const text = guide.textContent ?? "";
    expect(text).toContain("続けること");
    expect(text).toContain("反応が少ないのが当たり前");
    expect(text).toContain("約束するものではありません");
    expect(text).toContain("15分");
    expect(text).toContain("小さく試して");
    expect(text).not.toMatch(/必ず(伸び|増え)|確実に/);
    expect(guide.compareDocumentPosition(screen.getByRole("heading", { name: "まずは「課題」から埋めましょう" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("「閉じる」で見出し1行になり、利用者ごとに端末に覚える。「開く」で戻る", async () => {
    const user = userEvent.setup();
    renderHome();
    const guide = await screen.findByRole("region", { name: "はじめに読んでほしいこと" });
    await user.click(within(guide).getByRole("button", { name: "閉じる" }));
    expect(guide.textContent).not.toContain("続けること");
    expect(localStorage.getItem("threads-grower:intro-dismissed:u1")).toBe("true");
    await user.click(within(guide).getByRole("button", { name: "開く" }));
    expect(guide.textContent).toContain("続けること");
  });

  it("閉じたことを覚えていれば閉じた状態。ほかの利用者には覚えた値を使わない", async () => {
    localStorage.setItem("threads-grower:intro-dismissed:u1", "true");
    userId = "u2";
    renderHome();
    const guide = await screen.findByRole("region", { name: "はじめに読んでほしいこと" });
    expect(within(guide).getByRole("button", { name: "閉じる" })).toBeInTheDocument();
  });
});
