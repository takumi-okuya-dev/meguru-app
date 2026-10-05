// 追加・編集のダイアログの枠（docs/ui-design.md 型B）。
// 768px以上は中央のダイアログ（右上に✕、下に「キャンセル」「保存」）。
// 767px以下は全画面のシート（左上に✕、右上に「保存」）。
import { XIcon } from "lucide-react";
import type { ReactNode } from "react";
import { GrowerRequiredBanner } from "@/components/GrowerRequiredNotice";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

/**
 * 追加・編集のダイアログの枠。閉じる操作（✕・キャンセル・Esc・背景のクリック）は、すべて onRequestClose を通す。
 * @param props - title：見出し、submitLabel：主な操作の文言、onSubmit：保存、onRequestClose：閉じる操作、submitting：保存中、locked：保存できない、
 *   lockedNotice：保存できないときの案内（省略すると grower機能の案内）、children：入力欄
 * @returns ダイアログ
 */
export function FormDialogFrame({
  title,
  description,
  submitLabel,
  submitting,
  locked = false,
  lockedNotice,
  onSubmit,
  onRequestClose,
  children,
}: {
  title: string;
  description: string;
  submitLabel: string;
  submitting: boolean;
  /** grower機能が使えなくなった（保存の操作を出さず、案内を出す） */
  locked?: boolean;
  /** 保存できないときに、grower機能の案内の代わりに出す案内 */
  lockedNotice?: ReactNode;
  onSubmit: () => void;
  onRequestClose: () => void;
  children: ReactNode;
}) {
  return (
    <Dialog open onOpenChange={(v) => !v && onRequestClose()}>
      <DialogContent mobileFullScreen showClose={false} className="gap-0 p-0 sm:max-w-xl" aria-describedby="form-dialog-desc">
        <div className="grid h-[52px] shrink-0 grid-cols-[5.5rem_minmax(0,1fr)_5.5rem] items-center border-b px-1.5 md:flex md:h-auto md:border-0 md:px-6 md:pt-5 md:pb-2">
          <button
            type="button"
            aria-label="閉じる"
            onClick={onRequestClose}
            className="flex size-11 items-center justify-center rounded-lg hover:bg-accent md:order-last md:-mr-2 md:size-9"
          >
            <XIcon className="size-5" />
          </button>
          <DialogTitle className="truncate text-center text-base font-semibold md:flex-1 md:text-left md:text-[17px]">
            {title}
          </DialogTitle>
          <div className="flex justify-end pr-1.5 md:hidden">
            {!locked && (
              <Button className="h-9 rounded-full px-4" disabled={submitting} onClick={onSubmit}>
                {submitLabel}
              </Button>
            )}
          </div>
        </div>
        <DialogDescription id="form-dialog-desc" className="sr-only">
          {description}
        </DialogDescription>
        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4 md:max-h-[65vh] md:px-6 md:py-3">
          {locked && (lockedNotice ?? <GrowerRequiredBanner />)}
          {children}
        </div>
        <div className="hidden justify-end gap-2 px-6 pt-3 pb-5 md:flex">
          <Button variant="outline" className="rounded-full" onClick={onRequestClose}>
            {locked ? "閉じる" : "キャンセル"}
          </Button>
          {!locked && (
            <Button className="rounded-full" disabled={submitting} onClick={onSubmit}>
              {submitLabel}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * ダイアログの中に出す、行が削除されていたときの案内（contracts/ui-routes.md 規則6）。
 * @param props - what：「宣伝内容」など、onClose：閉じて一覧を読み込み直す
 * @returns 案内
 */
export function DeletedElsewhereNotice({ what, onClose }: { what: string; onClose: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-warning/40 bg-warning-bg px-4 py-3 text-sm">
      <span className="flex-1">この{what}は、別のタブや端末で削除されています。入力した内容は、必要ならコピーしてください。</span>
      <Button size="sm" variant="outline" className="rounded-full" onClick={onClose}>
        閉じる
      </Button>
    </div>
  );
}
