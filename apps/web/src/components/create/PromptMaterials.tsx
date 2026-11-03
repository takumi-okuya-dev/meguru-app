// 「プロンプトに入っている情報」（specs/014-strategy-guidance US11、FR-120〜FR-123、contracts/ui-routes.md「投稿をつくる」）。
// 数はAPIがプロンプトを作るときの数え方のまま（materials）。画面では並べて、編集の画面へのリンクを作るだけ。
import { STRATEGY_FIELDS, STRATEGY_TOTAL, type PromptMaterials as Materials } from "@threads-grower/shared";
import { ChevronDownIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { cn } from "@/lib/utils";

/** 目的の5問は見出しが長いので、一覧では短い名前にする。 */
const SHORT_LABELS: Record<string, string> = {
  purposeOrigin: "Q1 活動を始めたきっかけ",
  purposeSelf: "Q2 自分がなりたい姿",
  purposeOthers: "Q3 関わった人にどうなってほしいか",
  purposeFuture: "Q4 活動の先に作りたい未来",
  purposeStance: "Q5 大切にしたい在り方",
};

const labelOf = (key: string) => SHORT_LABELS[key] ?? STRATEGY_FIELDS.find((f) => f.key === key)?.label ?? key;

const DRAFT_LABELS = ["プロフィール文", "固定投稿①", "固定投稿②", "固定投稿③"] as const;
const DRAFT_KEYS = ["profileBioDraft", "pinnedPostDraft1", "pinnedPostDraft2", "pinnedPostDraft3"] as const;

/**
 * 判定の文字（判定しない項目は入力のあり・なし）。
 * @param status - 判定。判定しない項目は null
 * @param chars - 文字数
 * @returns 判定の文字と色
 */
function statusText(status: "empty" | "short" | "ok" | null, chars: number): { text: string; tone: string } {
  if (status === "ok") return { text: "十分", tone: "text-success" };
  if (status === "short") return { text: "短め", tone: "text-warning" };
  if (status === null && chars > 0) return { text: "入力あり", tone: "text-success" };
  return { text: "未入力", tone: "text-muted-foreground" };
}

function Card({ title, where, action, children }: { title: string; where: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title} className="space-y-2 rounded-xl border bg-background px-3.5 py-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-medium">{title}</h3>
          <p className="text-xs text-muted-foreground">{where}</p>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function EditLink({ to }: { to: string }) {
  return (
    <Link to={to} className="shrink-0 text-xs text-ring underline">
      編集
    </Link>
  );
}

/**
 * プロンプトに入っている情報。初めは閉じていて、1行のまとめを出す。
 * @param props - accountId：Account の ID、materials：情報の一覧
 * @returns 情報の一覧
 */
export function PromptMaterials({ accountId, materials }: { accountId: string; materials: Materials }) {
  const [open, setOpen] = useState(false);
  const base = `/accounts/${accountId}`;
  const { strategy, drafts, promotions, research } = materials;
  const draftFilled = [drafts.profileBio, ...drafts.pinned];
  const summary = `課題 ${strategy.done}/${STRATEGY_TOTAL}・目的 ${strategy.purposeDone}/5・下書き ${draftFilled.filter(Boolean).length}/4・宣伝内容 ${promotions.included}件・参考投稿 ${research.total}件（解説あり ${research.explained}件）`;

  return (
    <div className="rounded-xl bg-muted/50">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-11 w-full items-center gap-2 px-3.5 py-2 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">プロンプトに入っている情報</span>
          <span className="block text-xs text-muted-foreground">{summary}</span>
        </span>
        <ChevronDownIcon className={cn("size-4 shrink-0 transition-transform", open && "rotate-180")} aria-hidden="true" />
      </button>
      {/* 列の幅を決めないと、スマートフォンで長い項目名に合わせて列が広がり、灰色の枠からはみ出す */}
      {open && (
        <div className="grid grid-cols-1 gap-2.5 px-3 pb-3 md:grid-cols-2">
          <Card title="課題" where="→ プロンプトの「戦略設計」「活動の目的・在り方」に入ります">
            <ul className="divide-y text-[13px]">
              {strategy.items.map((item) => {
                const label = labelOf(item.key);
                const s = statusText(item.status, item.chars);
                return (
                  <li key={item.key} aria-label={label} className="flex items-center gap-2 py-1.5">
                    <span className="min-w-0 flex-1 truncate">{label}</span>
                    <span className={cn("shrink-0 text-xs", s.tone)}>{s.text}</span>
                    {item.chars > 0 && <span className="w-12 shrink-0 text-right text-xs text-muted-foreground tabular-nums">{item.chars}字</span>}
                    <EditLink to={`${base}/strategy#field-${item.key}`} />
                  </li>
                );
              })}
            </ul>
          </Card>
          <div className="space-y-2.5">
            <Card title="プロフィール・固定投稿（下書き）" where="→ 「現在のプロフィールと固定投稿」に入ります">
              <ul className="divide-y text-[13px]">
                {DRAFT_LABELS.map((label, i) => (
                  <li key={label} aria-label={label} className="flex items-center gap-2 py-1.5">
                    <span className="min-w-0 flex-1">{label}</span>
                    <span className={cn("shrink-0 text-xs", draftFilled[i] ? "text-success" : "text-muted-foreground")}>
                      {draftFilled[i] ? "入力あり" : "未入力"}
                    </span>
                    <EditLink to={`${base}/strategy#field-${DRAFT_KEYS[i]}`} />
                  </li>
                ))}
              </ul>
            </Card>
            <Card title="宣伝内容" where="→ 「今回組み込む宣伝内容」に入ります（公開中で期限内のもの）" action={<EditLink to={`${base}/promotions`} />}>
              <p className="text-[13px]">
                プロンプトに入る宣伝内容 {promotions.included}件（行動喚起が未記載 {promotions.missingCta}件）
              </p>
            </Card>
            <Card title="リサーチ" where="→ 「リサーチで見つけた伸びている投稿」に入ります" action={<EditLink to={`${base}/research`} />}>
              <p className="text-[13px]">
                参考投稿 {research.total}件（プロンプトに入るのは{research.included}件）・解説あり {research.explained}件・解説がまだ {research.pending}件
              </p>
              {research.pending > 0 && (
                <Link to={`${base}/research#explain`} className="inline-block text-[13px] text-ring underline">
                  解説がまだ{research.pending}件 → まとめてAIに解説してもらう
                </Link>
              )}
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
