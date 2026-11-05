// トークンを調べる呼び出し（specs/010-token-account-add research.md R3）
import { beforeEach, describe, expect, it } from "vitest";
import { ThreadsAuthError, ThreadsPermissionError, createThreadsClient } from "../../src/lib/threads-client";
import { fake, testEnv } from "../helpers/app";

describe("debugToken", () => {
  const threads = createThreadsClient(testEnv);
  beforeEach(async () => {
    await fake.reset();
    await fake.addUser("9003", "cafe_b");
  });

  it("長期トークンの期限・発行の時刻・権限を読む", async () => {
    const token = await fake.issueToken({ user: "9003" });
    const info = await threads.debugToken(token);
    expect(info.isValid).toBe(true);
    expect(info.scopes).toEqual(["threads_basic", "threads_content_publish", "threads_manage_insights", "threads_manage_replies"]);
    const days = (info.expiresAt!.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(59);
    expect(Math.abs(info.issuedAt!.getTime() - Date.now())).toBeLessThan(5_000);
  });

  it("短期トークンは期限が1時間後", async () => {
    const token = await fake.issueToken({ user: "9003", lifetime: "short" });
    const info = await threads.debugToken(token);
    expect((info.expiresAt!.getTime() - Date.now()) / 3_600_000).toBeLessThanOrEqual(1);
  });

  it("調べられないトークンは権限のエラー、無効なトークンは認証のエラー", async () => {
    const hidden = await fake.issueToken({ user: "9003", debug: false });
    await expect(threads.debugToken(hidden)).rejects.toBeInstanceOf(ThreadsPermissionError);
    const revoked = await fake.issueToken({ user: "9003" });
    await fake.revokeToken(revoked);
    await expect(threads.debugToken(revoked)).rejects.toBeInstanceOf(ThreadsAuthError);
  });

  it("エラーのメッセージにトークンを含めない", async () => {
    const revoked = await fake.issueToken({ user: "9003" });
    await fake.revokeToken(revoked);
    const err = await threads.debugToken(revoked).catch((e: Error) => e);
    expect(String((err as Error).message)).not.toContain(revoked);
  });
});
