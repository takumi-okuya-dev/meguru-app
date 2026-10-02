import { describe, expect, it } from "vitest";
import { createLogger, redact } from "../../src/lib/logger";

describe("ロガーのマスク（research.md R5、FR-010）", () => {
  it("秘密情報のキーの値をマスクする", () => {
    const out = redact({
      access_token: "SECRET_A1",
      accessToken: "SECRET_A2",
      code: "SECRET_C",
      client_secret: "SECRET_S",
      signed_request: "SECRET_SR",
      state: "SECRET_ST",
      authorizeUrl: "https://threads.com/oauth/authorize?state=SECRET_Q",
      nested: { token: "SECRET_T", ok: "visible" },
    }) as Record<string, unknown>;
    const text = JSON.stringify(out);
    expect(text).not.toMatch(/SECRET_/);
    expect(text).toContain("visible");
  });

  it("URLのクエリ文字列をマスクする", () => {
    const out = redact({ url: "https://graph.threads.com/access_token?access_token=SECRET&x=1" });
    expect(JSON.stringify(out)).not.toContain("SECRET");
    expect(JSON.stringify(out)).toContain("https://graph.threads.com/access_token");
  });

  it("文字列の中に埋め込まれた access_token= もマスクする", () => {
    const lines: string[] = [];
    const logger = createLogger((line) => lines.push(line));
    logger.error("fetch failed for https://x/y?access_token=SECRET2", { err: "code=abc&state=def" });
    expect(lines.join("\n")).not.toMatch(/SECRET2|abc|def/);
  });
});
