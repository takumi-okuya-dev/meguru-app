// Threadsの反応数・フォロワー数の呼び出し（specs/006-performance-feedback contracts/api.md「Threads APIの呼び出し」、research.md R1）
import { beforeEach, describe, expect, it } from "vitest";
import {
  ThreadsApiError,
  ThreadsAuthError,
  ThreadsNotFoundError,
  ThreadsPermissionError,
  ThreadsRateLimitError,
  ThreadsTransientError,
  createThreadsClient,
} from "../../src/adapters/threads-api/threads-client";
import { fake, testEnv } from "../helpers/app";

const USER = "8201";
const MEDIA = "17900000123";

/**
 * 偽のThreadsの認可を通して、そのユーザーのトークンを得る。
 * @param userId - 偽のユーザーのID
 * @returns アクセストークン
 */
async function tokenFor(userId: string): Promise<string> {
  const threads = createThreadsClient(testEnv);
  const url = new URL(threads.buildAuthorizeUrl("state"));
  url.searchParams.set("fake_action", "allow");
  url.searchParams.set("fake_user", userId);
  const res = await fetch(url, { redirect: "manual" });
  const code = new URL(res.headers.get("Location")!).searchParams.get("code")!;
  return (await threads.exchangeCode(code)).accessToken;
}

describe("Threadsの反応数・フォロワー数の呼び出し", () => {
  const threads = createThreadsClient(testEnv);
  let token: string;
  beforeEach(async () => {
    await fake.reset();
    await fake.addUser(USER, "insights");
    token = await tokenFor(USER);
  });

  it("6つの指標を1回で読む（values の形）", async () => {
    await fake.setInsights(MEDIA, { views: 167, likes: 5, replies: 1, reposts: 2, quotes: 3, shares: 4 });
    expect(await threads.getMediaInsights(token, MEDIA)).toEqual({
      views: 167,
      likes: 5,
      replies: 1,
      reposts: 2,
      quotes: 3,
      shares: 4,
    });
    expect((await fake.callCounts()).insights).toBe(1);
  });

  it("total_value の形でも読め、返らなかった指標は null", async () => {
    await fake.setInsightsShape("total_value");
    await fake.setInsights(MEDIA, { views: 30, likes: 1 }, ["shares", "quotes"]);
    expect(await threads.getMediaInsights(token, MEDIA)).toEqual({
      views: 30,
      likes: 1,
      replies: 0,
      reposts: 0,
      quotes: null,
      shares: null,
    });
  });

  it("フォロワー数を読む", async () => {
    await fake.setFollowers(USER, 321);
    expect(await threads.getFollowersCount(token, USER)).toBe(321);
  });

  it("トークンを Authorization ヘッダーで渡す（URLに載せない）", async () => {
    const urls: string[] = [];
    const headers: (string | null)[] = [];
    const spy = createThreadsClient(testEnv, async (input, init) => {
      urls.push(String(input));
      headers.push(new Headers(init?.headers).get("Authorization"));
      return fetch(input, init);
    });
    await spy.getMediaInsights(token, MEDIA);
    await spy.getFollowersCount(token, USER);
    expect(urls.every((u) => !u.includes(token))).toBe(true);
    expect(headers).toEqual([`Bearer ${token}`, `Bearer ${token}`]);
  });

  it("失敗を種類ごとのエラーに分ける", async () => {
    await fake.insightsFail(MEDIA, "not_found", 1);
    await expect(threads.getMediaInsights(token, MEDIA)).rejects.toBeInstanceOf(ThreadsNotFoundError);
    await fake.insightsFail(MEDIA, "permission", 1);
    await expect(threads.getMediaInsights(token, MEDIA)).rejects.toBeInstanceOf(ThreadsPermissionError);
    await fake.insightsFail(MEDIA, "rate_limit", 1);
    await expect(threads.getMediaInsights(token, MEDIA)).rejects.toBeInstanceOf(ThreadsRateLimitError);
    await fake.insightsFail(MEDIA, "transient", 1);
    await expect(threads.getMediaInsights(token, MEDIA)).rejects.toBeInstanceOf(ThreadsTransientError);
    await fake.insightsFail(MEDIA, "auth", 1);
    await expect(threads.getMediaInsights(token, MEDIA)).rejects.toBeInstanceOf(ThreadsAuthError);
    await fake.insightsFail(`user:${USER}`, "permission", 1);
    await expect(threads.getFollowersCount(token, USER)).rejects.toBeInstanceOf(ThreadsPermissionError);
  });

  it("見つからない・権限のエラーも ThreadsApiError の一種", async () => {
    await fake.insightsFail(MEDIA, "not_found", 1);
    await expect(threads.getMediaInsights(token, MEDIA)).rejects.toBeInstanceOf(ThreadsApiError);
    await fake.insightsFail(MEDIA, "permission", 1);
    await expect(threads.getMediaInsights(token, MEDIA)).rejects.toBeInstanceOf(ThreadsApiError);
  });
});
