// クリップボードが使えないときに、誘いの文を選んだ状態で出す欄（specs/people/001-people-memo research.md R17）。
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

/**
 * 文を選んだ欄のダイアログ。
 * @param props - text：誘いの文、onClose：閉じる
 * @returns ダイアログ
 */
export function CopyFallbackDialog({ text, onClose }: { text: string; onClose: () => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    // 開いたら文をすべて選ぶ（そのままコピーできる）
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.select();
  }, [text]);
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md" showClose={false}>
        <DialogTitle>この文をコピーしてください</DialogTitle>
        <DialogDescription>自動でコピーできませんでした。選んだ文を長押し（パソコンは Ctrl+C か ⌘+C）でコピーしてください。</DialogDescription>
        <Textarea ref={ref} readOnly aria-label="誘いの文" rows={5} value={text} onFocus={(e) => e.currentTarget.select()} />
        <Button className="h-11 rounded-full md:h-9" onClick={onClose}>
          閉じる
        </Button>
      </DialogContent>
    </Dialog>
  );
}
