import { NextRequest, NextResponse } from "next/server";
import { listProducts, upsertProduct } from "@/lib/products";
import { authorize, handleApiError } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const { response } = authorize(req);
  if (response) return response;

  try {
    const products = await listProducts();
    return NextResponse.json(products);
  } catch (err) {
    return handleApiError(err, "Không thể tải danh mục sản phẩm.");
  }
}

export async function POST(req: NextRequest) {
  const { user, response } = authorize(req, ["ADMIN", "DISPATCHER"]);
  if (response) return response;

  try {
    const body = await req.json();
    const product = await upsertProduct(body);
    return NextResponse.json(product);
  } catch (err) {
    return handleApiError(err, "Cập nhật sản phẩm thất bại.");
  }
}
