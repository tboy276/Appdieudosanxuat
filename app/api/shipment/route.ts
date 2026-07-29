import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { recordShipment, ShipmentRecord } from "@/lib/po-wo-engine";
import { authorize, handleApiError } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const { response } = authorize(req);
  if (response) return response;

  try {
    const shipmentIds = await redis.smembers("shipments");
    if (!shipmentIds || shipmentIds.length === 0) {
      return NextResponse.json([]);
    }

    const records: ShipmentRecord[] = [];
    for (const id of shipmentIds) {
      const raw = await redis.get<ShipmentRecord | string>(`shipment:${id}`);
      if (raw) {
        records.push(typeof raw === "string" ? JSON.parse(raw) : raw);
      }
    }

    return NextResponse.json(records);
  } catch (err) {
    return handleApiError(err, "Không thể tải danh sách chuyến xuất hàng.");
  }
}

export async function POST(req: NextRequest) {
  const { user, response } = authorize(req, ["ADMIN", "DISPATCHER"]);
  if (response) return response;

  try {
    const body = await req.json();
    const { woIds, qtyByWoId, shipmentMeta } = body;

    if (!woIds || !Array.isArray(woIds) || woIds.length === 0 || !qtyByWoId) {
      return NextResponse.json(
        { error: "Mảng woIds và qtyByWoId là bắt buộc." },
        { status: 400 }
      );
    }

    const record = await recordShipment(woIds, qtyByWoId, user!.username, shipmentMeta);
    return NextResponse.json(record);
  } catch (err) {
    return handleApiError(err, "Ghi nhận xuất hàng thất bại.");
  }
}
