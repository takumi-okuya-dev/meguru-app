// 自動投稿の知らせ：手伝う人には権限のない操作を出さない（specs/008 contracts/permissions.md、PR #9 のCodexレビュー）
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { AccountAccessResponse, AutoPostStatus } from "@threads-grower/shared";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { EDITOR_ACCESS, OWNER_ACCESS } from "./helpers/access";

let access: AccountAccessResponse = OWNER_ACCESS;
const status: AutoPostStatus = {
  autoPost: { enabled: true, slotCount: 3, stoppedReason: "needs_reconnect" },
  next: null,
  approvedCount: 0,
  daysLeft: null,
  notices: [
    { kind: "blocked", count: 2, latestReason: "ng_word", latestWords: ["絶対"] },
    { kind: "needs_reconnect" },
  ],
} as AutoPostStatus;
vi.mock("@/lib/api-client", async (orig) => {
  const actual = await orig<typeof import("@/lib/api-client")>();
  return {
    ...actual,
    api: { ...actual.api, getAutoPost: async () => status, accountAccess: async () => access },
  };
});

const { AutoPostNotices } = await import("@/components/AutoPostNotices");

function renderNotices(a: AccountAccessResponse) {
  access = a;
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <AutoPostNotices accountId="a1" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("AutoPostNotices の権限による出し分け", () => {
  it("オーナーには「閉じる」と再接続のボタンが出る", async () => {
    renderNotices(OWNER_ACCESS);
    expect(await screen.findByRole("button", { name: "閉じる" })).toBeInTheDocument();
    expect(screen.getByText(/再接続してください/)).toBeInTheDocument();
  });

  it("編集者には「閉じる」も再接続のボタンも出さず、オーナーを待つ案内を出す", async () => {
    renderNotices(EDITOR_ACCESS);
    expect(await screen.findByText(/オーナーの再接続を待っています/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "閉じる" })).not.toBeInTheDocument();
    expect(screen.queryByText(/再接続してください/)).not.toBeInTheDocument();
  });
});
