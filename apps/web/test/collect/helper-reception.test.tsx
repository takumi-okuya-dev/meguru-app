// 手伝う人の受付の画面（specs/collect/001-event-day-collection User Story 3、FR-071・FR-073・FR-075、tasks.md T045）。
// 名前を入れる → 受付だけの画面（サイドバーなし）・同じ端末は保存した端末の印で続きから・409 で「同じ人ですか？」→ 同じ人／別の人・
// 自分の記録だけ「取り消す」・止められたら「このリンクは止められました」・ブラウザの保存が使えないときも名前を入れれば使える。
import type { LiveMessage, ReceptionSnapshot } from "@meguru/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  info: vi.fn(),
  join: vi.fn(),
  reception: vi.fn(),
  record: vi.fn(),
  live: { onMessage: null as null | ((m: LiveMessage) => void) },
}));
vi.mock("@/apps/collect/lib/helper-api", async (orig) => {
  const actual = await orig<typeof import("@/apps/collect/lib/helper-api")>();
  return {
    ...actual,
    helperApi: {
      info: mocks.info,
      join: mocks.join,
      reception: mocks.reception,
      record: mocks.record,
      undo: vi.fn(),
      walkIn: vi.fn(),
      paypayQr: vi.fn(),
      liveTicket: vi.fn(),
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

const { HelperApiError } = await import("@/apps/collect/lib/helper-api");
const { collectApp } = await import("@/apps/collect");

const TOKEN = "cr_abc";
const record = (personId: string, helperId: string | null) => ({
  personId,
  method: "cash" as const,
  priceTierId: "t1",
  amount: 3000,
  amountOverridden: false,
  receiverKind: helperId ? ("helper" as const) : ("owner" as const),
  receiverHelperId: helperId,
  paymentStatus: "paid" as const,
  transferConfirmedAt: null,
  recordedAt: "2026-11-20T10:05:00.000Z",
  selfReported: false,
  confirmedAt: null,
});

/**
 * スナップショットを作る（No.1 は自分が受け取った・No.2 は主催者が受け取った・No.3 は未受付）。
 * @returns スナップショット
 */
function snapshot(): ReceptionSnapshot {
  const p = (id: string, number: number, name: string) => ({ id, number, name, kana: null, media: "peatix" as const, priceTierId: "t1", tierUndecided: false, sameName: false, selfEntered: false });
  return {
    version: 3,
    event: {
      id: "e1",
      name: "IT交流会",
      startsAt: "2026-11-20T10:00:00.000Z",
      endsAt: null,
      venue: "渋谷",
      methods: ["cash"],
      tiers: [{ id: "t1", name: "通常", amount: 3000, position: 0 }],
      closedAt: null,
      checkInMode: "roster",
    },
    people: [
      { person: p("p1", 1, "松本 れい"), record: record("p1", "h1") },
      { person: p("p2", 2, "井上 そら"), record: record("p2", null) },
      { person: p("p3", 3, "木村 ゆうき"), record: null },
    ],
    stats: { arrived: 2, rosterCount: 3, cash: 6000, paypay: 0, awaitingTransferCount: 0, awaitingTransferAmount: 0, mine: 3000, awaitingConfirmationCount: 0, awaitingConfirmationAmount: 0 },
    helpers: [{ id: "h1", name: "井上", joinedAt: "2026-11-20T09:50:00.000Z" }],
    settings: { hasPaypayQr: false, bankText: null },
    selfRequests: [],
  };
}

/**
 * 手伝う人の画面を描く（集金管理のログインのいらないルートだけ）。
 */
function renderHelper() {
  const router = createMemoryRouter(collectApp.publicRoutes!, { initialEntries: [`/collect/r/${TOKEN}`] });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  for (const m of [mocks.info, mocks.join, mocks.reception, mocks.record]) m.mockReset();
  mocks.info.mockResolvedValue({ status: "active", event: { name: "IT交流会", startsAt: "2026-11-20T10:00:00.000Z", venue: "渋谷" }, expiresAt: "2026-11-20T17:00:00.000Z" });
  mocks.reception.mockResolvedValue(snapshot());
  mocks.join.mockResolvedValue({ helperId: "h1", deviceSecret: "cd_secret" });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("参加する", () => {
  it("名前を入れて「受付を始める」→ 受付だけの画面（サイドバーなし）。端末の印をリンクごとに保存する", async () => {
    const user = userEvent.setup();
    renderHelper();
    await user.type(await screen.findByRole("textbox", { name: "あなたの名前" }), "井上");
    await user.click(screen.getByRole("button", { name: "受付を始める" }));
    expect(await screen.findByRole("heading", { name: "IT交流会の受付" })).toBeInTheDocument();
    expect(mocks.join).toHaveBeenCalledWith(TOKEN, { name: "井上" });
    expect(mocks.reception).toHaveBeenCalledWith(TOKEN, "cd_secret");
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.queryByText("名簿")).toBeNull();
    expect(JSON.parse(window.localStorage.getItem(`collect:device:${TOKEN}`)!)).toEqual({ helperId: "h1", deviceSecret: "cd_secret", name: "井上" });
  });

  it("同じ端末で開き直したら、保存した端末の印で続きから", async () => {
    window.localStorage.setItem(`collect:device:${TOKEN}`, JSON.stringify({ helperId: "h1", deviceSecret: "cd_saved", name: "井上" }));
    renderHelper();
    expect(await screen.findByRole("heading", { name: "IT交流会の受付" })).toBeInTheDocument();
    expect(mocks.reception).toHaveBeenCalledWith(TOKEN, "cd_saved");
    expect(mocks.join).not.toHaveBeenCalled();
  });

  it("同じ名前がいれば「同じ人ですか？」。同じ人なら sameAsHelperId、別の人なら asNew で送り直す", async () => {
    mocks.join.mockRejectedValueOnce(new HelperApiError("HELPER_NAME_TAKEN", 409, { helperId: "h1", joinedAt: "2026-11-20T09:50:00.000Z" }));
    const user = userEvent.setup();
    renderHelper();
    await user.type(await screen.findByRole("textbox", { name: "あなたの名前" }), "井上");
    await user.click(screen.getByRole("button", { name: "受付を始める" }));
    const dialog = await screen.findByRole("dialog", { name: "すでに井上さんがいます。同じ人ですか？" });
    await user.click(within(dialog).getByRole("button", { name: "同じ人" }));
    await waitFor(() => expect(mocks.join).toHaveBeenLastCalledWith(TOKEN, { name: "井上", sameAsHelperId: "h1" }));
    expect(await screen.findByRole("heading", { name: "IT交流会の受付" })).toBeInTheDocument();
  });

  it("別の人を選ぶと asNew", async () => {
    mocks.join.mockRejectedValueOnce(new HelperApiError("HELPER_NAME_TAKEN", 409, { helperId: "h1", joinedAt: "" }));
    const user = userEvent.setup();
    renderHelper();
    await user.type(await screen.findByRole("textbox", { name: "あなたの名前" }), "井上");
    await user.click(screen.getByRole("button", { name: "受付を始める" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "別の人" }));
    await waitFor(() => expect(mocks.join).toHaveBeenLastCalledWith(TOKEN, { name: "井上", asNew: true }));
  });

  it("ブラウザの保存が使えないときも、名前を入れれば使える", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const user = userEvent.setup();
    renderHelper();
    await user.type(await screen.findByRole("textbox", { name: "あなたの名前" }), "井上");
    await user.click(screen.getByRole("button", { name: "受付を始める" }));
    expect(await screen.findByRole("heading", { name: "IT交流会の受付" })).toBeInTheDocument();
  });
});

describe("受付", () => {
  beforeEach(() => {
    window.localStorage.setItem(`collect:device:${TOKEN}`, JSON.stringify({ helperId: "h1", deviceSecret: "cd_saved", name: "井上" }));
  });

  it("自分が受け取った記録だけ「取り消す」が出る（主催者の記録には出ない）", async () => {
    renderHelper();
    const mine = await screen.findByRole("listitem", { name: /松本 れい（受付済み）/ });
    expect(within(mine).getByRole("button", { name: "取り消す" })).toBeInTheDocument();
    expect(within(mine).getByText(/受け取り：井上/)).toBeInTheDocument();
    const owners = screen.getByRole("listitem", { name: /井上 そら（受付済み）/ });
    expect(within(owners).queryByRole("button", { name: "取り消す" })).toBeNull();
  });

  it("リンクが止められたら「このリンクは止められました」", async () => {
    renderHelper();
    await screen.findByRole("listitem", { name: /木村 ゆうき/ });
    act(() => mocks.live.onMessage!({ type: "link.stopped", eventId: "e1", version: 4, at: "" }));
    expect(await screen.findByRole("heading", { name: "このリンクは止められました" })).toBeInTheDocument();
  });

  it("開いたときに止められていれば、名前を聞かずに止めた案内", async () => {
    mocks.info.mockResolvedValue({ status: "stopped", event: { name: "IT交流会", startsAt: "2026-11-20T10:00:00.000Z", venue: null }, expiresAt: "2026-11-20T17:00:00.000Z" });
    renderHelper();
    expect(await screen.findByRole("heading", { name: "このリンクは止められました" })).toBeInTheDocument();
    expect(mocks.reception).not.toHaveBeenCalled();
  });

  it("端末の印が合わなくなったら、名前を入れ直す画面に戻る", async () => {
    mocks.reception.mockRejectedValue(new HelperApiError("DEVICE_REQUIRED", 401));
    renderHelper();
    expect(await screen.findByRole("textbox", { name: "あなたの名前" })).toBeInTheDocument();
    expect(window.localStorage.getItem(`collect:device:${TOKEN}`)).toBeNull();
  });
});
