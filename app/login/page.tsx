"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Factory, Lock, User as UserIcon, ArrowRight, AlertCircle } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!username.trim() || !password) {
      setError("Vui lòng nhập tên đăng nhập và mật khẩu.");
      return;
    }

    setIsLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          username: username.trim(),
          password,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Đăng nhập thất bại.");
        setIsLoading(false);
        return;
      }

      router.push("/dashboard/xnt");
    } catch {
      setError("Không thể kết nối đến máy chủ. Vui lòng thử lại sau.");
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-canvas text-txt-primary p-4">
      <div className="w-full max-w-sm space-y-6">
        {/* Brand Logo & Header */}
        <div className="flex flex-col items-center text-center space-y-2">
          <div className="flex items-center justify-center w-12 h-12 rounded border border-border bg-subtle text-txt-primary">
            <Factory className="w-6 h-6" />
          </div>
          <h1 className="text-xl font-bold tracking-tight text-txt-primary">Đăng Nhập MES-Lite</h1>
          <p className="text-xs text-txt-secondary">
            Hệ thống Quản lý & Điều độ Sản xuất Cơ khí
          </p>
        </div>

        {/* Login Form */}
        <div className="p-6 bg-canvas border border-border rounded shadow-sm space-y-4">
          {error && (
            <div className="flex items-center gap-2 p-3 rounded bg-amber-50 border border-amber-200 text-amber-800 text-xs">
              <AlertCircle className="w-4 h-4 shrink-0 text-amber-600" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1">
              <label className="text-xs font-medium text-txt-secondary">Tên đăng nhập</label>
              <div className="relative flex items-center">
                <UserIcon className="w-4 h-4 absolute left-3 text-txt-secondary" />
                <input
                  type="text"
                  required
                  placeholder="Nhập tên đăng nhập (vd: admin)"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-sm bg-canvas border border-border rounded focus:outline-none focus:border-accent text-txt-primary"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-txt-secondary">Mật khẩu</label>
              <div className="relative flex items-center">
                <Lock className="w-4 h-4 absolute left-3 text-txt-secondary" />
                <input
                  type="password"
                  required
                  placeholder="Nhập mật khẩu"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-sm bg-canvas border border-border rounded focus:outline-none focus:border-accent text-txt-primary"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full flex items-center justify-center gap-2 py-2 px-4 rounded bg-accent text-white text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {isLoading ? (
                "Đang xử lý..."
              ) : (
                <>
                  <span>Đăng Nhập</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>
        </div>

        {/* Demo Account Info Box */}
        <div className="p-3 bg-subtle border border-border rounded text-center space-y-1">
          <p className="text-[11px] font-semibold text-txt-secondary uppercase">Tài khoản mặc định sau Seed</p>
          <p className="text-xs text-txt-primary font-mono">
            Username: <span className="font-bold">admin</span> | Password: <span className="font-bold">Admin@123</span>
          </p>
        </div>
      </div>
    </div>
  );
}
