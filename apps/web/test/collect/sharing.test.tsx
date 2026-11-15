// 分配の画面（specs/collect/003-revenue-sharing User Story 1〜3、tasks.md T024）。
import { computeDistribution, type SettlementSnapshot, type SharingSnapshot } from "@meguru/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sharing: vi.fn(),
  referrals: vi.fn(),
  referrers: vi.fn(),
  addExpense: vi.fn(),
  updateExpense: vi.fn(),
  deleteExpense: vi.fn(),
  addMember: vi.fn(),
  updateMember: vi.fn(),
  deleteMember: vi.fn(),
  createInvite: vi.fn(),
  stopInvite: vi.fn(),
  unlinkMember: vi.fn(),
  settlement: vi.fn(),
  chooseSettlementHolder: vi.fn(),
  markSettlementTransfer: vi.fn(),
  undoSettlementTransfer: vi.fn(),
}));
vi.mock("@/apps/collect/lib/api", () => ({ collectApi: mocks }));
const toast = vi.hoisted(() => ({ info: vi.fn(), error: vi.fn(), success: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
vi.mock("@/apps/collect/components/QrCode", () => ({ QrCode: ({ value }: { value: string }) => <div data-testid="qr">{value}</div> }));

const { SharingPage } = await import("@/apps/collect/pages/SharingPage");

type Member = SharingSnapshot["members"][number];
const owner: Member = { id: "o", name: "主催者", role: "leader", ratioTenths: 12, isOwner: true, linked: true, invite: null };
const member = (id: string, name: string): Member => ({ id, name, role: "member", ratioTenths: null, isOwner: false, linked: false, invite: null });

/**
 * 分配の画面の数字を作る（分配は共通の計算で出す）。
 * @param over - 変える分
 * @returns 数字
 */
function snapshot(over: Partial<SharingSnapshot> = {}): SharingSnapshot {
  const members = over.members ?? [owner, member("a", "井上"), member("b", "木村"), member("c", "佐藤")];
  const revenue = over.revenue ?? { paid: 25000, awaiting: 3000, awaitingConfirmation: 0 };
  const expenseTotal = over.expenseTotal ?? 5000;
  const calc = members.map((m) => ({ id: m.id, role: m.role, ratioTenths: m.ratioTenths, isOwner: m.isOwner }));
  return {
    event: { id: "e1", name: "IT交流会", startsAt: "2026-11-20T10:00:00.000Z" },
    revenue,
    expenses: [{ id: "x1", name: "会場費", amount: 5000, payer: { memberId: "o", name: "主催者" } }],
    expenseTotal,
    members,
    maxRatioTenths: members.length * 10,
    current: computeDistribution(revenue.paid - expenseTotal, calc),
    projected: computeDistribution(revenue.paid + revenue.awaiting - expenseTotal, calc),
    reimbursements: [{ memberId: "o", name: "主催者", amount: 5000 }],
    ...over,
  };
}

/**
 * 精算の手順の数字を作る（spec の例：主催者 11,000・井上 9,000）。
 * @param over - 変える分
 * @returns 数字
 */
function settlementSnapshot(over: Partial<SettlementSnapshot> = {}): SettlementSnapshot {
  const party = (key: string, name: string, holding: number, target: number, isOwner = false) => ({ key, name, kind: "member" as const, isOwner, holding, target });
  return {
    parties: [party("m:o", "主催者", 11000, 6002, true), party("m:a", "井上", 9000, 4666), party("m:b", "木村", 0, 4666), party("m:c", "佐藤", 0, 4666)],
    helpers: [{ helperId: "h1", name: "井上", cash: 9000, memberId: "a", chosen: false }],
    steps: [
      { fromKey: "m:o", fromName: "主催者", toKey: "m:b", toName: "木村", amount: 4666 },
      { fromKey: "m:a", fromName: "井上", toKey: "m:c", toName: "佐藤", amount: 4334 },
      { fromKey: "m:o", fromName: "主催者", toKey: "m:c", toName: "佐藤", amount: 332 },
    ],
    done: [],
    mismatch: 0,
    ...over,
  };
}

/**
 * 分配の画面を描く。
 */
function renderPage() {
  const router = createMemoryRouter([{ path: "/collect/events/:eventId/sharing", element: <SharingPage /> }], { initialEntries: ["/collect/events/e1/sharing"] });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  for (const m of Object.values(mocks)) m.mockReset();
  mocks.sharing.mockResolvedValue(snapshot());
  mocks.referrals.mockResolvedValue({ rows: [{ name: "井上", people: 3, attended: 2, paid: 6000, awaiting: 3000 }, { name: null, people: 1, attended: 1, paid: 3000, awaiting: 0 }] });
  mocks.referrers.mockResolvedValue({ names: [] });
  mocks.settlement.mockResolvedValue(settlementSnapshot());
});

describe("分配の画面", () => {
  it("売上と残る額（今と見込み）・spec の例の分配額（リーダー6,002円・メンバー各4,666円）と立て替えの戻し", async () => {
    renderPage();
    expect(await screen.findByLabelText("今の残る額")).toHaveTextContent("20,000円");
    expect(screen.getByLabelText("見込みの残る額")).toHaveTextContent("23,000円");
    const leader = screen.getByRole("row", { name: "主催者の分配" });
    expect(within(leader).getByText("6,002円")).toBeInTheDocument();
    expect(within(leader).getByText("端数 2円 を含む")).toBeInTheDocument();
    // 受け取る合計＝分配額＋立て替えの戻し
    expect(within(leader).getByText("11,002円")).toBeInTheDocument();
    expect(within(screen.getByRole("row", { name: "井上の分配" })).getAllByText("4,666円")).toHaveLength(2);
  });

  it("見込みに切り替えると、振込待ちを含めた額で出す", async () => {
    renderPage();
    await userEvent.click(await screen.findByRole("tab", { name: "見込み" }));
    // 23,000 ÷ 4 × 1.2 = 6,900、メンバー floor(16,100 ÷ 3) = 5,366、端数 2
    expect(within(screen.getByRole("row", { name: "主催者の分配" })).getByText("6,902円")).toBeInTheDocument();
    expect(within(screen.getByRole("row", { name: "井上の分配" })).getAllByText("5,366円")).toHaveLength(2);
  });

  it("赤字なら知らせて、負担の目安として出す", async () => {
    mocks.sharing.mockResolvedValue(snapshot({ revenue: { paid: 3000, awaiting: 0, awaitingConfirmation: 0 } }));
    renderPage();
    expect(await screen.findByText(/赤字 2,000円/)).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "負担の目安" })).toBeInTheDocument();
  });

  it("経費を足すと API の数字で描き直す", async () => {
    mocks.addExpense.mockResolvedValue(snapshot({ expenseTotal: 6000, expenses: [] }));
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "経費を足す" }));
    const dialog = screen.getByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText("経費の名前"), "飲食");
    await userEvent.type(within(dialog).getByLabelText("金額"), "1,000");
    await userEvent.selectOptions(within(dialog).getByLabelText("立て替えた人"), "運営メンバーでない人");
    await userEvent.type(within(dialog).getByLabelText("立て替えた人の名前"), "会場の人");
    await userEvent.click(within(dialog).getByRole("button", { name: "保存する" }));
    await waitFor(() => expect(mocks.addExpense).toHaveBeenCalledWith("e1", { name: "飲食", amount: 1000, payerMemberId: null, payerName: "会場の人" }));
    expect(await screen.findByLabelText("今の残る額")).toHaveTextContent("19,000円");
  });

  it("運営メンバーの倍率：入れながら分配額の見込みを出し、上限を超えると保存できない", async () => {
    mocks.updateMember.mockResolvedValue(snapshot());
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "主催者を直す" }));
    const dialog = screen.getByRole("dialog");
    const ratio = within(dialog).getByLabelText("倍率");
    await userEvent.clear(ratio);
    await userEvent.type(ratio, "1.5");
    expect(within(dialog).getByText(/この人の分配額は 7,502円/)).toBeInTheDocument();
    await userEvent.clear(ratio);
    await userEvent.type(ratio, "4.1");
    expect(within(dialog).getByRole("alert")).toHaveTextContent("4.0倍以下");
    expect(within(dialog).getByRole("button", { name: "保存する" })).toBeDisabled();
    await userEvent.clear(ratio);
    await userEvent.type(ratio, "1.5");
    await userEvent.click(within(dialog).getByRole("button", { name: "保存する" }));
    await waitFor(() => expect(mocks.updateMember).toHaveBeenCalledWith("e1", "o", { name: "主催者", role: "leader", ratioTenths: 15 }));
  });

  it("API が断ったら言葉を出す", async () => {
    const { ApiError } = await import("@/lib/api-client");
    mocks.addMember.mockRejectedValue(new ApiError("RATIO_TOO_HIGH", 400));
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "運営メンバーを足す" }));
    const dialog = screen.getByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText("運営メンバーの名前"), "長谷川");
    await userEvent.click(within(dialog).getByRole("button", { name: "保存する" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("倍率")));
  });

  it("紹介経由の売上（紹介なしは最後）", async () => {
    renderPage();
    const table = await screen.findByRole("table", { name: "紹介経由の売上" });
    expect(within(table).getByText("井上")).toBeInTheDocument();
    expect(within(table).getByText("紹介なし")).toBeInTheDocument();
    expect(within(table).getByText("6,000円")).toBeInTheDocument();
  });

  it("招待：リンクと QR と期限を出す。招待中の人は止められる。つながった人は外せる。主催者の行には出さない", async () => {
    mocks.sharing.mockResolvedValue(
      snapshot({
        members: [
          owner,
          { ...member("a", "井上"), invite: { expiresAt: "2026-11-21T10:00:00.000Z" } },
          member("b", "木村"),
          { ...member("c", "佐藤"), linked: true },
        ],
      }),
    );
    mocks.createInvite.mockResolvedValue({ url: "https://example.test/collect/join/ci_x", expiresAt: "2026-11-21T10:00:00.000Z" });
    mocks.unlinkMember.mockResolvedValue(snapshot());
    renderPage();
    const ownerRow = await screen.findByRole("listitem", { name: "運営メンバー 主催者" });
    expect(within(ownerRow).queryByRole("button", { name: /招待/ })).toBeNull();
    expect(within(screen.getByRole("listitem", { name: "運営メンバー 井上" })).getByText(/招待中/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "井上の招待を止める" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "木村の招待のリンクを出す" }));
    const dialog = await screen.findByRole("dialog", { name: "木村さんへの招待のリンク" });
    expect(within(dialog).getByTestId("qr")).toHaveTextContent("ci_x");
    expect(mocks.createInvite).toHaveBeenCalledWith("e1", "b");
    await userEvent.keyboard("{Escape}");
    await userEvent.click(within(screen.getByRole("listitem", { name: "運営メンバー 佐藤" })).getByRole("button", { name: /外す/ }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "外す" }));
    await waitFor(() => expect(mocks.unlinkMember).toHaveBeenCalledWith("e1", "c"));
  });
});

describe("精算の手順（User Story 4）", () => {
  it("だれがだれにいくら渡すかを出し、「渡した」を押すと印と時刻が付く", async () => {
    const after = settlementSnapshot({
      steps: settlementSnapshot().steps.slice(1),
      done: [{ id: "t1", fromKey: "m:o", fromName: "主催者", toKey: "m:b", toName: "木村", amount: 4666, doneAt: "2026-11-20T13:05:00.000Z" }],
    });
    mocks.markSettlementTransfer.mockResolvedValue(after);
    renderPage();
    const steps = await screen.findByRole("list", { name: "精算の手順" });
    expect(within(steps).getAllByRole("listitem")).toHaveLength(3);
    const first = within(steps).getByRole("listitem", { name: "主催者から木村へ" });
    expect(within(first).getByText("4,666円")).toBeInTheDocument();
    await userEvent.click(within(first).getByRole("button", { name: "渡した" }));
    expect(mocks.markSettlementTransfer).toHaveBeenCalledWith("e1", { fromKey: "m:o", toKey: "m:b", amount: 4666 });
    const done = await screen.findByRole("list", { name: "渡したもの" });
    expect(within(done).getByText(/主催者 → 木村/)).toBeInTheDocument();
    expect(within(done).getByText("11/20 22:05")).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "精算の手順" })).getAllByRole("listitem")).toHaveLength(2);
  });

  it("取り消すと API の数字で描き直す。全部渡したら終わりと出す", async () => {
    mocks.settlement.mockResolvedValue(
      settlementSnapshot({ steps: [], done: [{ id: "t1", fromKey: "m:o", fromName: "主催者", toKey: "m:b", toName: "木村", amount: 4666, doneAt: "2026-11-20T13:05:00.000Z" }] }),
    );
    mocks.undoSettlementTransfer.mockResolvedValue(settlementSnapshot());
    renderPage();
    expect(await screen.findByText(/精算は終わりました/)).toBeInTheDocument();
    await userEvent.click(within(screen.getByRole("list", { name: "渡したもの" })).getByRole("button", { name: "取り消す" }));
    expect(mocks.undoSettlementTransfer).toHaveBeenCalledWith("e1", "t1");
    expect(await screen.findByRole("list", { name: "精算の手順" })).toBeInTheDocument();
  });

  it("手伝う人がどの運営メンバーかを選べる（名前が同じなら自動）", async () => {
    mocks.chooseSettlementHolder.mockResolvedValue(settlementSnapshot({ helpers: [{ helperId: "h1", name: "井上", cash: 9000, memberId: null, chosen: true }] }));
    renderPage();
    expect(await screen.findByText("名前が同じなので、同じ人とみなしています")).toBeInTheDocument();
    const select = screen.getByLabelText("井上はどの運営メンバーか");
    expect(select).toHaveValue("a");
    await userEvent.selectOptions(select, "運営メンバーでない");
    expect(mocks.chooseSettlementHolder).toHaveBeenCalledWith("e1", "h1", null);
    await waitFor(() => expect(screen.getByLabelText("井上はどの運営メンバーか")).toHaveValue("__none__"));
    expect(screen.queryByText("名前が同じなので、同じ人とみなしています")).not.toBeInTheDocument();
  });

  it("経費を変えると、精算の手順を読み直す", async () => {
    mocks.deleteExpense.mockResolvedValue(snapshot({ expenses: [], expenseTotal: 0 }));
    renderPage();
    await screen.findByRole("list", { name: "精算の手順" });
    expect(mocks.settlement).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "会場費を消す" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "消す" }));
    await waitFor(() => expect(mocks.settlement).toHaveBeenCalledTimes(2));
  });
});
