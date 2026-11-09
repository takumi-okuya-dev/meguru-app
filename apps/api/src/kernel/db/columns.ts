// 表の定義で使う共通の部品（列の型・作成と更新の時刻・版の列・IN のリスト）。どのモジュールの schema.ts からも使う（specs/027-modular-monolith）。
import { sql } from "drizzle-orm";
import { customType, integer, timestamp } from "drizzle-orm/pg-core";

/** バイト列（bytea）の列。ドライバーが16進の文字列で返すときも Uint8Array にする。 */
export const bytea = customType<{ data: Uint8Array; driverData: Uint8Array | string }>({
  dataType() {
    return "bytea";
  },
  fromDriver(value) {
    if (value instanceof Uint8Array) return value;
    // node-postgres / neon は bytea を "\\x..." の16進文字列で返すことがある
    const hex = value.startsWith("\\x") ? value.slice(2) : value;
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return out;
  },
  toDriver(value) {
    return value;
  },
});

/** 作成と更新の時刻の列（created_at・updated_at）。 */
export const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

/**
 * 楽観ロックの版の列（version、既定1）。
 * @returns 列の定義
 */
export const versionColumn = () => integer("version").notNull().default(1);

/**
 * CHECK 制約の IN に入れる値のリスト（'a', 'b'）。
 * @param values - 値
 * @returns SQL の断片
 */
export const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(", "));
