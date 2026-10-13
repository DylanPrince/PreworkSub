"use client";
import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * False during SSR and before hydration. Forms disable submit until hydrated so a fast click can
 * never fall through to a native GET submission (which would put field values in the URL).
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
