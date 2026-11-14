// 招待を受ける画面と、つながった運営メンバーの画面（specs/collect/003-revenue-sharing User Story 5、tasks.md T029）。
import { computeDistribution, type MemberSharingView } from "@meguru/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invite: vi.fn(), acceptInvite: vi.fn(), shares: vi.fn(), share: vi.fn() }));
vi.mock("@/apps/collect/lib/api", () => ({ collectApi: mocks }));
const auth = vi.hoisted(() => ({ isLoaded: true, isSignedIn: true }));
vi.mock("@clerk/react", () => ({ useAuth: () => auth }));

const { JoinPage } = await import("@/apps/collect/pages/JoinPage");
const { SharesPage, ShareDetailPage } = await import("@/apps/collect/pages/SharesPage");
const { ApiError } = await import("@/lib/api-client");

/**
 * 画面を描く。
 * @param path - 開くURL
 * @returns ルーター
 */
function renderAt(path: string) {
  const router = createMemoryRouter(
    [
      { path: "/collect/join/:token", element: <JoinPage /> },
      { path: "/collect/shares", element: <SharesPage /> },
      { path: "/collect/shares/:eventId", element: <ShareDetailPage /> },
      { path: "/sign-in", element: <div>ログインの画面</div> },
    ],
    { initialEntries: [path] },
  );
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

const members = [
  { id: "o", name: "主催者", role: "leader" as const, ratioTenths: 12, isOwner: true, linked: true },
  { id: "k", name: "木村", role: "member" as const, ratioTenths: null, isOwner: false, linked: true },
];
const view: MemberSharingView = {
  event: { id: "e1", name: "IT交流会", startsAt: "2026-11-20T10:00:00.000Z" },
  revenue: { paid: 10000, awaiting: 0, awaitingConfirmation: 0 },
  expenses: [{ id: "x", name: "会場費", amount: 2000, payer: null }],
  expenseTotal: 2000,
  members,
  maxRatioTenths: 20,
  current: computeDistribution(8000, members),
  projected: computeDistribution(8000, members),
  reimbursements: [],
  you: "k",
};

beforeEach(() => {
  for (const m of Object.values(mocks)) m.mockReset();
  auth.isLoaded = true;
  auth.isSignedIn = true;
});

describe("招待を受ける", () => {
  it("ログインしていなければ、ログインのあとでこの画面に戻る", async () => {
    auth.isSignedIn = false;
    const router = renderAt("/collect/join/ci_abc");
    await userEvent.click(screen.getByRole("button", { name: "ログインして受ける" }));
    expect(router.state.location.pathname).toBe("/sign-in");
    expect(router.state.location.search).toBe(`?next=${encodeURIComponent("/collect/join/ci_abc")}`);
    expect(mocks.invite).not.toHaveBeenCalled();
  });

  it("中身を見て受けると、そのイベントの分配へ進む", async () => {
    mocks.invite.mockResolvedValue({ event: { name: "IT交流会", startsAt: "2026-11-20T10:00:00.000Z" }, memberName: "木村", ownerIsYou: false, alreadyLinked: false });
    mocks.acceptInvite.mockResolvedValue({ eventId: "e1" });
    mocks.share.mockResolvedValue(view);
    const router = renderAt("/collect/join/ci_abc");
    expect(await screen.findByRole("heading", { name: "「IT交流会」の運営メンバーに招待されています" })).toBeInTheDocument();
    expect(screen.getByText(/運営メンバーの名前：木村/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "受ける" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/collect/shares/e1"));
    expect(mocks.acceptInvite).toHaveBeenCalledWith("ci_abc");
  });

  it("主催者・もうつながっている人には「受ける」を出さない。使えないリンクは知らせる", async () => {
    mocks.invite.mockResolvedValue({ event: { name: "IT交流会", startsAt: "2026-11-20T10:00:00.000Z" }, memberName: "木村", ownerIsYou: true, alreadyLinked: false });
    renderAt("/collect/join/ci_abc");
    expect(await screen.findByText(/あなたはこのイベントの主催者です/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "受ける" })).toBeNull();
  });

  it("使えないリンク", async () => {
    mocks.invite.mockRejectedValue(new ApiError("INVITE_INACTIVE", 404));
    renderAt("/collect/join/ci_abc");
    expect(await screen.findByRole("heading", { name: "このリンクは使えません" })).toBeInTheDocument();
  });
});

describe("つながった運営メンバー", () => {
  it("一覧に受け取る合計を出す", async () => {
    mocks.shares.mockResolvedValue({ events: [{ eventId: "e1", name: "IT交流会", startsAt: "2026-11-20T10:00:00.000Z", memberName: "木村", total: 3200, deficit: false }] });
    renderAt("/collect/shares");
    const list = await screen.findByRole("list", { name: "運営メンバーのイベント" });
    expect(within(list).getByText("IT交流会")).toBeInTheDocument();
    expect(within(list).getByText("3,200円")).toBeInTheDocument();
  });

  it("分配は読むだけで、自分の行に「あなた」。直すボタンはない", async () => {
    mocks.share.mockResolvedValue(view);
    renderAt("/collect/shares/e1");
    const mine = await screen.findByRole("row", { name: "木村の分配" });
    expect(within(mine).getByText("あなた")).toBeInTheDocument();
    // 8,000 ÷ 2 × 1.2 = 4,800、木村 3,200
    expect(within(mine).getAllByText("3,200円")).toHaveLength(2);
    expect(screen.getByLabelText("今の残る額")).toHaveTextContent("8,000円");
    expect(screen.queryByRole("button", { name: /直す|消す|足す/ })).toBeNull();
  });
});
