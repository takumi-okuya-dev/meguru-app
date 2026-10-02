// 認証（FR-001〜FR-003、research.md R2）。
// Authorization: Bearer <Clerkのセッショントークン> を検証し、失敗したら 401 AUTH_REQUIRED。
// 成功したら clerk_user_id で users を探し、なければその場で作る（JIT作成）。
import { createClerkClient, verifyToken } from "@clerk/backend";
import { eq } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import type { Env } from "../env";
import { createDb } from "../db/client";
import { users } from "../db/schema";
import { AppError } from "../lib/errors";

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

/** リクエストしたユーザー（users の行）。 */
export type CurrentUser = typeof users.$inferSelect;
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

    let user: CurrentUser;
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
          .returning()) as [CurrentUser];
      }
    } else {
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
        CurrentUser,
      ];
    }

    c.set("user", user);
    await next();
  });
}
