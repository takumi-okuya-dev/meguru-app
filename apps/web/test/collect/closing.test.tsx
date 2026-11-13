// 締めの画面（specs/collect/001-event-day-collection User Story 4、FR-040〜FR-045、tasks.md T056）。
import type { ClosingSnapshot } from "@meguru/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ closing: vi.fn(), settle: vi.fn(), checkPaypay: vi.fn(), close: vi.fn(), exportCsv: vi.fn(), liveTicket: vi.fn() }));
const live = vi.hoisted(() => ({ onMessage: null as null | (() => void) }));
vi.mock("@/apps/collect/lib/api", () => ({ collectApi: mocks }));
// 会場の共有はつながず、知らせを手で送れるようにする
vi.mock("@/apps/collect/lib/live", () => ({
  useLive: (opts: { onMessage: () => void }) => {
    live.onMessage = opts.onMessage;
    return "live";
  },
}));
vi.mock("sonner", () => ({ toast: { info: vi.fn(), error: vi.fn(), success: vi.fn() } }));
const saveFile = vi.hoisted(() => vi.fn());
vi.mock("@/lib/save-file", () => ({ saveFile }));

const { ClosingPage, diffText, fallbackCsvName } = await import("@/apps/collect/pages/ClosingPage");

const zero = { count: 0, amount: 0 };
/**
 * 締めの画面の数字を作る。
 * @param over - 変える分
 * @returns 数字
 */
function snapshot(over: Partial<ClosingSnapshot> = {}): ClosingSnapshot {
  return {
    version: 7,
    event: { id: "e1", name: "IT交流会", startsAt: "2026-11-20T10:00:00.000Z" },
    closedAt: null,
    changedAfterClose: false,
    attendance: { arrived: 5, rosterCount: 6 },
    byMethod: { cash: { count: 2, amount: 6000 }, paypay: { count: 1, amount: 2500 }, transfer_today: { count: 1, amount: 3000 }, transfer_later: { count: 1, amount: 3000 }, none: zero },
    cashByReceiver: [
      { receiverKey: "owner", name: "主催者", count: 1, amount: 3000, countedAmount: null, settledAt: null, changedAfterSettle: false },
      { receiverKey: "h1", name: "井上", count: 1, amount: 3000, countedAmount: null, settledAt: null, changedAfterSettle: false },
    ],
    paypay: { count: 1, amount: 2500, checkedAt: null, records: [{ personId: "p2", number: 2, name: "井上 そら", amount: 2500, recordedAt: "2026-11-20T10:10:00.000Z", receiverName: "主催者" }] },
    transfers: { paid: zero, awaiting: { count: 2, amount: 6000 } },
    byMedia: [{ media: "peatix", roster: 3, attended: 3, paid: 5500, awaiting: 0 }],
    absent: [{ personId: "p6", number: 6, name: "来ない人", kana: null, media: "minato" }],
    ...over,
  };
}

/**
 * 締めの画面を描く。
 */
function renderClosing() {
  const router = createMemoryRouter([{ path: "/collect/events/:eventId/closing", element: <ClosingPage /> }], { initialEntries: ["/collect/events/e1/closing"] });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  for (const m of Object.values(mocks)) m.mockReset();
  saveFile.mockReset();
  mocks.closing.mockResolvedValue(snapshot());
});

describe("締め", () => {
  it("差の言葉", () => {
    expect(diffText(3000, 3000)).toBe("合っている");
    expect(diffText(3500, 3000)).toBe("500円多い");
    expect(diffText(2000, 3000)).toBe("1,000円足りない");
  });

  it("人ごとの精算：額を入れると差が出て保存し、「精算した」を押す", async () => {
    const settled = snapshot();
    settled.cashByReceiver[1] = { ...settled.cashByReceiver[1]!, countedAmount: 2500, settledAt: "2026-11-20T13:00:00.000Z" };
    mocks.settle.mockResolvedValueOnce(snapshot()).mockResolvedValueOnce(settled);
    const user = userEvent.setup();
    renderClosing();
    const row = await screen.findByRole("listitem", { name: "井上の精算" });
    await user.type(within(row).getByRole("textbox", { name: "井上から渡された額" }), "2,500");
    expect(within(row).getByText("500円足りない")).toBeInTheDocument();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(mocks.settle).toHaveBeenCalledWith("e1", "h1", { countedAmount: 2500 }));
    await user.click(within(row).getByRole("button", { name: "精算した" }));
    await waitFor(() => expect(mocks.settle).toHaveBeenLastCalledWith("e1", "h1", { settled: true }));
    expect(await within(screen.getByRole("listitem", { name: "井上の精算" })).findByRole("button", { name: "精算を外す" })).toBeInTheDocument();
  });

  it("PayPay・振込・媒体ごと・来なかった人を出し、「履歴と合った」を押せる", async () => {
    mocks.checkPaypay.mockResolvedValue(snapshot({ paypay: { ...snapshot().paypay, checkedAt: "2026-11-20T13:00:00.000Z" } }));
    const user = userEvent.setup();
    renderClosing();
    expect(await screen.findByRole("heading", { name: /PayPay 1件・2,500円/ })).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "PayPayの記録" })).getByText(/井上 そら/)).toBeInTheDocument();
    expect(screen.getByText(/振込待ち 2件・6,000円/)).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Peatix" })).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "来なかった人" })).getByText(/来ない人/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "履歴と合った" }));
    expect(await screen.findByRole("button", { name: /履歴と合った（/ })).toBeInTheDocument();
  });

  it("精算していない人がいれば、締める前に知らせる（止めない）", async () => {
    mocks.close.mockResolvedValue({ closedAt: "2026-11-20T13:00:00.000Z", unsettled: ["owner", "h1"] });
    const user = userEvent.setup();
    renderClosing();
    await user.click(await screen.findByRole("button", { name: "締める" }));
    const dialog = await screen.findByRole("dialog", { name: "精算していない人がいます" });
    expect(within(dialog).getByText(/主催者・井上/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "締める" }));
    await waitFor(() => expect(mocks.close).toHaveBeenCalledWith("e1"));
  });

  it("締めたあとで変わったら知らせる", async () => {
    mocks.closing.mockResolvedValue(snapshot({ closedAt: "2026-11-20T13:00:00.000Z", changedAfterClose: true }));
    renderClosing();
    expect(await screen.findByRole("status")).toHaveTextContent("締めたあとで受付の記録が変わりました");
    expect(screen.getByRole("button", { name: "もう一度締める" })).toBeInTheDocument();
  });

  it("会場の共有の知らせ（手伝う人の記録など）が来たら、数字を読み直す", async () => {
    renderClosing();
    await screen.findByRole("heading", { name: /PayPay 1件/ });
    expect(mocks.closing).toHaveBeenCalledTimes(1);
    mocks.closing.mockResolvedValue(snapshot({ paypay: { ...snapshot().paypay, count: 2, amount: 5000 } }));
    act(() => live.onMessage!());
    expect(await screen.findByRole("heading", { name: /PayPay 2件・5,000円/ })).toBeInTheDocument();
  });

  it("CSV は API のファイル名で、共通の saveFile で保存する", async () => {
    const blob = new Blob(["a"], { type: "text/csv" });
    mocks.exportCsv.mockResolvedValue({ blob, filename: "集金_2026-11-20_IT交流会.csv", truncated: null, headers: new Headers() });
    renderClosing();
    await userEvent.click(await screen.findByRole("button", { name: /CSV/ }));
    await waitFor(() => expect(saveFile).toHaveBeenCalledWith(blob, "集金_2026-11-20_IT交流会.csv"));
  });

  it("API のファイル名が読めないときは、API と同じ置き換えで名前を作る", async () => {
    expect(fallbackCsvName({ name: "港/IT:交流会", startsAt: "2026-11-20T16:00:00.000Z" })).toBe("集金_2026-11-21_港_IT_交流会.csv");
    const blob = new Blob(["a"]);
    mocks.exportCsv.mockResolvedValue({ blob, filename: null, truncated: null, headers: new Headers() });
    renderClosing();
    await userEvent.click(await screen.findByRole("button", { name: /CSV/ }));
    await waitFor(() => expect(saveFile).toHaveBeenCalledWith(blob, "集金_2026-11-20_IT交流会.csv"));
  });
});
