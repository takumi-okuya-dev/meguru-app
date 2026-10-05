// 偽のThreadsサーバー（research.md R12）。Node で動かし、結合テスト・E2E・ローカル確認で使う。
// - 認可画面：/oauth/authorize（fake_action=allow|deny で即リダイレクト。指定がなければ許可・拒否のリンクを表示）
// - Graph API：コード交換、長期トークン交換、更新、プロフィール
// - 投稿（specs/005-auto-post contracts/api.md「Threads APIの呼び出し」）：コンテナーの作成・公開・状態、投稿の取得・一覧、投稿数の使用量
// - 制御用：/__control/*（ユーザーの登録、トークンの無効化、失敗・遅延の注入、発行済みトークンの一覧、
//   投稿の失敗・応答の喪失・権限なしの注入、コンテナーの状態の上書き、作った投稿の一覧）
import { Hono, type Context } from "hono";

type FakeUser = { id: string; username: string; name: string | null; picture: string | null };
type Endpoint = "exchangeCode" | "exchangeLongLived" | "refresh" | "getProfile";
type Failure = { times: number; kind: "auth" | "server" };
type PublishEndpoint = "createContainer" | "publish" | "containerStatus" | "getMedia" | "publishingLimit" | "listThreads";
type PublishFailureKind = "transient" | "auth" | "rate_limit" | "invalid";
type ContainerStatus = "IN_PROGRESS" | "FINISHED" | "PUBLISHED" | "ERROR" | "EXPIRED";
type Container = { id: string; userId: string; text: string; status: ContainerStatus; mediaId: string | null };
type Post = { id: string; userId: string; text: string; timestamp: string; permalink: string; containerId: string };

export function createFakeThreads() {
  const users = new Map<string, FakeUser>();
  const codes = new Map<string, string>(); // code -> userId
  const tokens = new Map<string, { userId: string; valid: boolean }>();
  const issued: string[] = [];
  const failures = new Map<Endpoint, Failure>();
  const delays = new Map<Endpoint, number>();
  let defaultUserId: string | null = null;
  const containers = new Map<string, Container>();
  const posts: Post[] = [];
  const publishFailures = new Map<PublishEndpoint, { times: number; kind: PublishFailureKind }>();
  let dropPublishResponses = 0;
  const noPublishPermission = new Set<string>();
  let seq = 0;
  const nextId = () => String(17_900_000_000_000_000 + ++seq);

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

  // 本物のGraph APIと同じく、上限・権限のエラーも type は OAuthException（code で見分ける）
  const publishFailure = (kind: PublishFailureKind) => {
    if (kind === "transient") return Response.json({ error: { message: "temporary failure", code: 2 } }, { status: 500 });
    if (kind === "auth") return invalidToken();
    if (kind === "rate_limit") {
      return Response.json({ error: { message: "(#4) Application request limit reached", type: "OAuthException", code: 4 } }, { status: 400 });
    }
    return Response.json({ error: { message: "(#100) Invalid parameter", type: "OAuthException", code: 100 } }, { status: 400 });
  };
  const noPermission = () =>
    Response.json(
      { error: { message: "(#10) Application does not have permission for this action", type: "OAuthException", code: 10 } },
      { status: 403 },
    );

  function injectPublish(endpoint: PublishEndpoint): Response | null {
    const f = publishFailures.get(endpoint);
    if (f && f.times > 0) {
      f.times -= 1;
      return publishFailure(f.kind);
    }
    return null;
  }

  function bearerUser(c: Context): FakeUser | null {
    const header = c.req.header("Authorization") ?? "";
    return tokenUser(header.startsWith("Bearer ") ? header.slice(7) : c.req.query("access_token"));
  }

  async function form(c: Context): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const [k, v] of new URL(c.req.url).searchParams) out[k] = v;
    const ct = c.req.header("Content-Type") ?? "";
    if (ct.includes("application/x-www-form-urlencoded") || ct.includes("multipart/form-data")) {
      for (const [k, v] of Object.entries(await c.req.parseBody())) out[k] = String(v);
    }
    return out;
  }

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

  // ---- 投稿（specs/005-auto-post）----
  app.post("/v1.0/:userId/threads", async (c) => {
    const injected = injectPublish("createContainer");
    if (injected) return injected;
    const u = bearerUser(c);
    if (!u) return invalidToken();
    if (noPublishPermission.has(u.id)) return noPermission();
    const body = await form(c);
    if (body.media_type !== "TEXT" || !body.text) return publishFailure("invalid");
    const id = nextId();
    containers.set(id, { id, userId: u.id, text: body.text, status: "FINISHED", mediaId: null });
    return c.json({ id });
  });

  app.post("/v1.0/:userId/threads_publish", async (c) => {
    const injected = injectPublish("publish");
    if (injected) return injected;
    const u = bearerUser(c);
    if (!u) return invalidToken();
    if (noPublishPermission.has(u.id)) return noPermission();
    const { creation_id: creationId } = await form(c);
    const container = creationId ? containers.get(creationId) : undefined;
    if (!container || container.userId !== u.id || container.status !== "FINISHED") return publishFailure("invalid");
    const id = nextId();
    const post: Post = {
      id,
      userId: u.id,
      text: container.text,
      timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, "+0000"),
      permalink: `https://www.threads.com/@${u.username}/post/${id}`,
      containerId: container.id,
    };
    posts.push(post);
    container.status = "PUBLISHED";
    container.mediaId = id;
    // 公開は済ませ、応答だけを失わせる（research.md R6 の確認用）
    if (dropPublishResponses > 0) {
      dropPublishResponses -= 1;
      return c.json({ error: { message: "bad gateway" } }, 502);
    }
    return c.json({ id });
  });

  app.get("/v1.0/:userId/threads_publishing_limit", (c) => {
    const injected = injectPublish("publishingLimit");
    if (injected) return injected;
    const u = bearerUser(c);
    if (!u) return invalidToken();
    if (noPublishPermission.has(u.id)) return noPermission();
    const since = Date.now() - 86_400_000;
    const usage = posts.filter((p) => p.userId === u.id && Date.parse(p.timestamp.replace("+0000", "Z")) >= since).length;
    return c.json({ data: [{ quota_usage: usage, config: { quota_total: 250, quota_duration: 86400 } }] });
  });

  app.get("/v1.0/:userId/threads", (c) => {
    const injected = injectPublish("listThreads");
    if (injected) return injected;
    const u = bearerUser(c);
    if (!u) return invalidToken();
    const since = Number(c.req.query("since") ?? 0) * 1000;
    const data = posts
      .filter((p) => p.userId === u.id && Date.parse(p.timestamp.replace("+0000", "Z")) >= since - 1000)
      .slice()
      .reverse()
      .map(({ id, text, timestamp, permalink }) => ({ id, text, timestamp, permalink }));
    return c.json({ data });
  });

  app.get("/v1.0/:id", async (c, next) => {
    const id = c.req.param("id");
    if (id === "me") return next();
    const u = bearerUser(c);
    const container = containers.get(id);
    if (container) {
      const injected = injectPublish("containerStatus");
      if (injected) return injected;
      if (!u) return invalidToken();
      return c.json({ id, status: container.status });
    }
    const post = posts.find((p) => p.id === id);
    if (post) {
      const injected = injectPublish("getMedia");
      if (injected) return injected;
      if (!u) return invalidToken();
      return c.json({ id, permalink: post.permalink, timestamp: post.timestamp, text: post.text });
    }
    return publishFailure("invalid");
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
    containers.clear();
    posts.length = 0;
    publishFailures.clear();
    dropPublishResponses = 0;
    noPublishPermission.clear();
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
  app.post("/__control/publish-failures", async (c) => {
    const { endpoint, kind, times } = (await c.req.json()) as { endpoint: PublishEndpoint; kind: PublishFailureKind; times: number };
    publishFailures.set(endpoint, { kind, times });
    return c.json({ ok: true });
  });
  app.post("/__control/drop-publish-response", async (c) => {
    dropPublishResponses = ((await c.req.json()) as { times: number }).times;
    return c.json({ ok: true });
  });
  app.post("/__control/container-status", async (c) => {
    const { containerId, status } = (await c.req.json()) as { containerId: string; status: ContainerStatus };
    const container = containers.get(containerId);
    if (!container) return c.json({ ok: false }, 404);
    container.status = status;
    return c.json({ ok: true });
  });
  app.post("/__control/publish-permission", async (c) => {
    const { userId, granted } = (await c.req.json()) as { userId: string; granted: boolean };
    if (granted) noPublishPermission.delete(userId);
    else noPublishPermission.add(userId);
    return c.json({ ok: true });
  });
  app.get("/__control/posts", (c) => c.json({ posts }));
  app.get("/__control/containers", (c) => c.json({ containers: [...containers.values()] }));

  return app;
}
