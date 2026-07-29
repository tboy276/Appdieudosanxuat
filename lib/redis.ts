import { Redis } from "@upstash/redis";
import bcrypt from "bcryptjs";
import { WorkCenter, User } from "./types";

const effectiveRedisUrl =
  process.env.UPSTASH_REDIS_REST_URL_STAGING || process.env.UPSTASH_REDIS_REST_URL || "";
const effectiveRedisToken =
  process.env.UPSTASH_REDIS_REST_TOKEN_STAGING || process.env.UPSTASH_REDIS_REST_TOKEN || "";

const isDummyOrMissing =
  !effectiveRedisUrl ||
  effectiveRedisUrl.includes("dummy-url") ||
  !effectiveRedisToken ||
  effectiveRedisToken.includes("dummy");

// In-Memory Fallback Storage for Local Dev when Upstash Redis credentials are placeholder
const inMemoryKV = new Map<string, any>();
const inMemoryList = new Map<string, any[]>();
const inMemorySet = new Map<string, Set<string>>();

function getSeedAdminPassword(): string {
  const seedPass = process.env.SEED_ADMIN_PASSWORD;
  if (!seedPass || !seedPass.trim()) {
    throw new Error(
      "❌ LỖI HỆ THỐNG: Biến môi trường SEED_ADMIN_PASSWORD chưa được thiết lập. Vui lòng cấu hình SEED_ADMIN_PASSWORD trước khi thực hiện seed/reset."
    );
  }
  return seedPass.trim();
}

// Auto-seed baseline master data in fallback mode
async function initInMemorySeed() {
  if (inMemoryKV.has("workcenters") && inMemoryKV.has("users")) return;

  const WORK_CENTERS: WorkCenter[] = [
    { code: "CUAPHOI", name: "Tổ cưa phôi PSX", scrapRate: 0.01, isFirstStep: true },
    { code: "D1", name: "Xưởng Đúc 1", scrapRate: 0.10, isFirstStep: true },
    { code: "D2", name: "Xưởng Đúc 2", scrapRate: 0.10, isFirstStep: true },
    { code: "R1", name: "Xưởng Rèn 1", scrapRate: 0.05, isFirstStep: true },
    { code: "R2", name: "Xưởng Rèn 2", scrapRate: 0.05, isFirstStep: true },
    { code: "CK1", name: "Xưởng Cơ Khí 1", scrapRate: 0.02 },
    { code: "CK2", name: "Xưởng Cơ Khí 2", scrapRate: 0.02 },
    { code: "CK3", name: "Xưởng Cơ Khí 3", scrapRate: 0.02 },
    { code: "MNL", name: "Xưởng Mạ Nhiệt Luyện", scrapRate: 0.03 },
    { code: "LR", name: "Xưởng Lắp Ráp", scrapRate: 0.00, isFinalStep: true },
  ];

  const adminPass = await bcrypt.hash(getSeedAdminPassword(), 10);
  const adminUser: User = {
    id: "usr_admin_001",
    username: "admin",
    passwordHash: adminPass,
    role: "ADMIN",
    createdAt: new Date().toISOString(),
  };

  inMemoryKV.set("workcenters", WORK_CENTERS);
  inMemoryKV.set("users", [adminUser]);
}

if (isDummyOrMissing) {
  console.warn("⚠️ Warning: Using In-Memory Redis Fallback because UPSTASH_REDIS_REST_URL is missing or dummy in .env.local.");
  initInMemorySeed().catch(console.error);
}

const realUpstashClient = new Redis({
  url: effectiveRedisUrl,
  token: effectiveRedisToken,
});

export const redis = {
  async get<T>(key: string): Promise<T | null> {
    if (isDummyOrMissing) {
      await initInMemorySeed();
      const val = inMemoryKV.get(key);
      return val === undefined ? null : (val as T);
    }
    return realUpstashClient.get<T>(key);
  },

  async set(key: string, value: any): Promise<"OK"> {
    if (isDummyOrMissing) {
      await initInMemorySeed();
      inMemoryKV.set(key, value);
      return "OK";
    }
    return realUpstashClient.set(key, value);
  },

  async del(...keys: string[]): Promise<number> {
    if (isDummyOrMissing) {
      await initInMemorySeed();
      let count = 0;
      for (const k of keys) {
        if (inMemoryKV.has(k)) {
          inMemoryKV.delete(k);
          count++;
        }
      }
      return count;
    }
    return realUpstashClient.del(...keys);
  },

  async exists(key: string): Promise<number> {
    if (isDummyOrMissing) {
      await initInMemorySeed();
      return inMemoryKV.has(key) ? 1 : 0;
    }
    return realUpstashClient.exists(key);
  },

  async hget<T>(key: string, field: string): Promise<T | null> {
    if (isDummyOrMissing) {
      await initInMemorySeed();
      const hash = inMemoryKV.get(key);
      if (!hash) return null;
      const val = hash[field];
      return val === undefined ? null : (val as T);
    }
    return realUpstashClient.hget<T>(key, field);
  },

  async hgetall<T>(key: string): Promise<T | null> {
    if (isDummyOrMissing) {
      await initInMemorySeed();
      const hash = inMemoryKV.get(key);
      return hash === undefined ? null : (hash as T);
    }
    return (await realUpstashClient.hgetall(key)) as T | null;
  },

  async hset(key: string, data: Record<string, any>): Promise<number> {
    if (isDummyOrMissing) {
      await initInMemorySeed();
      const existing = inMemoryKV.get(key) || {};
      inMemoryKV.set(key, { ...existing, ...data });
      return Object.keys(data).length;
    }
    return realUpstashClient.hset(key, data);
  },

  async hdel(key: string, ...fields: string[]): Promise<number> {
    if (isDummyOrMissing) {
      await initInMemorySeed();
      const hash = inMemoryKV.get(key);
      if (!hash) return 0;
      let count = 0;
      for (const f of fields) {
        if (f in hash) {
          delete hash[f];
          count++;
        }
      }
      return count;
    }
    return realUpstashClient.hdel(key, ...fields);
  },

  async sadd(key: string, member: string): Promise<number> {
    if (isDummyOrMissing) {
      await initInMemorySeed();
      const set = inMemorySet.get(key) || new Set<string>();
      set.add(member);
      inMemorySet.set(key, set);
      return 1;
    }
    return realUpstashClient.sadd(key, member);
  },

  async srem(key: string, ...members: string[]): Promise<number> {
    if (isDummyOrMissing) {
      await initInMemorySeed();
      const set = inMemorySet.get(key);
      if (!set) return 0;
      let count = 0;
      for (const m of members) {
        if (set.has(m)) {
          set.delete(m);
          count++;
        }
      }
      return count;
    }
    return realUpstashClient.srem(key, ...members);
  },

  async smembers(key: string): Promise<string[]> {
    if (isDummyOrMissing) {
      await initInMemorySeed();
      const set = inMemorySet.get(key);
      return set ? Array.from(set) : [];
    }
    return realUpstashClient.smembers(key);
  },

  async rpush(key: string, val: any): Promise<number> {
    if (isDummyOrMissing) {
      await initInMemorySeed();
      const list = inMemoryList.get(key) || [];
      list.push(val);
      inMemoryList.set(key, list);
      return list.length;
    }
    return realUpstashClient.rpush(key, val);
  },

  async lrange<T>(key: string, start: number, end: number): Promise<T[]> {
    if (isDummyOrMissing) {
      await initInMemorySeed();
      const list = inMemoryList.get(key) || [];
      if (end === -1) return list.slice(start) as T[];
      return list.slice(start, end + 1) as T[];
    }
    return realUpstashClient.lrange<T>(key, start, end);
  },

  async eval<T>(script: string, keys: string[], args: any[]): Promise<T> {
    if (isDummyOrMissing) {
      await initInMemorySeed();
      if (script.includes("TRANSFER_OUT") || keys.length === 7) {
        const [stateFromKey, stateToKey, openFromKey, openToKey, txFromKey, txToKey, activePairsKey] = keys;
        const [qtyStr, actor, woId, ts, fromCode, toCode, sku, today] = args;
        const qty = Number(qtyStr);

        const rawFrom = inMemoryKV.get(stateFromKey);
        let tonPhoiFrom = 0, tonDauVaoFrom = 0, tonBTPFrom = 0;
        if (rawFrom) {
          const obj = typeof rawFrom === "string" ? JSON.parse(rawFrom) : rawFrom;
          tonPhoiFrom = Number(obj.tonPhoi || 0);
          tonDauVaoFrom = Number(obj.tonPhoiDauVao || 0);
          tonBTPFrom = Number(obj.tonBanThanhPham || 0);
        }

        if (tonPhoiFrom < qty) return `INSUFFICIENT_PHOI|${tonPhoiFrom}` as unknown as T;

        const rawTo = inMemoryKV.get(stateToKey);
        let tonPhoiTo = 0, tonDauVaoTo = 0, tonBTPTo = 0;
        if (rawTo) {
          const obj = typeof rawTo === "string" ? JSON.parse(rawTo) : rawTo;
          tonPhoiTo = Number(obj.tonPhoi || 0);
          tonDauVaoTo = Number(obj.tonPhoiDauVao || 0);
          tonBTPTo = Number(obj.tonBanThanhPham || 0);
        }

        if (!inMemoryKV.has(openFromKey)) {
          inMemoryKV.set(openFromKey, { tonPhoi: tonPhoiFrom, tonPhoiDauVao: tonDauVaoFrom, tonBanThanhPham: tonBTPFrom, declaredBy: "system_lazy", declaredAt: ts });
        }
        if (!inMemoryKV.has(openToKey)) {
          inMemoryKV.set(openToKey, { tonPhoi: tonPhoiTo, tonPhoiDauVao: tonDauVaoTo, tonBanThanhPham: tonBTPTo, declaredBy: "system_lazy", declaredAt: ts });
        }

        tonPhoiFrom -= qty;
        tonDauVaoTo += qty;

        inMemoryKV.set(stateFromKey, { tonPhoi: tonPhoiFrom, tonPhoiDauVao: tonDauVaoFrom, tonBanThanhPham: tonBTPFrom });
        inMemoryKV.set(stateToKey, { tonPhoi: tonPhoiTo, tonPhoiDauVao: tonDauVaoTo, tonBanThanhPham: tonBTPTo });

        const txFromList = inMemoryList.get(txFromKey) || [];
        txFromList.push({ ts, type: "TRANSFER_OUT", qty, fromCode, toCode, sku, woId, actor });
        inMemoryList.set(txFromKey, txFromList);

        const txToList = inMemoryList.get(txToKey) || [];
        txToList.push({ ts, type: "TRANSFER_IN", qty, fromCode, toCode, sku, woId, actor });
        inMemoryList.set(txToKey, txToList);

        const set = inMemorySet.get(activePairsKey) || new Set<string>();
        set.add(`${fromCode}:${sku}`);
        set.add(`${toCode}:${sku}`);
        inMemorySet.set(activePairsKey, set);

        return "OK" as unknown as T;
      }

      if (script.includes("PRODUCE_PHOI") || keys.length === 4) {
        const [stateKey, openKey, txKey, activePairsKey] = keys;
        const [actualQtyStr, actor, woId, ts, isFirstStepStr, code, sku, today] = args;
        const actualQty = Number(actualQtyStr);
        const isFirstStep = isFirstStepStr === "1" || isFirstStepStr === "true";

        const rawState = inMemoryKV.get(stateKey);
        let tonPhoi = 0, tonDauVao = 0, tonBTP = 0;
        if (rawState) {
          const obj = typeof rawState === "string" ? JSON.parse(rawState) : rawState;
          tonPhoi = Number(obj.tonPhoi || 0);
          tonDauVao = Number(obj.tonPhoiDauVao || 0);
          tonBTP = Number(obj.tonBanThanhPham || 0);
        }

        if (!isFirstStep && actualQty > tonDauVao) return `INSUFFICIENT_INPUT|${tonDauVao}` as unknown as T;

        if (!inMemoryKV.has(openKey)) {
          inMemoryKV.set(openKey, { tonPhoi, tonPhoiDauVao: tonDauVao, tonBanThanhPham: tonBTP, declaredBy: "system_lazy", declaredAt: ts });
        }

        const txList = inMemoryList.get(txKey) || [];
        if (isFirstStep) {
          tonPhoi += actualQty;
          txList.push({ ts, type: "PRODUCE_PHOI", qty: actualQty, sku, woId, actor });
        } else {
          tonDauVao -= actualQty;
          tonBTP += actualQty;
          txList.push({ ts, type: "CONSUME_PHOI", qty: actualQty, sku, woId, actor });
          txList.push({ ts, type: "OUTPUT_BTP", qty: actualQty, sku, woId, actor });
        }
        inMemoryList.set(txKey, txList);

        inMemoryKV.set(stateKey, { tonPhoi, tonPhoiDauVao: tonDauVao, tonBanThanhPham: tonBTP });

        const set = inMemorySet.get(activePairsKey) || new Set<string>();
        set.add(`${code}:${sku}`);
        inMemorySet.set(activePairsKey, set);

        return "OK" as unknown as T;
      }
      return "OK" as unknown as T;
    }
    return (await realUpstashClient.eval(script, keys, args)) as T;
  },
};

/**
 * Flush & Reset System Database
 */
export async function resetSystemData(): Promise<void> {
  if (isDummyOrMissing) {
    inMemoryKV.clear();
    inMemoryList.clear();
    inMemorySet.clear();
    await initInMemorySeed();
    return;
  }

  // 1. Fetch all keys in Upstash Redis
  const allKeys = await realUpstashClient.keys("*");

  // 2. Delete all operational data keys (excluding workcenters & users)
  for (const k of allKeys) {
    if (k !== "workcenters" && k !== "users") {
      await realUpstashClient.del(k);
    }
  }

  // 3. Re-seed default Workcenters and Admin User
  const WORK_CENTERS: WorkCenter[] = [
    { code: "CUAPHOI", name: "Tổ cưa phôi PSX", scrapRate: 0.01, isFirstStep: true },
    { code: "D1", name: "Xưởng Đúc 1", scrapRate: 0.10, isFirstStep: true },
    { code: "D2", name: "Xưởng Đúc 2", scrapRate: 0.10, isFirstStep: true },
    { code: "R1", name: "Xưởng Rèn 1", scrapRate: 0.05, isFirstStep: true },
    { code: "R2", name: "Xưởng Rèn 2", scrapRate: 0.05, isFirstStep: true },
    { code: "CK1", name: "Xưởng Cơ Khí 1", scrapRate: 0.02 },
    { code: "CK2", name: "Xưởng Cơ Khí 2", scrapRate: 0.02 },
    { code: "CK3", name: "Xưởng Cơ Khí 3", scrapRate: 0.02 },
    { code: "MNL", name: "Xưởng Mạ Nhiệt Luyện", scrapRate: 0.03 },
    { code: "LR", name: "Xưởng Lắp Ráp", scrapRate: 0.00, isFinalStep: true },
  ];

  const adminPass = await bcrypt.hash(getSeedAdminPassword(), 10);
  const adminUser: User = {
    id: "usr_admin_001",
    username: "admin",
    passwordHash: adminPass,
    role: "ADMIN",
    createdAt: new Date().toISOString(),
  };

  await realUpstashClient.set("workcenters", WORK_CENTERS);
  await realUpstashClient.set("users", [adminUser]);
}
