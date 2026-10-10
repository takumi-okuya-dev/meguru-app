// US2：open の再試行と中止（規則5、research.md R10）
import { renderHook } from "@testing-library/react";
import type { AccountSummary } from "@threads-grower/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OPEN_RETRY_DELAYS_MS, useAccountOpen } from "@/lib/use-account-open";

const sample: AccountSummary = {
  id: "a1",
  username: "takumi",
  displayName: null,
  profilePictureUrl: null,
  plan: "auto-only",
  connectionStatus: "connected",
  lastUsedAt: null,
  role: "owner" as const,
  ownerName: null,
};

describe("useAccountOpen", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("失敗したら指数バックオフで最大3回まで再試行し、再試行でも同じ clientId・openSeq を送る", async () => {
    const openAccount = vi.fn().mockRejectedValue(new Error("network"));
    renderHook(() => useAccountOpen("a1", () => {}, { openAccount, clientId: "page-1" }));
    await vi.advanceTimersByTimeAsync(0);
    for (const ms of OPEN_RETRY_DELAYS_MS) await vi.advanceTimersByTimeAsync(ms);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(openAccount).toHaveBeenCalledTimes(1 + OPEN_RETRY_DELAYS_MS.length);
    const bodies = openAccount.mock.calls.map((c) => c[1]);
    expect(new Set(bodies.map((b) => JSON.stringify(b))).size).toBe(1);
    expect(bodies[0].clientId).toBe("page-1");
  });

  it("再試行がすべて失敗した後は、ウィンドウにフォーカスが戻ったときにもう一度呼ぶ", async () => {
    const openAccount = vi.fn().mockRejectedValue(new Error("network"));
    renderHook(() => useAccountOpen("a1", () => {}, { openAccount, clientId: "page-1" }));
    await vi.advanceTimersByTimeAsync(10_000);
    const before = openAccount.mock.calls.length;
    openAccount.mockResolvedValueOnce(sample);
    window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(0);
    expect(openAccount).toHaveBeenCalledTimes(before + 1);
  });

  it("画面を離れると、待機中の再試行は中止される", async () => {
    const openAccount = vi.fn().mockRejectedValue(new Error("network"));
    const { unmount } = renderHook(() => useAccountOpen("a1", () => {}, { openAccount, clientId: "page-1" }));
    await vi.advanceTimersByTimeAsync(0);
    expect(openAccount).toHaveBeenCalledTimes(1);
    unmount();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(openAccount).toHaveBeenCalledTimes(1);
  });

  it("別のAccountへ移ると、前のAccountの実行中の呼び出しを中止し、新しいAccountは大きい openSeq で呼ぶ", async () => {
    const signals: AbortSignal[] = [];
    const openAccount = vi.fn((_id: string, _b: unknown, signal?: AbortSignal) => {
      signals.push(signal!);
      return new Promise<AccountSummary>(() => {});
    });
    const { rerender } = renderHook(({ id }) => useAccountOpen(id, () => {}, { openAccount, clientId: "page-1" }), {
      initialProps: { id: "a1" },
    });
    await vi.advanceTimersByTimeAsync(0);
    rerender({ id: "b1" });
    await vi.advanceTimersByTimeAsync(0);
    expect(signals[0]!.aborted).toBe(true);
    const [first, second] = openAccount.mock.calls.map((c) => (c[1] as { openSeq: number }).openSeq);
    expect(second!).toBeGreaterThan(first!);
  });

  it("成功したら結果を渡す", async () => {
    const openAccount = vi.fn().mockResolvedValue(sample);
    const onResult = vi.fn();
    renderHook(() => useAccountOpen("a1", onResult, { openAccount, clientId: "page-1" }));
    await vi.advanceTimersByTimeAsync(0);
    expect(onResult).toHaveBeenCalledWith(sample);
  });
});
