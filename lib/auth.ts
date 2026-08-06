import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { UserRole } from "./types";
import { AUTH_COOKIE_NAME } from "./auth-constants";

export { AUTH_COOKIE_NAME };

const JWT_SECRET = process.env.JWT_SECRET || "super_secret_jwt_key_mes_lite_2026";

export interface JWTPayload {
  id: string;
  username: string;
  role: UserRole;
  iat?: number;
  exp?: number;
}

function base64UrlEncode(str: string): string {
  return Buffer.from(str)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function base64UrlDecode(str: string): string {
  let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4) {
    base64 += "=";
  }
  return Buffer.from(base64, "base64").toString("utf-8");
}

export function signToken(payload: { id: string; username: string; role: UserRole }): string {
  const header = { alg: "HS256", typ: "JWT" };
  const nowSec = Math.floor(Date.now() / 1000);
  const fullPayload: JWTPayload = {
    ...payload,
    iat: nowSec,
    exp: nowSec + 7 * 24 * 60 * 60, // 7 days
  };

  const headerB64 = base64UrlEncode(JSON.stringify(header));
  const payloadB64 = base64UrlEncode(JSON.stringify(fullPayload));
  const signature = crypto
    .createHmac("sha256", JWT_SECRET)
    .update(`${headerB64}.${payloadB64}`)
    .digest("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  return `${headerB64}.${payloadB64}.${signature}`;
}

export function verifyToken(token: string): JWTPayload | null {
  try {
    if (!token || typeof token !== "string") return null;
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const [headerB64, payloadB64, signature] = parts;
    const expectedSig = crypto
      .createHmac("sha256", JWT_SECRET)
      .update(`${headerB64}.${payloadB64}`)
      .digest("base64")
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");

    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return null;
    }

    const payloadJson = base64UrlDecode(payloadB64);
    const payload = JSON.parse(payloadJson) as JWTPayload;

    if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) {
      return null;
    }

    return payload;
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
