// 集金管理の結合テストの共通部品（specs/collect/001-event-day-collection）。利用の許可・利用者の番号・イベントを作る。
import { neon } from "@neondatabase/serverless";
import { call, db, testEnv, type TestApp } from "./app";

/**
 * 利用者を作り（JIT作成）、users.id を返す。
 * @param app - テストのアプリ
 * @param user - Clerk のユーザーID
 * @returns users.id
 */
export async function collectUserId(app: TestApp, user: string): Promise<string> {
  await call(app, "GET", "/api/me", { user });
  db(); // ローカルプロキシの設定
  const [row] = (await neon(testEnv.DATABASE_URL)`SELECT id FROM users WHERE clerk_user_id = ${user}`) as [{ id: string }];
  return row.id;
}

/**
 * 集金管理の利用の許可を、運営者の画面を通さずに付ける（人ごとの許可）。
 * @param app - テストのアプリ
 * @param user - Clerk のユーザーID
 * @returns users.id
 */
export async function grantCollect(app: TestApp, user: string): Promise<string> {
  const id = await collectUserId(app, user);
  await neon(testEnv.DATABASE_URL)`INSERT INTO app_access_grants (user_id, app) VALUES (${id}, 'collect') ON CONFLICT DO NOTHING`;
  return id;
}

/** 区分が3つのイベントの入力。 */
export const EVENT_INPUT = {
  name: "IT交流会",
  startsAt: "2026-11-20T10:00:00.000Z",
  endsAt: "2026-11-20T12:00:00.000Z",
  venue: "渋谷",
  capacity: 30,
  methods: ["cash", "paypay", "transfer"],
  tiers: [
    { name: "通常", amount: 3000 },
    { name: "早割", amount: 2500 },
    { name: "招待", amount: 0 },
  ],
};

/** イベントの応答の形（テストで使う分）。 */
export type EventBody = {
  id: string;
  name: string;
  version: number;
  tiers: { id: string; name: string; amount: number; position: number }[];
};

/**
 * イベントを作る。
 * @param app - テストのアプリ
 * @param user - 主催者
 * @param over - 入力を変える分
 * @returns 作ったイベント
 */
export async function createCollectEvent(app: TestApp, user: string, over: Record<string, unknown> = {}): Promise<EventBody> {
  const res = await call(app, "POST", "/api/collect/events", { user, body: { ...EVENT_INPUT, ...over } });
  if (res.status !== 201) throw new Error(`create event failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as EventBody;
}

/**
 * エラーの応答から、状態とコードを読む。
 * @param res - 応答
 * @returns 状態とコード
 */
export async function errorOf(res: Response): Promise<[number, string]> {
  const body = (await res.json()) as { error: { code: string } };
  return [res.status, body.error.code];
}

/**
 * セルフ受付のリンクを出して、トークンを返す（specs/collect/002）。
 * @param app - テストのアプリ
 * @param user - 主催者
 * @param eventId - イベントの番号
 * @returns トークン（cs_…）
 */
export async function selfToken(app: TestApp, user: string, eventId: string): Promise<string> {
  const res = await call(app, "POST", `/api/collect/events/${eventId}/self-link`, { user });
  const { link } = (await res.json()) as { link: { url: string } };
  return link.url.split("/collect/s/")[1]!;
}

/**
 * 参加者として呼ぶ（端末の印つき）。
 * @param app - テストのアプリ
 * @param method - メソッド
 * @param path - /api/collect/s/:token のあとの道筋を含む全体
 * @param device - 端末の印（UUID）
 * @param body - 本文
 * @returns 応答
 */
export function asParticipant(app: TestApp, method: string, path: string, device: string, body?: unknown) {
  return call(app, method, path, { headers: { "X-Collect-Device": device }, ...(body === undefined ? {} : { body }) });
}
