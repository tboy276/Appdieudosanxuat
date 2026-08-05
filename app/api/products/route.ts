import { NextRequest, NextResponse } from "next/server";
import { listProducts, upsertProduct, deleteProduct, bulkDeleteProducts } from "@/lib/products";
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
  const { response } = authorize(req, ["ADMIN", "DISPATCHER"]);
  if (response) return response;

  try {
    const { searchParams } = new URL(req.url);
    const singleSku = searchParams.get("sku");

    if (singleSku) {
      // Legacy single-delete
      await deleteProduct(singleSku);
      return NextResponse.json({ success: true, message: `Đã xóa sản phẩm ${singleSku} thành công.` });
    }

    // Bulk delete via JSON body
    const body = await req.json().catch(() => ({}));
    const skus: string[] = Array.isArray(body?.skus) ? body.skus : [];

    if (skus.length === 0) {
      return NextResponse.json(
        { error: "Vui lòng chọn ít nhất 1 sản phẩm để xóa." },
        { status: 400 }
      );
    }

    const result = await bulkDeleteProducts(skus);

    const message =
      result.rejectedCount === 0
        ? `Đã xóa thành công ${result.deletedCount}/${skus.length} sản phẩm.`
        : `Đã xóa thành công ${result.deletedCount}/${skus.length} sản phẩm. ${result.rejectedCount} mục bị từ chối.`;

    return NextResponse.json({ success: true, message, ...result });
  } catch (err) {
    return handleApiError(err, "Xóa sản phẩm thất bại.");
  }
}
