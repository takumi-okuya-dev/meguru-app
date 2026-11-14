// 受付の画面の「確かめ待ち」と「申し出」（specs/collect/002-self-check-in User Story 2・4、FR-030〜FR-033・FR-020〜FR-023、tasks.md T020）。
// 手伝う人の画面で：受け取った・払い方を変えて受け取った・取り消す・名簿に入れる・名簿の人に当てる・断る・会場の共有の知らせ・数字。
import type { LiveMessage, ReceptionRecord, ReceptionSnapshot } from "@meguru/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  reception: vi.fn(),
  confirm: vi.fn(),
  resolveRequest: vi.fn(),
  undo: vi.fn(),
  live: { onMessage: null as null | ((m: LiveMessage) => void) },
}));
vi.mock("@/apps/collect/lib/helper-api", async (orig) => {
  const actual = await orig<typeof import("@/apps/collect/lib/helper-api")>();
  return {
    ...actual,
    helperApi: {
      info: vi.fn().mockResolvedValue({ status: "active", event: { name: "IT交流会", startsAt: "2026-11-20T10:00:00.000Z", venue: "渋谷" }, expiresAt: "2026-11-20T17:00:00.000Z" }),
      join: vi.fn(),
      reception: mocks.reception,
      record: vi.fn(),
      undo: mocks.undo,
      walkIn: vi.fn(),
      paypayQr: vi.fn(),
      liveTicket: vi.fn(),
      confirm: mocks.confirm,
      resolveRequest: mocks.resolveRequest,
    },
  };
});
vi.mock("@/apps/collect/lib/live", () => ({
  useLive: (opts: { onMessage: (m: LiveMessage) => void }) => {
    mocks.live.onMessage = opts.onMessage;
    return "live";
  },
}));
vi.mock("sonner", () => ({ toast: { info: vi.fn(), error: vi.fn(), success: vi.fn() } }));

const { collectApp } = await import("@/apps/collect");

const TOKEN = "cr_abc";
const self = (personId: string, method: "cash" | "paypay", over: Partial<ReceptionRecord> = {}): ReceptionRecord => ({
  personId,
  method,
  priceTierId: "t1",
  amount: 3000,
  amountOverridden: false,
  receiverKind: "self",
  receiverHelperId: null,
  paymentStatus: "awaiting_confirmation",
  transferConfirmedAt: null,
  recordedAt: "2026-11-20T10:05:00.000Z",
  selfReported: true,
  confirmedAt: null,
  ...over,
});

/**
 * スナップショット（No.1 は現金の確かめ待ち・No.2 は確かめた本人の申告・No.3 は未受付・申し出1件）。
 * @returns スナップショット
 */
function snapshot(): ReceptionSnapshot {
  const p = (id: string, number: number, name: string) => ({ id, number, name, kana: null, media: "peatix" as const, priceTierId: "t1" });
  return {
    version: 5,
    event: {
      id: "e1",
      name: "IT交流会",
      startsAt: "2026-11-20T10:00:00.000Z",
      endsAt: null,
      venue: "渋谷",
      methods: ["cash", "paypay"],
      tiers: [{ id: "t1", name: "通常", amount: 3000, position: 0 }],
      closedAt: null,
    },
    people: [
      { person: p("p1", 1, "松本 れい"), record: self("p1", "cash") },
      { person: p("p2", 2, "井上 そら"), record: self("p2", "paypay", { receiverKind: "helper", receiverHelperId: "h1", paymentStatus: "paid", confirmedAt: "2026-11-20T10:06:00.000Z" }) },
      { person: p("p3", 3, "木村 ゆうき"), record: null },
    ],
    stats: { arrived: 2, rosterCount: 3, cash: 0, paypay: 3000, awaitingTransferCount: 0, awaitingTransferAmount: 0, mine: 0, awaitingConfirmationCount: 1, awaitingConfirmationAmount: 3000 },
    helpers: [{ id: "h1", name: "井上", joinedAt: "2026-11-20T09:50:00.000Z" }],
    settings: { hasPaypayQr: false, bankText: null },
    selfRequests: [{ id: "r1", name: "飛び入り 花子", kana: "とびいり はなこ", createdAt: "2026-11-20T10:07:00.000Z" }],
  };
}

/**
 * 手伝う人の画面を描く（保存した端末の印で続きから）。
 */
function renderHelper() {
  window.localStorage.setItem(`collect:device:${TOKEN}`, JSON.stringify({ helperId: "h1", deviceSecret: "cd_saved", name: "井上" }));
  const router = createMemoryRouter(collectApp.publicRoutes!, { initialEntries: [`/collect/r/${TOKEN}`] });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  for (const m of [mocks.reception, mocks.confirm, mocks.resolveRequest, mocks.undo]) m.mockReset();
  mocks.reception.mockResolvedValue(snapshot());
});

describe("確かめ待ち", () => {
  it("確かめ待ちの人と数字が出る。確かめた本人の申告は「本人の申告→井上」", async () => {
    renderHelper();
    const awaiting = await screen.findByRole("list", { name: "確かめ待ち" });
    expect(within(awaiting).getByText("松本 れい")).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "受付の名簿" })).getByRole("listitem", { name: /井上 そら/ })).toHaveTextContent("受け取り：本人の申告→井上");
    const stats = screen.getByLabelText("受付の数字");
    expect(within(stats).getByText("確かめ待ち")).toBeInTheDocument();
    expect(within(stats).getByText("1件・3,000円")).toBeInTheDocument();
  });

  it("「受け取った」で確かめる。「PayPayで受け取った」は払い方を変えて確かめる。応答で行が支払い済みになる", async () => {
    mocks.confirm.mockResolvedValue({ record: self("p1", "cash", { receiverKind: "helper", receiverHelperId: "h1", paymentStatus: "paid" }), version: 6 });
    const user = userEvent.setup();
    renderHelper();
    const row = await screen.findByRole("listitem", { name: "No.1 松本 れい（確かめ待ち）" });
    await user.click(within(row).getByRole("button", { name: "PayPayで受け取った" }));
    expect(mocks.confirm).toHaveBeenCalledWith(TOKEN, "cd_saved", "p1", { method: "paypay" });
    expect(screen.queryByRole("list", { name: "確かめ待ち" })).toBeNull();
  });

  it("手伝う人も、まだ確かめていない本人の申告を取り消せる（確かめてから）", async () => {
    mocks.undo.mockResolvedValue({ version: 6 });
    const user = userEvent.setup();
    renderHelper();
    const row = await screen.findByRole("listitem", { name: "No.1 松本 れい（確かめ待ち）" });
    await user.click(within(row).getByRole("button", { name: "取り消す" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "取り消す" }));
    expect(mocks.undo).toHaveBeenCalledWith(TOKEN, "cd_saved", "p1");
  });
});

describe("申し出", () => {
  it("名簿に入れる → 名簿に人が足され、申し出が消える", async () => {
    mocks.resolveRequest.mockResolvedValue({ version: 6, person: { id: "p4", number: 4, name: "飛び入り 花子", kana: "とびいり はなこ", media: "walk_in", priceTierId: "t1" } });
    const user = userEvent.setup();
    renderHelper();
    const item = await screen.findByRole("listitem", { name: "申し出 飛び入り 花子" });
    await user.click(within(item).getByRole("button", { name: "名簿に入れる" }));
    expect(mocks.resolveRequest).toHaveBeenCalledWith(TOKEN, "cd_saved", "r1", "accept", undefined);
    expect(await screen.findByRole("listitem", { name: "No.4 飛び入り 花子" })).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "申し出" })).toBeNull();
  });

  it("名簿の人に当てる：まだ受付していない人から選ぶ", async () => {
    mocks.resolveRequest.mockResolvedValue({ version: 6 });
    const user = userEvent.setup();
    renderHelper();
    await user.click(within(await screen.findByRole("listitem", { name: "申し出 飛び入り 花子" })).getByRole("button", { name: "名簿の人に当てる" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getAllByRole("option").map((o) => o.textContent)).toEqual(["No.3 木村 ゆうき"]);
    await user.click(within(dialog).getByRole("button", { name: "当てる" }));
    expect(mocks.resolveRequest).toHaveBeenCalledWith(TOKEN, "cd_saved", "r1", "match", "p3");
  });

  it("会場の共有の知らせ（self_requests.changed）で申し出の一覧が変わる", async () => {
    renderHelper();
    await screen.findByRole("list", { name: "申し出" });
    act(() =>
      mocks.live.onMessage!({
        type: "self_requests.changed",
        eventId: "e1",
        version: 6,
        at: "",
        selfRequests: [{ id: "r2", name: "遅れた人", kana: null, createdAt: "2026-11-20T10:08:00.000Z" }],
      }),
    );
    expect(await screen.findByRole("listitem", { name: "申し出 遅れた人" })).toBeInTheDocument();
    expect(screen.queryByRole("listitem", { name: "申し出 飛び入り 花子" })).toBeNull();
  });
});
