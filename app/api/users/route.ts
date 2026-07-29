import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { redis } from "@/lib/redis";
import { User, UserRole } from "@/lib/types";
import { authorize, handleApiError } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const { response } = authorize(req, ["ADMIN"]);
  if (response) return response;

  try {
    const raw = await redis.get<User[] | string>("users");
    const users: User[] = raw
      ? typeof raw === "string"
        ? JSON.parse(raw)
        : raw
      : [];

    const sanitizedUsers = users.map(({ passwordHash, ...user }) => user);
    return NextResponse.json(sanitizedUsers);
  } catch (err) {
    return handleApiError(err, "Không thể tải danh sách tài khoản người dùng.");
  }
}

export async function POST(req: NextRequest) {
  const { response } = authorize(req, ["ADMIN"]);
  if (response) return response;

  try {
    const body = await req.json();
    const { username, password, role } = body;

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

    const raw = await redis.get<User[] | string>("users");
    const users: User[] = raw
      ? typeof raw === "string"
        ? JSON.parse(raw)
        : raw
      : [];

    if (users.some((u) => u.username.toLowerCase() === username.trim().toLowerCase())) {
      return NextResponse.json(
        { error: `Tên đăng nhập '${username}' đã tồn tại trong hệ thống.` },
        { status: 400 }
      );
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const newUser: User = {
      id: `usr_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      username: username.trim(),
      passwordHash,
      role,
      createdAt: new Date().toISOString(),
    };

    users.push(newUser);
    await redis.set("users", users);

    const { passwordHash: _, ...sanitized } = newUser;
    return NextResponse.json(sanitized);
  } catch (err) {
    return handleApiError(err, "Tạo tài khoản người dùng mới thất bại.");
  }
}

export async function PATCH(req: NextRequest) {
  const { response } = authorize(req, ["ADMIN"]);
  if (response) return response;

  try {
    const body = await req.json();
    const { id, role, password } = body;

    if (!id) {
      return NextResponse.json({ error: "Mã người dùng (id) là bắt buộc." }, { status: 400 });
    }

    const raw = await redis.get<User[] | string>("users");
    const users: User[] = raw
      ? typeof raw === "string"
        ? JSON.parse(raw)
        : raw
      : [];

    const userIndex = users.findIndex((u) => u.id === id);
    if (userIndex === -1) {
      return NextResponse.json({ error: "Không tìm thấy người dùng." }, { status: 400 });
    }

    const targetUser = users[userIndex];

    if (role) {
      const validRoles: UserRole[] = ["ADMIN", "DISPATCHER", "VIEWER"];
      if (!validRoles.includes(role)) {
        return NextResponse.json({ error: "Vai trò không hợp lệ." }, { status: 400 });
      }
      targetUser.role = role;
    }

    if (password && password.trim().length > 0) {
      targetUser.passwordHash = await bcrypt.hash(password, 10);
    }

    users[userIndex] = targetUser;
    await redis.set("users", users);

    const { passwordHash: _, ...sanitized } = targetUser;
    return NextResponse.json(sanitized);
  } catch (err) {
    return handleApiError(err, "Cập nhật người dùng thất bại.");
  }
}
