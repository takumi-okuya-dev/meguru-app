// チームを手で確かめるために、管理者・オーナー（メンバー）・編集者の3人のブラウザを、ログインした状態で並べて開く
// （specs/011-team-revision quickstart.md 2、docs/team-roles.md）。
// 先に `pnpm dev:fake` を起動しておく。ウィンドウはふつうに操作でき、すべて閉じるか Ctrl+C で終わる。
//
//   pnpm team:open            # 今のデータのまま、3人でログインして開く
//   pnpm team:open --setup    # DBを空にし、3人の接続・チームの作成・参加・編集者と担当まで済ませてから開く
//   pnpm team:demo            # 上の --setup を、偽のThreads・API・Webの起動からまとめて1回で行う（--wait で起動を待つ）
//   （--headless を付けると、画面を出さずに準備までを確かめて終わる。スクリプト自体の確認用）
import { clerkSetup } from "@clerk/testing/playwright";
import { chromium, type Browser, type Page } from "@playwright/test";
import { loadLocalEnv } from "../env.ts";
import { registerFakeUsers, resetAll, signInAs, teamEmail, type TeamRole } from "../tests/helpers.ts";
import {
  FAKE_ACCOUNTS,
  assignEditor,
  connectThreads,
  createTeam,
  joinByLink,
  makeEditor,
  readTeamInvite,
} from "../tests/team-flow.ts";

const WEB = "http://localhost:5173";
const ROLES: { role: TeamRole; label: string; color: string }[] = [
  { role: "admin", label: "管理者（田中役）", color: "#1d4ed8" },
  { role: "owner", label: "オーナー（鈴木役）", color: "#111827" },
  { role: "editor", label: "編集者（佐藤役）", color: "#047857" },
];

/**
 * 起動しているかを確かめる。
 * @param url - 確かめるURL
 * @returns 応答があれば true
 */
async function isUp(url: string): Promise<boolean> {
  try {
    await fetch(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * 画面の右下に役割の印を出す（3つのウィンドウを見分けるため。押せないようにして操作の邪魔をしない）。
 * @param page - ページ
 * @param label - 役割の名前とメールアドレス
 * @param color - 印の色
 */
async function addRoleBadge(page: Page, label: string, color: string) {
  await page.addInitScript(
    ([text, bg]) => {
      const add = () => {
        if (document.getElementById("__team_role_badge")) return;
        const el = document.createElement("div");
        el.id = "__team_role_badge";
        el.textContent = text!;
        el.setAttribute("aria-hidden", "true");
        el.style.cssText = `position:fixed;right:8px;bottom:8px;z-index:2147483647;pointer-events:none;padding:4px 10px;border-radius:9999px;font:600 12px system-ui;color:#fff;background:${bg};opacity:.85`;
        document.body.appendChild(el);
      };
      if (document.body) add();
      else document.addEventListener("DOMContentLoaded", add);
    },
    [label, color],
  );
}

async function main() {
  const setup = process.argv.includes("--setup");
  const headless = process.argv.includes("--headless");
  // pnpm team:demo から呼ぶときは、同時に起動したサーバーが応答するまで待つ（最大120秒）
  const wait = process.argv.includes("--wait");
  loadLocalEnv();

  for (const role of ["admin", "owner", "editor"] as const) teamEmail(role); // 足りなければここで止める
  for (const [name, url] of [
    ["Web", WEB],
    ["API", "http://localhost:8787/"],
    ["偽のThreads", "http://localhost:8790/__control/posts"],
  ] as const) {
    const deadline = Date.now() + (wait ? 120_000 : 0);
    while (!(await isUp(url))) {
      if (Date.now() >= deadline) {
        throw new Error(`${name}（${url}）が起動していません。先に別のターミナルで pnpm dev:fake を起動してください`);
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  await clerkSetup();
  if (setup) await resetAll();
  else await registerFakeUsers();

  const browsers: Browser[] = [];
  const pages = {} as Record<TeamRole, Page>;
  const width = Number(process.env.TEAM_WINDOW_WIDTH ?? 560);
  for (const [i, { role, label, color }] of ROLES.entries()) {
    const browser = await chromium.launch({
      headless,
      args: [`--window-size=${width},900`, `--window-position=${i * (width + 10)},0`],
    });
    browsers.push(browser);
    const context = await browser.newContext({ baseURL: WEB, viewport: null });
    const page = await context.newPage();
    await addRoleBadge(page, `${label} · ${teamEmail(role)}`, color);
    await signInAs(page, role);
    pages[role] = page;
  }

  if (setup) {
    console.log("チームを用意しています（3人の接続 → 管理者が「飲食チーム」を作る → 2人が参加 → 編集者にして担当）…");
    const ids = {} as Record<TeamRole, string>;
    for (const { role } of ROLES) ids[role] = await connectThreads(pages[role], FAKE_ACCOUNTS[role].id);
    const teamId = await createTeam(pages.admin, ids.admin, "飲食チーム");
    const link = await readTeamInvite(pages.admin, teamId);
    await joinByLink(pages.owner, link, FAKE_ACCOUNTS.owner.name);
    await joinByLink(pages.editor, link, FAKE_ACCOUNTS.editor.name);
    await makeEditor(pages.admin, teamId, FAKE_ACCOUNTS.editor.name);
    await assignEditor(pages.admin, teamId, FAKE_ACCOUNTS.owner.name);
    await pages.admin.goto(`/teams/${teamId}`);
    await pages.owner.goto(`/teams/${teamId}`);
    await pages.editor.goto(`/accounts/${ids.owner}`);
  } else {
    for (const page of Object.values(pages)) await page.goto("/");
  }

  console.log(
    [
      "3人のブラウザを開きました（左から 管理者・オーナー・編集者。右下の印で見分けられます）。",
      "管理者は @partner_co、オーナーは @e2e_user、編集者は @cafe_b を自分のアカウントとして接続しています。",
      "終えるときは、ウィンドウをすべて閉じるか Ctrl+C を押してください。",
    ].join("\n"),
  );

  const closeAll = () => Promise.all(browsers.map((b) => b.close().catch(() => {})));
  if (headless) {
    await closeAll();
    return;
  }
  process.once("SIGINT", () => void closeAll().then(() => process.exit(0)));
  await Promise.all(browsers.map((b) => new Promise((resolve) => b.once("disconnected", resolve))));
}

/**
 * 失敗の理由を、読める文にする。DBにつながらないとき（AggregateError で message が空）は、起動の仕方を案内する。
 * @param err - 失敗
 * @returns 表示する文
 */
function describe(err: unknown): string {
  const code = (err as { code?: string } | null)?.code;
  if (code === "ECONNREFUSED") {
    return "DB（localhost:5432）につながりません。OrbStack（Docker）を起動し、docker compose up -d を実行してください";
  }
  if (err instanceof Error) return err.message || String(code ?? err.name);
  return String(err);
}

main().catch((err: unknown) => {
  console.error(describe(err));
  process.exit(1);
});
