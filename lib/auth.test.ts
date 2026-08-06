import { describe, it, expect } from "vitest";
import { signToken, verifyToken, getAuthUser, authorize } from "./auth";
import { NextRequest } from "next/server";
import { AUTH_COOKIE_NAME } from "./auth-constants";

describe("lib/auth.ts - Native HMAC-SHA256 JWT & Edge Auth Security Tests", () => {
  const sampleUser = {
    id: "usr-123e4567-e89b-12d3-a456-426614174000",
    username: "admin",
    role: "ADMIN" as const,
  };

  it("1. Normal flow: signToken generates valid JWT and verifyToken extracts correct payload", () => {
    const token = signToken(sampleUser);
    expect(typeof token).toBe("string");
    expect(token.split(".").length).toBe(3);

    const payload = verifyToken(token);
    expect(payload).not.toBeNull();
    expect(payload!.id).toBe(sampleUser.id);
    expect(payload!.username).toBe(sampleUser.username);
    expect(payload!.role).toBe(sampleUser.role);
    expect(payload!.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
    expect(payload!.iat).toBeLessThanOrEqual(Math.floor(Date.now() / 1000));
  });

  it("2. Tampering protection: modified payload with original signature is REJECTED", () => {
    const token = signToken(sampleUser);
    const [headerB64, payloadB64, sig] = token.split(".");

    // Decode payload, modify role to ADMIN or change user id, then re-encode without updating signature
    const originalPayload = JSON.parse(Buffer.from(payloadB64, "base64").toString("utf-8"));
    const tamperedPayload = { ...originalPayload, role: "SUPER_ADMIN", username: "hacker" };
    const tamperedPayloadB64 = Buffer.from(JSON.stringify(tamperedPayload))
      .toString("base64")
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");

    const forgedToken = `${headerB64}.${tamperedPayloadB64}.${sig}`;
    const result = verifyToken(forgedToken);
    expect(result).toBeNull();
  });

  it("3. Signature tampering: altered signature is REJECTED (timing-safe check)", () => {
    const token = signToken(sampleUser);
    const [headerB64, payloadB64, sig] = token.split(".");

    // Corrupt one character in signature
    const corruptedSig = sig.slice(0, -1) + (sig.slice(-1) === "a" ? "b" : "a");
    const corruptedToken = `${headerB64}.${payloadB64}.${corruptedSig}`;

    const result = verifyToken(corruptedToken);
    expect(result).toBeNull();
  });

  it("4. Expiration check: expired token (exp in past) is REJECTED", () => {
    // Manually craft a token that expired 1 hour ago
    const headerB64 = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" }))
      .toString("base64")
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");

    const expiredPayload = {
      ...sampleUser,
      iat: Math.floor(Date.now() / 1000) - 7200,
      exp: Math.floor(Date.now() / 1000) - 3600, // expired 1 hour ago
    };
    const payloadB64 = Buffer.from(JSON.stringify(expiredPayload))
      .toString("base64")
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");

    // Sign it properly with HMAC secret
    const crypto = require("crypto");
    const sig = crypto
      .createHmac("sha256", process.env.JWT_SECRET || "super_secret_jwt_key_mes_lite_2026")
      .update(`${headerB64}.${payloadB64}`)
      .digest("base64")
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");

    const expiredToken = `${headerB64}.${payloadB64}.${sig}`;
    const result = verifyToken(expiredToken);
    expect(result).toBeNull();
  });

  it("5. Malformed tokens: invalid structures, non-base64, empty inputs are REJECTED gracefully without throwing", () => {
    expect(verifyToken("")).toBeNull();
    expect(verifyToken(null as any)).toBeNull();
    expect(verifyToken(undefined as any)).toBeNull();
    expect(verifyToken("invalid-string")).toBeNull();
    expect(verifyToken("part1.part2")).toBeNull();
    expect(verifyToken("part1.part2.part3.part4")).toBeNull();
    expect(verifyToken("!!!.@@@.###")).toBeNull();
    expect(verifyToken("eyJhbGciOiJIUzI1NiJ9.notjson.signature")).toBeNull();
  });

  it("6. authorize helper correctly authenticates and enforces role-based access control", () => {
    const validToken = signToken({ id: "1", username: "operator", role: "DISPATCHER" });

    // Request with valid cookie
    const reqWithCookie = new NextRequest("http://localhost:3000/api/test", {
      headers: {
        cookie: `${AUTH_COOKIE_NAME}=${validToken}`,
      },
    });

    const authResult = authorize(reqWithCookie, ["ADMIN", "DISPATCHER"]);
    expect(authResult.user).toBeDefined();
    expect(authResult.user!.username).toBe("operator");
    expect(authResult.response).toBeUndefined();

    // Request with forbidden role
    const forbiddenResult = authorize(reqWithCookie, ["ADMIN"]); // only ADMIN allowed
    expect(forbiddenResult.response).toBeDefined();
    expect(forbiddenResult.response!.status).toBe(403);

    // Request with no cookie
    const unauthReq = new NextRequest("http://localhost:3000/api/test");
    const unauthResult = authorize(unauthReq);
    expect(unauthResult.response).toBeDefined();
    expect(unauthResult.response!.status).toBe(401);
  });
});
