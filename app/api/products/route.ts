import { NextRequest, NextResponse } from "next/server";
import { listProducts, upsertProduct, deleteProduct } from "@/lib/products";
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
    return handleApiError(err, "Tạo sản phẩm mới thất bại.");
  }
}

export async function PUT(req: NextRequest) {
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

export async function DELETE(req: NextRequest) {
  const { user, response } = authorize(req, ["ADMIN", "DISPATCHER"]);
  if (response) return response;

  try {
    const { searchParams } = new URL(req.url);
    const sku = searchParams.get("sku");

    if (!sku) {
      return NextResponse.json(
        { error: "Tham số sku là bắt buộc để xóa sản phẩm." },
        { status: 400 }
      );
    }

    await deleteProduct(sku);
    return NextResponse.json({ success: true, message: `Đã xóa sản phẩm ${sku} thành công.` });
  } catch (err) {
    return handleApiError(err, "Xóa sản phẩm thất bại.");
  }
}
