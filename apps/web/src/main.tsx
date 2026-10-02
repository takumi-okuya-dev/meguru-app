import { ClerkProvider, useAuth } from "@clerk/react";
import { jaJP } from "@clerk/localizations";
import { QueryClientProvider } from "@tanstack/react-query";
import { errorMessage } from "@threads-grower/shared";
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { ClerkKeyMissingScreen } from "@/components/ErrorScreen";
import { configureApiClient } from "@/lib/api-client";
import { isUsablePublishableKey } from "@/lib/config-check";
import { queryClient } from "@/lib/query";
import { router } from "@/router";
import "./index.css";

const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;

/** APIクライアントに、Clerkのトークンの取り方とセッション切れの扱いを渡す */
function ApiClientBridge() {
  const { getToken } = useAuth();
  useEffect(() => {
    configureApiClient({
      getToken: () => getToken(),
      onSessionExpired: () => {
        toast.error(errorMessage("AUTH_REQUIRED").message);
        queryClient.clear();
        void router.navigate("/sign-in", { replace: true });
      },
    });
  }, [getToken]);
  return null;
}

const root = createRoot(document.getElementById("root")!);

// Clerk のキーが未設定・見本の値なら、真っ白や読み込み中のまま止めずに案内を出す
if (!isUsablePublishableKey(publishableKey)) {
  root.render(
    <StrictMode>
      <ClerkKeyMissingScreen />
    </StrictMode>,
  );
} else {
  root.render(
    <StrictMode>
      <ClerkProvider publishableKey={publishableKey} localization={jaJP} afterSignOutUrl="/sign-in">
        <QueryClientProvider client={queryClient}>
          <ApiClientBridge />
          <RouterProvider router={router} />
          <Toaster />
        </QueryClientProvider>
      </ClerkProvider>
    </StrictMode>,
  );
}
