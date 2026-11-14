// 画面から読める応答の見出し（CORS の Access-Control-Expose-Headers）。ファイルの書き出しのファイル名と、上限で切ったか。
import { describe, expect, it } from "vitest";
import { makeApp, testEnv } from "../helpers/app";

const app = makeApp();

describe("CORS：画面から読める見出し", () => {
  it("Content-Disposition と X-Export-Truncated を出す", async () => {
    const res = await app.request("/api/health", { headers: { Origin: testEnv.WEB_ORIGIN } }, testEnv);
    const exposed = (res.headers.get("Access-Control-Expose-Headers") ?? "").toLowerCase().split(/,\s*/);
    expect(exposed).toEqual(expect.arrayContaining(["content-disposition", "x-export-truncated"]));
  });
});
