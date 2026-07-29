"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import Header from "@/components/Header";
import { UserRole } from "@/lib/types";

interface AuthUser {
  id: string;
  username: string;
  role: UserRole;
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function checkAuth() {
      try {
        const res = await fetch("/api/auth/me");
        if (!res.ok) {
          router.push("/login");
          return;
        }
        const data = await res.json();
        if (data.user) {
          setUser(data.user);
        } else {
          router.push("/login");
        }
      } catch {
        router.push("/login");
      } finally {
        setIsLoading(false);
      }
    }
    checkAuth();
  }, [router]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas text-txt-secondary text-sm">
        Đang tải hệ thống...
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-canvas text-txt-primary overflow-hidden">
      {/* Left Sidebar Navigation */}
      <Sidebar userRole={user?.role} />

      {/* Right Content Column */}
      <div className="flex flex-col flex-1 h-screen overflow-hidden min-w-0">
        <Header user={user} />
        <main className="flex-1 overflow-y-auto p-6 bg-canvas">{children}</main>
      </div>
    </div>
  );
}
