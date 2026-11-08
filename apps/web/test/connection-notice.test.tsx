// 違うアカウントでつながった知らせ（specs/025-threads-account-guide contracts/ui-routes.md 3、US3、T015）
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ connectionNotice: vi.fn(), dismissConnectionNotice: vi.fn() }));
vi.mock("@/lib/api-client", async (orig) => {
  const actual = await orig<typeof import("@/lib/api-client")>();
  return { ...actual, api: { ...actual.api, ...mocks } };
});

const { ConnectionNotice } = await import("@/components/connect/ConnectionNotice");

function renderIt() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ConnectionNotice accountId="a1" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mocks.connectionNotice.mockReset();
  mocks.dismissConnectionNotice.mockReset();
});

describe("ConnectionNotice", () => {
  it("違うアカウントでつながったことと、2行の箇条書き。「閉じる」で dismiss を送って消える", async () => {
    mocks.connectionNotice.mockResolvedValue({ otherAccount: { appliedUsername: "shop_tokyo", connectedUsername: "other_shop" } });
    mocks.dismissConnectionNotice.mockResolvedValue(undefined);
    renderIt();
    expect(await screen.findByText(/でつながりました。申し込んだ/)).toBeInTheDocument();
    expect(screen.getByText("@other_shop").tagName).toBe("STRONG");
    expect(screen.getByText(/このままでよければ、閉じてください/)).toBeInTheDocument();
    expect(screen.getByText(/@shop_tokyo にログインし直してから「接続し直す」を押す/)).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "閉じる" }));
    await waitFor(() => expect(mocks.dismissConnectionNotice).toHaveBeenCalledWith("a1"));
    await waitFor(() => expect(screen.queryByText(/でつながりました。/)).not.toBeInTheDocument());
  });

  it("otherAccount が null なら何も出さない", async () => {
    mocks.connectionNotice.mockResolvedValue({ otherAccount: null });
    renderIt();
    await waitFor(() => expect(mocks.connectionNotice).toHaveBeenCalled());
    expect(screen.queryByText(/でつながりました。/)).not.toBeInTheDocument();
  });
});
