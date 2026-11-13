// 集金管理の受付の画面（specs/collect/001-event-day-collection User Story 2、FR-030〜FR-038、tasks.md T034）。
// 名前・ふりがな・受付番号で絞る・払い方を押すと記録の呼び出し1回・PayPayはQRのシート→「受け取った」・振込は当日・後日・
// 受付済みの行は払い方を出さない・保存できなかったら「もう一度送る」（受付済みに見せない）・知らせで1行が変わる・版が飛んだら読み直す。
import type { LiveMessage, ReceptionMethod, ReceptionSnapshot } from "@meguru/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api-client";

const mocks = vi.hoisted(() => ({
  reception: vi.fn(),
  record: vi.fn(),
  undo: vi.fn(),
  walkIn: vi.fn(),
  paypayQr: vi.fn(),
  live: { onMessage: null as null | ((m: LiveMessage) => void) },
}));
vi.mock("@/apps/collect/lib/api", () => ({
  collectApi: {
    reception: mocks.reception,
    record: mocks.record,
    undo: mocks.undo,
    walkIn: mocks.walkIn,
    paypayQr: mocks.paypayQr,
    liveTicket: vi.fn(),
  },
}));
// 会場の共有はつながず、知らせを手で送れるようにする
vi.mock("@/apps/collect/lib/live", () => ({
  useLive: (opts: { onMessage: (m: LiveMessage) => void }) => {
    mocks.live.onMessage = opts.onMessage;
    return "live";
  },
}));
vi.mock("sonner", () => ({ toast: { info: vi.fn(), error: vi.fn(), success: vi.fn() } }));

const { ReceptionPage } = await import("@/apps/collect/pages/ReceptionPage");

const person = (id: string, number: number, name: string, kana: string | null = null) => ({
  person: { id, number, name, kana, media: "peatix" as const, priceTierId: "t1", memo: null },
  record: null,
});

/**
 * スナップショットを作る。
 * @param over - 変える分
 * @returns スナップショット
 */
function snapshot(over: Partial<ReceptionSnapshot> = {}): ReceptionSnapshot {
  return {
    version: 5,
    event: {
      id: "e1",
      name: "IT交流会",
      startsAt: "2026-11-20T10:00:00.000Z",
      endsAt: null,
      venue: "渋谷",
      methods: ["cash", "paypay", "transfer"],
      tiers: [
        { id: "t1", name: "通常", amount: 3000, position: 0 },
        { id: "t2", name: "早割", amount: 2500, position: 1 },
      ],
      closedAt: null,
    },
    people: [person("p1", 1, "松本 れい", "まつもと れい"), person("p2", 2, "井上 そら", "いのうえ そら"), person("p3", 12, "木村 ゆうき")],
    stats: { arrived: 0, rosterCount: 3, cash: 0, paypay: 0, awaitingTransferCount: 0, awaitingTransferAmount: 0, mine: 0 },
    helpers: [],
    settings: { hasPaypayQr: true, bankText: "めぐる銀行 渋谷支店 普通 1234567" },
    ...over,
  };
}

const recordOf = (personId: string, method: ReceptionMethod, amount = 3000) => ({
  personId,
  method,
  priceTierId: "t1",
  amount,
  amountOverridden: false,
  receiverKind: "owner" as const,
  receiverHelperId: null,
  paymentStatus: method.startsWith("transfer") ? ("awaiting_transfer" as const) : ("paid" as const),
  transferConfirmedAt: null,
  recordedAt: "2026-11-20T10:05:00.000Z",
});

/**
 * 受付の画面を描く。
 */
function renderReception() {
  const router = createMemoryRouter([{ path: "/collect/events/:eventId/reception", element: <ReceptionPage /> }], {
    initialEntries: ["/collect/events/e1/reception"],
  });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

const row = (name: RegExp) => screen.getByRole("listitem", { name });

beforeEach(() => {
  for (const m of [mocks.reception, mocks.record, mocks.undo, mocks.walkIn, mocks.paypayQr]) m.mockReset();
  mocks.reception.mockResolvedValue(snapshot());
  mocks.paypayQr.mockResolvedValue(new Blob(["png"], { type: "image/png" }));
  mocks.live.onMessage = null;
  globalThis.URL.createObjectURL = vi.fn(() => "blob:qr");
  globalThis.URL.revokeObjectURL = vi.fn();
});

describe("探す", () => {
  it("名前・ふりがな・受付番号の一部で絞る（ひらがなとカタカナ・全角と半角を区別しない）", async () => {
    const user = userEvent.setup();
    renderReception();
    const search = await screen.findByRole("textbox", { name: "名前・ふりがな・受付番号で探す" });
    await user.type(search, "マツモト");
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(row(/松本 れい/)).toBeInTheDocument();
    await user.clear(search);
    await user.type(search, "ｲﾉｳｴ");
    expect(row(/井上 そら/)).toBeInTheDocument();
    await user.clear(search);
    await user.type(search, "１２");
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(row(/木村 ゆうき/)).toBeInTheDocument();
  });
});

describe("記録する", () => {
  it("現金を押すと記録の呼び出し1回。受付済みになり、数字が増え、払い方のボタンが消える", async () => {
    mocks.record.mockResolvedValue({ record: recordOf("p1", "cash"), version: 6 });
    const user = userEvent.setup();
    renderReception();
    await screen.findByRole("listitem", { name: /松本 れい/ });
    await user.click(within(row(/松本 れい/)).getByRole("button", { name: "現金" }));
    await waitFor(() => expect(mocks.record).toHaveBeenCalledTimes(1));
    expect(mocks.record).toHaveBeenCalledWith("e1", "p1", { method: "cash", clientRequestId: expect.any(String) });
    const done = await screen.findByRole("listitem", { name: /松本 れい（受付済み）/ });
    expect(within(done).queryByRole("button", { name: "現金" })).toBeNull();
    expect(within(done).getByText(/現金 3,000円・受け取り：主催者/)).toBeInTheDocument();
    expect(within(screen.getByLabelText("受付の数字")).getByText("1 / 3人")).toBeInTheDocument();
  });

  it("PayPayはQRのシートを出し、「受け取った」で記録する", async () => {
    mocks.record.mockResolvedValue({ record: recordOf("p1", "paypay"), version: 6 });
    const user = userEvent.setup();
    renderReception();
    await screen.findByRole("listitem", { name: /松本 れい/ });
    await user.click(within(row(/松本 れい/)).getByRole("button", { name: "PayPay" }));
    const sheet = await screen.findByRole("dialog");
    expect(await within(sheet).findByRole("img", { name: "PayPayの受け取り用QR" })).toBeInTheDocument();
    expect(mocks.record).not.toHaveBeenCalled();
    await user.click(within(sheet).getByRole("button", { name: "受け取った" }));
    await waitFor(() => expect(mocks.record).toHaveBeenCalledWith("e1", "p1", { method: "paypay", clientRequestId: expect.any(String) }));
  });

  it("振込は当日・後日を選ぶ。シートに振込先と受付番号の案内", async () => {
    mocks.record.mockResolvedValue({ record: recordOf("p3", "transfer_later"), version: 6 });
    const user = userEvent.setup();
    renderReception();
    await screen.findByRole("listitem", { name: /木村 ゆうき/ });
    await user.click(within(row(/木村 ゆうき/)).getByRole("button", { name: "振込" }));
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByText(/めぐる銀行/)).toBeInTheDocument();
    expect(within(sheet).getByText(/受付番号「12」/)).toBeInTheDocument();
    await user.click(within(sheet).getByRole("button", { name: "後日振り込む" }));
    await waitFor(() => expect(mocks.record).toHaveBeenCalledWith("e1", "p3", { method: "transfer_later", clientRequestId: expect.any(String) }));
    const done = await screen.findByRole("listitem", { name: /木村 ゆうき（受付済み）/ });
    expect(within(done).getByText(/振込（後日） 3,000円.*振込待ち/)).toBeInTheDocument();
  });

  it("区分・金額を変えると、記録に区分と金額を送る", async () => {
    mocks.record.mockResolvedValue({ record: recordOf("p1", "cash", 1000), version: 6 });
    const user = userEvent.setup();
    renderReception();
    await screen.findByRole("listitem", { name: /松本 れい/ });
    await user.click(within(row(/松本 れい/)).getByRole("button", { name: "区分・金額" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("radio", { name: /早割/ }));
    await user.type(within(dialog).getByRole("textbox", { name: "金額を直接入れる" }), "1,000");
    await user.click(within(dialog).getByRole("button", { name: "決める" }));
    expect(within(row(/松本 れい/)).getByText(/早割 1,000円/)).toBeInTheDocument();
    await user.click(within(row(/松本 れい/)).getByRole("button", { name: "現金" }));
    await waitFor(() =>
      expect(mocks.record).toHaveBeenCalledWith("e1", "p1", { method: "cash", priceTierId: "t2", amount: 1000, clientRequestId: expect.any(String) }),
    );
  });

  it("保存できなかったら「保存できませんでした・もう一度送る」を出し、受付済みに見せない。送り直しは同じ clientRequestId", async () => {
    mocks.record.mockRejectedValueOnce(new ApiError("API_UNREACHABLE", 0)).mockResolvedValueOnce({ record: recordOf("p1", "cash"), version: 6 });
    const user = userEvent.setup();
    renderReception();
    await screen.findByRole("listitem", { name: /松本 れい/ });
    await user.click(within(row(/松本 れい/)).getByRole("button", { name: "現金" }));
    expect(await within(row(/松本 れい/)).findByText("保存できませんでした")).toBeInTheDocument();
    expect(screen.queryByRole("listitem", { name: /松本 れい（受付済み）/ })).toBeNull();
    await user.click(within(row(/松本 れい/)).getByRole("button", { name: "もう一度送る" }));
    await screen.findByRole("listitem", { name: /松本 れい（受付済み）/ });
    const [first, second] = mocks.record.mock.calls;
    expect(second![2].clientRequestId).toBe(first![2].clientRequestId);
  });
});

describe("会場の共有", () => {
  it("知らせで1行が受付済みになる。古い版の知らせは当てない", async () => {
    renderReception();
    await screen.findByRole("listitem", { name: /井上 そら/ });
    act(() => mocks.live.onMessage!({ type: "reception.recorded", eventId: "e1", version: 6, at: "", personId: "p2", record: recordOf("p2", "paypay") }));
    expect(await screen.findByRole("listitem", { name: /井上 そら（受付済み）/ })).toBeInTheDocument();
    act(() => mocks.live.onMessage!({ type: "reception.undone", eventId: "e1", version: 6, at: "", personId: "p2" }));
    expect(screen.getByRole("listitem", { name: /井上 そら（受付済み）/ })).toBeInTheDocument();
    act(() => mocks.live.onMessage!({ type: "reception.undone", eventId: "e1", version: 7, at: "", personId: "p2" }));
    expect(await screen.findByRole("listitem", { name: "No.2 井上 そら" })).toBeInTheDocument();
  });

  it("版が飛んだら、スナップショットを読み直す", async () => {
    renderReception();
    await screen.findByRole("listitem", { name: /井上 そら/ });
    expect(mocks.reception).toHaveBeenCalledTimes(1);
    act(() => mocks.live.onMessage!({ type: "reception.undone", eventId: "e1", version: 9, at: "", personId: "p2" }));
    await waitFor(() => expect(mocks.reception).toHaveBeenCalledTimes(2));
  });

  it("飛び入りの知らせで行が増える", async () => {
    renderReception();
    await screen.findByRole("listitem", { name: /井上 そら/ });
    act(() =>
      mocks.live.onMessage!({
        type: "roster.changed",
        eventId: "e1",
        version: 6,
        at: "",
        personId: "p9",
        person: { id: "p9", number: 13, name: "飛び入り 太郎", kana: null, media: "walk_in", priceTierId: "t1" },
      }),
    );
    expect(await screen.findByRole("listitem", { name: "No.13 飛び入り 太郎" })).toBeInTheDocument();
  });
});
