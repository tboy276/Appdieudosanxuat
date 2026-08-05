import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { supabaseAdmin } from "@/lib/supabase";
import { UserRole } from "@/lib/types";
import { authorize, handleApiError } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const { response } = authorize(req, ["ADMIN"]);
  if (response) return response;

  try {
    const { data: pgUsers, error: pgErr } = await supabaseAdmin
      .from("users")
      .select("id, username, full_name, role, status, created_at")
      .order("created_at", { ascending: true });

    if (pgErr) {
      throw new Error(`Lỗi PostgreSQL khi tải danh sách người dùng: ${pgErr.message}`);
    }

    const sanitized = (pgUsers || []).map((u) => ({
      id: u.id,
      username: u.username,
      fullName: u.full_name || u.username,
      role: u.role,
      status: u.status,
      createdAt: u.created_at,
    }));

    return NextResponse.json(sanitized);
  } catch (err) {
    return handleApiError(err, "Không thể tải danh sách tài khoản người dùng.");
  }
}

export async function POST(req: NextRequest) {
  const { response } = authorize(req, ["ADMIN"]);
  if (response) return response;

  try {
    const body = await req.json();
    const { username, password, role, fullName } = body;

    if (!username || !password || !role) {
      return NextResponse.json(
        { error: "Tên đăng nhập, mật khẩu và vai trò (role) là bắt buộc." },
        { status: 400 }
      );
    }

    const validRoles: UserRole[] = ["ADMIN", "DISPATCHER", "VIEWER"];
    if (!validRoles.includes(role)) {
      return NextResponse.json(
        { error: `Vai trò '${role}' không hợp lệ. Phải là ADMIN, DISPATCHER hoặc VIEWER.` },
        { status: 400 }
      );
    }

    const cleanUsername = username.trim();
    const passwordHash = await bcrypt.hash(password, 10);

    // Check duplicate in Supabase PostgreSQL
    const { data: existingPg } = await supabaseAdmin
      .from("users")
      .select("id")
      .ilike("username", cleanUsername)
      .maybeSingle();

    if (existingPg) {
      return NextResponse.json(
        { error: `Tên đăng nhập '${cleanUsername}' đã tồn tại trong hệ thống.` },
        { status: 400 }
      );
    }

    // Insert into PostgreSQL
    const { data: newUserPg, error: insertErr } = await supabaseAdmin
      .from("users")
      .insert({
        username: cleanUsername,
        password_hash: passwordHash,
        full_name: fullName || cleanUsername,
        role,
        status: "ACTIVE",
      })
      .select("id, username, full_name, role, status, created_at")
      .single();

    if (insertErr) {
      throw new Error(`Lỗi PostgreSQL khi khởi tạo tài khoản mới: ${insertErr.message}`);
    }

    return NextResponse.json({
      id: newUserPg.id,
      username: newUserPg.username,
      fullName: newUserPg.full_name,
      role: newUserPg.role,
      status: newUserPg.status,
      createdAt: newUserPg.created_at,
    });
  } catch (err) {
    return handleApiError(err, "Tạo tài khoản người dùng mới thất bại.");
  }
}

export async function PATCH(req: NextRequest) {
  const { response } = authorize(req, ["ADMIN"]);
  if (response) return response;

  try {
    const body = await req.json();
    const { id, username, role, password, status } = body;

    if (!id && !username) {
      return NextResponse.json(
        { error: "Mã người dùng (id) hoặc Tên đăng nhập (username) là bắt buộc." },
        { status: 400 }
      );
    }

    const updates: any = {};
    if (role) {
      const validRoles: UserRole[] = ["ADMIN", "DISPATCHER", "VIEWER"];
      if (!validRoles.includes(role)) {
        return NextResponse.json({ error: "Vai trò không hợp lệ." }, { status: 400 });
      }
      updates.role = role;
    }

    if (status) {
      if (status !== "ACTIVE" && status !== "LOCKED") {
        return NextResponse.json({ error: "Trạng thái không hợp lệ (phải là ACTIVE hoặc LOCKED)." }, { status: 400 });
      }
      updates.status = status;
    }

    if (password && password.trim().length > 0) {
      updates.password_hash = await bcrypt.hash(password.trim(), 10);
    }

    // Update in Supabase PostgreSQL
    let query = supabaseAdmin.from("users").update(updates);
    if (id) {
      query = query.eq("id", id);
    } else if (username) {
      query = query.ilike("username", String(username).trim());
    }

    const { data: updatedPg, error: updateErr } = await query
      .select("id, username, full_name, role, status, created_at")
      .maybeSingle();

    if (updateErr) {
      throw new Error(`Lỗi PostgreSQL khi cập nhật thông tin người dùng: ${updateErr.message}`);
    }

    if (!updatedPg) {
      return NextResponse.json({ error: "Không tìm thấy người dùng." }, { status: 400 });
    }

    return NextResponse.json({
      id: updatedPg.id,
      username: updatedPg.username,
      fullName: updatedPg.full_name,
      role: updatedPg.role,
      status: updatedPg.status,
      createdAt: updatedPg.created_at,
    });
  } catch (err) {
    return handleApiError(err, "Cập nhật người dùng thất bại.");
  }
}
