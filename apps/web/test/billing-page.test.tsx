// 設定 > 契約と支払い（specs/013-billing contracts/ui-routes.md「契約と支払い」、T023・T030・T040・T045）
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { BillingSummary } from "@meguru/shared";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const billing = vi.fn();
const syncBilling = vi.fn();
const startCheckout = vi.fn();
const openPortal = vi.fn();
vi.mock("@/lib/api-client", async (orig) => {
  const actual = await orig<typeof import("@/lib/api-client")>();
  return { ...actual, api: { ...actual.api, billing, syncBilling, startCheckout, openPortal, me: vi.fn(async () => ({})) } };
});
const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError, dismiss: vi.fn() } }));

const { ApiError } = await import("@/lib/api-client");
const { BillingSettingsPage } = await import("@/shell/settings/billing");

const PRICES = { perAccount: 1000 };
function summary(over: Partial<BillingSummary> = {}): BillingSummary {
  return {
    mode: "enabled",
    state: "trial",
    readOnlyReason: null,
    trialEndsAt: "2026-11-15T03:00:00.000Z",
    trialDaysLeft: 30,
    ownedAccountCount: 1,
    subscription: null,
    prices: PRICES,
    ...over,
  };
}
const sub = (over: Partial<NonNullable<BillingSummary["subscription"]>> = {}) => ({
  status: "active",
  currentPeriodEnd: "2026-12-01T03:00:00.000Z",
  cancelAtPeriodEnd: false,
  nextInvoiceAt: "2026-12-01T03:00:00.000Z",
  nextInvoiceAmount: 1500,
  ...over,
});

function renderPage(path = "/settings/billing") {
  const router = createMemoryRouter([{ path: "/settings/billing", element: <BillingSettingsPage /> }], { initialEntries: [path] });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

const assign = vi.fn();
beforeEach(() => {
  for (const f of [billing, syncBilling, startCheckout, openPortal, toastSuccess, toastError, assign]) f.mockReset();
  // 開いたときの読み直しは、既定では返らない（表示は billing の値のまま）
  syncBilling.mockImplementation(() => new Promise(() => {}));
  vi.stubGlobal("location", { ...window.location, assign });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("状態ごとの表示", () => {
  it("決済OFF：「この環境では決済を使いません」だけで、ボタンも料金も出さない", async () => {
    billing.mockResolvedValue(summary({ mode: "disabled", state: "billing_disabled", trialEndsAt: null, trialDaysLeft: null, ownedAccountCount: null }));
    renderPage();
    expect(await screen.findByText("この環境では決済を使いません")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByText(/基本料金/)).not.toBeInTheDocument();
  });

  it("料金なし", async () => {
    billing.mockResolvedValue(summary({ state: "exempt" }));
    renderPage();
    expect(await screen.findByText("料金なし")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("料金なしでも、前からの契約が残っていれば、解約できるよう支払いの画面を開ける", async () => {
    billing.mockResolvedValue(summary({ state: "exempt", subscription: sub() }));
    renderPage();
    expect(await screen.findByText("料金なし")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /支払い/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "契約する" })).not.toBeInTheDocument();
  });

  it("無料体験中：終わる日と残りの日数、料金、規約へのリンク、「契約する」", async () => {
    billing.mockResolvedValue(summary());
    renderPage();
    expect(await screen.findByText("無料体験中：2026年11月15日まで（あと30日）")).toBeInTheDocument();
    expect(screen.getByText(/アカウント1件につき月1,000円（税込み）/)).toBeInTheDocument();
    expect(screen.queryByText(/500円/)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "利用規約" })).toHaveAttribute("href", "/terms");
    expect(screen.getByRole("link", { name: "特定商取引法に基づく表記" })).toHaveAttribute("href", "/legal/commerce");
    expect(screen.getByRole("button", { name: "契約する" })).toBeInTheDocument();
  });

  it("契約の記録がなくても、開いたら1回読み直し、Checkoutを終えていれば契約済みを出す（PR #16 のCodexレビュー）", async () => {
    billing.mockResolvedValue(summary());
    syncBilling.mockResolvedValue(summary({ state: "subscribed_trial", subscription: sub({ status: "trialing" }) }));
    renderPage();
    expect(await screen.findByText("無料体験中（契約済み）")).toBeInTheDocument();
    expect(syncBilling).toHaveBeenCalledTimes(1);
  });

  it("決済OFFでは読み直さない", async () => {
    billing.mockResolvedValue(summary({ mode: "disabled", state: "billing_disabled" }));
    renderPage();
    await screen.findByText("この環境では決済を使いません");
    expect(syncBilling).not.toHaveBeenCalled();
  });

  it("契約中：次の請求日と見込み、「支払いの画面を開く」。開いたら1回読み直す（FR-036）", async () => {
    billing.mockResolvedValue(summary({ state: "active", trialDaysLeft: null, ownedAccountCount: 2, subscription: sub() }));
    syncBilling.mockResolvedValue(summary({ state: "active", trialDaysLeft: null, ownedAccountCount: 2, subscription: sub() }));
    renderPage();
    expect(await screen.findByText("契約中")).toBeInTheDocument();
    expect(screen.getByText("次の請求日 2026年12月1日・見込み 1,500円・アカウント2件")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "支払いの画面を開く" })).toBeInTheDocument();
    await waitFor(() => expect(syncBilling).toHaveBeenCalledTimes(1));
  });

  it("解約済み：終わる日と、取り消せることを出す", async () => {
    billing.mockResolvedValue(summary({ state: "canceling", subscription: sub({ cancelAtPeriodEnd: true, nextInvoiceAt: null, nextInvoiceAmount: null }) }));
    syncBilling.mockImplementation(() => new Promise(() => {}));
    renderPage();
    expect(await screen.findByText("2026年12月1日に終わります（解約済み）")).toBeInTheDocument();
    expect(screen.getByText(/解約は支払いの画面から取り消せます/)).toBeInTheDocument();
  });

  it.each([
    ["trial_ended", "無料体験が終わりました", "契約する"],
    ["canceled", "契約が終わりました", "契約する"],
    ["payment_failed", "支払いに失敗しました", "支払いの画面を開く"],
  ] as const)("読むだけ（%s）：見出しとボタン", async (reason, title, button) => {
    billing.mockResolvedValue(summary({ state: "read_only", readOnlyReason: reason, trialDaysLeft: null }));
    renderPage();
    expect(await screen.findByText(title)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: button })).toBeInTheDocument();
  });
});

describe("ボタン", () => {
  it("開いたときの読み直しが終わるまで「契約する」は押せない（PR #16 のCodexレビュー）", async () => {
    billing.mockResolvedValue(summary());
    let resolve: (v: BillingSummary) => void = () => {};
    syncBilling.mockImplementation(() => new Promise((r) => (resolve = r)));
    renderPage();
    expect(await screen.findByRole("button", { name: "契約する" })).toBeDisabled();
    resolve(summary());
    await waitFor(() => expect(screen.getByRole("button", { name: "契約する" })).toBeEnabled());
  });

  it("「契約する」でCheckoutのURLへ移る。押している間は止める", async () => {
    billing.mockResolvedValue(summary());
    syncBilling.mockResolvedValue(summary());
    let resolve: (v: { url: string }) => void = () => {};
    startCheckout.mockImplementation(() => new Promise((r) => (resolve = r)));
    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: "契約する" })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: "契約する" }));
    expect(screen.getByRole("button", { name: "支払いの画面に移っています…" })).toBeDisabled();
    resolve({ url: "https://checkout.stripe.com/x" });
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://checkout.stripe.com/x"));
  });

  it("Stripeにつながらなければトースト", async () => {
    billing.mockResolvedValue(summary({ state: "active", subscription: sub() }));
    syncBilling.mockImplementation(() => new Promise(() => {}));
    openPortal.mockRejectedValue(new ApiError("BILLING_UNAVAILABLE", 503));
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "支払いの画面を開く" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(expect.stringContaining("支払いの手続きにつながりませんでした")));
  });
});

describe("Checkoutから戻ったとき（FR-023）", () => {
  it("?checkout=success：読み直して契約済みになったら「契約しました」を出し、URLから消す", async () => {
    billing.mockResolvedValue(summary());
    syncBilling.mockResolvedValueOnce(summary()).mockResolvedValue(summary({ state: "subscribed_trial", subscription: sub({ status: "trialing" }) }));
    const router = renderPage("/settings/billing?checkout=success");
    expect(await screen.findByText("契約を確かめています…")).toBeInTheDocument();
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("契約しました"), { timeout: 3000 });
    expect(router.state.location.search).toBe("");
    expect(await screen.findByText("無料体験中（契約済み）")).toBeInTheDocument();
  });

  it("?checkout=canceled：何も出さず、URLから消す（読み直しは、開いたときの1回だけ）", async () => {
    billing.mockResolvedValue(summary());
    const router = renderPage("/settings/billing?checkout=canceled");
    await screen.findByRole("button", { name: "契約する" });
    await waitFor(() => expect(router.state.location.search).toBe(""));
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(syncBilling.mock.calls.length).toBeLessThanOrEqual(1);
  });
});
