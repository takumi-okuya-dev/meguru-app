// 投稿ルール（CORE RULES）のダイアログ（specs/004-review-approval FR-019〜FR-021、contracts/ui-routes.md「投稿ルールのダイアログ」）。
// 002の追加・編集のダイアログの枠と振る舞い（未保存の警告・他の場所での更新・grower機能の判定）を使う。
import { CORE_RULES_MAX, countChars, type CoreRulesResponse } from "@meguru/shared";
import { FieldWithCounter } from "@/components/FieldWithCounter";
import { FormDialogFrame } from "@/apps/threads/components/items/FormDialogFrame";
import { useItemForm } from "@/apps/threads/components/items/use-item-form";
import { ApiError } from "@/lib/api-client";
import { threadsApi } from "@/apps/threads/lib/api";
import { isStale } from "@/lib/save-error";

type Form = { text: string };
/** useItemForm で扱う形（版と更新日時を持つ行）。投稿ルールは更新日時を返さないので空にする。 */
type Item = { coreRules: string; version: number; updatedAt: string };

const toItem = (r: CoreRulesResponse): Item => ({
  coreRules: r.coreRules,
  version: r.coreRulesVersion,
  updatedAt: "",
});

/**
 * 投稿ルールのダイアログ。
 * @param props - accountId、coreRules・version：保存済みの投稿ルールと版、readOnly：grower機能を使えない（読むだけ）、
 *   onSaved：保存できた、onClose：閉じる
 * @returns ダイアログ
 */
export function CoreRulesDialog({
  accountId,
  coreRules,
  version,
  readOnly,
  onSaved,
  onClose,
}: {
  accountId: string;
  coreRules: string;
  version: number;
  readOnly: boolean;
  onSaved: () => void;
  onClose: () => void;
}) {
  const f = useItemForm<Form, Item>({
    item: { coreRules, version, updatedAt: "" },
    emptyForm: { text: "" },
    toForm: (item) => ({ text: item.coreRules }),
    validate: () => ({}),
    overLimit: (form) => countChars(form.text) > CORE_RULES_MAX,
    onSaved,
    onClose,
    onReadOnly: () => {},
    onDeletedElsewhere: onClose,
    save: async (form, expectedVersion) => {
      try {
        return toItem(
          await threadsApi.putCoreRules(accountId, {
            text: form.text,
            expectedVersion: expectedVersion ?? version,
          }),
        );
      } catch (err) {
        // 409 の latest を、useItemForm が扱う形（version を持つ行）にそろえる
        if (isStale(err))
          throw new ApiError(
            err.code,
            err.status,
            err.details,
            toItem(err.latest as CoreRulesResponse),
            err.updatedBy,
          );
        throw err;
      }
    },
  });

  return (
    <>
      <FormDialogFrame
        title="投稿ルール（CORE RULES）"
        description="1行に1つのルールを書きます。AIプロンプトの「絶対に守るルール」に、上から順に入ります"
        submitLabel="保存"
        submitting={f.submitting}
        locked={readOnly || f.locked}
        lockedNotice={
          <p role="status" className="rounded-2xl border bg-muted/60 px-4 py-3 text-sm">
            このアカウントは今、読むだけです。投稿ルールは保存済みのまま、AIプロンプトの生成で使われます。
          </p>
        }
        onSubmit={f.submit}
        onRequestClose={f.requestClose}
      >
        <p className="text-[13px] text-muted-foreground">
          1行に1つのルールを書きます。AIプロンプトの「絶対に守るルール」に、上から順に入ります
        </p>
        <FieldWithCounter
          id="core-rules"
          label="投稿ルール"
          readOnly={readOnly || f.readOnly}
          rows={8}
          max={CORE_RULES_MAX}
          placeholder={"断定口調は使わない\n医療・投資の効果をうたわない"}
          value={f.form.text}
          onChange={(v) => f.setField("text", v)}
        />
      </FormDialogFrame>
      {f.overlays}
    </>
  );
}
