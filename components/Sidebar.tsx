"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Package,
  FileText,
  Layers,
  ArrowLeftRight,
  Truck,
  Users,
  PanelLeftClose,
  PanelLeftOpen,
  Factory,
  Workflow,
  Settings,
  History,
} from "lucide-react";
import { UserRole } from "@/lib/types";

interface SidebarProps {
  userRole?: UserRole;
}

interface NavItem {
  label: string;
  href: string;
  icon: any;
  roles?: UserRole[];
}

const NAV_ITEMS: NavItem[] = [
  { label: "Xuất Nhập Tồn theo Xưởng", href: "/dashboard/xnt", icon: BarChart3 },
  { label: "Tiến Độ theo PO", href: "/dashboard/pipeline", icon: Workflow },
  { label: "Danh Mục Part No.", href: "/dashboard/products", icon: Package },
  { label: "Đơn Hàng PO", href: "/dashboard/po", icon: FileText },
  { label: "Lệnh Sản Xuất WO", href: "/dashboard/wo", icon: Layers },
  { label: "Sản Xuất & Chuyển Phôi", href: "/dashboard/production", icon: ArrowLeftRight },
  { label: "Xuất Hàng", href: "/dashboard/shipment", icon: Truck },
  { label: "Lịch Sử Giao Dịch (Admin)", href: "/dashboard/history", icon: History, roles: ["ADMIN"] },
  { label: "Quản Lý Người Dùng", href: "/dashboard/users", icon: Users, roles: ["ADMIN"] },
];

export default function Sidebar({ userRole = "VIEWER" }: SidebarProps) {
  const pathname = usePathname();
  const [isExpanded, setIsExpanded] = useState(false);

  const filteredItems = NAV_ITEMS.filter((item) => {
    if (!item.roles) return true;
    return item.roles.includes(userRole);
  });

  return (
    <aside
      className={`relative flex flex-col h-screen bg-sidebar border-r border-border transition-all duration-200 ease-in-out z-20 ${
        isExpanded ? "w-56" : "w-16"
      }`}
      onMouseEnter={() => setIsExpanded(true)}
      onMouseLeave={() => setIsExpanded(false)}
    >
      {/* Brand Header */}
      <div className="flex items-center h-14 px-4 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-8 h-8 rounded bg-subtle text-txt-primary font-bold">
            <Factory className="w-4 h-4" />
          </div>
          {isExpanded && (
            <span className="text-sm font-semibold tracking-tight text-txt-primary whitespace-nowrap">
              MES-Lite
            </span>
          )}
        </div>
      </div>

      {/* Navigation List */}
      <nav className="flex-1 p-2 space-y-1 overflow-y-auto">
        {filteredItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href || pathname.startsWith(item.href + "/");

          return (
            <Link
              key={item.href}
              href={item.href}
              title={item.label}
              className={`flex items-center h-10 px-3 rounded text-sm transition-colors ${
                isActive
                  ? "bg-subtle text-txt-primary font-medium"
                  : "text-txt-secondary hover:bg-subtle hover:text-txt-primary"
              }`}
            >
              <Icon className="w-5 h-5 min-w-[20px]" />
              {isExpanded && (
                <span className="ml-3 truncate whitespace-nowrap">{item.label}</span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Footer Toggle */}
      <div className="p-2 border-t border-border">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center justify-center w-full h-9 rounded text-txt-secondary hover:bg-subtle hover:text-txt-primary transition-colors"
          title={isExpanded ? "Thu gọn sidebar" : "Mở rộng sidebar"}
        >
          {isExpanded ? <PanelLeftClose className="w-4 h-4" /> : <PanelLeftOpen className="w-4 h-4" />}
        </button>
      </div>
    </aside>
  );
}
