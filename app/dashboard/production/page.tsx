"use client";

import { useState } from "react";
import ProductionInputPage from "../input/page";
import PhoiTransferPage from "../transfer/page";
import { Factory, ArrowLeftRight } from "lucide-react";

export default function ProductionHubPage() {
  const [activeTab, setActiveTab] = useState<"input" | "transfer">("input");

  return (
    <div className="space-y-6">
      {/* Segmented Control Header */}
      <div className="flex items-center justify-between p-2 rounded bg-canvas border border-border">
        <div className="flex items-center gap-1 p-1 bg-subtle rounded border border-border w-full sm:w-auto">
          <button
            onClick={() => setActiveTab("input")}
            className={`flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-1.5 rounded text-xs font-medium transition-all ${
              activeTab === "input"
                ? "bg-canvas text-txt-primary shadow-sm border border-border"
                : "text-txt-secondary hover:text-txt-primary"
            }`}
          >
            <Factory className="w-3.5 h-3.5" />
            <span>1. Nhập Sản Lượng Thực Tế</span>
          </button>

          <button
            onClick={() => setActiveTab("transfer")}
            className={`flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-1.5 rounded text-xs font-medium transition-all ${
              activeTab === "transfer"
                ? "bg-canvas text-txt-primary shadow-sm border border-border"
                : "text-txt-secondary hover:text-txt-primary"
            }`}
          >
            <ArrowLeftRight className="w-3.5 h-3.5" />
            <span>2. Xuất Chuyển Phôi Xưởng</span>
          </button>
        </div>
      </div>

      {/* Render Active View */}
      {activeTab === "input" ? <ProductionInputPage /> : <PhoiTransferPage />}
    </div>
  );
}
