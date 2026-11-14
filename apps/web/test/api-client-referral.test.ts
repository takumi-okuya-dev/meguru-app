// APIクライアントが紹介の見出しを付け、me の成功で消す（specs/017-referral-links contracts/ui-routes.md 3）
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, configureApiClient } from "@/lib/api-client";
import { currentReferral, rememberReferral } from "@/lib/referral-store";
import { ME_BILLING_OFF } from "./helpers/billing";

const CODE = `r_${"a".repeat(22)}`;
const ME = {
  user: { id: "u", email: "u@example.com", displayName: null },
  accounts: [],
  landingAccountId: null,
  accountLimit: { max: null, used: 0 },
  threadsAccessMode: "testers",
  threadsConnectMethods: ["token"],
  teams: [],
  ...ME_BILLING_OFF,
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  localStorage.clear();
  configureApiClient({ getToken: async () => "t", onSessionExpired: () => undefined });
  fetchMock = vi.fn(async () => new Response(JSON.stringify(ME), { status: 200, headers: { "Content-Type": "application/json" } }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const sentHeaders = () => new Headers((fetchMock.mock.calls[0]![1] as RequestInit).headers);

describe("紹介の見出し", () => {
  it("覚えていれば X-Referral-Code を付け、me が成功したら消す", async () => {
    rememberReferral(CODE);
    await api.me();
    expect(sentHeaders().get("X-Referral-Code")).toBe(CODE);
    expect(currentReferral()).toBeNull();
  });

  it("覚えていなければ付けない", async () => {
    await api.me();
    expect(sentHeaders().has("X-Referral-Code")).toBe(false);
  });

  it("me が失敗したら消さない（まだ登録が終わっていない）", async () => {
    rememberReferral(CODE);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "INTERNAL_ERROR", message: "x" } }), { status: 500 }));
    await expect(api.me()).rejects.toThrow();
    expect(currentReferral()).toBe(CODE);
  });
});
