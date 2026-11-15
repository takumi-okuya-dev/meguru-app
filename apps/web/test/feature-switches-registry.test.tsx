// 機能のスイッチは、登録の一覧（GET /api/operator/app-registry）の名前で出す。読めなければ理由と再試行を出す
// （specs/meguru/029-threads-pattern1 tasks.md T070、PR #105 のセルフレビュー）。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const appRegistry = vi.fn();
vi.mock("@/lib/api-client", async (orig) => {
  const actual = await orig<typeof import("@/lib/api-client")>();
  return { ...actual, api: { ...actual.api, appRegistry } };
});

const { ApiError } = await import("@/lib/api-client");
const { FeatureSwitches } = await import("@/components/FeatureSwitches");
const { THREADS_REGISTRY } = await import("./helpers/app-registry");

function renderSwitches() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <FeatureSwitches label="花子の使える機能" disabled={["team"]} onSave={async () => undefined} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  appRegistry.mockReset();
});

describe("機能のスイッチと登録の一覧", () => {
  it("登録の名前と表示名で出し、OFFのまとまりは切った状態", async () => {
    appRegistry.mockResolvedValue(THREADS_REGISTRY);
    renderSwitches();
    expect(await screen.findByRole("switch", { name: "自動投稿" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "戦略" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "チーム" })).not.toBeChecked();
  });

  it("読めなければ理由と「もう一度読み込む」を出し、読み直せたらスイッチを出す", async () => {
    appRegistry.mockRejectedValueOnce(new ApiError("INTERNAL_ERROR", 500)).mockResolvedValue(THREADS_REGISTRY);
    renderSwitches();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "もう一度読み込む" }));
    expect(await screen.findByRole("switch", { name: "自動投稿" })).toBeInTheDocument();
  });
});
