import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { WorkCenter } from "@/lib/types";
import { authorize, handleApiError } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const { response } = authorize(req);
  if (response) return response;

  try {
    const raw = await redis.get<WorkCenter[] | string>("workcenters");
    const workcenters: WorkCenter[] = raw
      ? typeof raw === "string"
        ? JSON.parse(raw)
        : raw
      : [];

    return NextResponse.json(workcenters);
  } catch (err) {
    return handleApiError(err, "Không thể tải danh sách xưởng sản xuất.");
  }
}
