// 集金管理の PayPay・振込先の設定の画面（specs/collect/001-event-day-collection FR-013、tasks.md T031）。
// 振込先の案内：保存すると下書きを捨てて保存した値を出す・保存の返事を待つ間に書き足した分は消さない・
// QRの保存の返事があとから来ても、新しい振込先の案内を古い値で上書きしない。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ settings: vi.fn(), saveBankText: vi.fn(), deletePaypayQr: vi.fn() }));
vi.mock("@/apps/collect/lib/api", () => ({
  collectApi: {
    settings: mocks.settings,
    saveBankText: mocks.saveBankText,
    uploadPaypayQr: vi.fn(),
    // 画像は読み終わらないままにする（ここでは見ない）
    paypayQr: () => new Promise(() => {}),
    deletePaypayQr: mocks.deletePaypayQr,
  },
}));
vi.mock("sonner", () => ({ toast: { info: vi.fn(), error: vi.fn(), success: vi.fn() } }));

const { SettingsPage } = await import("@/apps/collect/pages/SettingsPage");

/**
 * 設定の画面を描く。
 */
function renderSettings() {
  const router = createMemoryRouter([{ path: "/collect/settings", element: <SettingsPage /> }], { initialEntries: ["/collect/settings"] });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mocks.settings.mockReset().mockResolvedValue({ bankText: null, hasPaypayQr: false });
  mocks.saveBankText.mockReset();
  mocks.deletePaypayQr.mockReset();
});

describe("振込先の案内", () => {
  it("保存すると保存した値を出し、保存のボタンは押せなくなる", async () => {
    mocks.saveBankText.mockResolvedValue({ bankText: "めぐる銀行 渋谷支店", hasPaypayQr: false });
    const user = userEvent.setup();
    renderSettings();
    const box = await screen.findByRole("textbox", { name: "振込先の案内" });
    await user.type(box, "めぐる銀行 渋谷支店");
    await user.click(screen.getByRole("button", { name: "保存する" }));
    await waitFor(() => expect(mocks.saveBankText).toHaveBeenCalledWith("めぐる銀行 渋谷支店"));
    await waitFor(() => expect(screen.getByRole("button", { name: "保存する" })).toBeDisabled());
    expect(box).toHaveValue("めぐる銀行 渋谷支店");
  });

  it("保存の返事を待つ間に書き足した分は消さず、もう一度保存できる", async () => {
    let resolve: (v: unknown) => void = () => {};
    mocks.saveBankText.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    const user = userEvent.setup();
    renderSettings();
    const box = await screen.findByRole("textbox", { name: "振込先の案内" });
    await user.type(box, "めぐる銀行");
    await user.click(screen.getByRole("button", { name: "保存する" }));
    await user.type(box, " 渋谷支店");
    resolve({ bankText: "めぐる銀行", hasPaypayQr: false });
    await waitFor(() => expect(screen.getByRole("button", { name: "保存する" })).toBeEnabled());
    expect(box).toHaveValue("めぐる銀行 渋谷支店");
  });

  it("QRを消す返事が振込先の保存よりあとに来ても、保存した振込先の案内のまま", async () => {
    mocks.settings.mockResolvedValue({ bankText: "古い案内", hasPaypayQr: true });
    let resolveDelete: (v: unknown) => void = () => {};
    mocks.deletePaypayQr.mockReturnValueOnce(new Promise((r) => (resolveDelete = r)));
    mocks.saveBankText.mockResolvedValue({ bankText: "新しい案内", hasPaypayQr: true });
    const user = userEvent.setup();
    renderSettings();
    const box = await screen.findByRole("textbox", { name: "振込先の案内" });
    await user.click(screen.getByRole("button", { name: "消す" }));
    expect(screen.getByRole("button", { name: "画像を変える" })).toBeDisabled();
    await user.clear(box);
    await user.type(box, "新しい案内");
    await user.click(screen.getByRole("button", { name: "保存する" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "保存する" })).toBeDisabled());
    resolveDelete({ bankText: "古い案内", hasPaypayQr: false });
    await waitFor(() => expect(screen.getByRole("button", { name: "画像を選ぶ" })).toBeEnabled());
    expect(box).toHaveValue("新しい案内");
  });
});
