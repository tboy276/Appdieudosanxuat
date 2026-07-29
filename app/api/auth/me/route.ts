import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const { user, response } = authorize(req);
  if (response) return response;

  return NextResponse.json({ user });
}
