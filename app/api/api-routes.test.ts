import fs from "fs";
import path from "path";

// Load .env.local variables before any imports
const envPath = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) {
  const envConfig = fs.readFileSync(envPath, "utf8");
  for (const line of envConfig.split("\n")) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#")) {
      const [key, ...valueParts] = trimmed.split("=");
      if (key && valueParts.length > 0) {
        process.env[key.trim()] = valueParts.join("=").trim();
      }
    }
  }
}

import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { POST as loginHandler } from "./auth/login/route";
import { GET as getProductsHandler, POST as postProductsHandler } from "./products/route";
import { GET as getUsersHandler } from "./users/route";
import { signToken, AUTH_COOKIE_NAME } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

describe("API Routes & Security Integration Tests (PostgreSQL)", () => {
  let adminPassHash: string;
  let viewerPassHash: string;
  let dispatcherPassHash: string;

  beforeAll(async () => {
    adminPassHash = await bcrypt.hash("Admin@2026", 10);
    viewerPassHash = await bcrypt.hash("Viewer@123", 10);
    dispatcherPassHash = await bcrypt.hash("Dispatcher@123", 10);

    // Update password_hash in Supabase PostgreSQL for test accounts
    await supabaseAdmin.from("users").update({ password_hash: adminPassHash, status: "ACTIVE" }).eq("username", "admin");
    await supabaseAdmin.from("users").update({ password_hash: viewerPassHash, status: "ACTIVE" }).eq("username", "viewer");
    await supabaseAdmin.from("users").update({ password_hash: dispatcherPassHash, status: "ACTIVE" }).eq("username", "dispatcher");
  }, 10000);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createMockRequest(url: string, method: string, body?: any, roleToken?: string): NextRequest {
    const headers = new Headers();
    if (roleToken) {
      headers.set("cookie", `${AUTH_COOKIE_NAME}=${roleToken}`);
    }
    return new NextRequest(new URL(url, "http://localhost:3000"), {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  it("1. Auth Login: reject wrong password, accept correct password and set cookie", async () => {
    const reqFail = createMockRequest("http://localhost:3000/api/auth/login", "POST", {
      username: "admin",
      password: "WrongPassword",
    });
    const resFail = await loginHandler(reqFail);
    expect(resFail.status).toBe(401);

    const reqOk = createMockRequest("http://localhost:3000/api/auth/login", "POST", {
      username: "admin",
      password: "Admin@2026",
    });
    const resOk = await loginHandler(reqOk);
    expect(resOk.status).toBe(200);
    const cookies = resOk.cookies.get(AUTH_COOKIE_NAME);
    expect(cookies?.value).toBeDefined();
  });

  it("2. Auth Security: return 401 when token is missing", async () => {
    const req = createMockRequest("http://localhost:3000/api/products", "GET");
    const res = await getProductsHandler(req);
    expect(res.status).toBe(401);
  });

  it("3. RBAC Permissions: VIEWER role gets 403 when trying POST /api/products", async () => {
    const viewerToken = signToken({ id: "u2", username: "viewer", role: "VIEWER" });
    const req = createMockRequest(
      "http://localhost:3000/api/products",
      "POST",
      { sku: "SKU-PROD", nameVi: "SP Test", routing: ["D1", "LR"], unit: "Cái" },
      viewerToken
    );
    const res = await postProductsHandler(req);
    expect(res.status).toBe(403);
  });

  it("4. RBAC Permissions: DISPATCHER role gets 403 when trying GET /api/users", async () => {
    const dispatcherToken = signToken({ id: "u3", username: "dispatcher", role: "DISPATCHER" });
    const req = createMockRequest("http://localhost:3000/api/users", "GET", undefined, dispatcherToken);
    const res = await getUsersHandler(req);
    expect(res.status).toBe(403);
  });
});
