// Threadsの投稿の呼び出し（specs/005-auto-post contracts/api.md「Threads APIの呼び出し」、research.md R7）
import { beforeEach, describe, expect, it } from "vitest";
import {
  ThreadsApiError,
  ThreadsAuthError,
  ThreadsRateLimitError,
  ThreadsTransientError,
  createThreadsClient,
} from "../../src/lib/threads-client";
import { fake, testEnv } from "../helpers/app";

const USER = "8101";
const threads = createThreadsClient(testEnv);

/** 偽のThreadsの認可を通して、そのユーザーのトークンを得る。 */
async function tokenFor(userId: string): Promise<string> {
  const url = new URL(threads.buildAuthorizeUrl("state"));
  url.searchParams.set("fake_action", "allow");
  url.searchParams.set("fake_user", userId);
  const res = await fetch(url, { redirect: "manual" });
  const code = new URL(res.headers.get("Location")!).searchParams.get("code")!;
  return (await threads.exchangeCode(code)).accessToken;
}

describe("Threadsの投稿の呼び出し", () => {
  let token: string;
  beforeEach(async () => {
    await fake.reset();
    await fake.addUser(USER, "publisher");
    token = await tokenFor(USER);
  });

  it("コンテナーを作って公開し、状態・投稿・一覧・使用量を読める", async () => {
    const { containerId } = await threads.createTextContainer(token, USER, "こんにちは");
    expect(await threads.getContainerStatus(token, containerId)).toEqual({ status: "FINISHED" });
    const since = new Date(Date.now() - 60_000);
    const { mediaId } = await threads.publishContainer(token, USER, containerId);
    expect(await threads.getContainerStatus(token, containerId)).toEqual({ status: "PUBLISHED" });

    const media = await threads.getMedia(token, mediaId);
    expect(media.id).toBe(mediaId);
    expect(media.permalink).toContain(mediaId);
    expect(Number.isNaN(new Date(media.timestamp).getTime())).toBe(false);

    const recent = await threads.listRecentThreads(token, USER, since);
    expect(recent.map((p) => [p.id, p.text])).toEqual([[mediaId, "こんにちは"]]);

    expect(await threads.getPublishingLimit(token, USER)).toEqual({ quotaUsage: 1, quotaTotal: 250 });
  });

  it("失敗を種類ごとのエラーに分ける", async () => {
    await fake.publishFail("createContainer", "auth", 1);
    await expect(threads.createTextContainer(token, USER, "a")).rejects.toBeInstanceOf(ThreadsAuthError);
    await fake.publishFail("createContainer", "rate_limit", 1);
    await expect(threads.createTextContainer(token, USER, "a")).rejects.toBeInstanceOf(ThreadsRateLimitError);
    await fake.publishFail("createContainer", "transient", 1);
    await expect(threads.createTextContainer(token, USER, "a")).rejects.toBeInstanceOf(ThreadsTransientError);
    await fake.publishFail("createContainer", "invalid", 1);
    await expect(threads.createTextContainer(token, USER, "a")).rejects.toBeInstanceOf(ThreadsApiError);
  });

  it("投稿の権限がない（コード10）は ThreadsApiError（要再接続にはしない）", async () => {
    await fake.setPublishPermission(USER, false);
    const err = await threads.getPublishingLimit(token, USER).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ThreadsApiError);
    expect(err).not.toBeInstanceOf(ThreadsAuthError);
  });

  it("公開の応答が 502 なら ThreadsTransientError（公開は済んでいる）", async () => {
    const { containerId } = await threads.createTextContainer(token, USER, "x");
    await fake.dropPublishResponse(1);
    await expect(threads.publishContainer(token, USER, containerId)).rejects.toBeInstanceOf(ThreadsTransientError);
    expect(await fake.posts()).toHaveLength(1);
  });

  it("通信の失敗・タイムアウトは ThreadsTransientError", async () => {
    const broken = createThreadsClient(testEnv, async () => {
      throw new TypeError("network down");
    });
    await expect(broken.createTextContainer(token, USER, "x")).rejects.toBeInstanceOf(ThreadsTransientError);
    const timeout = createThreadsClient(testEnv, async () => {
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    });
    await expect(timeout.getPublishingLimit(token, USER)).rejects.toBeInstanceOf(ThreadsTransientError);
  });

  it("エラーのメッセージに、Threadsの応答の本文を入れない", async () => {
    await fake.publishFail("publish", "invalid", 1);
    const err = (await threads.publishContainer(token, USER, "1").catch((e: unknown) => e)) as Error;
    expect(err.message).not.toContain("Invalid parameter");
  });
});
