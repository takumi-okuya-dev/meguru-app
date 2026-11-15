// 時間差のメンション（specs/023-delayed-mention contracts/api.md、research.md R3・R5・R6・R9）。
// 承認した返信の文は書き換えない（原則II）。人を一覧から消したとき、承認済みは要確認に戻し、投稿済みの予定は「やめた」にする。
import {
  MENTION_DELAY_DEFAULT,
  MENTION_PEOPLE_MAX,
  MENTION_PER_REPLY_MAX,
  MENTION_PUBLISHED_DAYS,
  MENTION_SAME_PERSON_HOURS,
  buildMentionText,
  checkPublishable,
  findNgWords,
  mentionUsernamesIn,
  normalizeMentionUsername,
  threadsLength,
  toggleMentionInText,
  type MentionAttachRequest,
} from "@meguru/shared";
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import type { Db, TxDb } from "../../../kernel/db/client";
import { lockAccountDrafts } from "../../../kernel/db/locks";
import { mentionPeople, mentionSettings, postDrafts, postMentions } from "../schema";
import { accounts } from "../schema";
import { recordActivity } from "../activity/activity-log";
import type { Env } from "../../../kernel/env";
import { AppError, itemNotFound } from "../../../kernel/errors";
import type { AccountAccess } from "../access/access";
import { CLEAR_BLOCKED_FIELDS, CLEAR_QUEUE_FIELDS, toPostDraft } from "../drafts/draft-service";
import { loadMentions } from "./mention-view";
import { listNgWords } from "../drafts/posting-rules-service";
import { notifyWake } from "../publish/posting-schedule-service";

const DAY_MS = 86_400_000;
type DraftRow = typeof postDrafts.$inferSelect;

const invalid = (details: string[], message = "invalid mention") =>
  new AppError("VALIDATION_FAILED", 400, message, undefined, details);

/**
 * 設定の行と人を読む。
 * @param db - データベース
 * @param accountId - accounts.id
 * @returns ひとこと・時間差・版・人
 */
async function readSettings(db: Db | TxDb, accountId: string) {
  const [[row], people] = await Promise.all([
    db.select().from(mentionSettings).where(eq(mentionSettings.accountId, accountId)),
    db.select().from(mentionPeople).where(eq(mentionPeople.accountId, accountId)).orderBy(asc(mentionPeople.createdAt), asc(mentionPeople.id)),
  ]);
  return {
    message: row?.message ?? "",
    delayMinutes: row?.delayMinutes ?? MENTION_DELAY_DEFAULT,
    version: row?.version ?? null,
    people,
  };
}

/**
 * GET …/mention-settings の応答。
 * @param db - データベース
 * @param access - authorizeAccount の結果
 * @returns 設定
 */
export async function getMentionSettings(db: Db | TxDb, access: AccountAccess) {
  const accountId = access.account.id;
  const [s, pending] = await Promise.all([
    readSettings(db, accountId),
    db
      .select({ usernames: postMentions.usernames })
      .from(postMentions)
      .where(and(eq(postMentions.accountId, accountId), eq(postMentions.state, "pending"))),
  ]);
  const count = (u: string) => pending.filter((p) => p.usernames.includes(u)).length;
  // 今は選べない人（research.md R6）。画面が、自分の下書きの分を除いて点線のボタンにする
  const since = new Date(Date.now() - MENTION_SAME_PERSON_HOURS * 3_600_000);
  const busyRows = await db
    .select({ draftId: postMentions.draftId, usernames: postMentions.usernames, state: postMentions.state })
    .from(postMentions)
    .where(
      and(
        eq(postMentions.accountId, accountId),
        sql`(${postMentions.state} = 'pending' OR (${postMentions.state} = 'sent' AND ${postMentions.sentAt} > ${since.toISOString()}))`,
      ),
    );
  const blocked = busyRows.flatMap((r) =>
    r.usernames.map((username) => ({ username, draftId: r.draftId, reason: r.state === "sent" ? ("recent" as const) : ("pending" as const) })),
  );
  const [account] = await db.select({ repliesDeniedAt: accounts.repliesDeniedAt }).from(accounts).where(eq(accounts.id, accountId));
  return {
    message: s.message,
    delayMinutes: s.delayMinutes,
    version: s.version,
    people: s.people.map((p) => ({ id: p.id, username: p.username, label: p.label, always: p.always, pendingCount: count(p.username) })),
    repliesDenied: (account?.repliesDeniedAt ?? null) !== null,
    blocked,
    canEdit: access.permissions.has("settings"),
  };
}

/**
 * ひとことと時間差を保存する。
 * @param tx - トランザクション
 * @param access - authorizeAccount の結果（settings）
 * @param req - 入力
 * @returns 設定
 * @throws AppError VALIDATION_FAILED（NGワード）、STALE_UPDATE
 */
export async function saveMentionSettings(
  tx: TxDb,
  access: AccountAccess,
  req: { expectedVersion: number | null; message: string; delayMinutes: number },
) {
  const accountId = access.account.id;
  const ng = await listNgWords(tx, accountId);
  if (findNgWords(req.message, ng).length > 0) throw invalid(["message"], "ng word");
  const values = { message: req.message, delayMinutes: req.delayMinutes, updatedByUserId: access.actor.id, updatedAt: new Date() };
  const [row] =
    req.expectedVersion === null
      ? await tx.insert(mentionSettings).values({ accountId, ...values }).onConflictDoNothing().returning()
      : await tx
          .update(mentionSettings)
          .set({ ...values, version: sql`${mentionSettings.version} + 1` })
          .where(and(eq(mentionSettings.accountId, accountId), eq(mentionSettings.version, req.expectedVersion)))
          .returning();
  if (!row) throw new AppError("STALE_UPDATE", 409, "updated elsewhere", await getMentionSettings(tx, access), undefined);
  await recordActivity(tx, access, { kind: "settings", action: "mention_settings_updated", summary: "時間差のメンション" });
  return getMentionSettings(tx, access);
}

/**
 * メンションする人を足す。
 * @param tx - トランザクション
 * @param access - authorizeAccount の結果（settings）
 * @param req - ユーザー名・呼び名・いつも付ける
 * @returns 設定
 * @throws AppError VALIDATION_FAILED（形・上限・同じ人・自分）
 */
export async function addMentionPerson(tx: TxDb, access: AccountAccess, req: { username: string; label: string; always?: boolean }) {
  const accountId = access.account.id;
  const username = normalizeMentionUsername(req.username);
  if (!username || username === access.account.username?.toLowerCase()) throw invalid(["username"]);
  const people = await tx.select({ username: mentionPeople.username }).from(mentionPeople).where(eq(mentionPeople.accountId, accountId));
  if (people.length >= MENTION_PEOPLE_MAX) throw invalid(["limit"]);
  if (people.some((p) => p.username === username)) throw invalid(["username"], "duplicate");
  await tx.insert(mentionPeople).values({ accountId, username, label: req.label, always: req.always ?? false });
  await recordActivity(tx, access, { kind: "settings", action: "mention_person_added", summary: req.label });
  return getMentionSettings(tx, access);
}

/**
 * メンションする人の呼び名・いつも付けるを変える。
 * @param tx - トランザクション
 * @param access - authorizeAccount の結果（settings）
 * @param personId - mention_people.id
 * @param req - 変える値
 * @returns 設定
 */
export async function updateMentionPerson(tx: TxDb, access: AccountAccess, personId: string, req: { label?: string; always?: boolean }) {
  const [row] = await tx
    .update(mentionPeople)
    .set({ ...(req.label !== undefined ? { label: req.label } : {}), ...(req.always !== undefined ? { always: req.always } : {}) })
    .where(and(eq(mentionPeople.id, personId), eq(mentionPeople.accountId, access.account.id)))
    .returning();
  if (!row) throw itemNotFound();
  return getMentionSettings(tx, access);
}

/**
 * メンションする人を消す（contracts/api.md「DELETE /mention-people」、research.md R6）。承認した文は書き換えない。
 * @param tx - トランザクション
 * @param access - authorizeAccount の結果（settings）
 * @param personId - mention_people.id
 * @returns 設定
 */
export async function removeMentionPerson(tx: TxDb, access: AccountAccess, personId: string) {
  const accountId = access.account.id;
  await lockAccountDrafts(tx, accountId);
  const [person] = await tx
    .delete(mentionPeople)
    .where(and(eq(mentionPeople.id, personId), eq(mentionPeople.accountId, accountId)))
    .returning();
  if (!person) throw itemNotFound();
  const rows = await tx
    .select({ m: postMentions, d: postDrafts })
    .from(postMentions)
    .innerJoin(postDrafts, eq(postDrafts.id, postMentions.draftId))
    .where(and(eq(postMentions.accountId, accountId), eq(postMentions.state, "pending"), sql`${person.username} = ANY(${postMentions.usernames})`));
  const now = new Date();
  for (const { m, d } of rows) {
    if (d.status === "needs_review" || d.status === "approved") {
      const usernames = m.usernames.filter((u) => u !== person.username);
      if (usernames.length === 0) await tx.delete(postMentions).where(eq(postMentions.draftId, m.draftId));
      else
        await tx
          .update(postMentions)
          .set({ usernames, text: toggleMentionInText(m.text, person.username), updatedAt: now })
          .where(eq(postMentions.draftId, m.draftId));
      // 返信の文が変わるので、承認済みは要確認に戻す（原則II）。要確認でも版を上げて、画面の古い版での保存を止める
      await tx
        .update(postDrafts)
        .set({
          ...(d.status === "approved"
            ? { status: "needs_review" as const, reviewedAt: null, lastReviewRequestId: null, ...CLEAR_QUEUE_FIELDS, ...CLEAR_BLOCKED_FIELDS }
            : {}),
          version: sql`${postDrafts.version} + 1`,
          updatedAt: now,
        })
        .where(eq(postDrafts.id, d.id));
    } else {
      // 投稿済み・処理中：承認した文を変えずに出さない
      // 公開を送ったあと（結果を確かめている途中）は、出たかどうかを正しく残すため取りやめない
      if (!m.publishRequestedAt)
        await tx.update(postMentions).set({ state: "canceled", updatedAt: now }).where(eq(postMentions.draftId, m.draftId));
    }
  }
  await recordActivity(tx, access, { kind: "settings", action: "mention_person_removed", summary: person.label });
  return getMentionSettings(tx, access);
}

/**
 * 今は選べない人（research.md R6）：ほかの投稿でまだ出していない予定に入っている人と、過去24時間に返信を出した人。
 * @param db - データベース
 * @param accountId - accounts.id
 * @param exceptDraftId - 数えない下書き（付けようとしている下書き）
 * @param now - 今
 * @returns ユーザー名から理由へ
 */
export async function blockedPeople(db: Db | TxDb, accountId: string, exceptDraftId: string | null, now: Date) {
  const since = new Date(now.getTime() - MENTION_SAME_PERSON_HOURS * 3_600_000);
  const rows = await db
    .select({ usernames: postMentions.usernames, state: postMentions.state, sentAt: postMentions.sentAt })
    .from(postMentions)
    .where(
      and(
        eq(postMentions.accountId, accountId),
        exceptDraftId ? ne(postMentions.draftId, exceptDraftId) : undefined,
        sql`(${postMentions.state} = 'pending' OR (${postMentions.state} = 'sent' AND ${postMentions.sentAt} > ${since.toISOString()}))`,
      ),
    );
  const out = new Map<string, "pending" | "recent">();
  for (const r of rows) for (const u of r.usernames) if (!out.has(u) || r.state === "sent") out.set(u, r.state === "sent" ? "recent" : "pending");
  return out;
}

const blockedList = (m: Map<string, "pending" | "recent">) => [...m].map(([username, reason]) => ({ username, reason }));

/**
 * 応答の下書き（時間差のメンションつき）。
 * @param db - データベース
 * @param row - post_drafts の行
 * @param username - Accountのユーザー名
 * @returns PostDraft
 */
async function draftWithMention(db: Db | TxDb, row: DraftRow, username: string | null) {
  return toPostDraft(row, { mentions: await loadMentions(db, [row], username) });
}

/**
 * 時間差のメンションを付ける・直す（PUT …/post-drafts/:draftId/mention）。
 * @param env - Workersのバインディング（関所を起こす）
 * @param tx - トランザクション
 * @param access - authorizeAccount の結果（review）
 * @param draftId - post_drafts.id
 * @param req - 入力
 * @param now - 今
 * @returns 下書きと、今は選べない人
 * @throws AppError VALIDATION_FAILED、STALE_UPDATE、DRAFT_PUBLISHING、ITEM_NOT_FOUND
 */
export async function attachMention(env: Env, tx: TxDb, access: AccountAccess, draftId: string, req: MentionAttachRequest, now: Date) {
  const accountId = access.account.id;
  await lockAccountDrafts(tx, accountId);
  const [draft] = await tx.select().from(postDrafts).where(and(eq(postDrafts.id, draftId), eq(postDrafts.accountId, accountId)));
  if (!draft) throw itemNotFound();
  if (draft.status === "publishing") throw new AppError("DRAFT_PUBLISHING", 409, "draft is being published", toPostDraft(draft));
  const settings = await readSettings(tx, accountId);
  const known = settings.people.map((p) => p.username);
  const blocked = await blockedPeople(tx, accountId, draftId, now);

  // 文があれば、文の中の一覧の人が選んだ人（spec FR-011）。なければ選んだ人から文を作る
  const text = req.text?.trim() ?? buildMentionText(settings.message, req.usernames.map((u) => u.toLowerCase()));
  const usernames = req.text !== undefined ? mentionUsernamesIn(text, known) : req.usernames.map((u) => u.toLowerCase());
  if (req.text === undefined && usernames.some((u) => !known.includes(u))) throw invalid(usernames.filter((u) => !known.includes(u)));
  if (usernames.length < 1 || usernames.length > MENTION_PER_REPLY_MAX) throw invalid(["text"]);
  const hit = usernames.filter((u) => blocked.has(u));
  if (hit.length > 0) throw invalid(hit, "blocked");
  if (threadsLength(text) > 500) throw invalid(["text"]);

  const [existing] = await tx.select().from(postMentions).where(eq(postMentions.draftId, draftId));
  let row = draft;
  if (draft.status === "needs_review" || draft.status === "approved") {
    if (draft.version !== req.expectedVersion)
      throw new AppError("STALE_UPDATE", 409, "updated elsewhere", await draftWithMention(tx, draft, access.account.username));
    const values = {
      usernames,
      text,
      delayMinutes: settings.delayMinutes,
      sendAfter: null,
      state: "pending",
      failureReason: null,
      updatedAt: now,
    };
    await tx
      .insert(postMentions)
      .values({ draftId, accountId, ...values, createdByUserId: access.actor.id })
      .onConflictDoUpdate({ target: postMentions.draftId, set: values });
    [row] = (await tx
      .update(postDrafts)
      .set({
        // 承認のあとに返信の文を変えたら、承認し直し（spec FR-013。本文の編集と同じ）
        ...(draft.status === "approved"
          ? { status: "needs_review" as const, reviewedAt: null, lastReviewRequestId: null, ...CLEAR_QUEUE_FIELDS, ...CLEAR_BLOCKED_FIELDS }
          : {}),
        version: sql`${postDrafts.version} + 1`,
        updatedAt: now,
      })
      .where(eq(postDrafts.id, draftId))
      .returning()) as [DraftRow];
  } else if (draft.status === "published") {
    // 投稿済みの投稿にあとから（spec FR-016）。「返信する」が承認なので、ここでNGワードを確かめる（原則I・II）
    const [acc] = await tx.select({ repliesDeniedAt: accounts.repliesDeniedAt }).from(accounts).where(eq(accounts.id, accountId));
    const tooOld = !draft.publishedAt || now.getTime() - draft.publishedAt.getTime() > MENTION_PUBLISHED_DAYS * DAY_MS;
    if (!draft.threadsMediaId || tooOld || existing || acc?.repliesDeniedAt) throw invalid(["status"]);
    const check = checkPublishable(text, await listNgWords(tx, accountId));
    if (!check.approvable) throw invalid(["text"], "not publishable");
    await tx.insert(postMentions).values({
      draftId,
      accountId,
      usernames,
      text,
      delayMinutes: null,
      sendAfter: now,
      createdByUserId: access.actor.id,
      updatedAt: now,
    });
    await notifyWake(env.AUTOPOST_KV, now);
  } else {
    throw invalid(["status"]);
  }
  await recordActivity(tx, access, { kind: "review", action: "mention_attached", excerpts: [draft.body] });
  return { draft: await draftWithMention(tx, row, access.account.username), blocked: blockedList(blocked) };
}

/**
 * 選んだ要確認の下書きに、「いつも付ける」の人でまとめて付ける（POST …/post-drafts/mentions）。
 * @param env - Workersのバインディング
 * @param tx - トランザクション
 * @param access - authorizeAccount の結果（review）
 * @param items - 下書きと版
 * @param now - 今
 * @returns 付けた下書きと、付けられなかった下書き
 */
export async function attachMentionsBulk(
  env: Env,
  tx: TxDb,
  access: AccountAccess,
  items: { id: string; expectedVersion: number }[],
  now: Date,
) {
  const accountId = access.account.id;
  const settings = await readSettings(tx, accountId);
  const always = settings.people.filter((p) => p.always).map((p) => p.username);
  const updated = [];
  const skipped: { id: string; reason: string }[] = [];
  for (const item of items) {
    const [draft] = await tx.select().from(postDrafts).where(and(eq(postDrafts.id, item.id), eq(postDrafts.accountId, accountId)));
    if (!draft || draft.status !== "needs_review") {
      skipped.push({ id: item.id, reason: draft ? "STALE" : "NOT_FOUND" });
      continue;
    }
    if (draft.version !== item.expectedVersion) {
      skipped.push({ id: item.id, reason: "STALE" });
      continue;
    }
    const blocked = await blockedPeople(tx, accountId, item.id, now);
    const usernames = always.filter((u) => !blocked.has(u)).slice(0, MENTION_PER_REPLY_MAX);
    if (usernames.length === 0) {
      skipped.push({ id: item.id, reason: "NO_PEOPLE" });
      continue;
    }
    const r = await attachMention(env, tx, access, item.id, { expectedVersion: item.expectedVersion, usernames }, now);
    updated.push(r.draft);
  }
  return { updated, skipped };
}

/**
 * 時間差のメンションを外す・やめる（DELETE …/post-drafts/:draftId/mention）。
 * @param tx - トランザクション
 * @param access - authorizeAccount の結果（review）
 * @param draftId - post_drafts.id
 * @param expectedVersion - 要確認・承認済みのときの下書きの版
 * @returns 下書き
 * @throws AppError VALIDATION_FAILED（済み・出せなかった）、STALE_UPDATE、ITEM_NOT_FOUND
 */
export async function detachMention(tx: TxDb, access: AccountAccess, draftId: string, expectedVersion: number | undefined) {
  const accountId = access.account.id;
  await lockAccountDrafts(tx, accountId);
  const [draft] = await tx.select().from(postDrafts).where(and(eq(postDrafts.id, draftId), eq(postDrafts.accountId, accountId)));
  if (!draft) throw itemNotFound();
  const [m] = await tx.select().from(postMentions).where(eq(postMentions.draftId, draftId));
  if (!m || m.state !== "pending") throw invalid(["state"]);
  let row = draft;
  if (draft.status === "needs_review" || draft.status === "approved") {
    if (expectedVersion !== undefined && draft.version !== expectedVersion)
      throw new AppError("STALE_UPDATE", 409, "updated elsewhere", await draftWithMention(tx, draft, access.account.username));
    await tx.delete(postMentions).where(eq(postMentions.draftId, draftId));
    [row] = (await tx
      .update(postDrafts)
      .set({ version: sql`${postDrafts.version} + 1`, updatedAt: new Date() })
      .where(eq(postDrafts.id, draftId))
      .returning()) as [DraftRow];
  } else {
    // 公開を送ったあとは、出たかどうかを確かめている途中なので、やめられない（PR #66 のCodexレビュー）
    if (m.publishRequestedAt) throw invalid(["state"], "already sending");
    await tx.update(postMentions).set({ state: "canceled", updatedAt: new Date() }).where(eq(postMentions.draftId, draftId));
  }
  await recordActivity(tx, access, { kind: "review", action: "mention_detached", excerpts: [draft.body] });
  return { draft: await draftWithMention(tx, row, access.account.username) };
}

/**
 * 承認のときの返信の文の確かめ（research.md R5）。下書きごとの時間差のメンションの文を返す。
 * @param db - データベース
 * @param draftIds - 下書き
 * @returns draftId から返信の文へ（予定中のものだけ）
 */
export async function pendingMentionTexts(db: Db | TxDb, draftIds: readonly string[]) {
  if (draftIds.length === 0) return new Map<string, string>();
  const rows = await db
    .select({ draftId: postMentions.draftId, text: postMentions.text })
    .from(postMentions)
    .where(and(inArray(postMentions.draftId, [...draftIds]), eq(postMentions.state, "pending")));
  return new Map(rows.map((r) => [r.draftId, r.text]));
}

/**
 * 次の返信の予定の時刻（関所の候補。contracts/mention-job.md 7-4）。
 * @param db - データベース
 * @returns 最も早い予定。なければ null
 */
export async function nextMentionDueAt(db: Db | TxDb): Promise<Date | null> {
  const [r] = await db
    .select({
      at: sql<Date | null>`min(GREATEST(COALESCE(${postMentions.sendAfter}, ${postDrafts.publishedAt} + make_interval(mins => ${postMentions.delayMinutes})), COALESCE(${postMentions.nextAttemptAt}, '-infinity'::timestamptz)))`,
    })
    .from(postMentions)
    .innerJoin(postDrafts, eq(postDrafts.id, postMentions.draftId))
    .where(and(eq(postMentions.state, "pending"), sql`(${postDrafts.status} = 'published' OR ${postMentions.sendAfter} IS NOT NULL)`));
  return r?.at ? new Date(r.at) : null;
}

