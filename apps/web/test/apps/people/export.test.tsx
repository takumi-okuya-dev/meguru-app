// 人の一覧の書き出し（specs/people/002-sales-list tasks.md T216・T218、spec US7、FR-111・FR-112）。
// 今の絞り込みを本文で送り、返った CSV をファイルとして保存する。1万人を超えたら「最初の1万人だけ書き出しました」。
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeListItem, renderRoutes } from "./helpers";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
const api = { persons: vi.fn(), facets: vi.fn(), events: vi.fn(), tags: vi.fn(), settings: vi.fn(), updateSettings: vi.fn() };
const requestBlob = vi.fn();
vi.mock("@/lib/api-client", async (orig) => {
  const actual = await orig<typeof import("@/lib/api-client")>();
  return { ...actual, requestBlob };
});
vi.mock("@/apps/people/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/apps/people/lib/api")>();
  return { ...actual, peopleApi: { ...actual.peopleApi, ...api } };
});

const { PeopleListPage } = await import("@/apps/people/pages/PeopleListPage");
const { exportBody, exportFilename } = await import("@/apps/people/lib/api");
const { saveFile, REVOKE_DELAY_MS } = await import("@/apps/people/lib/save-file");

const ROUTES = [{ path: "/people/list", element: <PeopleListPage /> }];
let clicked: { download: string; href: string }[] = [];

beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
  requestBlob.mockReset();
  toast.success.mockReset();
  toast.warning.mockReset();
  api.persons.mockResolvedValue({ persons: [makeListItem()], total: 1 });
  api.facets.mockResolvedValue({ nextAttendance: [], wantedConnections: [], careerInterests: [] });
  api.events.mockResolvedValue([]);
  api.tags.mockResolvedValue([{ id: "t1", name: "常連", personCount: 1 }]);
  api.settings.mockResolvedValue({ inviteTemplate: null, repeaterGoal: null, personView: { sort: "kana", group: "none" } });
  requestBlob.mockResolvedValue(new Blob(["﻿名前\r\n"], { type: "text/csv" }));
  clicked = [];
  URL.createObjectURL = vi.fn(() => "blob:people-export");
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    clicked.push({ download: this.download, href: this.href });
  });
});
afterEach(() => vi.restoreAllMocks());

describe("書き出す", () => {
  it("今の絞り込み（タグ・並べ方も）を本文で POST し、返った CSV を people-YYYYMMDD.csv として保存する", async () => {
    const user = userEvent.setup();
    renderRoutes(ROUTES, "/people/list");
    await screen.findByText("全 1人");
    await user.click(screen.getByRole("button", { name: /絞り込み/ }));
    await user.click(screen.getByRole("button", { name: "#常連" }));
    await waitFor(() => expect(api.persons).toHaveBeenLastCalledWith(expect.objectContaining({ tag: ["t1"] })));
    await user.click(screen.getByRole("button", { name: /書き出す/ }));
    await waitFor(() => expect(requestBlob).toHaveBeenCalledTimes(1));
    const [path, init] = requestBlob.mock.calls[0]! as [string, RequestInit];
    expect(path).toBe("/api/people/persons/export");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ next: [], wanted: [], career: [], tag: ["t1"], likelihood: [], sort: "kana" });
    await waitFor(() => expect(clicked).toEqual([{ download: exportFilename(), href: "blob:people-export" }]));
    expect(exportFilename()).toMatch(/^people-\d{8}\.csv$/);
    expect(toast.success).toHaveBeenCalledWith("書き出しました。");
  });

  it("1万人を超えるときは「最初の1万人だけ書き出しました」", async () => {
    const user = userEvent.setup();
    api.persons.mockResolvedValue({ persons: [makeListItem()], total: 12_000 });
    renderRoutes(ROUTES, "/people/list");
    await screen.findByText("全 12000人");
    await user.click(screen.getByRole("button", { name: /書き出す/ }));
    await waitFor(() => expect(toast.warning).toHaveBeenCalledWith("最初の1万人だけ書き出しました。"));
  });

  it("探す言葉の待ちの途中と、前の結果を出したまま読んでいる間は押せない（画面に出ている条件だけで書き出す）", async () => {
    const user = userEvent.setup();
    let release!: (v: object) => void;
    api.persons.mockImplementation((p: { q?: string }) =>
      p.q ? new Promise((res) => (release = res)) : Promise.resolve({ persons: [makeListItem()], total: 1 }),
    );
    renderRoutes(ROUTES, "/people/list");
    await screen.findByText("全 1人");
    const button = screen.getByRole("button", { name: /書き出す/ });
    expect(button).toBeEnabled();
    await user.type(screen.getByLabelText("人を探す"), "はな");
    // 待ちの途中
    expect(button).toBeDisabled();
    // 新しい条件で読んでいる間（前の結果を出したまま）
    await waitFor(() => expect(api.persons).toHaveBeenLastCalledWith(expect.objectContaining({ q: "はな" })));
    expect(button).toBeDisabled();
    release({ persons: [makeListItem()], total: 1 });
    await waitFor(() => expect(button).toBeEnabled());
    await user.click(button);
    await waitFor(() => expect(requestBlob).toHaveBeenCalledTimes(1));
    expect(JSON.parse((requestBlob.mock.calls[0]![1] as RequestInit).body as string)).toMatchObject({ q: "はな" });
  });

  it("「最初の1万人だけ」は、書き出したときの条件の人数で決める（前の結果の人数を使わない）", async () => {
    const user = userEvent.setup();
    api.persons.mockImplementation(async (p: { tag?: string[] }) => ({ persons: [makeListItem()], total: p.tag?.length ? 5 : 12_000 }));
    renderRoutes(ROUTES, "/people/list");
    await screen.findByText("全 12000人");
    await user.click(screen.getByRole("button", { name: /絞り込み/ }));
    await user.click(screen.getByRole("button", { name: "#常連" }));
    await screen.findByText("当てはまる人 5人");
    await user.click(screen.getByRole("button", { name: /書き出す/ }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("書き出しました。"));
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it("保存の URL は、すぐには捨てず、少し待ってから捨てる", () => {
    vi.useFakeTimers();
    try {
      saveFile(new Blob(["a"]), "people-20261113.csv");
      expect(clicked).toEqual([{ download: "people-20261113.csv", href: "blob:people-export" }]);
      vi.advanceTimersByTime(1000);
      expect(URL.revokeObjectURL).not.toHaveBeenCalled();
      vi.advanceTimersByTime(REVOKE_DELAY_MS);
      expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:people-export");
    } finally {
      vi.useRealTimers();
    }
  });

  it("書き出しの本文は、探す言葉を URL ではなく本文に入れる（空の項目は送らない）", () => {
    expect(exportBody({ q: " はな ", eventId: "e1", next: ["参加できそう"], lastMetFrom: "2026-10-01", offset: 100 })).toEqual({
      q: "はな",
      eventId: "e1",
      next: ["参加できそう"],
      wanted: [],
      career: [],
      lastMetFrom: "2026-10-01",
      tag: [],
      likelihood: [],
    });
  });

  it("日本時間の日付でファイル名を作る", () => {
    expect(exportFilename(new Date("2026-11-13T16:00:00.000Z"))).toBe("people-20261114.csv");
  });
});
