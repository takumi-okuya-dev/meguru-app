// 「Threadsの規約への備え」のダイアログ（specs/004-review-approval FR-042・FR-043、contracts/ui-routes.md）。
// アプリが用意しているルールと「規約に注意」の分類を、読むだけで出す。規約に触れないことを保証するものではない。
import { POLICY_CAUTIONS, POLICY_LIST_VERSION, POLICY_PROMPT_RULES } from "@threads-grower/shared";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * 規約への備えのダイアログ（読むだけ）。
 * @param props - onClose：閉じる
 * @returns ダイアログ
 */
export function PolicyInfoDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Threadsの規約への備え</DialogTitle>
          <DialogDescription>
            アプリが用意しているルールです。変更・無効化はできません。規約に触れないことを保証するものではありません。
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] space-y-5 overflow-y-auto text-sm">
          <section className="space-y-2">
            <h3 className="font-medium">AIプロンプトに入れるルール</h3>
            <ul className="list-disc space-y-1 pl-5">
              {POLICY_PROMPT_RULES.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </section>
          <section className="space-y-2">
            <h3 className="font-medium">「規約に注意」と表示する表現</h3>
            <ul className="space-y-3">
              {POLICY_CAUTIONS.map((c) => (
                <li key={c.id} className="space-y-0.5">
                  <p className="font-medium">{c.label}</p>
                  <p className="text-muted-foreground">{c.suggestion}</p>
                  <a
                    href={c.policyUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[13px] text-ring underline"
                  >
                    {c.policyName}
                  </a>
                </li>
              ))}
            </ul>
          </section>
          <p className="text-xs text-muted-foreground">
            {POLICY_LIST_VERSION}時点のMetaコミュニティ規定をもとにしています
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
