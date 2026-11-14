// 精算の手順（specs/collect/003-revenue-sharing User Story 4、contracts/api.md 1-7、FR-030〜FR-032、research.md R10）。
// 手順は毎回計算する。持つのは「渡した」もの（settlement_transfers）と、手伝う人と運営メンバーの対応（settlement_holders）だけ。
// 持っている額：PayPay・振込（支払い済み）は主催者の口座、現金は受け取った人（本人の申告を確かめた現金は主催者。001 の締めと同じ）。
// 001 で主催者と「精算した」手伝う人の現金は、そのときの額（expected_at_settle）を主催者に移す。立て替えた人のない経費は主催者が払ったものとする。
import {
  nameKey,
  SETTLEMENT_KEY_PREFIX,
  SETTLEMENT_LIMITS,
  settlementSteps,
  type CreateSettlementTransferRequest,
  type SettlementHelper,
  type SettlementParty,
  type SettlementSnapshot,
} from "@meguru/shared";
import { and, asc, count, eq, isNotNull } from "drizzle-orm";
import { withTransaction, type Db, type TxDb } from "../../../kernel/db/client";
import { AppError } from "../../../kernel/errors";
import { isUuid } from "../../../kernel/validate";
import { loadOwnedEvent, type CollectEventRow } from "../access";
import {
  collectExpenses,
  collectHelpers,
  collectReceptionRecords,
  collectSettlementHolders,
  collectSettlementTransfers,
  collectSettlements,
  collectSharingMembers,
} from "../schema";
import { buildSharingSnapshot, ensureOwnerMember } from "./sharing-service";

/** 001 の精算の、主催者の鍵。 */
const OWNER_RECEIVER_KEY = "owner";

/**
 * ない・ほかのイベントの人や「渡した」。
 * @returns 404 ITEM_NOT_FOUND のエラー
 */
const notFound = () => new AppError("ITEM_NOT_FOUND", 404, "item not found");

/**
 * 精算の手順の画面の数字を作る。
 * @param db - データベース
 * @param event - イベント
 * @param now - 今
 * @returns 精算の手順の画面
 */
async function buildSettlement(
  db: Db,
  event: CollectEventRow,
  now: Date,
): Promise<SettlementSnapshot> {
  const [snap, records, helpers, settled, holders, transfers, expenses] = await Promise.all([
    buildSharingSnapshot(db, event, now),
    db
      .select({
        method: collectReceptionRecords.method,
        amount: collectReceptionRecords.amount,
        paymentStatus: collectReceptionRecords.paymentStatus,
        helperId: collectReceptionRecords.receiverHelperId,
      })
      .from(collectReceptionRecords)
      .where(eq(collectReceptionRecords.eventId, event.id)),
    db
      .select({ id: collectHelpers.id, name: collectHelpers.name, nameKey: collectHelpers.nameKey })
      .from(collectHelpers)
      .where(eq(collectHelpers.eventId, event.id))
      .orderBy(asc(collectHelpers.joinedAt)),
    db
      .select({
        receiverKey: collectSettlements.receiverKey,
        amount: collectSettlements.expectedAtSettle,
      })
      .from(collectSettlements)
      .where(
        and(eq(collectSettlements.eventId, event.id), isNotNull(collectSettlements.settledAt)),
      ),
    db
      .select()
      .from(collectSettlementHolders)
      .where(eq(collectSettlementHolders.eventId, event.id)),
    db
      .select()
      .from(collectSettlementTransfers)
      .where(eq(collectSettlementTransfers.eventId, event.id))
      .orderBy(asc(collectSettlementTransfers.doneAt), asc(collectSettlementTransfers.id)),
    db
      .select({
        amount: collectExpenses.amount,
        payerMemberId: collectExpenses.payerMemberId,
        payerName: collectExpenses.payerName,
      })
      .from(collectExpenses)
      .where(eq(collectExpenses.eventId, event.id)),
  ]);

  // 受け取った人ごとの現金（本人の申告の確かめ待ちは、まだだれも持っていない）
  const helperCash = new Map<string, number>();
  let cashTotal = 0;
  let ownerCash = 0;
  for (const r of records) {
    if (r.method !== "cash" || r.paymentStatus === "awaiting_confirmation") continue;
    cashTotal += r.amount;
    if (r.helperId) helperCash.set(r.helperId, (helperCash.get(r.helperId) ?? 0) + r.amount);
    else ownerCash += r.amount;
  }
  const settledOf = new Map(
    settled
      .filter((s) => s.receiverKey !== OWNER_RECEIVER_KEY)
      .map((s) => [s.receiverKey, s.amount ?? 0]),
  );
  const unpaidExpenses = expenses
    .filter((e) => e.payerMemberId === null && e.payerName === null)
    .reduce((s, e) => s + e.amount, 0);

  // 手伝う人と運営メンバーの対応（選んでいなければ、名前の形が同じ運営メンバーが1人だけならその人）
  const memberIds = new Set(snap.members.map((m) => m.id));
  const holderOf = new Map(holders.map((h) => [h.helperId, h.memberId]));
  const mappedMember = new Map<string, string | null>();
  for (const h of helpers) {
    if (holderOf.has(h.id)) {
      const chosen = holderOf.get(h.id) ?? null;
      mappedMember.set(h.id, chosen !== null && memberIds.has(chosen) ? chosen : null);
    } else {
      const same = snap.members.filter((m) => nameKey(m.name) === h.nameKey);
      mappedMember.set(h.id, same.length === 1 ? same[0]!.id : null);
    }
  }

  // 人：運営メンバー（並びの順）→ 手伝う人 → 運営メンバーでない立て替えた人 → 今はいない人
  const parties = new Map<string, SettlementParty>();
  const owner = snap.members.find((m) => m.isOwner) ?? snap.members[0];
  const share = new Map(
    snap.current.shares.map((s) => [s.memberId, snap.current.deficit ? -s.total : s.total]),
  );
  for (const m of snap.members) {
    const back = snap.reimbursements.find((r) => r.memberId === m.id)?.amount ?? 0;
    parties.set(memberKey(m.id), {
      key: memberKey(m.id),
      name: m.name,
      kind: "member",
      isOwner: m.isOwner,
      holding: 0,
      target: (share.get(m.id) ?? 0) + back,
    });
  }
  const helperName = new Map(helpers.map((h) => [h.id, h.name]));
  const resolve = (key: string): string => {
    if (!key.startsWith(SETTLEMENT_KEY_PREFIX.helper)) return key;
    const member = mappedMember.get(key.slice(SETTLEMENT_KEY_PREFIX.helper.length));
    return member ? memberKey(member) : key;
  };
  const partyOf = (key: string, fallbackName: string): SettlementParty => {
    const found = parties.get(key);
    if (found) return found;
    const helperId = key.startsWith(SETTLEMENT_KEY_PREFIX.helper)
      ? key.slice(SETTLEMENT_KEY_PREFIX.helper.length)
      : null;
    const created: SettlementParty =
      helperId !== null && helperName.has(helperId)
        ? {
            key,
            name: helperName.get(helperId)!,
            kind: "helper",
            isOwner: false,
            holding: 0,
            target: 0,
          }
        : { key, name: fallbackName, kind: "former", isOwner: false, holding: 0, target: 0 };
    parties.set(key, created);
    return created;
  };

  if (owner) {
    const o = parties.get(memberKey(owner.id))!;
    o.holding += snap.revenue.paid - cashTotal + ownerCash - unpaidExpenses;
    for (const amount of settledOf.values()) o.holding += amount;
  }
  for (const h of helpers) {
    const cash = (helperCash.get(h.id) ?? 0) - (settledOf.get(h.id) ?? 0);
    if (cash === 0) continue;
    partyOf(resolve(helperKey(h.id)), h.name).holding += cash;
  }
  for (const r of snap.reimbursements) {
    if (r.memberId !== null) continue;
    const key = payerKey(r.name);
    parties.set(key, {
      key,
      name: r.name,
      kind: "payer",
      isOwner: false,
      holding: 0,
      target: r.amount,
    });
  }
  for (const t of transfers) {
    partyOf(resolve(t.fromKey), t.fromName).holding -= t.amount;
    partyOf(resolve(t.toKey), t.toName).holding += t.amount;
  }

  const list = [...parties.values()].filter(
    (p) => p.kind === "member" || p.holding !== 0 || p.target !== 0,
  );
  const plan = settlementSteps(list);
  const helperRows: SettlementHelper[] = helpers
    .filter((h) => (helperCash.get(h.id) ?? 0) > 0)
    .map((h) => ({
      helperId: h.id,
      name: h.name,
      cash: helperCash.get(h.id)!,
      memberId: mappedMember.get(h.id) ?? null,
      chosen: holderOf.has(h.id),
    }));
  return {
    parties: list,
    helpers: helperRows,
    steps: plan.steps,
    done: transfers.map((t) => ({
      id: t.id,
      fromKey: t.fromKey,
      fromName: t.fromName,
      toKey: t.toKey,
      toName: t.toName,
      amount: t.amount,
      doneAt: t.doneAt.toISOString(),
    })),
    mismatch: plan.mismatch,
  };
}

/**
 * 運営メンバーの鍵。
 * @param id - 運営メンバーの番号
 * @returns 鍵
 */
const memberKey = (id: string) => `${SETTLEMENT_KEY_PREFIX.member}${id}`;
/**
 * 手伝う人の鍵。
 * @param id - 手伝う人の番号
 * @returns 鍵
 */
const helperKey = (id: string) => `${SETTLEMENT_KEY_PREFIX.helper}${id}`;
/**
 * 運営メンバーでない立て替えた人の鍵（名前ごと）。
 * @param name - 名前
 * @returns 鍵
 */
const payerKey = (name: string) => `${SETTLEMENT_KEY_PREFIX.payer}${name}`;

/**
 * 精算の手順の画面（GET …/settlement）。運営メンバーがいなければ主催者の行を作る。
 * @param db - データベース
 * @param ownerUserId - 主催者
 * @param eventId - イベントの番号
 * @param now - 今
 * @returns 精算の手順の画面
 */
export async function settlementSnapshot(
  db: Db,
  ownerUserId: string,
  eventId: string,
  now: Date,
): Promise<SettlementSnapshot> {
  const event = await loadOwnedEvent(db, ownerUserId, eventId);
  await ensureOwnerMember(db, event, now);
  return buildSettlement(db, event, now);
}

/**
 * 主催者のイベントをロックして中身を変え、変えたあとの精算の手順の画面を返す。
 * @param databaseUrl - 接続文字列
 * @param db - 読み直しに使うデータベース
 * @param ownerUserId - 主催者
 * @param eventId - イベントの番号
 * @param now - 今
 * @param change - 変える中身
 * @returns 精算の手順の画面
 */
async function mutate(
  databaseUrl: string,
  db: Db,
  ownerUserId: string,
  eventId: string,
  now: Date,
  change: (tx: TxDb, event: CollectEventRow) => Promise<void>,
): Promise<SettlementSnapshot> {
  const event = await withTransaction(databaseUrl, async (tx) => {
    const ev = await loadOwnedEvent(tx, ownerUserId, eventId, { forUpdate: true });
    await ensureOwnerMember(tx, ev, now);
    await change(tx, ev);
    return ev;
  });
  return buildSettlement(db, event, now);
}

/**
 * 手伝う人と運営メンバーの対応を選ぶ（PUT …/settlement/helpers/:helperId。FR-032）。
 * @param databaseUrl - 接続文字列
 * @param db - データベース
 * @param ownerUserId - 主催者
 * @param eventId - イベントの番号
 * @param helperId - 手伝う人の番号
 * @param memberId - 運営メンバーの番号（null は「運営メンバーでない」）
 * @param now - 今
 * @returns 精算の手順の画面
 * @throws AppError ITEM_NOT_FOUND（ほかのイベントの手伝う人・運営メンバー）
 */
export async function putSettlementHolder(
  databaseUrl: string,
  db: Db,
  ownerUserId: string,
  eventId: string,
  helperId: string,
  memberId: string | null,
  now: Date,
): Promise<SettlementSnapshot> {
  return mutate(databaseUrl, db, ownerUserId, eventId, now, async (tx, event) => {
    if (!isUuid(helperId)) throw notFound();
    const [helper] = await tx
      .select({ id: collectHelpers.id })
      .from(collectHelpers)
      .where(and(eq(collectHelpers.id, helperId), eq(collectHelpers.eventId, event.id)))
      .limit(1);
    if (!helper) throw notFound();
    if (memberId !== null) {
      const [member] = await tx
        .select({ id: collectSharingMembers.id })
        .from(collectSharingMembers)
        .where(
          and(eq(collectSharingMembers.id, memberId), eq(collectSharingMembers.eventId, event.id)),
        )
        .limit(1);
      if (!member) throw notFound();
    }
    await tx
      .insert(collectSettlementHolders)
      .values({ helperId, eventId: event.id, memberId })
      .onConflictDoUpdate({ target: collectSettlementHolders.helperId, set: { memberId } });
  });
}

/**
 * 鍵が今の人か、前に渡したものに出てくる人かを確かめ、名前を返す。
 * @param tx - トランザクション
 * @param eventId - イベントの番号
 * @param key - 人の鍵
 * @returns そのときの名前
 * @throws AppError ITEM_NOT_FOUND
 */
async function partyName(tx: TxDb, eventId: string, key: string): Promise<string> {
  const id = key.slice(2);
  if (key.startsWith(SETTLEMENT_KEY_PREFIX.member) && isUuid(id)) {
    const [m] = await tx
      .select({ name: collectSharingMembers.name })
      .from(collectSharingMembers)
      .where(and(eq(collectSharingMembers.id, id), eq(collectSharingMembers.eventId, eventId)))
      .limit(1);
    if (m) return m.name;
  } else if (key.startsWith(SETTLEMENT_KEY_PREFIX.helper) && isUuid(id)) {
    const [h] = await tx
      .select({ name: collectHelpers.name })
      .from(collectHelpers)
      .where(and(eq(collectHelpers.id, id), eq(collectHelpers.eventId, eventId)))
      .limit(1);
    if (h) return h.name;
  } else if (key.startsWith(SETTLEMENT_KEY_PREFIX.payer)) {
    const [e] = await tx
      .select({ name: collectExpenses.payerName })
      .from(collectExpenses)
      .where(and(eq(collectExpenses.eventId, eventId), eq(collectExpenses.payerName, id)))
      .limit(1);
    if (e?.name) return e.name;
  }
  // 今はいない人（消した運営メンバーなど）でも、前に渡したものに出てくれば、そのときの名前で受ける
  const [from] = await tx
    .select({ name: collectSettlementTransfers.fromName })
    .from(collectSettlementTransfers)
    .where(
      and(
        eq(collectSettlementTransfers.eventId, eventId),
        eq(collectSettlementTransfers.fromKey, key),
      ),
    )
    .limit(1);
  if (from) return from.name;
  const [to] = await tx
    .select({ name: collectSettlementTransfers.toName })
    .from(collectSettlementTransfers)
    .where(
      and(
        eq(collectSettlementTransfers.eventId, eventId),
        eq(collectSettlementTransfers.toKey, key),
      ),
    )
    .limit(1);
  if (to) return to.name;
  throw notFound();
}

/**
 * 「渡した」を付ける（POST …/settlement/transfers。FR-031）。1イベント200件まで。
 * @param databaseUrl - 接続文字列
 * @param db - データベース
 * @param ownerUserId - 主催者
 * @param eventId - イベントの番号
 * @param input - 渡した人・受け取った人・額
 * @param now - 今
 * @returns 精算の手順の画面
 * @throws AppError ITEM_NOT_FOUND・ITEM_LIMIT_REACHED
 */
export async function addSettlementTransfer(
  databaseUrl: string,
  db: Db,
  ownerUserId: string,
  eventId: string,
  input: CreateSettlementTransferRequest,
  now: Date,
): Promise<SettlementSnapshot> {
  return mutate(databaseUrl, db, ownerUserId, eventId, now, async (tx, event) => {
    const [row] = await tx
      .select({ n: count() })
      .from(collectSettlementTransfers)
      .where(eq(collectSettlementTransfers.eventId, event.id));
    if ((row?.n ?? 0) >= SETTLEMENT_LIMITS.transfersPerEvent)
      throw new AppError("ITEM_LIMIT_REACHED", 409, "transfer limit reached");
    const fromName = await partyName(tx, event.id, input.fromKey);
    const toName = await partyName(tx, event.id, input.toKey);
    await tx.insert(collectSettlementTransfers).values({
      eventId: event.id,
      fromKey: input.fromKey,
      fromName,
      toKey: input.toKey,
      toName,
      amount: input.amount,
      doneAt: now,
    });
  });
}

/**
 * 「渡した」を取り消す（DELETE …/settlement/transfers/:transferId。FR-031）。
 * @param databaseUrl - 接続文字列
 * @param db - データベース
 * @param ownerUserId - 主催者
 * @param eventId - イベントの番号
 * @param transferId - 渡したものの番号
 * @param now - 今
 * @returns 精算の手順の画面
 * @throws AppError ITEM_NOT_FOUND
 */
export async function deleteSettlementTransfer(
  databaseUrl: string,
  db: Db,
  ownerUserId: string,
  eventId: string,
  transferId: string,
  now: Date,
): Promise<SettlementSnapshot> {
  return mutate(databaseUrl, db, ownerUserId, eventId, now, async (tx, event) => {
    if (!isUuid(transferId)) throw notFound();
    const deleted = await tx
      .delete(collectSettlementTransfers)
      .where(
        and(
          eq(collectSettlementTransfers.id, transferId),
          eq(collectSettlementTransfers.eventId, event.id),
        ),
      )
      .returning({ id: collectSettlementTransfers.id });
    if (deleted.length === 0) throw notFound();
  });
}
