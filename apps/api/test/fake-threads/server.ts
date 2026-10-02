// 偽のThreadsサーバー（research.md R12）。Node で動かし、結合テスト・E2E・ローカル確認で使う。
// - 認可画面：/oauth/authorize（fake_action=allow|deny で即リダイレクト。指定がなければ許可・拒否のリンクを表示）
// - Graph API：コード交換、長期トークン交換、更新、プロフィール
// - 制御用：/__control/*（ユーザーの登録、トークンの無効化、失敗・遅延の注入、発行済みトークンの一覧）
import { Hono } from "hono";

type FakeUser = { id: string; username: string; name: string | null; picture: string | null };
type Endpoint = "exchangeCode" | "exchangeLongLived" | "refresh" | "getProfile";
type Failure = { times: number; kind: "auth" | "server" };

export function createFakeThreads() {
  const users = new Map<string, FakeUser>();
  const codes = new Map<string, string>(); // code -> userId
  const tokens = new Map<string, { userId: string; valid: boolean }>();
  const issued: string[] = [];
  const failures = new Map<Endpoint, Failure>();
  const delays = new Map<Endpoint, number>();
  let defaultUserId: string | null = null;

  const rand = () => crypto.randomUUID().replace(/-/g, "");
  const issue = (prefix: string, userId: string) => {
    const t = `${prefix}_${rand()}`;
    tokens.set(t, { userId, valid: true });
    issued.push(t);
    return t;
  };

  async function inject(endpoint: Endpoint): Promise<Response | null> {
    const ms = delays.get(endpoint);
    if (ms) await new Promise((r) => setTimeout(r, ms));
    const f = failures.get(endpoint);
    if (f && f.times > 0) {
      f.times -= 1;
      if (f.kind === "auth") {
        return Response.json({ error: { message: "Invalid OAuth access token", type: "OAuthException", code: 190 } }, { status: 400 });
      }
      return Response.json({ error: { message: "temporary failure", code: 2 } }, { status: 500 });
    }
    return null;
  }

  function tokenUser(token: string | null | undefined): FakeUser | null {
    if (!token) return null;
    const t = tokens.get(token);
    if (!t || !t.valid) return null;
    return users.get(t.userId) ?? null;
  }

  const invalidToken = () =>
    Response.json({ error: { message: "Invalid OAuth access token", type: "OAuthException", code: 190 } }, { status: 400 });

  const app = new Hono();

  app.get("/oauth/authorize", (c) => {
    const redirectUri = c.req.query("redirect_uri");
    const state = c.req.query("state") ?? "";
    const action = c.req.query("fake_action");
    if (!redirectUri) return c.text("missing redirect_uri", 400);
    if (!action) {
      const here = new URL(c.req.url);
      const allow = new URL(here);
      allow.searchParams.set("fake_action", "allow");
      const deny = new URL(here);
      deny.searchParams.set("fake_action", "deny");
      return c.html(
        `<!doctype html><meta charset="utf-8"><title>Fake Threads</title><h1>偽のThreads認可画面</h1>` +
          `<a id="allow" href="${allow}">許可する</a> <a id="deny" href="${deny}">キャンセル</a>`,
      );
    }
    const target = new URL(redirectUri);
    target.searchParams.set("state", state);
    if (action === "deny") {
      target.searchParams.set("error", "access_denied");
      target.searchParams.set("error_reason", "user_denied");
      return c.redirect(target.toString(), 302);
    }
    const userId = c.req.query("fake_user") ?? defaultUserId;
    if (!userId || !users.has(userId)) return c.text("unknown fake user", 400);
    const code = `code_${rand()}`;
    codes.set(code, userId);
    target.searchParams.set("code", code);
    return c.redirect(target.toString(), 302);
  });

  app.post("/oauth/access_token", async (c) => {
    const injected = await inject("exchangeCode");
    if (injected) return injected;
    const form = await c.req.parseBody();
    const code = String(form.code ?? "");
    const userId = codes.get(code);
    if (!userId) return c.json({ error: { message: "invalid code", type: "OAuthException", code: 100 } }, 400);
    codes.delete(code);
    return c.json({ access_token: issue("short", userId), user_id: userId });
  });

  app.get("/access_token", async (c) => {
    const injected = await inject("exchangeLongLived");
    if (injected) return injected;
    const u = tokenUser(c.req.query("access_token"));
    if (!u) return invalidToken();
    return c.json({ access_token: issue("long", u.id), token_type: "bearer", expires_in: 60 * 24 * 3600 });
  });

  app.get("/refresh_access_token", async (c) => {
    const injected = await inject("refresh");
    if (injected) return injected;
    const u = tokenUser(c.req.query("access_token"));
    if (!u) return invalidToken();
    return c.json({ access_token: issue("long", u.id), token_type: "bearer", expires_in: 60 * 24 * 3600 });
  });

  app.get("/v1.0/me", async (c) => {
    const injected = await inject("getProfile");
    if (injected) return injected;
    const header = c.req.header("Authorization") ?? "";
    const u = tokenUser(header.startsWith("Bearer ") ? header.slice(7) : c.req.query("access_token"));
    if (!u) return invalidToken();
    return c.json({
      id: u.id,
      username: u.username,
      ...(u.name ? { name: u.name } : {}),
      ...(u.picture ? { threads_profile_picture_url: u.picture } : {}),
    });
  });

  // ---- 制御用 ----
  app.post("/__control/reset", (c) => {
    users.clear();
    codes.clear();
    tokens.clear();
    issued.length = 0;
    failures.clear();
    delays.clear();
    defaultUserId = null;
    return c.json({ ok: true });
  });
  app.post("/__control/users", async (c) => {
    const u = (await c.req.json()) as FakeUser;
    users.set(u.id, { id: u.id, username: u.username, name: u.name ?? null, picture: u.picture ?? null });
    if (!defaultUserId) defaultUserId = u.id;
    return c.json({ ok: true });
  });
  app.post("/__control/default-user", async (c) => {
    defaultUserId = ((await c.req.json()) as { id: string }).id;
    return c.json({ ok: true });
  });
  app.post("/__control/invalidate", async (c) => {
    const { userId } = (await c.req.json()) as { userId: string };
    for (const t of tokens.values()) if (t.userId === userId) t.valid = false;
    return c.json({ ok: true });
  });
  app.post("/__control/fail", async (c) => {
    const { endpoint, times, kind } = (await c.req.json()) as { endpoint: Endpoint; times: number; kind: "auth" | "server" };
    failures.set(endpoint, { times, kind });
    return c.json({ ok: true });
  });
  app.post("/__control/delay", async (c) => {
    const { endpoint, ms } = (await c.req.json()) as { endpoint: Endpoint; ms: number };
    delays.set(endpoint, ms);
    return c.json({ ok: true });
  });
  app.get("/__control/issued-tokens", (c) => c.json({ tokens: issued }));

  return app;
}
