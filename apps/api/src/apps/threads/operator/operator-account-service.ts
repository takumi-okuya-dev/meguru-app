// 運営者のアカウント一覧（specs/026-operator-accounts contracts/api.md、research.md R1〜R6）。
// すべてのアカウントを、接続方法・接続の状態・オーナー・テスター招待の状態とともに読むだけ（書き込まない。FR-005）。
// アカウントの中身（投稿・戦略・結果）は読まない（FR-006）。
import {
  OPERATOR_ACCOUNTS_CURSOR_RE,
  OPERATOR_ACCOUNTS_PAGE_SIZE,
  type OperatorAccount,
  type OperatorAccounts,
  type OperatorAccountsQuery,
} from "@threads-grower/shared";
import { sql, type SQL } from "drizzle-orm";
import type { Db } from "../../../kernel/db/client";

/** 接続方法（つなぐ前は none。research.md R5）。 */
const METHOD = sql`CASE WHEN a.connection_status = 'not_connected' THEN 'none' ELSE a.connection_method::text END`;

/**
 * LIKE の特別な文字（\ % _）をそのまま探せるようにする（research.md R3）。
 * @param q - 検索語
 * @returns LIKE のパターン（前後に % を付けたもの）
 */
function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

type Row = {
  id: string;
  name: string;
  username: string | null;
  method: OperatorAccount["method"];
  status: OperatorAccount["status"];
  created_at: string | Date;
  cursor: string;
  owner_name: string | null;
  owner_email: string | null;
  owner_count: number | null;
  tester: OperatorAccount["tester"];
};

/**
 * 運営者のアカウント一覧（GET /api/operator/accounts）。
 * @param db - データベース
 * @param query - 接続方法の絞り込み・検索語・続きの印
 * @returns 接続方法ごとの件数（検索に左右されない）と、作った日の新しい順の1ページ分の行
 */
export async function listOperatorAccounts(db: Db, query: OperatorAccountsQuery): Promise<OperatorAccounts> {
  const where: SQL[] = [];
  if (query.method !== "all") where.push(sql`${METHOD} = ${query.method}`);
  if (query.q) {
    const p = likePattern(query.q);
    where.push(sql`(a.name ILIKE ${p} OR a.username ILIKE ${p} OR u.display_name ILIKE ${p} OR u.email ILIKE ${p})`);
  }
  // 続きの印（作った日時とID）より前。印のアカウントが消えていても、位置は変わらない（research.md R2、PR #74 のCodexレビュー）
  const cursor = query.cursor ? OPERATOR_ACCOUNTS_CURSOR_RE.exec(query.cursor) : null;
  if (cursor) where.push(sql`(a.created_at, a.id) < (${cursor[1]}::timestamptz, ${cursor[2]}::uuid)`);
  const filter = where.length ? sql`WHERE ${sql.join(where, sql` AND `)}` : sql``;

  const [rows, counts] = await Promise.all([
    db.execute<Row>(sql`
      SELECT a.id, a.name, a.username, ${METHOD} AS method, a.connection_status::text AS status, a.created_at,
             to_char(a.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') || '_' || a.id::text AS cursor,
             u.display_name AS owner_name, u.email AS owner_email,
             (SELECT count(*)::int FROM memberships om WHERE om.user_id = m.user_id AND om.role = 'owner') AS owner_count,
             (SELECT CASE
                       WHEN t.status IN ('pending', 'invited', 'connected') THEN t.status
                       ELSE 'removable'
                     END
                FROM tester_applications t
               WHERE t.account_id = a.id
                 AND (t.status IN ('pending', 'invited', 'connected') OR (t.holds_slot AND t.removal_reason IS NOT NULL))
               ORDER BY (t.status IN ('pending', 'invited', 'connected')) DESC, t.status_changed_at DESC
               LIMIT 1) AS tester
        FROM accounts a
        LEFT JOIN memberships m ON m.account_id = a.id AND m.role = 'owner'
        LEFT JOIN users u ON u.id = m.user_id
        ${filter}
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT ${OPERATOR_ACCOUNTS_PAGE_SIZE + 1}
    `),
    db.execute<{ all: number; app: number; token: number; none: number }>(sql`
      SELECT count(*)::int AS all,
             count(*) FILTER (WHERE ${METHOD} = 'app')::int AS app,
             count(*) FILTER (WHERE ${METHOD} = 'token')::int AS token,
             count(*) FILTER (WHERE ${METHOD} = 'none')::int AS none
        FROM accounts a
    `),
  ]);

  const page = rows.rows.slice(0, OPERATOR_ACCOUNTS_PAGE_SIZE);
  const c = counts.rows[0]!;
  return {
    counts: { all: Number(c.all), app: Number(c.app), token: Number(c.token), none: Number(c.none) },
    items: page.map((r) => ({
      id: r.id,
      name: r.name,
      username: r.username,
      method: r.method,
      status: r.status,
      owner: r.owner_email === null ? null : { name: r.owner_name, email: r.owner_email, accountCount: Number(r.owner_count ?? 0) },
      tester: r.tester,
      createdAt: new Date(r.created_at).toISOString(),
    })),
    nextCursor: rows.rows.length > OPERATOR_ACCOUNTS_PAGE_SIZE ? page[page.length - 1]!.cursor : null,
  };
}
