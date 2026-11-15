// 参加者のセルフ受付の画面（specs/collect/002-self-check-in User Story 1・4、FR-010〜FR-023、tasks.md T020）。
// 探す → 払い方 → 案内・同じ名前は受付番号を聞く・受付済み・見つからなければ申し出 → 待ち → 名簿に入ったら払い方・止められたら案内。
import type { SelfMe } from "@meguru/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ info: vi.fn(), search: vi.fn(), declare: vi.fn(), request: vi.fn(), me: vi.fn(), paypayQr: vi.fn() }));
vi.mock("@/apps/collect/lib/self-api", async (orig) => {
  const actual = await orig<typeof import("@/apps/collect/lib/self-api")>();
  return { ...actual, selfApi: mocks };
});
vi.mock("sonner", () => ({ toast: { info: vi.fn(), error: vi.fn(), success: vi.fn() } }));

const { ApiError } = await import("@/lib/api-client");
const { collectApp } = await import("@/apps/collect");
const { selfDevice } = await import("@/apps/collect/lib/self-api");

const TOKEN = "cs_abc";
const PERSON = { id: "11111111-1111-4111-8111-111111111111", number: 12, name: "松本 れい", tierName: "通常", amount: 3000, tierUndecided: false };
const info = (status = "active") => ({
  status,
  event: { name: "IT交流会", startsAt: "2026-11-20T10:00:00.000Z", venue: "渋谷", methods: ["cash", "paypay", "transfer"] },
  settings: { hasPaypayQr: false, bankText: "めぐる銀行 渋谷支店 普通 1234567" },
});
const me = (over: Partial<SelfMe> = {}): SelfMe => ({ status: "active", declaration: null, request: null, ...over });

/**
 * 参加者の画面を描く。
 */
function renderSelf() {
  const router = createMemoryRouter(collectApp.publicRoutes!, { initialEntries: [`/collect/s/${TOKEN}`] });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  for (const m of Object.values(mocks)) m.mockReset();
  mocks.info.mockResolvedValue(info());
  mocks.me.mockResolvedValue(me());
});

describe("探して払い方を選ぶ", () => {
  it("名前で探す → 区分と金額 → 現金を選ぶ → 「受付で3,000円を払ってください」", async () => {
    mocks.search.mockResolvedValue({ result: "found", person: PERSON, record: null });
    mocks.declare.mockImplementation(async () => {
      mocks.me.mockResolvedValue(me({ declaration: { person: PERSON, record: { method: "cash", paymentStatus: "awaiting_confirmation", amount: 3000 } } }));
      return { record: { method: "cash", paymentStatus: "awaiting_confirmation", amount: 3000 } };
    });
    const user = userEvent.setup();
    renderSelf();
    expect(await screen.findByRole("heading", { name: "IT交流会" })).toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "名前か受付番号" }), "松本 れい");
    await user.click(screen.getByRole("button", { name: "探す" }));
    expect(await screen.findByText("通常 3,000円")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "振込（後日）" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "現金" }));
    expect(await screen.findByRole("heading", { name: "受付で3,000円を払ってください" })).toBeInTheDocument();
    expect(mocks.declare).toHaveBeenCalledWith(TOKEN, PERSON.id, "cash", expect.any(String));
    expect(screen.getByRole("button", { name: "払い方を選び直す" })).toBeInTheDocument();
  });

  it("振込を選んだら振込先と「名義の前に受付番号」の案内。確かめられたら「受付が済みました」", async () => {
    mocks.me.mockResolvedValue(me({ declaration: { person: PERSON, record: { method: "transfer_later", paymentStatus: "awaiting_transfer", amount: 3000 } } }));
    renderSelf();
    expect(await screen.findByText(/受付番号「12」を付けてください/)).toBeInTheDocument();
    expect(screen.getByText("めぐる銀行 渋谷支店 普通 1234567")).toBeInTheDocument();
  });

  it("確かめられた（支払い済み）なら「受付が済みました」で、選び直しは出さない", async () => {
    mocks.me.mockResolvedValue(me({ declaration: { person: PERSON, record: { method: "cash", paymentStatus: "paid", amount: 3000 } } }));
    renderSelf();
    expect(await screen.findByRole("heading", { name: "受付が済みました" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "払い方を選び直す" })).toBeNull();
  });

  it("0円の区分は「来場を伝える」だけ", async () => {
    mocks.search.mockResolvedValue({ result: "found", person: { ...PERSON, tierName: "招待", amount: 0 }, record: null });
    mocks.declare.mockResolvedValue({ record: { method: "none", paymentStatus: "paid", amount: 0 } });
    const user = userEvent.setup();
    renderSelf();
    await user.type(await screen.findByRole("textbox", { name: "名前か受付番号" }), "12");
    await user.click(screen.getByRole("button", { name: "探す" }));
    await user.click(await screen.findByRole("button", { name: "来場を伝える" }));
    expect(mocks.declare).toHaveBeenCalledWith(TOKEN, PERSON.id, undefined, expect.any(String));
    expect(screen.queryByRole("button", { name: "現金" })).toBeNull();
  });

  it("同じ名前は受付番号を聞く・受付済み・探しすぎの案内", async () => {
    const user = userEvent.setup();
    renderSelf();
    const box = await screen.findByRole("textbox", { name: "名前か受付番号" });
    mocks.search.mockResolvedValueOnce({ result: "ambiguous" });
    await user.type(box, "同名 太郎");
    await user.click(screen.getByRole("button", { name: "探す" }));
    expect(await screen.findByText(/受付番号で探してください/)).toBeInTheDocument();
    mocks.search.mockResolvedValueOnce({ result: "found", person: PERSON, record: { method: "cash", paymentStatus: "paid", amount: 3000 } });
    await user.click(screen.getByRole("button", { name: "探す" }));
    expect(await screen.findByText(/もう受付が済んでいます/)).toBeInTheDocument();
    mocks.search.mockRejectedValueOnce(new ApiError("RATE_LIMITED", 429));
    await user.click(screen.getByRole("button", { name: "探す" }));
    expect(await screen.findByText(/1分ほど待って/)).toBeInTheDocument();
  });

  it("端末の印をリンクごとに保存して、毎回同じものを使う", () => {
    const first = selfDevice("cs_other");
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(window.localStorage.getItem("collect:self-device:cs_other")).toBe(first);
    expect(selfDevice("cs_other")).toBe(first);
  });
});

describe("名簿にいない人の申し出", () => {
  it("見つからない → 受付の人に知らせる → 名前を送る → 待ち → 名簿に入ったら払い方へ", async () => {
    mocks.search.mockResolvedValue({ result: "not_found" });
    mocks.request.mockImplementation(async () => {
      mocks.me.mockResolvedValue(me({ request: { id: "r1", status: "pending", person: null } }));
      return { requestId: "r1" };
    });
    const user = userEvent.setup();
    renderSelf();
    await user.type(await screen.findByRole("textbox", { name: "名前か受付番号" }), "飛び入り 花子");
    await user.click(screen.getByRole("button", { name: "探す" }));
    await user.click(await screen.findByRole("button", { name: "名簿にないので、受付の人に知らせる" }));
    expect(screen.getByRole("textbox", { name: "名前" })).toHaveValue("飛び入り 花子");
    await user.click(screen.getByRole("button", { name: "送る" }));
    expect(mocks.request).toHaveBeenCalledWith(TOKEN, { name: "飛び入り 花子", kana: null });
    expect(await screen.findByRole("heading", { name: "受付の人が確かめています" })).toBeInTheDocument();
  });

  it("名簿に入った申し出は「払い方を選ぶ」。断られたら声をかける案内と探す欄", async () => {
    mocks.me.mockResolvedValue(me({ request: { id: "r1", status: "accepted", person: { ...PERSON, number: 31, name: "飛び入り 花子" } } }));
    const user = userEvent.setup();
    renderSelf();
    await user.click(await screen.findByRole("button", { name: "払い方を選ぶ" }));
    expect(await screen.findByRole("button", { name: "PayPay" })).toBeInTheDocument();
  });

  it("断られた申し出は、声をかける案内と探す欄", async () => {
    mocks.me.mockResolvedValue(me({ request: { id: "r1", status: "rejected", person: null } }));
    renderSelf();
    expect(await screen.findByText(/前の申し出は受付できませんでした/)).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "名前か受付番号" })).toBeInTheDocument();
  });
});

describe("止められたリンク", () => {
  it("止められたら「セルフ受付は止まりました」。ないリンクは「このQRは使えません」", async () => {
    mocks.info.mockResolvedValue(info("stopped"));
    mocks.me.mockResolvedValue(me({ status: "stopped" }));
    renderSelf();
    expect(await screen.findByRole("heading", { name: "セルフ受付は止まりました" })).toBeInTheDocument();
  });

  it("ないリンク", async () => {
    mocks.info.mockRejectedValue(new ApiError("ITEM_NOT_FOUND", 404));
    renderSelf();
    expect(await screen.findByRole("heading", { name: "このQRは使えません" })).toBeInTheDocument();
  });
});
