// Cloudflare Pages に出す応答ヘッダの検査（セキュリティ監査 run-1 の
// `apps/web:absent-framing-control:one-click-approval-and-team-mutations`）。
//
// この画面は1クリックで終わる操作を並べている（下書きの承認、役割の昇格、招待リンクの
// 再発行、担当の切り替え、チームへの共有）。承認は Constitution が NON-NEGOTIABLE と
// している関所で、しかも承認だけで無人公開に進む。frame に入れられると、盗まれた1クリックが
// そのまま通る。
//
// `_headers` は Cloudflare Pages が読む。Vite は `public/` の中身を dist へそのまま写すので、
// ここに置けばデプロイに乗る。
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// グローバルの URL はブラウザの型なので、node:fs にはパスの文字列で渡す
const webRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string): string => readFileSync(join(webRoot, p), { encoding: "utf8" });

describe("Cloudflare Pages の _headers", () => {
  it("すべてのパスに対する決まりがある", () => {
    expect(read("public/_headers")).toMatch(/^\/\*$/m);
  });

  it("frame への埋め込みを断っている", () => {
    const headers = read("public/_headers");
    // CSP の frame-ancestors が本命。X-Frame-Options は古いブラウザ向けの保険
    expect(headers).toMatch(/Content-Security-Policy:.*frame-ancestors 'none'/);
    expect(headers).toMatch(/X-Frame-Options: DENY/);
  });

  it("MIMEの推測と参照元の送り過ぎも止めている", () => {
    const headers = read("public/_headers");
    expect(headers).toMatch(/X-Content-Type-Options: nosniff/);
    expect(headers).toMatch(/Referrer-Policy: /);
  });

  it("public/ を dist へ写す既定の動きを止めていない", () => {
    // publicDir を false にすると _headers が dist に入らず、ヘッダが付かないまま出る
    expect(read("vite.config.ts")).not.toMatch(/publicDir\s*:\s*false/);
  });
});
