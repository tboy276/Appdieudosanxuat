import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE_NAME } from "@/lib/auth";

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const token = req.cookies.get(AUTH_COOKIE_NAME)?.value;

  // 1. Dashboard Route Protection
  if (pathname.startsWith("/dashboard")) {
    if (!token) {
      const loginUrl = new URL("/login", req.url);
      return NextResponse.redirect(loginUrl);
    }
  }

  // 2. API Protection & Strict RBAC Enforcement
  if (pathname.startsWith("/api")) {
    // Exempt login and logout routes
    if (pathname === "/api/auth/login" || pathname === "/api/auth/logout") {
      return NextResponse.next();
    }

    if (!token) {
      return NextResponse.json(
        { error: "401 Unauthorized: Vui lòng đăng nhập." },
        { status: 401 }
      );
    }

    try {
      // Decode base64url JWT payload
      const parts = token.split(".");
      if (parts.length === 3) {
        const base64Url = parts[1];
        const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
        const jsonPayload = decodeURIComponent(
          atob(base64)
            .split("")
            .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
            .join("")
        );
        const payload = JSON.parse(jsonPayload);
        const role = payload?.role;

        // VIEWER role is strictly limited to GET operations
        if (role === "VIEWER" && req.method !== "GET") {
          return NextResponse.json(
            { error: "403 Forbidden: Tài khoản VIEWER chỉ có quyền xem dữ liệu." },
            { status: 403 }
          );
        }

        // Only ADMIN role can access /api/users
        if (pathname.startsWith("/api/users") && role !== "ADMIN") {
          return NextResponse.json(
            { error: "403 Forbidden: Chỉ ADMIN mới có quyền truy cập quản lý người dùng." },
            { status: 403 }
          );
        }
      }
    } catch {
      return NextResponse.json(
        { error: "401 Unauthorized: Token không hợp lệ." },
        { status: 401 }
      );
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/api/:path*"],
};
