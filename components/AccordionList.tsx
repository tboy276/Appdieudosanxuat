"use client";

import { useState, ReactNode } from "react";
import { ChevronRight } from "lucide-react";

export interface AccordionGroup<T> {
  id: string;
  title: string;
  count?: number;
  items: T[];
}

interface AccordionListProps<T> {
  groups?: AccordionGroup<T>[];
  items?: T[];
  getItemKey: (item: T) => string;
  renderHeader: (item: T, isOpen: boolean) => ReactNode;
  renderDetail: (item: T) => ReactNode;
  emptyMessage?: string;
  defaultExpandedKeys?: string[];
}

export default function AccordionList<T>({
  groups,
  items,
  getItemKey,
  renderHeader,
  renderDetail,
  emptyMessage = "Không có dữ liệu hiển thị.",
  defaultExpandedKeys = [],
}: AccordionListProps<T>) {
  const [openKeys, setOpenKeys] = useState<Set<string>>(new Set(defaultExpandedKeys));

  const toggleKey = (key: string) => {
    setOpenKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const renderSingleList = (itemList: T[]) => {
    if (!itemList || itemList.length === 0) {
      return (
        <div className="py-8 text-center text-xs text-txt-secondary border border-border rounded bg-canvas">
          {emptyMessage}
        </div>
      );
    }

    return (
      <div className="divide-y divide-border border border-border rounded bg-canvas overflow-hidden">
        {itemList.map((item) => {
          const key = getItemKey(item);
          const isOpen = openKeys.has(key);

          return (
            <div key={key} className="transition-colors">
              {/* Item Header */}
              <div
                onClick={() => toggleKey(key)}
                className={`flex items-center justify-between px-4 py-3 cursor-pointer select-none transition-colors hover:bg-subtle ${
                  isOpen ? "bg-subtle border-l-2 border-l-accent" : ""
                }`}
              >
                <div className="flex-1 pr-4">{renderHeader(item, isOpen)}</div>
                <ChevronRight
                  className={`w-4 h-4 text-txt-secondary transition-transform duration-200 ${
                    isOpen ? "rotate-90 text-txt-primary" : ""
                  }`}
                />
              </div>

              {/* Item Detail (Collapsible) */}
              {isOpen && (
                <div className="px-5 py-4 bg-canvas border-t border-border space-y-3">
                  {renderDetail(item)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  if (groups && groups.length > 0) {
    return (
      <div className="space-y-6">
        {groups.map((group) => (
          <div key={group.id} className="space-y-2">
            {/* Section Divider Band */}
            <div className="flex items-center justify-between px-3 h-8 rounded bg-subtle text-[11px] font-semibold uppercase tracking-wider text-txt-secondary">
              <span>{group.title}</span>
              {group.count !== undefined && (
                <span className="px-2 py-0.5 rounded bg-canvas text-txt-primary font-bold text-[10px]">
                  {group.count}
                </span>
              )}
            </div>

            {/* Section List */}
            {renderSingleList(group.items)}
          </div>
        ))}
      </div>
    );
  }

  return renderSingleList(items || []);
}
