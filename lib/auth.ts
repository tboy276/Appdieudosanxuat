import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { UserRole } from "./types";

const JWT_SECRET = process.env.JWT_SECRET || "super_secret_jwt_key_mes_lite_2026";
export const AUTH_COOKIE_NAME = "mes_token";

export interface JWTPayload {
  id: string;
  username: string;
  role: UserRole;
  iat?: number;
  exp?: number;
}

export function signToken(payload: { id: string; username: string; role: UserRole }): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
}

export function verifyToken(token: string): JWTPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JWTPayload;
  } catch {
    return null;
  }
}

export function getAuthUser(req: NextRequest): JWTPayload | null {
  // 1. Try httpOnly cookie
  const cookieToken = req.cookies.get(AUTH_COOKIE_NAME)?.value;
  if (cookieToken) {
    const verified = verifyToken(cookieToken);
    if (verified) return verified;
  }

  // 2. Try Authorization header
  const authHeader = req.headers.get("authorization");
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const headerToken = authHeader.substring(7);
    const verified = verifyToken(headerToken);
    if (verified) return verified;
  }

  return null;
}

export function authorize(
  req: NextRequest,
  allowedRoles?: UserRole[]
): { user?: JWTPayload; response?: NextResponse } {
  const user = getAuthUser(req);
  if (!user) {
    return {
      response: NextResponse.json({ error: "Chưa đăng nhập hoặc phiên làm việc đã hết hạn." }, { status: 401 }),
    };
  }

  if (allowedRoles && allowedRoles.length > 0 && !allowedRoles.includes(user.role)) {
    return {
      response: NextResponse.json(
        { error: `Tài khoản với vai trò ${user.role} không có quyền thực hiện thao tác này.` },
        { status: 403 }
      ),
    };
  }

  return { user };
}

export function handleApiError(err: unknown, fallbackMessage = "Đã xảy ra lỗi hệ thống."): NextResponse {
  const message = err instanceof Error ? err.message : fallbackMessage;
  return NextResponse.json({ error: message }, { status: 400 });
}
