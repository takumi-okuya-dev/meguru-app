// 会場の共有のつなぎ方（specs/collect/001-event-day-collection contracts/realtime.md 4、tasks.md T041）。
// つながったら読み直す・切れたら1秒・2秒…でつなぎ直す・つながらない間は15秒ごとに読み直す・リンクが止められたらつなぎ直さない。
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { liveUrl, retryDelay, useLive } from "@/apps/collect/lib/live";
import { ApiError } from "@/lib/api-client";

/** 偽の WebSocket（つないだURLと、開く・知らせ・閉じるを手で起こす）。 */
class FakeSocket {
  static all: FakeSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  constructor(readonly url: string) {
    FakeSocket.all.push(this);
  }
  close() {}
}

const flush = () => act(async () => {});

beforeEach(() => {
  vi.useFakeTimers();
  FakeSocket.all = [];
  vi.stubGlobal("WebSocket", FakeSocket);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useLive", () => {
  it("待ちは1秒・2秒・4秒…最大30秒。URLは ws の /api/collect/live", () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(retryDelay)).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000]);
    expect(liveUrl("a.b")).toMatch(/^ws:\/\/.+\/api\/collect\/live\?ticket=a\.b$/);
  });

  it("つながったら読み直し、知らせを渡す。切れたらつなぎ直し、その間は15秒ごとに読み直す", async () => {
    const onMessage = vi.fn();
    const onResync = vi.fn();
    const getTicket = vi.fn().mockResolvedValue({ ticket: "t", expiresAt: "" });
    const { result } = renderHook(() => useLive({ enabled: true, getTicket, onMessage, onResync }));
    await flush();
    expect(FakeSocket.all).toHaveLength(1);
    act(() => FakeSocket.all[0]!.onopen!());
    expect(result.current).toBe("live");
    expect(onResync).toHaveBeenCalledTimes(1);
    act(() => FakeSocket.all[0]!.onmessage!({ data: JSON.stringify({ type: "resync", eventId: "e1", version: 2, at: "" }) }));
    expect(onMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "resync" }));

    act(() => FakeSocket.all[0]!.onclose!({ code: 1006 }));
    expect(result.current).toBe("offline");
    // 1秒後につなぎ直す（入場券を取り直す）
    await act(async () => vi.advanceTimersByTime(1000));
    expect(getTicket).toHaveBeenCalledTimes(2);
    expect(FakeSocket.all).toHaveLength(2);
    // つながらないまま15秒たつと読み直す
    act(() => FakeSocket.all[1]!.onclose!({ code: 1006 }));
    onResync.mockClear();
    await act(async () => vi.advanceTimersByTime(15_000));
    expect(onResync).toHaveBeenCalled();
  });

  it("リンクが止められたら（閉じた理由4001・LINK_INACTIVE）、つなぎ直さない", async () => {
    const getTicket = vi.fn().mockResolvedValue({ ticket: "t", expiresAt: "" });
    const { result } = renderHook(() => useLive({ enabled: true, getTicket, onMessage: vi.fn(), onResync: vi.fn() }));
    await flush();
    act(() => FakeSocket.all[0]!.onopen!());
    act(() => FakeSocket.all[0]!.onclose!({ code: 4001 }));
    expect(result.current).toBe("stopped");
    await act(async () => vi.advanceTimersByTime(60_000));
    expect(getTicket).toHaveBeenCalledTimes(1);

    const inactive = vi.fn().mockRejectedValue(new ApiError("LINK_INACTIVE", 410));
    const second = renderHook(() => useLive({ enabled: true, getTicket: inactive, onMessage: vi.fn(), onResync: vi.fn() }));
    await flush();
    expect(second.result.current).toBe("stopped");
  });
});
