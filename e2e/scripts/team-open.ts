// チーム運用を手で確かめるために、オーナー・パートナー・編集者の3人のブラウザを、ログインした状態で並べて開く
// （specs/008-team-operations quickstart.md「3人の画面をまとめて開く」、docs/team-roles.md）。
// 先に `pnpm dev:fake` を起動しておく。ウィンドウはふつうに操作でき、すべて閉じるか Ctrl+C で終わる。
//
//   pnpm team:open            # 今のデータのまま、3人でログインして開く
//   pnpm team:open --setup    # DBを空にし、接続・パートナーの参加・編集者の参加と担当まで済ませてから開く
//   （--headless を付けると、画面を出さずに準備までを確かめて終わる。スクリプト自体の確認用）
import { clerkSetup } from "@clerk/testing/playwright";
import { chromium, type Browser, type Page } from "@playwright/test";
import { loadLocalEnv } from "../env.ts";
import { registerFakeUsers, resetAll, signInAs, teamEmail, type TeamRole } from "../tests/helpers.ts";
import {
  assignFirstEditor,
  connectThreads,
  createEditorInvite,
  createPartnerInvite,
  joinByLink,
} from "../tests/team-flow.ts";

const WEB = "http://localhost:5173";
const ROLES: { role: TeamRole; label: string; color: string }[] = [
  { role: "owner", label: "オーナー", color: "#111827" },
  { role: "partner", label: "パートナー", color: "#1d4ed8" },
  { role: "editor", label: "編集者", color: "#047857" },
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
  loadLocalEnv();

  for (const role of ["owner", "partner", "editor"] as const) teamEmail(role); // 足りなければここで止める
  for (const [name, url] of [
    ["Web", WEB],
    ["API", "http://localhost:8787/"],
    ["偽のThreads", "http://localhost:8790/__control/posts"],
  ] as const) {
    if (!(await isUp(url))) throw new Error(`${name}（${url}）が起動していません。先に別のターミナルで pnpm dev:fake を起動してください`);
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
    console.log("チームを用意しています（接続 → パートナーの参加 → 編集者の参加と担当）…");
    const accountId = await connectThreads(pages.owner);
    await joinByLink(pages.partner, await createPartnerInvite(pages.owner, accountId), "A社");
    await joinByLink(pages.editor, await createEditorInvite(pages.partner));
    await assignFirstEditor(pages.partner);
    await pages.owner.goto(`/accounts/${accountId}/settings`);
    await pages.partner.goto(`/accounts/${accountId}/stock`);
    await pages.editor.goto(`/accounts/${accountId}`);
  } else {
    for (const page of Object.values(pages)) await page.goto("/");
  }

  console.log(
    [
      "3人のブラウザを開きました（左から オーナー・パートナー・編集者。右下の印で見分けられます）。",
      "偽のThreadsの認可画面では「@partner_co で許可する」などで、2件目・3件目のアカウントを接続できます。",
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

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
