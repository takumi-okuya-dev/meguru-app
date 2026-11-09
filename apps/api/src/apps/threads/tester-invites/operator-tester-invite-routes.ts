// /api/operator/tester-applications・/api/operator/tester-settings（specs/024-tester-invite-connect contracts/api.md「運営者の招待の管理」）。
// 運営者（OPERATOR_CLERK_USER_IDS）だけ。招待の管理がOFFでも一覧は読める（操作は 404。FR-027）。
import {
  testerApplicationViewSchema,
  testerDeclineRequestSchema,
  testerInviteRequestSchema,
  testerSettingsRequestSchema,
} from "@threads-grower/shared";
import { Hono, type MiddlewareHandler } from "hono";
import type { AppEnv } from "../../../platform";
import { createDb } from "../../../kernel/db/client";
import { AppError } from "../../../kernel/errors";
import { parseBody } from "../../../kernel/validate";
import { operatorOnly } from "../../../platform";
import {
  decline,
  invite,
  listForOperator,
  markRemoved,
  revert,
  setSlotCapacity,
} from "./tester-application-service";

/**
 * 運営者の招待の管理のルート。
 * @param authed - 認証のミドルウェア
 * @returns Hono のルート
 */
export function operatorTesterInviteRoutes(authed: MiddlewareHandler<AppEnv>) {
  return new Hono<AppEnv>()
    .get("/operator/tester-applications", authed, operatorOnly, async (c) => {
      const parsed = testerApplicationViewSchema.safeParse(c.req.query("view") ?? "pending");
      if (!parsed.success) throw new AppError("VALIDATION_FAILED", 400, "invalid view", undefined, ["view"]);
      return c.json(await listForOperator(c.env, createDb(c.env.DATABASE_URL), parsed.data));
    })
    .post("/operator/tester-applications/:id/invite", authed, operatorOnly, async (c) => {
      const { force } = await parseBody(testerInviteRequestSchema, c.req.json().catch(() => ({})));
      return c.json(await invite(c.env, c.get("user"), c.req.param("id"), { force }));
    })
    .post("/operator/tester-applications/:id/decline", authed, operatorOnly, async (c) => {
      const { reason } = await parseBody(testerDeclineRequestSchema, c.req.json().catch(() => ({})));
      return c.json(await decline(c.env, c.get("user"), c.req.param("id"), reason));
    })
    .post("/operator/tester-applications/:id/revert", authed, operatorOnly, async (c) =>
      c.json(await revert(c.env, c.get("user"), c.req.param("id"))),
    )
    .post("/operator/tester-applications/:id/removed", authed, operatorOnly, async (c) =>
      c.json(await markRemoved(c.env, c.get("user"), c.req.param("id"))),
    )
    .put("/operator/tester-settings", authed, operatorOnly, async (c) => {
      const { slotCapacity } = await parseBody(testerSettingsRequestSchema, c.req.json());
      return c.json(await setSlotCapacity(c.env, c.get("user"), slotCapacity));
    });
}
