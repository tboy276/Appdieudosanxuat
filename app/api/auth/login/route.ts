import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { signToken, handleApiError } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { username, password } = body;

    if (!username || !password) {
      return NextResponse.json(
        { error: "Vui lòng nhập đầy đủ Tên đăng nhập và Mật khẩu." },
        { status: 400 }
      );
    }

    const cleanUsername = username.trim();

    // Query user record directly from Supabase PostgreSQL public.users table
    const { data: pgUser, error: pgErr } = await supabaseAdmin
      .from("users")
      .select("*")
      .ilike("username", cleanUsername)
      .maybeSingle();

    if (pgErr) {
      console.error("❌ PostgreSQL Users Query Error:", pgErr.message);
      return NextResponse.json(
        { error: `Lỗi kết nối cơ sở dữ liệu khi xác thực: ${pgErr.message}` },
        { status: 500 }
      );
    }

    if (!pgUser) {
      return NextResponse.json(
        { error: "Tên đăng nhập hoặc mật khẩu không chính xác." },
        { status: 401 }
      );
    }

    if (pgUser.status === "INACTIVE") {
      return NextResponse.json(
        { error: "Tài khoản này đã bị khóa. Vui lòng liên hệ Admin." },
        { status: 403 }
      );
    }

    // Verify bcrypt password hash
    const isValid = await bcrypt.compare(password, pgUser.password_hash);
    if (!isValid) {
      return NextResponse.json(
        { error: "Tên đăng nhập hoặc mật khẩu không chính xác." },
        { status: 401 }
      );
    }

    // Sign JWT token
    const tokenPayload = {
      id: pgUser.id,
      username: pgUser.username,
      role: pgUser.role as any,
    };

    const token = signToken(tokenPayload);

    const userResponse = {
      id: pgUser.id,
      username: pgUser.username,
      fullName: pgUser.full_name || pgUser.username,
      role: pgUser.role,
      status: pgUser.status,
      createdAt: pgUser.created_at,
    };

    const res = NextResponse.json({
      success: true,
      token,
      user: userResponse,
    });

    res.cookies.set("mes_token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 86400 * 7, // 7 days
      path: "/",
    });

    return res;
  } catch (err) {
    return handleApiError(err, "Đã xảy ra lỗi hệ thống khi đăng nhập.");
  }
}
