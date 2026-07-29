import { redis } from "./redis";
import { Product } from "./types";

const PRODUCTS_KEY = "products";

/**
 * Validates product routing rules:
 * - If needsRouting is true and routing is empty, it is allowed (pending routing declaration).
 * - Otherwise, routing must not be empty and the last step MUST be "LR".
 */
export function validateProductRouting(product: Partial<Product>): void {
  const { routing, needsRouting } = product;

  if (needsRouting && (!routing || routing.length === 0)) {
    return; // Temporarily allowed empty routing when needsRouting is true
  }

  if (!routing || !Array.isArray(routing) || routing.length === 0) {
    throw new Error("Routing không được để rỗng trừ khi sản phẩm đang ở trạng thái cần cập nhật routing (needsRouting=true).");
  }

  const lastStep = routing[routing.length - 1];
  if (lastStep !== "LR") {
    throw new Error(`Routing không hợp lệ: bước cuối cùng của routing bắt buộc phải là 'LR' (hiện tại: '${lastStep}').`);
  }
}

/**
 * Fetch all products from Redis Hash "products"
 */
export async function listProducts(): Promise<Product[]> {
  const rawProducts = await redis.hgetall<Record<string, Product | string>>(PRODUCTS_KEY);
  if (!rawProducts) {
    return [];
  }

  return Object.values(rawProducts).map((item) => {
    if (typeof item === "string") {
      return JSON.parse(item) as Product;
    }
    return item as Product;
  });
}

/**
 * Fetch single product by SKU
 */
export async function getProduct(sku: string): Promise<Product | null> {
  if (!sku) return null;
  const raw = await redis.hget<Product | string>(PRODUCTS_KEY, sku);
  if (!raw) return null;

  if (typeof raw === "string") {
    return JSON.parse(raw) as Product;
  }
  return raw as Product;
}

/**
 * Upsert a product into Redis Hash "products"
 */
export async function upsertProduct(product: Product): Promise<Product> {
  if (!product.sku || !product.sku.trim()) {
    throw new Error("Mã SKU không được để rỗng.");
  }
  if (!product.nameVi || !product.nameVi.trim()) {
    throw new Error("Tên tiếng Việt không được để rỗng.");
  }

  // Validate routing rules
  validateProductRouting(product);

  const existing = await getProduct(product.sku);
  const now = new Date().toISOString();

  const updatedProduct: Product = {
    ...product,
    sku: product.sku.trim(),
    nameVi: product.nameVi.trim(),
    legacySymbols: product.legacySymbols || [],
    routing: product.routing || [],
    unit: product.unit || "Cái",
    needsRouting: Boolean(product.needsRouting),
    createdAt: existing?.createdAt || product.createdAt || now,
    updatedAt: now,
  };

  await redis.hset(PRODUCTS_KEY, {
    [updatedProduct.sku]: updatedProduct,
  });

  return updatedProduct;
}
