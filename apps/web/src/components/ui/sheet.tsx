import * as SheetPrimitive from "@radix-ui/react-dialog";
import * as React from "react";
import { cn } from "@/lib/utils";

// 狭い画面でサイドバーを開閉するドロワー（contracts/ui-routes.md「レイアウトの骨格」）
export const Sheet = SheetPrimitive.Root;
export const SheetTrigger = SheetPrimitive.Trigger;
export const SheetClose = SheetPrimitive.Close;

export function SheetContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content>) {
  return (
    <SheetPrimitive.Portal>
      <SheetPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50" />
      <SheetPrimitive.Content
        className={cn("fixed inset-y-0 left-0 z-50 flex h-full w-72 flex-col border-r bg-sidebar shadow-lg", className)}
        {...props}
      >
        <SheetPrimitive.Title className="sr-only">メニュー</SheetPrimitive.Title>
        {children}
      </SheetPrimitive.Content>
    </SheetPrimitive.Portal>
  );
}
