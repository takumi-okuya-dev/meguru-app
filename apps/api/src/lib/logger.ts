// 秘密情報をマスクする構造化ロガー（research.md R5、contracts/api.md「秘密情報」）。
// トークン・認可コード・App Secret・signed_request・state・authorizeUrl と、URLのクエリ文字列はログに出さない。

const SECRET_KEYS = new Set([
  "access_token",
  "accesstoken",
  "token",
  "code",
  "client_secret",
  "clientsecret",
  "signed_request",
  "signedrequest",
  "state",
  "authorizeurl",
  "authorization",
]);

const MASK = "[REDACTED]";

function redactString(value: string): string {
  return (
    value
      // URLのクエリ文字列を丸ごと落とす
      .replace(/(https?:\/\/[^\s?#"']+)\?[^\s"']*/g, `$1?${MASK}`)
      // URL以外に埋め込まれた key=value の形の秘密情報
      .replace(/\b(access_token|code|client_secret|signed_request|state)=[^&\s"']*/gi, `$1=${MASK}`)
  );
}

/**
 * ログに出す値から秘密情報を取り除く。秘密のキーの値と、URLのクエリ文字列を伏せる。
 * @param value - ログに出す値
 * @param depth - 入れ子の深さ（深すぎる値はまとめて伏せる）
 * @returns 秘密情報を伏せた値
 */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return MASK;
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value instanceof Error) return { name: value.name, message: redactString(value.message) };
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SECRET_KEYS.has(k.toLowerCase()) ? MASK : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

/** 構造化ロガー。値は出力の前に redact で秘密情報を伏せる。 */
export type Logger = {
  /** 調子を確かめるための細かいログ（自動投稿の関所で何もしなかった回など。specs/005-auto-post） */
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
};

/**
 * 構造化ロガーを作る。1行に1つの JSON を出力する。
 * @param write - 1行を書き出す処理（既定は console.log）
 * @returns ロガー
 */
export function createLogger(write: (line: string) => void = (line) => console.log(line)): Logger {
  function log(level: string, message: string, fields?: Record<string, unknown>) {
    write(
      JSON.stringify({
        level,
        message: redactString(message),
        ...(redact(fields ?? {}) as object),
      }),
    );
  }
  return {
    debug: (m, f) => log("debug", m, f),
    info: (m, f) => log("info", m, f),
    warn: (m, f) => log("warn", m, f),
    error: (m, f) => log("error", m, f),
  };
}

/** アプリ全体で使うロガー。 */
export const logger = createLogger();
