import { ClerkProvider, useAuth } from "@clerk/react";
import { jaJP } from "@clerk/localizations";
import { QueryClientProvider } from "@tanstack/react-query";
import { errorMessage } from "@threads-grower/shared";
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { configureApiClient } from "@/lib/api-client";
import { queryClient } from "@/lib/query";
import { router } from "@/router";
import "./index.css";

const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;
if (!publishableKey) throw new Error("VITE_CLERK_PUBLISHABLE_KEY が設定されていません（apps/web/.env.example 参照）");

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

createRoot(document.getElementById("root")!).render(
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
