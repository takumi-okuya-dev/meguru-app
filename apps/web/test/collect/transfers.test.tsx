// 振込待ちの画面（specs/collect/001-event-day-collection User Story 5、FR-050〜FR-052、tasks.md T063）。
import type { TransferItem } from "@meguru/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ transfers: vi.fn(), settings: vi.fn(), confirmTransfer: vi.fn(), unconfirmTransfer: vi.fn() }));
vi.mock("@/apps/collect/lib/api", () => ({ collectApi: mocks }));
vi.mock("sonner", () => ({ toast: { info: vi.fn(), error: vi.fn(), success: vi.fn() } }));

const { TransfersPage } = await import("@/apps/collect/pages/TransfersPage");

const item = (over: Partial<TransferItem>): TransferItem => ({
  personId: "p1",
  eventId: "e1",
  eventName: "11月の会",
  eventStartsAt: "2026-11-20T10:00:00.000Z",
  number: 12,
  name: "松本 れい",
  kana: "まつもと れい",
  amount: 3000,
  method: "transfer_later",
  recordedAt: "2026-11-20T10:05:00.000Z",
  transferConfirmedAt: null,
  tierUndecided: false,
  tiers: [],
  ...over,
});

/**
 * 振込待ちの画面を描く。
 */
function renderPage() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <TransfersPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  for (const m of Object.values(mocks)) m.mockReset();
  mocks.transfers.mockResolvedValue({ awaiting: [item({})], confirmed: [item({ personId: "p2", number: 3, name: "木村", transferConfirmedAt: "2026-11-21T01:00:00.000Z" })] });
  mocks.settings.mockResolvedValue({ bankText: "めぐる銀行 渋谷支店", hasPaypayQr: false });
});
afterEach(() => vi.restoreAllMocks());

describe("振込待ち", () => {
  it("一覧と探す", async () => {
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByRole("listitem", { name: "No.12 松本 れい" })).toHaveTextContent("11月の会");
    expect(screen.getByRole("heading", { name: /振込待ち 1件・3,000円/ })).toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "受付番号・名前で探す" }), "まつ");
    await waitFor(() => expect(mocks.transfers).toHaveBeenLastCalledWith("まつ"));
  });

  it("入金を確かめた・振込待ちに戻す", async () => {
    mocks.confirmTransfer.mockResolvedValue(item({ transferConfirmedAt: "2026-11-21T00:00:00.000Z" }));
    mocks.unconfirmTransfer.mockResolvedValue(item({ personId: "p2" }));
    const user = userEvent.setup();
    renderPage();
    await user.click(within(await screen.findByRole("listitem", { name: "No.12 松本 れい" })).getByRole("button", { name: "入金を確かめた" }));
    await waitFor(() => expect(mocks.confirmTransfer).toHaveBeenCalledWith("p1", undefined));
    await user.click(within(screen.getByRole("listitem", { name: "No.3 木村" })).getByRole("button", { name: "振込待ちに戻す" }));
    await waitFor(() => expect(mocks.unconfirmTransfer).toHaveBeenCalledWith("p2"));
  });

  it("区分が未定の人は「区分を確かめる」と出し、入金を確かめるときに区分を選ぶ（specs/collect/004 FR-022、tasks.md T030）", async () => {
    const tiers = [
      { id: "t1", name: "通常", amount: 3000 },
      { id: "t2", name: "早割", amount: 2500 },
    ];
    mocks.transfers.mockResolvedValue({ awaiting: [item({ tierUndecided: true, tiers, amount: 2500 })], confirmed: [] });
    mocks.confirmTransfer.mockResolvedValue(item({ transferConfirmedAt: "2026-11-21T00:00:00.000Z" }));
    const user = userEvent.setup();
    renderPage();
    const row = await screen.findByRole("listitem", { name: "No.12 松本 れい" });
    expect(row).toHaveTextContent("区分を確かめる");
    await user.click(within(row).getByRole("button", { name: "入金を確かめた" }));
    expect(mocks.confirmTransfer).not.toHaveBeenCalled();
    await user.click(await screen.findByRole("button", { name: /通常/ }));
    await waitFor(() => expect(mocks.confirmTransfer).toHaveBeenCalledWith("p1", "t1"));
  });

  it("連絡文をコピーする。コピーできないときは文を選べるように出す", async () => {
    const user = userEvent.setup();
    // userEvent.setup() が入れるクリップボードの代わりに、1回目は成功・2回目は失敗するものを入れる
    const writeText = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("denied"));
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderPage();
    const row = await screen.findByRole("listitem", { name: "No.12 松本 れい" });
    await user.click(within(row).getByRole("button", { name: "連絡文をコピー" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText.mock.calls[0]![0]).toContain("受付番号「12」");
    expect(writeText.mock.calls[0]![0]).toContain("めぐる銀行 渋谷支店");
    await user.click(within(row).getByRole("button", { name: "連絡文をコピー" }));
    const box = await screen.findByRole("textbox", { name: "連絡文" });
    expect((box as HTMLTextAreaElement).value).toContain("松本 れいさん");
  });
});
