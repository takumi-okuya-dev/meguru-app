// /api/me と退会の確かめに、アプリが足す中身（specs/meguru/029-threads-pattern1 contracts/api-routes.md 2）。
// 共通はアプリの表を読まないので、アプリが中身を作る関数を登録し、共通はそれを呼んで合わせる。
// PR5 で /api/me からアプリの中身を外すまでの間だけ使う（前の画面のため）。新しい画面は /api/<アプリ>/me を読む。
import type { Context } from "hono";
import type { AppEnv } from "./auth";

/** アプリが足す中身を作る関数。 */
export type MeSection = (c: Context<AppEnv>) => Promise<Record<string, unknown>>;

const meSections = new Map<string, MeSection>();
const previewSections = new Map<string, MeSection>();

/**
 * /api/me にアプリの中身を足す関数を登録する。同じアプリは1回だけ。
 * @param app - アプリの番号
 * @param section - 中身を作る関数
 */
export function registerMeSection(app: string, section: MeSection): void {
  if (!meSections.has(app)) meSections.set(app, section);
}

/**
 * 退会の確かめ（/api/me/withdrawal-preview）にアプリの中身を足す関数を登録する。同じアプリは1回だけ。
 * @param app - アプリの番号
 * @param section - 中身を作る関数
 */
export function registerWithdrawalPreviewSection(app: string, section: MeSection): void {
  if (!previewSections.has(app)) previewSections.set(app, section);
}

/**
 * 登録したアプリの中身を作って合わせる。
 * @param c - Hono の文脈
 * @param kind - me か preview
 * @returns 合わせた中身
 */
export async function collectSections(c: Context<AppEnv>, kind: "me" | "preview"): Promise<Record<string, unknown>> {
  const list = [...(kind === "me" ? meSections : previewSections).values()];
  const parts = await Promise.all(list.map((f) => f(c)));
  return Object.assign({}, ...parts);
}
