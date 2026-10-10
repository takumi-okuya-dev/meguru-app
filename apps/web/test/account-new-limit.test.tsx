// US3：上限到達時の案内（FR-017・FR-023、規則8）
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { MeResponse } from "@threads-grower/shared";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

let meResponse: MeResponse;
vi.mock("@/lib/api-client", async (orig) => {
  const actual = await orig<typeof import("@/lib/api-client")>();
  return { ...actual, api: { ...actual.api, me: () => Promise.resolve(meResponse), connect: vi.fn() } };
});

const { AccountNew } = await import("@/pages/account-new");

function account(id: string) {
  return {
    id,
    username: `user_${id}`,
    displayName: null,
    profilePictureUrl: null,
    plan: "auto-only" as const,
    connectionStatus: "connected" as const,
    lastUsedAt: null,
    role: "owner" as const,
    ownerName: null,
  };
}

function renderWith(max: number, used: number, threadsAccessMode: "testers" | "public" = "testers") {
  meResponse = {
    user: { id: "u", email: "u@example.com", displayName: null },
    accounts: Array.from({ length: used }, (_, i) => account(`a${i}`)),
    landingAccountId: used > 0 ? "a0" : null,
    accountLimit: { max, used },
    threadsAccessMode,
    partnerTeam: null,
    editorWaiting: null,
  };
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <AccountNew />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

vi.mock("@clerk/react", () => ({ useUser: () => ({ user: null }), useClerk: () => ({ signOut: vi.fn() }) }));

describe("アカウント追加画面の上限の案内", () => {
  it("上限1件に達していれば、プラン3の案内を出し、接続ボタンを無効にする", async () => {
    renderWith(1, 1);
    expect(await screen.findByText(/プラン3にすると最大5件まで登録できます/)).toBeInTheDocument();
    expect(screen.getByText(/そのAccountの設定画面から認可し直せます/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Threadsアカウントを接続" })).toBeDisabled();
  });

  it("上限5件に達していれば、不要なAccountの削除を案内し、接続ボタンを無効にする", async () => {
    renderWith(5, 5);
    expect(await screen.findByText(/使っていないAccountを削除してください/)).toBeInTheDocument();
    expect(screen.queryByText(/プラン3にすると/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Threadsアカウントを接続" })).toBeDisabled();
  });

  it("上限に余裕があれば接続ボタンは押せて、testers のときはテスター制限の案内が出る", async () => {
    renderWith(5, 1);
    expect(await screen.findByRole("button", { name: "Threadsアカウントを接続" })).toBeEnabled();
    expect(screen.getByText(/招待されたThreadsアカウントのみ接続できます/)).toBeInTheDocument();
  });

  it("THREADS_ACCESS_MODE が public なら、テスター制限の案内を出さない（specs/002 FR-028）", async () => {
    renderWith(5, 1, "public");
    expect(await screen.findByRole("button", { name: "Threadsアカウントを接続" })).toBeEnabled();
    expect(screen.queryByText(/招待されたThreadsアカウントのみ接続できます/)).not.toBeInTheDocument();
  });
});
