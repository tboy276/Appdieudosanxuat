"use client";

import { useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import {
  Search,
  Bell,
  CalendarDays,
  User as UserIcon,
  LogOut,
  ChevronDown,
  X,
  Plus,
} from "lucide-react";
import { UserRole } from "@/lib/types";

interface HeaderProps {
  user?: {
    username: string;
    role: UserRole;
  };
  title?: string;
  onSearch?: (query: string) => void;
  onDateChange?: (date: string) => void;
  onPrimaryAction?: () => void;
  primaryActionLabel?: string;
}

const PATH_TITLES: Record<string, string> = {
  "/dashboard": "Tổng Quan Sản Xuất",
  "/dashboard/xnt": "Bảng Cân Bằng Xuất - Nhập - Tồn Real-time",
  "/dashboard/products": "Quản Lý Danh Mục Sản Phẩm & Routing",
  "/dashboard/po": "Quản Lý Đơn Hàng PO",
  "/dashboard/wo": "Quản Lý Lệnh Sản Xuất WO",
  "/dashboard/production": "Nhập Sản Lượng & Chuyển Phôi Xưởng",
  "/dashboard/shipment": "Quản Lý Xuất Hàng",
  "/dashboard/users": "Quản Lý Tài Khoản Người Dùng",
};

export default function Header({
  user,
  title,
  onSearch,
  onDateChange,
  onPrimaryAction,
  primaryActionLabel,
}: HeaderProps) {
  const router = useRouter();
  const pathname = usePathname();

  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);

  const displayTitle = title || PATH_TITLES[pathname] || "Quản Lý & Điều Độ Sản Xuất";

  const handleLogout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.push("/login");
    } catch {
      router.push("/login");
    }
  };

  const initialLetter = user?.username ? user.username.charAt(0).toUpperCase() : "U";

  return (
    <header className="flex items-center justify-between h-14 px-6 bg-canvas border-b border-border sticky top-0 z-10">
      {/* Page Title */}
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold text-txt-primary tracking-tight">{displayTitle}</h1>
      </div>

      {/* Header Controls */}
      <div className="flex items-center gap-3">
        {/* Search Bar */}
        <div className="relative flex items-center">
          {isSearchOpen ? (
            <div className="flex items-center gap-1 bg-subtle border border-border rounded px-2.5 py-1">
              <Search className="w-4 h-4 text-txt-secondary" />
              <input
                type="text"
                autoFocus
                placeholder="Tìm kiếm..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  if (onSearch) onSearch(e.target.value);
                }}
                className="bg-transparent text-sm text-txt-primary focus:outline-none w-44 sm:w-56"
              />
              <button
                onClick={() => {
                  setIsSearchOpen(false);
                  setSearchQuery("");
                  if (onSearch) onSearch("");
                }}
                className="text-txt-secondary hover:text-txt-primary"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setIsSearchOpen(true)}
              className="p-2 rounded text-txt-secondary hover:text-txt-primary hover:bg-subtle transition-colors"
              title="Tìm kiếm"
            >
              <Search className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Notifications */}
        <button
          className="p-2 rounded text-txt-secondary hover:text-txt-primary hover:bg-subtle transition-colors relative"
          title="Thông báo"
        >
          <Bell className="w-4 h-4" />
        </button>

        {/* Primary Action Button (Optional) */}
        {onPrimaryAction && (
          <button
            onClick={onPrimaryAction}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-accent text-white text-xs font-medium hover:opacity-90 transition-opacity"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{primaryActionLabel || "Tạo mới"}</span>
          </button>
        )}

        {/* User Menu Dropdown */}
        <div className="relative">
          <button
            onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
            className="flex items-center gap-2 p-1.5 rounded hover:bg-subtle transition-colors focus:outline-none"
          >
            <div className="flex items-center justify-center w-8 h-8 rounded-full bg-subtle text-txt-primary font-semibold text-xs border border-border">
              {initialLetter}
            </div>
            <div className="hidden sm:flex flex-col text-left">
              <span className="text-xs font-medium text-txt-primary leading-tight">
                {user?.username || "Người dùng"}
              </span>
              <span className="text-[10px] text-txt-secondary leading-tight uppercase font-semibold">
                {user?.role || "VIEWER"}
              </span>
            </div>
            <ChevronDown className="w-3.5 h-3.5 text-txt-secondary hidden sm:block" />
          </button>

          {/* Dropdown Content */}
          {isUserMenuOpen && (
            <div
              className="absolute right-0 mt-2 w-48 bg-canvas border border-border rounded shadow-sm py-1 z-30"
              onMouseLeave={() => setIsUserMenuOpen(false)}
            >
              <div className="px-3 py-2 border-b border-border">
                <p className="text-xs font-medium text-txt-primary">{user?.username}</p>
                <p className="text-[10px] text-txt-secondary uppercase">Vai trò: {user?.role}</p>
              </div>
              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-txt-primary hover:bg-subtle transition-colors text-left"
              >
                <LogOut className="w-3.5 h-3.5 text-txt-secondary" />
                <span>Đăng xuất</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
