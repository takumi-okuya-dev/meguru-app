// チームのロールの図（specs/011-team-revision FR-056、contracts/ui-routes.md「このアカウントの設定：チームの区分」、docs/team-roles.md）。
// アカウントの持ち主（オーナー）と、チームのロール（管理者・メンバー・編集者）の関係を1枚で示す。説明のためだけで、守りはAPIにある。
import { cn } from "@/lib/utils";

/** 図の中のロール。 */
export type DiagramRole = "admin" | "member" | "editor";

const ROLES: { role: DiagramRole; name: string; can: string[] }[] = [
  {
    role: "admin",
    name: "管理者",
    can: ["チームを作り、招待リンクを送る", "メンバー⇔編集者を切り替え、担当を決める", "1チームに1人。抜ける前に引き継ぐ"],
  },
  {
    role: "member",
    name: "メンバー",
    can: ["ほかの人が「チームに見せる」にしたアカウントの、投稿ストックと戦略を読む", "招待リンクから入った人は、まずメンバー"],
  },
  {
    role: "editor",
    name: "編集者",
    can: ["メンバーと同じく読めるうえに、担当のアカウントで投稿の案・戦略を作る、直す", "承認と設定はできない"],
  },
];

/**
 * チームのロールの図。
 * @param props - you：見ている人のロール（「あなた」の印を付ける）、vertical：常に縦に並べる、className：外側のクラス
 * @returns 図
 */
export function RoleDiagram({ you, vertical = false, className }: { you?: DiagramRole; vertical?: boolean; className?: string }) {
  return (
    <figure aria-label="チームのロールの図" className={cn("space-y-3", className)}>
      <div className="rounded-xl border bg-muted/40 px-3.5 py-3 text-sm">
        <div className="font-semibold">オーナー（アカウントの持ち主）</div>
        <p className="text-[13px] text-foreground/80">
          チームの全員が、自分のThreadsアカウントを1つ以上持っています。自分のアカウントでは、誰でもオーナーです。承認・設定・Threadsとの接続・支払いは、いつもオーナーだけが行います。
        </p>
      </div>
      <ol className={cn("flex flex-col gap-1.5", !vertical && "md:flex-row")}>
        {ROLES.map((r) => (
          <li
            key={r.role}
            aria-current={you === r.role ? "true" : undefined}
            className={cn("min-w-0 flex-1 space-y-1 rounded-xl border bg-card px-3.5 py-3 text-sm", you === r.role && "border-foreground")}
          >
            <div className="flex items-center gap-2">
              <span className="font-semibold">{r.name}</span>
              {you === r.role && (
                <span className="rounded-full bg-foreground px-2 py-0.5 text-[11px] font-medium text-background">あなた</span>
              )}
            </div>
            <ul className="space-y-0.5 pt-1 text-[13px] text-foreground/80">
              {r.can.map((c) => (
                <li key={c}>・{c}</li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
      <figcaption className="text-xs text-muted-foreground">
        チームのロールは、ほかの人のアカウントに何ができるかを決めます。誰が何をしたかは「操作の記録」に残ります。
      </figcaption>
    </figure>
  );
}
