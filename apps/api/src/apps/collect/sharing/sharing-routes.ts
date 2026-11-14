// 分配の道筋（specs/collect/003-revenue-sharing contracts/api.md 1・2）。
// sharingOwnerRoutes：主催者（ログイン＋集金管理の利用の許可）。sharingMemberRoutes：招待を受ける人・つながった運営メンバー（ログインだけ）。
import {
  createExpenseRequestSchema,
  createSharingMemberRequestSchema,
  updateExpenseRequestSchema,
  updateSharingMemberRequestSchema,
} from "@meguru/shared";
import { Hono, type MiddlewareHandler } from "hono";
import { every } from "hono/combine";
import { createDb } from "../../../kernel/db/client";
import { parseBody } from "../../../kernel/validate";
import { allowBeforeSubscribe, type AppEnv } from "../../../platform";
import { acceptInvite, createInvite, getInvite, listShares, memberSharingView, stopInvite } from "./invite-service";
import { listReferrals, referrerSuggestions } from "./referral-service";
import { addExpense, addMember, deleteExpense, deleteMember, sharingSnapshot, unlinkMember, updateExpense, updateMember } from "./sharing-service";

/**
 * 主催者の分配の道筋を作る。
 * @param owner - 主催者の関所（collectOwner）
 * @returns Hono のアプリ
 */
export function sharingOwnerRoutes(owner: MiddlewareHandler<AppEnv>) {
  return new Hono<AppEnv>()
    .get("/events/:eventId/sharing", owner, async (c) => {
      return c.json(await sharingSnapshot(createDb(c.env.DATABASE_URL), c.get("user").id, c.req.param("eventId"), new Date()));
    })
    .post("/events/:eventId/expenses", owner, async (c) => {
      const input = await parseBody(createExpenseRequestSchema, c.req.json());
      return c.json(await addExpense(c.env.DATABASE_URL, createDb(c.env.DATABASE_URL), c.get("user").id, c.req.param("eventId"), input, new Date()), 201);
    })
    .patch("/events/:eventId/expenses/:expenseId", owner, async (c) => {
      const input = await parseBody(updateExpenseRequestSchema, c.req.json());
      return c.json(
        await updateExpense(c.env.DATABASE_URL, createDb(c.env.DATABASE_URL), c.get("user").id, c.req.param("eventId"), c.req.param("expenseId"), input, new Date()),
      );
    })
    .delete("/events/:eventId/expenses/:expenseId", owner, async (c) => {
      return c.json(await deleteExpense(c.env.DATABASE_URL, createDb(c.env.DATABASE_URL), c.get("user").id, c.req.param("eventId"), c.req.param("expenseId"), new Date()));
    })
    .post("/events/:eventId/members", owner, async (c) => {
      const input = await parseBody(createSharingMemberRequestSchema, c.req.json());
      return c.json(await addMember(c.env.DATABASE_URL, createDb(c.env.DATABASE_URL), c.get("user").id, c.req.param("eventId"), input, new Date()), 201);
    })
    .patch("/events/:eventId/members/:memberId", owner, async (c) => {
      const input = await parseBody(updateSharingMemberRequestSchema, c.req.json());
      return c.json(
        await updateMember(c.env.DATABASE_URL, createDb(c.env.DATABASE_URL), c.get("user").id, c.req.param("eventId"), c.req.param("memberId"), input, new Date()),
      );
    })
    .delete("/events/:eventId/members/:memberId", owner, async (c) => {
      return c.json(await deleteMember(c.env.DATABASE_URL, createDb(c.env.DATABASE_URL), c.get("user").id, c.req.param("eventId"), c.req.param("memberId"), new Date()));
    })
    .delete("/events/:eventId/members/:memberId/link", owner, async (c) => {
      return c.json(await unlinkMember(c.env.DATABASE_URL, createDb(c.env.DATABASE_URL), c.get("user").id, c.req.param("eventId"), c.req.param("memberId"), new Date()));
    })
    .post("/events/:eventId/members/:memberId/invite", owner, async (c) => {
      return c.json(await createInvite(c.env, c.get("user").id, c.req.param("eventId"), c.req.param("memberId"), new Date()), 201);
    })
    .delete("/events/:eventId/members/:memberId/invite", owner, async (c) => {
      return c.json(await stopInvite(c.env.DATABASE_URL, createDb(c.env.DATABASE_URL), c.get("user").id, c.req.param("eventId"), c.req.param("memberId"), new Date()));
    })
    .get("/events/:eventId/referrals", owner, async (c) => {
      return c.json({ rows: await listReferrals(createDb(c.env.DATABASE_URL), c.get("user").id, c.req.param("eventId")) });
    })
    .get("/referrers", owner, async (c) => {
      return c.json({ names: await referrerSuggestions(createDb(c.env.DATABASE_URL), c.get("user").id) });
    });
}

/**
 * 招待を受ける人・つながった運営メンバーの道筋を作る。ログインだけを見る（集金管理の利用の許可は見ない。research R7）。
 * 集金管理は料金なしなので、Threadsの契約の前でも呼べる印を付ける（collectOwner と同じ）。
 * @param authed - ログインのミドルウェア
 * @returns Hono のアプリ
 */
export function sharingMemberRoutes(authed: MiddlewareHandler<AppEnv>) {
  const member = every(allowBeforeSubscribe, authed);
  return new Hono<AppEnv>()
    .get("/invites/:token", member, async (c) => {
      return c.json(await getInvite(createDb(c.env.DATABASE_URL), c.get("user").id, c.req.param("token"), new Date()));
    })
    .post("/invites/:token/accept", member, async (c) => {
      return c.json(await acceptInvite(c.env.DATABASE_URL, c.get("user").id, c.req.param("token"), new Date()));
    })
    .get("/shares", member, async (c) => {
      return c.json({ events: await listShares(createDb(c.env.DATABASE_URL), c.get("user").id, new Date()) });
    })
    .get("/shares/:eventId", member, async (c) => {
      return c.json(await memberSharingView(createDb(c.env.DATABASE_URL), c.get("user").id, c.req.param("eventId"), new Date()));
    });
}
