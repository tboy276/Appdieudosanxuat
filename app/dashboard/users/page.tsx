"use client";

import { useState } from "react";
import useSWR from "swr";
import {
  Users,
  UserPlus,
  Lock,
  Unlock,
  KeyRound,
  ShieldAlert,
  CheckCircle2,
  AlertTriangle,
  X,
  UserCheck,
} from "lucide-react";
import { useSession } from "@/hooks/useSession";
import { UserRole } from "@/lib/types";

interface UserAccount {
  username: string;
  role: UserRole;
  status: "ACTIVE" | "LOCKED";
  createdAt?: string;
}

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export default function UsersPage() {
  const { user, isAdmin, isLoading: isSessionLoading } = useSession();
  const { data: usersData, mutate } = useSWR<UserAccount[]>("/api/users", fetcher);
  const users = Array.isArray(usersData) ? usersData : [];

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isResetModalOpen, setIsResetModalOpen] = useState(false);

  // Form State
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<UserRole>("DISPATCHER");

  // Reset Password State
  const [selectedUserForReset, setSelectedUserForReset] = useState<string>("");
  const [resetPasswordVal, setResetPasswordVal] = useState("");

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [successToast, setSuccessToast] = useState("");

  // 1. Block access for non-ADMIN users (403 Forbidden View)
  if (!isSessionLoading && !isAdmin) {
    return (
      <div className="max-w-xl mx-auto mt-12 p-6 rounded bg-amber-50 border border-amber-200 text-amber-900 space-y-3 text-center">
        <ShieldAlert className="w-10 h-10 text-amber-600 mx-auto" />
        <h2 className="text-base font-bold">403 Forbidden - Truy Cập Bị Từ Chối</h2>
        <p className="text-xs text-amber-800">
          Chỉ tài khoản quản trị hệ thống (<strong className="font-mono">ADMIN</strong>) mới có quyền xem và thao tác trên trang Quản Lý Người Dùng.
        </p>
      </div>
    );
  }

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");
    setSuccessToast("");

    if (!newUsername.trim() || !newPassword.trim()) {
      setErrorMsg("Vui lòng nhập đầy đủ Tên đăng nhập và Mật khẩu.");
      return;
    }

    setIsSubmitting(true);

    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: newUsername.trim(),
          password: newPassword.trim(),
          role: newRole,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || "Tạo tài khoản người dùng thất bại.");
        setIsSubmitting(false);
        return;
      }

      setSuccessToast(`Đã tạo thành công tài khoản '${newUsername}' với vai trò ${newRole}.`);
      setIsCreateModalOpen(false);
      setNewUsername("");
      setNewPassword("");
      setNewRole("DISPATCHER");
      mutate();
    } catch {
      setErrorMsg("Không thể kết nối tới máy chủ.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleLockUser = async (targetUser: UserAccount) => {
    const nextStatus = targetUser.status === "ACTIVE" ? "LOCKED" : "ACTIVE";
    const actionLabel = nextStatus === "LOCKED" ? "khóa" : "mở khóa";

    if (!confirm(`Bạn có chắc chắn muốn ${actionLabel} tài khoản '${targetUser.username}'?`)) {
      return;
    }

    try {
      const res = await fetch("/api/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: targetUser.username,
          status: nextStatus,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Cập nhật trạng thái thất bại.");
        return;
      }

      setSuccessToast(`Đã ${actionLabel} thành công tài khoản '${targetUser.username}'.`);
      mutate();
    } catch {
      alert("Đã xảy ra lỗi kết nối.");
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");

    if (!selectedUserForReset || !resetPasswordVal.trim()) {
      setErrorMsg("Vui lòng nhập mật khẩu mới.");
      return;
    }

    setIsSubmitting(true);

    try {
      const res = await fetch("/api/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: selectedUserForReset,
          password: resetPasswordVal.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || "Reset mật khẩu thất bại.");
        setIsSubmitting(false);
        return;
      }

      setSuccessToast(`Đã reset mật khẩu mới thành công cho tài khoản '${selectedUserForReset}'.`);
      setIsResetModalOpen(false);
      setSelectedUserForReset("");
      setResetPasswordVal("");
      mutate();
    } catch {
      setErrorMsg("Không thể kết nối đến máy chủ.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header & Actions */}
      <div className="flex items-center justify-between p-4 rounded bg-canvas border border-border">
        <div className="flex items-center gap-2">
          <Users className="w-5 h-5 text-txt-secondary" />
          <h2 className="text-sm font-semibold text-txt-primary">Quản Lý Người Dùng & Phân Quyền Hống</h2>
        </div>

        <button
          onClick={() => {
            setErrorMsg("");
            setIsCreateModalOpen(true);
          }}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-accent text-white text-xs font-medium hover:opacity-90 transition-opacity"
        >
          <UserPlus className="w-4 h-4" />
          <span>Tạo Tài Khoản Mới</span>
        </button>
      </div>

      {/* Success Toast */}
      {successToast && (
        <div className="p-3 rounded bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{successToast}</span>
          </div>
          <button onClick={() => setSuccessToast("")} className="text-emerald-700 hover:text-emerald-900">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* User Table */}
      <div className="border border-border rounded bg-canvas overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs tabular-nums border-collapse">
            <thead>
              <tr className="bg-subtle border-b border-border text-txt-secondary text-[11px] font-semibold uppercase">
                <th className="py-3 px-4">Tên Đăng Nhập</th>
                <th className="py-3 px-4">Vai Trò (Role)</th>
                <th className="py-3 px-4 text-center">Trạng Thái</th>
                <th className="py-3 px-4 text-right">Thao Tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {users.map((u) => {
                const isLocked = u.status === "LOCKED";
                const isCurrentSelf = user?.username === u.username;

                return (
                  <tr key={u.username} className={`hover:bg-subtle ${isLocked ? "bg-amber-50/30" : ""}`}>
                    <td className="py-3 px-4 font-mono font-bold text-txt-primary">
                      <div className="flex items-center gap-2">
                        <span>{u.username}</span>
                        {isCurrentSelf && (
                          <span className="px-1.5 py-0.5 rounded bg-subtle border border-border text-[10px] text-txt-secondary font-normal">
                            (Chính bạn)
                          </span>
                        )}
                      </div>
                    </td>

                    <td className="py-3 px-4">
                      <span className="font-semibold text-txt-primary">{u.role}</span>
                    </td>

                    <td className="py-3 px-4 text-center">
                      <span
                        className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded text-[10px] font-semibold ${
                          isLocked
                            ? "bg-amber-50 border border-amber-200 text-amber-800"
                            : "bg-emerald-50 border border-emerald-200 text-emerald-800"
                        }`}
                      >
                        {isLocked ? <Lock className="w-3 h-3" /> : <UserCheck className="w-3 h-3" />}
                        <span>{u.status}</span>
                      </span>
                    </td>

                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {/* Lock / Unlock */}
                        {!isCurrentSelf && (
                          <button
                            onClick={() => handleToggleLockUser(u)}
                            className={`p-1.5 rounded border text-xs font-medium transition-colors ${
                              isLocked
                                ? "bg-emerald-50 border-emerald-200 text-emerald-800 hover:bg-emerald-100"
                                : "bg-subtle border-border text-txt-secondary hover:text-txt-primary hover:bg-border"
                            }`}
                            title={isLocked ? "Mở khóa tài khoản" : "Khóa tài khoản"}
                          >
                            {isLocked ? <Unlock className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
                          </button>
                        )}

                        {/* Reset Password */}
                        <button
                          onClick={() => {
                            setSelectedUserForReset(u.username);
                            setResetPasswordVal("");
                            setErrorMsg("");
                            setIsResetModalOpen(true);
                          }}
                          className="p-1.5 rounded bg-subtle border border-border text-txt-secondary hover:text-txt-primary hover:bg-border transition-colors"
                          title="Reset mật khẩu"
                        >
                          <KeyRound className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create User Modal */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-canvas border border-border rounded shadow-lg max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="text-sm font-bold text-txt-primary">Tạo Tài Khoản Người Dùng Mới</h3>
              <button onClick={() => setIsCreateModalOpen(false)} className="text-txt-secondary hover:text-txt-primary">
                <X className="w-4 h-4" />
              </button>
            </div>

            {errorMsg && (
              <div className="p-3 rounded bg-amber-50 border border-amber-200 text-warning text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            <form onSubmit={handleCreateUser} className="space-y-3 text-xs">
              <div className="space-y-1">
                <label className="font-medium text-txt-secondary">Tên Đăng Nhập (*):</label>
                <input
                  type="text"
                  required
                  placeholder="VD: dispatcher01"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  className="w-full px-3 py-1.5 bg-canvas border border-border rounded text-txt-primary font-mono focus:outline-none focus:border-accent"
                />
              </div>

              <div className="space-y-1">
                <label className="font-medium text-txt-secondary">Mật Khẩu Tạm (*):</label>
                <input
                  type="password"
                  required
                  placeholder="Nhập mật khẩu..."
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full px-3 py-1.5 bg-canvas border border-border rounded text-txt-primary focus:outline-none focus:border-accent"
                />
              </div>

              <div className="space-y-1">
                <label className="font-medium text-txt-secondary">Vai Trò (Role) (*):</label>
                <select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value as UserRole)}
                  className="w-full px-3 py-1.5 bg-canvas border border-border rounded text-txt-primary focus:outline-none focus:border-accent"
                >
                  <option value="DISPATCHER">DISPATCHER (Điều độ viên - Nhập liệu)</option>
                  <option value="ADMIN">ADMIN (Quản trị viên toàn quyền)</option>
                  <option value="VIEWER">VIEWER (Khách xem - Chỉ đọc)</option>
                </select>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-border">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="px-4 py-1.5 rounded bg-subtle border border-border text-txt-primary hover:bg-border"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-1.5 rounded bg-accent text-white font-medium hover:opacity-90 disabled:opacity-40"
                >
                  {isSubmitting ? "Đang tạo..." : "Tạo Tài Khoản"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reset Password Modal */}
      {isResetModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-canvas border border-border rounded shadow-lg max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="text-sm font-bold text-txt-primary">Reset Mật Khẩu Tùy Chỉnh</h3>
              <button onClick={() => setIsResetModalOpen(false)} className="text-txt-secondary hover:text-txt-primary">
                <X className="w-4 h-4" />
              </button>
            </div>

            {errorMsg && (
              <div className="p-3 rounded bg-amber-50 border border-amber-200 text-warning text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            <form onSubmit={handleResetPassword} className="space-y-3 text-xs">
              <div className="space-y-1">
                <label className="font-medium text-txt-secondary">Tài Khoản Đang Reset:</label>
                <input
                  type="text"
                  disabled
                  value={selectedUserForReset}
                  className="w-full px-3 py-1.5 bg-subtle border border-border rounded text-txt-primary font-mono"
                />
              </div>

              <div className="space-y-1">
                <label className="font-medium text-txt-secondary">Mật Khẩu Mới (*):</label>
                <input
                  type="password"
                  required
                  placeholder="Nhập mật khẩu mới..."
                  value={resetPasswordVal}
                  onChange={(e) => setResetPasswordVal(e.target.value)}
                  className="w-full px-3 py-1.5 bg-canvas border border-border rounded text-txt-primary focus:outline-none focus:border-accent"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-border">
                <button
                  type="button"
                  onClick={() => setIsResetModalOpen(false)}
                  className="px-4 py-1.5 rounded bg-subtle border border-border text-txt-primary hover:bg-border"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-1.5 rounded bg-accent text-white font-medium hover:opacity-90 disabled:opacity-40"
                >
                  {isSubmitting ? "Đang xử lý..." : "Đổi Mật Khẩu"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
