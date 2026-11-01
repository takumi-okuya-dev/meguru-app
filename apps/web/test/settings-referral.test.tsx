// 設定 > 紹介（specs/017-referral-links contracts/ui-routes.md 2、US1・US2）
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const referral = vi.fn();
vi.mock("@/lib/api-client", async (orig) => {
  const actual = await orig<typeof import("@/lib/api-client")>();
  return { ...actual, api: { ...actual.api, referral } };
});

const { ReferralSettingsPage } = await import("@/pages/settings/referral");
const { SETTINGS_GROUPS } = await import("@/pages/settings/sections");

const URL = `https://app.test/r/r_${"a".repeat(22)}`;

function renderPage() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <ReferralSettingsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  referral.mockReset();
});

describe("設定 > 紹介", () => {
  it("紹介リンクと「コピー」、紹介で登録した人数を出す。コピーできたら「コピーしました」", async () => {
    referral.mockResolvedValue({ url: URL, referredCount: 2 });
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    renderPage();
    expect(await screen.findByRole("textbox", { name: "紹介リンク" })).toHaveValue(URL);
    expect(screen.getByText("あなたの紹介で登録した人：2人")).toBeInTheDocument();
    expect(screen.getByText("このリンクから登録した人の数がわかります。紹介した人・された人への特典はありません。")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "コピー" }));
    expect(writeText).toHaveBeenCalledWith(URL);
    expect(await screen.findByRole("button", { name: "コピーしました" })).toBeInTheDocument();
  });

  it("まだ誰も登録していなければ0人", async () => {
    referral.mockResolvedValue({ url: URL, referredCount: 0 });
    renderPage();
    expect(await screen.findByText("あなたの紹介で登録した人：0人")).toBeInTheDocument();
  });

  it("設定の「個人設定」に「紹介」がある", () => {
    const personal = SETTINGS_GROUPS.find((g) => g.label === "個人設定")!;
    expect(personal.sections.map((s) => s.slug)).toContain("referral");
  });
});
