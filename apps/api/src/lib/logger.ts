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

export type Logger = {
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
};

export function createLogger(write: (line: string) => void = (line) => console.log(line)): Logger {
  function log(level: string, message: string, fields?: Record<string, unknown>) {
    write(JSON.stringify({ level, message: redactString(message), ...(redact(fields ?? {}) as object) }));
  }
  return {
    info: (m, f) => log("info", m, f),
    warn: (m, f) => log("warn", m, f),
    error: (m, f) => log("error", m, f),
  };
}

export const logger = createLogger();
