// 認証（FR-001〜FR-003、research.md R2）。
// Authorization: Bearer <Clerkのセッショントークン> を検証し、失敗したら 401 AUTH_REQUIRED。
// 成功したら clerk_user_id で users を探し、なければその場で作る（JIT作成）。
import { createClerkClient, verifyToken } from "@clerk/backend";
import { eq } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import type { Env } from "../env";
import { createDb } from "../db/client";
import { users, withdrawnUsers } from "../db/schema";
import { billingModeOf, type BillingMode } from "../lib/config";
import { AppError } from "../lib/errors";

/** 退会の途中でも呼べるAPI（specs/013 contracts/api.md「認証のミドルウェアの変更」）。 */
const WITHDRAWAL_ALLOWED = new Set(["GET /api/me", "GET /api/me/withdrawal-preview", "POST /api/me/withdraw"]);

/** セッショントークンから確かめた本人。 */
export type VerifiedIdentity = {
  clerkUserId: string;
  /** セッショントークンのカスタムクレーム。Clerkダッシュボードで email・name を含める設定にする */
  email?: string;
  displayName?: string | null;
};

/** セッショントークンの検証と、ユーザーのプロフィールの取得。テストでは偽のものを差し込む。 */
export type AuthVerifier = {
  verify(token: string): Promise<VerifiedIdentity | null>;
  /** users 行を新しく作るときに、メールアドレスがトークンに含まれていなければ取りに行く */
  fetchProfile(clerkUserId: string): Promise<{ email: string; displayName: string | null }>;
};

/**
 * リクエストしたユーザー（users の行）と、環境の決済のモード。
 * 決済のモードは権限の判定（authorizeAccount）が使う（specs/013 research.md R2）。
 */
export type CurrentUser = typeof users.$inferSelect & { billing: BillingMode };
/** 認証済みのリクエストで Hono のコンテキストに置く値。 */
export type AuthVariables = { user: CurrentUser };

/**
 * Clerk でセッショントークンを検証する AuthVerifier を作る。
 * @param env - Workers のバインディング（Clerk のキーと WEB_ORIGIN を使う）
 * @returns Clerk を使う AuthVerifier
 */
export function clerkVerifier(env: Env): AuthVerifier {
  return {
    async verify(token) {
      try {
        const payload = await verifyToken(token, {
          secretKey: env.CLERK_SECRET_KEY,
          authorizedParties: [env.WEB_ORIGIN],
        });
        const claims = payload as Record<string, unknown>;
        return {
          clerkUserId: payload.sub,
          email: typeof claims.email === "string" ? claims.email : undefined,
          displayName: typeof claims.name === "string" ? claims.name : undefined,
        };
      } catch {
        return null;
      }
    },
    async fetchProfile(clerkUserId) {
      const clerk = createClerkClient({ secretKey: env.CLERK_SECRET_KEY });
      const u = await clerk.users.getUser(clerkUserId);
      const email =
        u.emailAddresses.find((e) => e.id === u.primaryEmailAddressId)?.emailAddress ??
        u.emailAddresses[0]?.emailAddress ??
        "";
      const name = [u.firstName, u.lastName].filter(Boolean).join(" ") || null;
      return { email, displayName: name };
    },
  };
}

/**
 * 認証のミドルウェアを作る（FR-001〜FR-003、research.md R2）。
 * Bearer トークンを検証し、失敗したら 401 AUTH_REQUIRED。成功したら users の行を探し、なければ作る（JIT作成）。
 * @param makeVerifier - バインディングから AuthVerifier を作る関数
 * @returns Hono のミドルウェア
 */
export function authMiddleware(makeVerifier: (env: Env) => AuthVerifier) {
  return createMiddleware<{ Bindings: Env; Variables: AuthVariables }>(async (c, next) => {
    const header = c.req.header("Authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
    if (!token) throw new AppError("AUTH_REQUIRED", 401, "missing bearer token");

    const verifier = makeVerifier(c.env);
    const identity = await verifier.verify(token);
    if (!identity) throw new AppError("AUTH_REQUIRED", 401, "invalid session token");

    const db = createDb(c.env.DATABASE_URL);
    const [existing] = await db.select().from(users).where(eq(users.clerkUserId, identity.clerkUserId)).limit(1);

    let user: typeof users.$inferSelect;
    if (existing) {
      user = existing;
      // メールアドレス・表示名がトークンに含まれていて、変わっていれば更新する
      const nextEmail = identity.email ?? existing.email;
      const nextName = identity.displayName === undefined ? existing.displayName : identity.displayName;
      if (nextEmail !== existing.email || nextName !== existing.displayName) {
        [user] = (await db
          .update(users)
          .set({ email: nextEmail, displayName: nextName, updatedAt: new Date() })
          .where(eq(users.id, existing.id))
          .returning()) as [typeof users.$inferSelect];
      }
    } else {
      // 退会した人のセッションが残っていても、users の行を作り直さない（specs/013 research.md R10）
      const [withdrawn] = await db
        .select({ id: withdrawnUsers.clerkUserId })
        .from(withdrawnUsers)
        .where(eq(withdrawnUsers.clerkUserId, identity.clerkUserId))
        .limit(1);
      if (withdrawn) throw new AppError("AUTH_REQUIRED", 401, "withdrawn user");
      const profile =
        identity.email !== undefined
          ? { email: identity.email, displayName: identity.displayName ?? null }
          : await verifier.fetchProfile(identity.clerkUserId);
      // 同時に初回アクセスが来ても1行だけになるよう、一意制約で衝突したら既存の行を使う
      await db
        .insert(users)
        .values({ clerkUserId: identity.clerkUserId, email: profile.email, displayName: profile.displayName })
        .onConflictDoNothing({ target: users.clerkUserId });
      [user] = (await db.select().from(users).where(eq(users.clerkUserId, identity.clerkUserId)).limit(1)) as [
        typeof users.$inferSelect,
      ];
    }

    // 退会の途中の人は、退会のAPIと GET /api/me のほかを止める（途中でデータを足させない。specs/013 research.md R10）
    if (user.withdrawalRequestedAt && !WITHDRAWAL_ALLOWED.has(`${c.req.method} ${c.req.path}`)) {
      throw new AppError("WITHDRAWAL_IN_PROGRESS", 409, "withdrawal in progress");
    }
    c.set("user", { ...user, billing: billingModeOf(c.env) });
    await next();
  });
}

/**
 * ログインが任意の認証のミドルウェアを作る（specs/008 招待の確認。research.md R7）。
 * Authorization があれば authMiddleware と同じく検証して user を置き、なければ user なしで次へ進む。
 * @param makeVerifier - バインディングから AuthVerifier を作る関数
 * @returns Hono のミドルウェア
 */
export function optionalAuthMiddleware(makeVerifier: (env: Env) => AuthVerifier) {
  const required = authMiddleware(makeVerifier);
  return createMiddleware<{ Bindings: Env; Variables: Partial<AuthVariables> }>(async (c, next) => {
    if (!c.req.header("Authorization")) {
      await next();
      return;
    }
    // 認証済みのときの処理は authMiddleware と同じ（JIT作成を含む）
    await required(c as never, next);
  });
}
