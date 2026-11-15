// 追加・編集のダイアログの共通の振る舞い（specs/002 contracts/ui-routes.md 規則2〜6・9・10）。
// 入力値の管理、未保存の警告、409（他で更新）・404（削除済み）・403（grower機能なし）の扱いをまとめる。
import { useMutation } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { ConflictDialog } from "@/components/ConflictDialog";
import { BillingRequiredDialog } from "@/components/billing/BillingRequiredDialog";
import { UnsavedChangesDialog } from "@/components/UnsavedChangesDialog";
import { ApiError } from "@/lib/api-client";
import { billingReasonOf, isBillingRequired, isStale, saveErrorMessage } from "@/lib/save-error";
import { useUnsavedChanges } from "@/lib/use-unsaved-changes";

/** 入力値の検証の結果。項目名 → 入力欄の下に出す案内。 */
export type FormErrors<F> = Partial<Record<keyof F, string>>;

/** useItemForm の引数。 */
export type ItemFormOptions<F, T extends { version: number; updatedAt: string }> = {
  /** 編集する行（追加のときは undefined） */
  item?: T;
  /** 追加のときの初期値 */
  emptyForm: F;
  /** 行を入力値にする */
  toForm: (item: T) => F;
  /** 保存する。expectedVersion は編集のときだけ渡す */
  save: (form: F, expectedVersion: number | undefined) => Promise<T>;
  /** 入力値を検証する（必須・URLの形など。文字数は入力欄が示す） */
  validate: (form: F) => FormErrors<F>;
  /** 文字数の上限を超えている項目があるか */
  overLimit: (form: F) => boolean;
  /** 保存できた */
  onSaved: (item: T) => void;
  /** 閉じる */
  onClose: () => void;
  /** grower機能が使えなくなった（画面を読むだけにする）。ダイアログは閉じずに、入力内容を読むだけで残す */
  onReadOnly: () => void;
  /** 件数の上限に達していた（一覧を読み込み直して、上限の案内を出す） */
  onLimitReached?: () => void;
  /** 削除済みの案内を閉じた（一覧を読み込み直す） */
  onDeletedElsewhere: () => void;
  /** 409 KEYWORD_DUPLICATE などを、入力欄の案内にする */
  fieldErrorFor?: (err: ApiError) => FormErrors<F> | null;
  /** 入力欄のほかに、未保存の内容があるか（参考投稿の1件の解説の貼り付けなど。specs/014、PR #17 のCodexレビュー） */
  extraDirty?: boolean;
};

function sameForm<F>(a: F, b: F) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * 追加・編集のダイアログの共通の振る舞い。
 * @param opts - 振る舞いの設定
 * @returns 入力値・操作・ダイアログに重ねて出す確認
 */
export function useItemForm<F, T extends { version: number; updatedAt: string }>(opts: ItemFormOptions<F, T>) {
  const [base, setBase] = useState<{ form: F; version: number | undefined }>(() =>
    opts.item ? { form: opts.toForm(opts.item), version: opts.item.version } : { form: opts.emptyForm, version: undefined },
  );
  const [form, setForm] = useState<F>(base.form);
  const [showErrors, setShowErrors] = useState(false);
  const [serverErrors, setServerErrors] = useState<FormErrors<F>>({});
  const [conflict, setConflict] = useState<T | null>(null);
  // 先に保存した人（specs/008 FR-007）
  const [conflictBy, setConflictBy] = useState<string | null>(null);
  const [readOnlyReason, setReadOnlyReason] = useState<string | null>(null);
  const [deleted, setDeleted] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  // grower機能が使えなくなった後は、入力内容を読むだけで残す（閉じるまで消さない）
  const [locked, setLocked] = useState(false);

  const dirty = (!sameForm(form, base.form) || !!opts.extraDirty) && !deleted;
  useUnsavedChanges(dirty);
  const errors = { ...(showErrors ? opts.validate(form) : {}), ...serverErrors } as FormErrors<F>;

  const mutation = useMutation({
    mutationFn: (expectedVersion: number | undefined) => opts.save(form, expectedVersion),
    onSuccess: (item) => {
      setBase({ form, version: item.version });
      opts.onSaved(item);
    },
    onError: (err) => {
      if (isStale(err)) {
        setConflictBy(err.updatedBy?.name ?? null);
        return setConflict(err.latest as T);
      }
      if (isBillingRequired(err)) return setReadOnlyReason(billingReasonOf(err));
      if (err instanceof ApiError && err.code === "ITEM_NOT_FOUND") return setDeleted(true);
      if (err instanceof ApiError && err.code === "ITEM_LIMIT_REACHED") {
        toast.error(saveErrorMessage(err));
        return opts.onLimitReached?.();
      }
      const fieldErrors = err instanceof ApiError ? opts.fieldErrorFor?.(err) : null;
      if (fieldErrors) return setServerErrors(fieldErrors);
      toast.error(saveErrorMessage(err));
    },
  });

  const setField = <K extends keyof F>(key: K, value: F[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    if (serverErrors[key]) setServerErrors((e) => ({ ...e, [key]: undefined }));
  };

  const submit = () => {
    if (locked || mutation.isPending) return;
    setShowErrors(true);
    const found = opts.validate(form);
    if (Object.values(found).some(Boolean) || opts.overLimit(form)) return;
    mutation.mutate(base.version);
  };

  const requestClose = () => (dirty ? setConfirmClose(true) : opts.onClose());

  const overlays: ReactNode = (
    <>
      <UnsavedChangesDialog
        open={confirmClose}
        onStay={() => setConfirmClose(false)}
        onDiscard={() => {
          setConfirmClose(false);
          opts.onClose();
        }}
      />
      <ConflictDialog
        open={conflict !== null}
        updatedAt={conflict?.updatedAt ?? null}
        updatedByName={conflictBy}
        onCancel={() => setConflict(null)}
        onReload={() => {
          if (conflict) {
            const latest = opts.toForm(conflict);
            setBase({ form: latest, version: conflict.version });
            setForm(latest);
          }
          setConflict(null);
        }}
        onOverwrite={() => {
          if (conflict) mutation.mutate(conflict.version);
          setConflict(null);
        }}
      />
      <BillingRequiredDialog
        reason={readOnlyReason}
        onClose={() => {
          setReadOnlyReason(null);
          setLocked(true);
          opts.onReadOnly();
        }}
      />
    </>
  );

  return {
    form,
    setField,
    errors,
    submit,
    submitting: mutation.isPending,
    /** grower機能が使えなくなり、保存できない（入力内容は読むだけで残す） */
    locked,
    /** 入力欄を読み取り専用にするか（保存中は、送った内容と食い違わないよう入力を止める） */
    readOnly: locked || mutation.isPending,
    requestClose,
    deleted,
    closeDeleted: () => {
      opts.onDeletedElsewhere();
      opts.onClose();
    },
    overlays,
  };
}
