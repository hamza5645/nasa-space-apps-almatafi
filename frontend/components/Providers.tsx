"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { shouldRetry } from "@/lib/retry";
import dynamic from "next/dynamic";
import { useState } from "react";
import WarpOverlay from "./WarpOverlay";

// Loaded after the page, so the guide and the data code it reads aren't in any page's first load.
const Wel3a = dynamic(() => import("./wel3a/Wel3a"), { ssr: false });

export default function Providers({ children }: { children: React.ReactNode }) {
  // One client per browser tab. Answers for an area and month don't change within a session.
  const [client] = useState(() => new QueryClient({
    defaultOptions: { queries: { staleTime: 10 * 60_000, retry: shouldRetry, refetchOnWindowFocus: false } },
  }));
  return (
    <QueryClientProvider client={client}>
      {children}
      <Wel3a />
      <WarpOverlay />
    </QueryClientProvider>
  );
}
