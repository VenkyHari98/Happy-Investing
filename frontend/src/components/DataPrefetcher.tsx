"use client";
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

const SCANNER_STALE_MS = 60 * 60 * 1000;

export function DataPrefetcher() {
  const queryClient = useQueryClient();
  useEffect(() => {
    queryClient.prefetchQuery({ queryKey: ["scanner-f40"],         queryFn: api.scanner.f40,        staleTime: SCANNER_STALE_MS });
    queryClient.prefetchQuery({ queryKey: ["scanner-f40-summary"], queryFn: api.scanner.f40Summary, staleTime: SCANNER_STALE_MS });
    queryClient.prefetchQuery({ queryKey: ["scanner-s200"],        queryFn: api.scanner.s200,       staleTime: SCANNER_STALE_MS });
  }, [queryClient]);
  return null;
}
