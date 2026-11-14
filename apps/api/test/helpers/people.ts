// 人物メモの結合テストの共通部品（specs/people/001-people-memo）。名前は作ったものだけを使う（research.md R18）。
import { neon } from "@neondatabase/serverless";
import { call, db, makeApp, testEnv } from "./app";
import { FEATURE_OPERATOR, operatorEnv } from "./features";
import { userRow } from "./test-groups";

export const peopleApp = makeApp();

/** 2026-10-11の回のフォームの見出し（初めから当てる質問文）。 */
export const FORM_HEADERS = [
  "タイムスタンプ",
  "あなたのLINE名を教えて下さい",
  "今日の満足度",
  "次回のIT交流会は参加できそうか",
  "次回、友達も誘って参加できそうか",
  "今後どんなつながりがあると嬉しいか",
  "今後のキャリアや働き方で興味があること",
  "今後、情報や機会があれば個別に案内してよいか",
  "もっとこうだったら嬉しいこと",
];

/** フォームの列の対応（初めから当たらない満足度と自由記述は「そのほか」）。 */
export const FORM_COLUMNS = FORM_HEADERS.map((_, i) => (i === 2 || i === 8 ? "other" : null));

/** フォームの1行の答え。 */
export type FormRow = {
  at?: string;
  line: string;
  next?: string;
  wanted?: string;
  career?: string;
  consent?: string;
  free?: string;
};

/**
 * フォームの1行を作る（見出しの順）。
 * @param r - 答え
 * @param i - 行の番号（時刻をずらす）
 * @returns 行
 */
export function formRow(r: FormRow, i = 0): string[] {
  return [
    r.at ?? `2026/10/11 21:${String(i % 60).padStart(2, "0")}:00`,
    r.line,
    "5",
    r.next ?? "参加できそう",
    "誘えそう",
    r.wanted ?? "エンジニアやSES企業とつながりたい",
    r.career ?? "副業・業務委託",
    r.consent ?? "交流会・勉強会の案内",
    r.free ?? "",
  ];
}

/**
 * 人物メモの道筋を呼ぶ。
 * @param method - HTTPのメソッド
 * @param path - /api/people の下のパス
 * @param user - 呼ぶ人
 * @param body - 本文
 * @returns 応答
 */
export function callPeople(method: string, path: string, user: string, body?: unknown) {
  return call(peopleApp, method, `/api/people${path}`, { user, body });
}

/**
 * 応答の本文を読む。
 * @param res - 応答
 * @returns 状態と本文
 */
export async function read<T = Record<string, unknown>>(res: Response): Promise<[number, T]> {
  return [res.status, (await res.json()) as T];
}

/**
 * 利用者を作り（JIT作成）、人物メモを開く。
 * @param user - Clerk のユーザーID
 * @returns users.id
 */
export async function grantPeople(user: string): Promise<string> {
  await call(peopleApp, "GET", "/api/me", { user, env: operatorEnv() });
  await call(peopleApp, "GET", "/api/me", { user: FEATURE_OPERATOR, env: operatorEnv() });
  const id = (await userRow(user))!.id;
  const res = await call(peopleApp, "PUT", `/api/operator/app-access/users/${id}`, { user: FEATURE_OPERATOR, body: { apps: { people: true } }, env: operatorEnv() });
  if (res.status !== 200) throw new Error(`grant failed: ${res.status} ${await res.text()}`);
  return id;
}

/**
 * イベントを作る。
 * @param user - 作り手
 * @param name - 名前
 * @param heldOn - 開催日
 * @param isOwn - 自分の会か
 * @returns イベントの番号
 */
export async function makeEvent(user: string, name = "IT交流会 10月", heldOn = "2026-10-11", isOwn = true): Promise<string> {
  const [status, body] = await read<{ event: { id: string } }>(await callPeople("POST", "/events", user, { name, heldOn, isOwn }));
  if (status !== 201) throw new Error(`event failed: ${status}`);
  return body.event.id;
}

/**
 * フォームの形の行を取り込む（決めは渡したものだけ）。
 * @param user - 作り手
 * @param eventId - イベント
 * @param rows - 行
 * @param decisions - 行ごとの決め
 * @returns 応答
 */
export function commitForm(user: string, eventId: string, rows: string[][], decisions: unknown[] = [], extra: Record<string, unknown> = {}) {
  return callPeople("POST", "/imports", user, { eventId, headers: FORM_HEADERS, rows, columns: FORM_COLUMNS, decisions, ...extra });
}

/**
 * フォームの形の行をプレビューする。
 * @param user - 作り手
 * @param eventId - イベント
 * @param rows - 行
 * @returns 応答
 */
export function previewForm(user: string, eventId: string, rows: string[][], extra: Record<string, unknown> = {}) {
  return callPeople("POST", "/imports/preview", user, { eventId, headers: FORM_HEADERS, rows, ...extra });
}

/**
 * 人物メモの表の行数（何も書かないことの確かめ）。
 * @returns 表ごとの行数
 */
export async function peopleCounts(): Promise<Record<string, number>> {
  db();
  const sql = neon(testEnv.DATABASE_URL);
  const [row] = (await sql`SELECT
    (SELECT count(*) FROM people.persons)::int AS persons,
    (SELECT count(*) FROM people.responses)::int AS responses,
    (SELECT count(*) FROM people.imports)::int AS imports,
    (SELECT count(*) FROM people.column_mappings)::int AS column_mappings,
    (SELECT count(*) FROM people.choice_mappings)::int AS choice_mappings,
    (SELECT count(*) FROM people.consent_changes)::int AS consent_changes`) as [Record<string, number>];
  return row;
}

/**
 * 人物メモの表に直接 SQL を流す（テストの準備）。
 * @returns neon の SQL
 */
export function rawSql() {
  db();
  return neon(testEnv.DATABASE_URL);
}
