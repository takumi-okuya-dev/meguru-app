// wrangler.toml の環境ごとの設定がそろっているかの検査（specs/015-deploy-environments research.md R3）。
// wrangler の名前付きの環境（[env.staging]・[env.production]）は、一番上の設定を受け継がない。
// vars・kv_namespaces・triggers を両方に書き切っていないと、デプロイしてから気づくことになるので、ここで止める。
import { describe, expect, it } from "vitest";
import toml from "../../wrangler.toml?raw";

/** TOMLの見出し（[x] と [[x]]）ごとに、中の key = value を集めた簡単な表現。 */
type Sections = Map<string, Record<string, string>[]>;

/**
 * wrangler.toml を見出しごとに読む（この検査に要る範囲だけの、簡単な読み取り）。
 * @param text - wrangler.toml の中身
 * @returns 見出しの名前から、その見出しの並び（[[x]] は複数）への表
 */
function parseSections(text: string): Sections {
  const sections: Sections = new Map();
  let current = "";
  const push = (name: string, fresh: boolean) => {
    const list = sections.get(name) ?? [];
    if (fresh || list.length === 0) list.push({});
    sections.set(name, list);
    current = name;
  };
  push("", true);
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const arrayHead = line.match(/^\[\[([^\]]+)\]\]$/);
    if (arrayHead) {
      push(arrayHead[1] as string, true);
      continue;
    }
    const head = line.match(/^\[([^\]]+)\]$/);
    if (head) {
      push(head[1] as string, false);
      continue;
    }
    const kv = line.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/);
    if (kv) {
      const entry = sections.get(current)?.at(-1);
      if (entry) entry[kv[1] as string] = (kv[2] as string).trim();
    }
  }
  return sections;
}

const sections = parseSections(toml);
const one = (name: string) => sections.get(name)?.[0];
const all = (name: string) => sections.get(name) ?? [];

const ENVS = ["staging", "production"] as const;
const CRONS = '["0 18 * * *", "*/5 * * * *"]';

/** 環境ごとに書き切る必要のある、秘密でない設定（data-model.md 3-1 の「[env.*].vars」）。 */
const REQUIRED_VARS = [
  "APP_ENV",
  "CLERK_PUBLISHABLE_KEY",
  "THREADS_APP_ID",
  "THREADS_ACCESS_MODE",
  "THREADS_REDIRECT_URI",
  "THREADS_AUTH_BASE_URL",
  "THREADS_GRAPH_BASE_URL",
  "WEB_ORIGIN",
  "TOKEN_ENCRYPTION_KEY_VERSION",
  "BILLING_ENABLED",
  "TEST_GROUPS_ENABLED",
  "STRIPE_PRICE_ID",
];

describe("wrangler.toml の環境ごとの設定", () => {
  it.each(ENVS)("[env.%s] に名前がある", (env) => {
    expect(one(`env.${env}`)?.name).toBeDefined();
  });

  it("手元・ステージング・本番で、Workerの名前がすべて違う（取り違えてデプロイしない）", () => {
    // 一番上の name を本番と同じにすると、--env を付けない deploy が本番を
    // 一番上の（足りない）設定で上書きしてしまう（PR #19 のCodexレビュー）
    const names = [one("")?.name, one("env.staging")?.name, one("env.production")?.name];
    expect(names.every(Boolean)).toBe(true);
    expect(new Set(names).size).toBe(names.length);
  });

  it.each(ENVS)("[env.%s.triggers] に両方のCronがある", (env) => {
    expect(one(`env.${env}.triggers`)?.crons).toBe(CRONS);
  });

  it.each(ENVS)("[[env.%s.kv_namespaces]] に AUTOPOST_KV がある", (env) => {
    const kv = all(`env.${env}.kv_namespaces`).find((k) => k.binding === '"AUTOPOST_KV"');
    expect(kv, `[[env.${env}.kv_namespaces]] の binding = "AUTOPOST_KV" がない`).toBeDefined();
    expect(kv?.id).toBeDefined();
  });

  it.each(ENVS)("[env.%s.vars] に、秘密でない設定がそろっている", (env) => {
    const vars = one(`env.${env}.vars`) ?? {};
    expect(Object.keys(vars).filter((k) => REQUIRED_VARS.includes(k)).sort()).toEqual([...REQUIRED_VARS].sort());
  });

  it.each(ENVS)("[env.%s.vars] の APP_ENV が環境の名前と合っている", (env) => {
    expect(one(`env.${env}.vars`)?.APP_ENV).toBe(`"${env}"`);
  });

  // キーがあるかだけでは足りない。`validateConfig` は "true"／"false" 以外を拒むのに
  // `billingModeOf` は `=== "true"` 以外を黙って「課金オフ」に写すので、"TRUE" や "1" が
  // 入ると fetch 側は全部止まるのに Cron 側は全員を全権として扱う（セキュリティ監査 run-1）
  it.each(ENVS)("[env.%s.vars] の BILLING_ENABLED が true か false のどちらかである", (env) => {
    expect(one(`env.${env}.vars`)?.BILLING_ENABLED).toMatch(/^"(true|false)"$/);
  });

  // テスト用のグループは、テスト環境だけON。本番で誤ってONにすると、招待のない人が使えなくなる（specs/016 FR-012）
  it("[env.*.vars] の TEST_GROUPS_ENABLED は、ステージングが true、本番が false", () => {
    expect(one("env.staging.vars")?.TEST_GROUPS_ENABLED).toBe('"true"');
    expect(one("env.production.vars")?.TEST_GROUPS_ENABLED).toBe('"false"');
  });

  it.each(ENVS)("[env.%s.vars] の THREADS_ACCESS_MODE が testers か public のどちらかである", (env) => {
    expect(one(`env.${env}.vars`)?.THREADS_ACCESS_MODE).toMatch(/^"(testers|public)"$/);
  });

  // 審査の前は両方とも「テスター招待」で「Threadsで許可する」を使う（specs/024 FR-028）。つなぐ方法は両方（書かない）
  it.each(ENVS)("[env.%s.vars] は審査の前（testers）で、つなぐ方法を絞らない", (env) => {
    expect(one(`env.${env}.vars`)?.THREADS_ACCESS_MODE).toBe('"testers"');
    expect(one(`env.${env}.vars`)?.THREADS_CONNECT_METHODS).toBeUndefined();
  });

  it("テスト版の THREADS_APP_ID は ThreadsAutomation の数字のID", () => {
    expect(one("env.staging.vars")?.THREADS_APP_ID).toMatch(/^"\d+"$/);
    expect(one("env.staging.vars")?.THREADS_APP_ID).not.toBe('"000000000000000"');
  });

  it("秘密情報は wrangler.toml に書かれていない", () => {
    expect(toml).not.toMatch(/sk_(live|test)_[A-Za-z0-9]{10,}/);
    expect(toml).not.toMatch(/whsec_[A-Za-z0-9]{10,}/);
    expect(toml).not.toMatch(/postgres(ql)?:\/\//);
    expect(toml).not.toMatch(/^\s*(TOKEN_ENCRYPTION_KEYS|IDENTIFIER_HASH_KEY|THREADS_APP_SECRET|CLERK_SECRET_KEY)\s*=/m);
  });
});
