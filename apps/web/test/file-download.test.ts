// ファイルの書き出しの共通の部品：応答の見出しからファイル名を読む・受け取る（lib/api-client.ts の requestFile）・保存する（lib/save-file.ts）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureApiClient, dispositionFilename, requestFile } from "@/lib/api-client";
import { REVOKE_DELAY_MS, saveFile } from "@/lib/save-file";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Content-Disposition のファイル名", () => {
  it("filename* の UTF-8 を先に読む（日本語のファイル名）", () => {
    expect(dispositionFilename(`attachment; filename="collect.csv"; filename*=UTF-8''${encodeURIComponent("集金_2026-11-13_交流会.csv")}`)).toBe(
      "集金_2026-11-13_交流会.csv",
    );
  });

  it("filename* の言語の印があっても読む", () => {
    expect(dispositionFilename(`attachment; filename="x.csv"; filename*=UTF-8'ja'${encodeURIComponent("集金.csv")}`)).toBe("集金.csv");
  });

  it("filename* がなければ filename（引用符あり・なし・引用符の中で逃がした引用符）", () => {
    expect(dispositionFilename('attachment; filename="a\\"b.csv"')).toBe('a"b.csv');
    expect(dispositionFilename('attachment; filename="people-20261113.csv"')).toBe("people-20261113.csv");
    expect(dispositionFilename("attachment; filename=people-20261113.csv")).toBe("people-20261113.csv");
  });

  it("形の崩れた filename* は filename を使う。ファイル名がなければ null", () => {
    expect(dispositionFilename(`attachment; filename="a.csv"; filename*=UTF-8''%E3%81`)).toBe("a.csv");
    expect(dispositionFilename("attachment")).toBeNull();
    expect(dispositionFilename('attachment; filename=""')).toBeNull();
    expect(dispositionFilename(null)).toBeNull();
  });
});

describe("requestFile", () => {
  beforeEach(() => {
    configureApiClient({ getToken: async () => "t", onSessionExpired: () => undefined });
  });

  it("中身・ファイル名・見出しを返す（トークンを付ける）", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response("名前\r\n", {
          status: 200,
          headers: { "Content-Type": "text/csv", "Content-Disposition": 'attachment; filename="people-20261113.csv"', "X-Export-Truncated": "true" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const file = await requestFile("/api/people/persons/export", { method: "POST", body: "{}" });
    expect(await file.blob.text()).toBe("名前\r\n");
    expect(file.filename).toBe("people-20261113.csv");
    expect(file.truncated).toBe(true);
    expect(new Headers((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].headers).get("Authorization")).toBe("Bearer t");
  });

  it("見出しが読めなければ filename・truncated は null", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("x", { status: 200 })));
    const file = await requestFile("/api/x");
    expect([file.filename, file.truncated]).toEqual([null, null]);
  });

  it("X-Export-Truncated: false は false", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("x", { status: 200, headers: { "X-Export-Truncated": "false" } })));
    expect((await requestFile("/api/x")).truncated).toBe(false);
  });
});

describe("saveFile", () => {
  it("a[download] を押し、保存の URL はすぐには捨てず、少し待ってから捨てる", () => {
    const clicked: { download: string; href: string }[] = [];
    URL.createObjectURL = vi.fn(() => "blob:file");
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push({ download: this.download, href: this.href });
    });
    vi.useFakeTimers();
    try {
      saveFile(new Blob(["a"]), "people-20261113.csv");
      expect(clicked).toEqual([{ download: "people-20261113.csv", href: "blob:file" }]);
      expect(document.querySelector("a[download]")).toBeNull();
      vi.advanceTimersByTime(1000);
      expect(URL.revokeObjectURL).not.toHaveBeenCalled();
      vi.advanceTimersByTime(REVOKE_DELAY_MS);
      expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:file");
    } finally {
      vi.useRealTimers();
    }
  });
});
