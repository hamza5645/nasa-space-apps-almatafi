"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { shouldRetry } from "@/lib/retry";
import { useState } from "react";
import WarpOverlay from "./WarpOverlay";

export default function Providers({ children }: { children: React.ReactNode }) {
  // One client per browser tab. Answers for an area and month don't change within a session.
  const [client] = useState(() => new QueryClient({
    defaultOptions: { queries: { staleTime: 10 * 60_000, retry: shouldRetry, refetchOnWindowFocus: false } },
  }));
  return (
    <QueryClientProvider client={client}>
      {children}
      <WarpOverlay />
    </QueryClientProvider>
  );
}
