"use client";

import useSWR from "swr";
import { UserRole } from "@/lib/types";

interface SessionUser {
  id?: string;
  username: string;
  role: UserRole;
}

const fetcher = (url: string) =>
  fetch(url).then((res) => {
    if (!res.ok) throw new Error("Unauthorized");
    return res.json();
  });

export function useSession() {
  const { data, error, isLoading, mutate } = useSWR<{ user?: SessionUser }>(
    "/api/auth/me",
    fetcher,
    {
      revalidateOnFocus: true,
    }
  );

  const user = data?.user || null;
  const role = user?.role;

  return {
    user,
    role,
    isLoading,
    isError: Boolean(error),
    isAdmin: role === "ADMIN",
    isDispatcher: role === "DISPATCHER",
    isViewer: role === "VIEWER",
    canWrite: role === "ADMIN" || role === "DISPATCHER",
    mutate,
  };
}
