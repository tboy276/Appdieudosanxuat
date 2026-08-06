import { NextRequest, NextResponse } from "next/server";
import { createShipment, listShipments, getShipment } from "@/lib/shipment";
import { recordShipment } from "@/lib/wo-postgres";
import { authorize, handleApiError } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const { response } = authorize(req);
  if (response) return response;

  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (id) {
      const detail = await getShipment(id);
      if (!detail) {
        return NextResponse.json({ error: "Không tìm thấy thông tin phiếu xuất." }, { status: 404 });
      }
      return NextResponse.json(detail);
    }

    const customerId = searchParams.get("customerId") || undefined;
    const search = searchParams.get("search") || undefined;

    const shipments = await listShipments({ customerId, search });
    return NextResponse.json(shipments);
  } catch (err) {
    return handleApiError(err, "Không thể tải danh sách chuyến xuất hàng.");
  }
}

export async function POST(req: NextRequest) {
  const { user, response } = authorize(req, ["ADMIN", "DISPATCHER"]);
  if (response) return response;

  try {
    const body = await req.json();

    // 1. Support WO-based shipment creation (from WO dashboard)
    if (body.woIds && Array.isArray(body.woIds) && body.qtyByWoId) {
      const record = await recordShipment(body.woIds, body.qtyByWoId, user!.username, body.shipmentMeta);
      return NextResponse.json(record);
    }

    // 2. Support Customer Shipment creation (from Customer Shipment dashboard)
    const {
      customerId,
      items,
      note,
      extraData,
      shipDate,
      customerAddress,
      customerPhone,
      deliveryTime,
      creatorName,
      creatorTitle,
    } = body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { error: "Danh sách mặt hàng xuất (items) là bắt buộc." },
        { status: 400 }
      );
    }

    const mergedExtra = extraData || {
      shipDate,
      customerAddress,
      customerPhone,
      deliveryTime,
      creatorName,
      creatorTitle,
      generalNote: note,
    };

    const record = await createShipment(customerId || "", items, user!.username, mergedExtra);
    return NextResponse.json(record);
  } catch (err) {
    return handleApiError(err, "Ghi nhận xuất hàng thất bại.");
  }
}
