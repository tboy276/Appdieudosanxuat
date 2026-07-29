import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";

const kvStore = new Map<string, any>();
const setStore = new Map<string, Set<string>>();
const listStore = new Map<string, any[]>();

vi.mock("@/lib/redis", () => {
  return {
    redis: {
      get: vi.fn(async (key: string) => kvStore.get(key) || null),
      set: vi.fn(async (key: string, val: any) => {
        kvStore.set(key, val);
        return "OK";
      }),
      exists: vi.fn(async (key: string) => (kvStore.has(key) ? 1 : 0)),
      sadd: vi.fn(async (key: string, member: string) => {
        const set = setStore.get(key) || new Set<string>();
        set.add(member);
        setStore.set(key, set);
        return 1;
      }),
      smembers: vi.fn(async (key: string) => {
        const set = setStore.get(key);
        return set ? Array.from(set) : [];
      }),
      hget: vi.fn(async (key: string, field: string) => {
        const hash = kvStore.get(key);
        return hash ? hash[field] : null;
      }),
      hgetall: vi.fn(async (key: string) => kvStore.get(key) || null),
      hset: vi.fn(async (key: string, data: Record<string, any>) => {
        const existing = kvStore.get(key) || {};
        kvStore.set(key, { ...existing, ...data });
        return 1;
      }),
      rpush: vi.fn(async (key: string, val: any) => {
        const list = listStore.get(key) || [];
        list.push(val);
        listStore.set(key, list);
        return list.length;
      }),
      lrange: vi.fn(async (key: string, start: number, end: number) => {
        const list = listStore.get(key) || [];
        if (end === -1) return list.slice(start);
        return list.slice(start, end + 1);
      }),
      eval: vi.fn(async (script: string, keys: string[], args: any[]) => {
        if (script.includes("TRANSFER_OUT") || keys.length === 7) {
          const [stateFromKey, stateToKey, openFromKey, openToKey, txFromKey, txToKey, activePairsKey] = keys;
          const [qtyStr, actor, woId, ts, fromCode, toCode, sku, today] = args;
          const qty = Number(qtyStr);

          const rawFrom = kvStore.get(stateFromKey);
          let tonPhoiFrom = 0, tonDauVaoFrom = 0, tonBTPFrom = 0;
          if (rawFrom) {
            const obj = typeof rawFrom === "string" ? JSON.parse(rawFrom) : rawFrom;
            tonPhoiFrom = Number(obj.tonPhoi || 0);
            tonDauVaoFrom = Number(obj.tonPhoiDauVao || 0);
            tonBTPFrom = Number(obj.tonBanThanhPham || 0);
          }

          if (tonPhoiFrom < qty) return `INSUFFICIENT_PHOI|${tonPhoiFrom}`;

          const rawTo = kvStore.get(stateToKey);
          let tonPhoiTo = 0, tonDauVaoTo = 0, tonBTPTo = 0;
          if (rawTo) {
            const obj = typeof rawTo === "string" ? JSON.parse(rawTo) : rawTo;
            tonPhoiTo = Number(obj.tonPhoi || 0);
            tonDauVaoTo = Number(obj.tonPhoiDauVao || 0);
            tonBTPTo = Number(obj.tonBanThanhPham || 0);
          }

          tonPhoiFrom -= qty;
          tonDauVaoTo += qty;

          kvStore.set(stateFromKey, { tonPhoi: tonPhoiFrom, tonPhoiDauVao: tonDauVaoFrom, tonBanThanhPham: tonBTPFrom });
          kvStore.set(stateToKey, { tonPhoi: tonPhoiTo, tonPhoiDauVao: tonDauVaoTo, tonBanThanhPham: tonBTPTo });
          return "OK";
        }

        if (script.includes("PRODUCE_PHOI") || keys.length === 4) {
          const [stateKey, openKey, txKey, activePairsKey] = keys;
          const [actualQtyStr, actor, woId, ts, isFirstStepStr, code, sku, today] = args;
          const actualQty = Number(actualQtyStr);
          const isFirstStep = isFirstStepStr === "1" || isFirstStepStr === "true";

          const rawState = kvStore.get(stateKey);
          let tonPhoi = 0, tonDauVao = 0, tonBTP = 0;
          if (rawState) {
            const obj = typeof rawState === "string" ? JSON.parse(rawState) : rawState;
            tonPhoi = Number(obj.tonPhoi || 0);
            tonDauVao = Number(obj.tonPhoiDauVao || 0);
            tonBTP = Number(obj.tonBanThanhPham || 0);
          }

          if (!isFirstStep && actualQty > tonDauVao) return `INSUFFICIENT_INPUT|${tonDauVao}`;

          if (isFirstStep) tonPhoi += actualQty;
          else {
            tonDauVao -= actualQty;
            tonBTP += actualQty;
          }

          kvStore.set(stateKey, { tonPhoi, tonPhoiDauVao: tonDauVao, tonBanThanhPham: tonBTP });
          return "OK";
        }
        return "OK";
      }),
      __reset: () => {
        kvStore.clear();
        setStore.clear();
        listStore.clear();
      },
    },
  };
});

import { POST as loginHandler } from "./auth/login/route";
import { POST as logoutHandler } from "./auth/logout/route";
import { GET as getProductsHandler, POST as postProductsHandler } from "./products/route";
import { POST as inputProductionHandler } from "./production/input/route";
import { POST as transferPhoiHandler } from "./production/transfer/route";
import { GET as getUsersHandler } from "./users/route";
import { signToken, AUTH_COOKIE_NAME } from "@/lib/auth";

describe("API Routes & Security Integration Tests", () => {
  beforeEach(async () => {
    (await import("@/lib/redis")).redis.__reset();
    vi.clearAllMocks();

    // Seed test users into kvStore
    const adminPass = await bcrypt.hash("Admin@123", 10);
    const viewerPass = await bcrypt.hash("Viewer@123", 10);
    const dispatcherPass = await bcrypt.hash("Dispatcher@123", 10);

    kvStore.set("users", [
      { id: "u1", username: "admin", passwordHash: adminPass, role: "ADMIN" },
      { id: "u2", username: "viewer", passwordHash: viewerPass, role: "VIEWER" },
      { id: "u3", username: "dispatcher", passwordHash: dispatcherPass, role: "DISPATCHER" },
    ]);
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
    // Wrong password
    const reqFail = createMockRequest("http://localhost:3000/api/auth/login", "POST", {
      username: "admin",
      password: "WrongPassword",
    });
    const resFail = await loginHandler(reqFail);
    expect(resFail.status).toBe(400);

    // Correct password
    const reqOk = createMockRequest("http://localhost:3000/api/auth/login", "POST", {
      username: "admin",
      password: "Admin@123",
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

  it("5. Routing Validation in Transfer: reject transfer if toCode is not immediate next step in SKU routing", async () => {
    const dispatcherToken = signToken({ id: "u3", username: "dispatcher", role: "DISPATCHER" });

    // Seed product with routing D1 -> CK1 -> LR
    kvStore.set("products", {
      "SKU-ROUTE": { sku: "SKU-ROUTE", nameVi: "Thân Máy", routing: ["D1", "CK1", "LR"], unit: "Cái" },
    });

    // Attempt transfer from D1 straight to LR (invalid, skipping CK1)
    const reqInvalid = createMockRequest(
      "http://localhost:3000/api/production/transfer",
      "POST",
      { fromCode: "D1", toCode: "LR", sku: "SKU-ROUTE", qty: 10 },
      dispatcherToken
    );
    const resInvalid = await transferPhoiHandler(reqInvalid);
    expect(resInvalid.status).toBe(400);

    const json = await resInvalid.json();
    expect(json.error).toContain("không phải là công đoạn kế tiếp");
  });
});
