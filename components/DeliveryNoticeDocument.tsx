"use client";

import React from "react";
import { DeliveryNoticeData, formatFullVNDate } from "@/lib/delivery-notice";

interface DeliveryNoticeDocumentProps {
  data: DeliveryNoticeData;
}

/**
 * DISOCO Official Logo SVG Component
 */
export function DisocoLogo({ className = "w-36 h-14" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 200 80"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="DISOCO Logo"
    >
      {/* Outer Blue Oval */}
      <ellipse cx="100" cy="40" rx="90" ry="34" fill="#18367a" />
      {/* Curved White Ring Orbit */}
      <path
        d="M 28 48 C 55 64, 145 64, 172 32 C 150 24, 60 22, 28 48 Z"
        fill="none"
        stroke="#ffffff"
        strokeWidth="3"
        opacity="0.9"
      />
      {/* White Bold Italic DISOCO Text */}
      <text
        x="100"
        y="50"
        fontFamily="'Arial Black', 'Impact', sans-serif"
        fontWeight="900"
        fontStyle="italic"
        fontSize="30"
        fill="#ffffff"
        textAnchor="middle"
        letterSpacing="2"
      >
        DISOCO
      </text>
    </svg>
  );
}

export default function DeliveryNoticeDocument({ data }: DeliveryNoticeDocumentProps) {
  const dateInfo = formatFullVNDate(data.shipDate);
  const items = data.items || [];
  const poNumbersList = (data.poNumbers && data.poNumbers.length > 0)
    ? data.poNumbers.join(", ")
    : Array.from(new Set(items.map((i) => i.poNumber).filter(Boolean))).join(", ");

  // Pad to minimum 4 rows as in BM/05-000-005 sample
  const minRows = 4;
  const paddedItems = [...items];
  while (paddedItems.length < minRows) {
    paddedItems.push({
      stt: paddedItems.length + 1,
      poNumber: "",
      sku: "",
      productNameVi: "",
      unit: "",
      shippedQty: 0,
      location: "",
      notes: "",
    });
  }

  return (
    <div
      id="delivery-notice-print-area"
      className="bg-white text-black font-['Times_New_Roman',Times,serif] leading-relaxed p-8 sm:p-12 max-w-[210mm] mx-auto min-h-[297mm] flex flex-col justify-between select-text shadow-sm print:shadow-none print:p-0 print:m-0 print:w-full print:min-h-0"
      style={{ boxSizing: "border-box" }}
    >
      <div>
        {/* TOP ROW: LOGO & HEADER */}
        <div className="flex items-start justify-between">
          <div className="pt-1">
            <DisocoLogo className="w-32 h-12" />
          </div>
          <div className="text-center flex-1 pr-6 pt-2">
            <h1 className="text-xl sm:text-2xl font-bold uppercase tracking-wide">
              THÔNG BÁO GIAO HÀNG
            </h1>
          </div>
        </div>

        {/* DATE & NUMBER ROW */}
        <div className="flex items-center justify-between mt-2 text-[14px]">
          <div className="pl-2 font-normal">
            Số:....../.......
          </div>
          <div className="italic text-right">
            Ngày ......... tháng ....... năm 2026
            {data.shipDate && (
              <span className="block not-italic text-[12px] text-gray-500 font-mono print:hidden">
                (Ngày lập: {dateInfo.fullText})
              </span>
            )}
          </div>
        </div>

        {/* RECIPIENT & REASON */}
        <div className="mt-4 space-y-1.5 text-[14px]">
          <p className="font-bold italic">
            Kính gửi:. Phòng Thị trường & Bán hàng
          </p>

          <div className="space-y-1 pl-1">
            <div className="flex items-baseline">
              <span className="shrink-0">- Căn cứ hợp đồng kinh tế/PO số:</span>
              <span className="font-semibold px-2">{poNumbersList || ". . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . ."}</span>
              <span className="flex-1 border-b border-dotted border-gray-400 min-w-[20px] print:border-black"></span>
            </div>

            <div className="flex items-baseline">
              <span className="shrink-0">- Tên khách hàng:</span>
              <span className="font-semibold px-2">{data.customerName || ". . . . . . . . . . . . . . . . . . . . . . . . . . . . . ."}</span>
              <span className="flex-1 border-b border-dotted border-gray-400 min-w-[20px] print:border-black"></span>
            </div>

            <div className="flex items-baseline">
              <span className="shrink-0">- Địa chỉ:</span>
              <span className="font-normal px-2">{data.customerAddress || ". . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . ."}</span>
              <span className="flex-1 border-b border-dotted border-gray-400 min-w-[20px] print:border-black"></span>
            </div>

            <div className="flex items-baseline">
              <span className="shrink-0">- Điện thoại:</span>
              <span className="font-normal px-2">{data.customerPhone || ". . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . ."}</span>
              <span className="flex-1 border-b border-dotted border-gray-400 min-w-[20px] print:border-black"></span>
            </div>

            <p className="pt-1">
              - Phòng SX đề nghị giao hàng theo danh mục, số lượng sau:
            </p>
          </div>
        </div>

        {/* SECTION 1: ITEMS TABLE */}
        <div className="mt-3">
          <p className="font-bold text-[14px] mb-1.5">
            1. Danh mục hàng hoá, số lượng giao hàng:
          </p>

          <table className="w-full border-collapse border border-black text-[13px] text-black">
            <thead>
              <tr className="bg-gray-50 print:bg-transparent font-bold">
                <th className="border border-black px-2 py-1.5 text-center w-10">STT</th>
                <th className="border border-black px-3 py-1.5 text-center">Tên gọi và ký hiệu</th>
                <th className="border border-black px-2 py-1.5 text-center w-24">Số PO</th>
                <th className="border border-black px-2 py-1.5 text-center w-16">
                  Đơn vị<br />tính
                </th>
                <th className="border border-black px-2 py-1.5 text-center w-20">
                  Số<br />lượng
                </th>
                <th className="border border-black px-2 py-1.5 text-center w-24">Nơi lấy hàng</th>
                <th className="border border-black px-2 py-1.5 text-center w-24">Ghi chú</th>
              </tr>
            </thead>
            <tbody>
              {paddedItems.map((item, idx) => {
                const isRealItem = idx < items.length;
                const isFirstRow = idx === 0;

                return (
                  <tr key={idx} className="min-h-[32px]">
                    <td
                      className={`border border-black px-2 py-2 text-center font-bold ${
                        idx > 0 && !isRealItem ? "text-red-600 font-bold" : ""
                      }`}
                    >
                      {idx + 1}
                    </td>
                    <td className="border border-black px-3 py-2 text-left">
                      {isRealItem ? (
                        <span className="font-bold">
                          {item.productNameVi || item.sku}
                          {item.productNameVi && item.sku && (
                            <span className="font-normal text-[12px] text-gray-700 block">
                              ({item.sku})
                            </span>
                          )}
                        </span>
                      ) : (
                        ""
                      )}
                    </td>
                    <td className="border border-black px-2 py-2 text-center font-mono text-[12px]">
                      {isRealItem ? item.poNumber : ""}
                    </td>
                    <td className="border border-black px-2 py-2 text-center font-normal">
                      {isRealItem ? item.unit || "Cái" : ""}
                    </td>
                    <td className="border border-black px-2 py-2 text-center font-bold">
                      {isRealItem ? item.shippedQty.toLocaleString() : ""}
                    </td>
                    <td className="border border-black px-2 py-2 text-center font-bold text-red-600">
                      {isRealItem ? "Kho TP" : ""}
                    </td>
                    <td className="border border-black px-2 py-2 text-left text-[12px]">
                      {isRealItem ? item.notes || "" : ""}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* SECTION 2: DELIVERY TIME */}
        <div className="mt-4 text-[14px]">
          <div className="flex items-baseline">
            <span className="font-bold shrink-0">2. Thời gian giao hàng:</span>
            <span className="px-2 font-normal">
              {data.deliveryTime || ". . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . ."}
            </span>
            <span className="flex-1 border-b border-dotted border-gray-400 min-w-[20px] print:border-black"></span>
          </div>
        </div>

        {/* SIGNATURE SECTION */}
        <div className="mt-6 grid grid-cols-2 gap-8 text-[14px]">
          {/* PHÒNG SẢN XUẤT */}
          <div className="text-center">
            <p className="font-bold uppercase tracking-wide">PHÒNG SẢN XUẤT</p>
            {/* Blank space for handwritten signature */}
            <div className="h-20 print:h-24"></div>
            <div className="text-left pl-4 space-y-1">
              <p className="italic">
                Họ tên: <span className="not-italic font-medium">{data.creatorName || "Đỗ Như Ba"}</span>
              </p>
              <p className="italic">
                Chức danh : <span className="not-italic font-medium">{data.creatorTitle || "P.PSX"}</span>
              </p>
            </div>
          </div>

          {/* ĐƠN VỊ NHẬN THÔNG BÁO */}
          <div className="text-center">
            <p className="font-bold uppercase tracking-wide">ĐƠN VỊ NHẬN THÔNG BÁO</p>
            {/* Blank space for handwritten signature */}
            <div className="h-20 print:h-24"></div>
            <div className="text-left pl-4 space-y-1">
              <p className="italic">
                Họ tên: .................................
              </p>
              <p className="italic">
                Chức danh: ……………….
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* FOOTER: BM/05-000-005 ISO STANDARD */}
      <div className="mt-8 pt-2 border-t border-black text-[12px] italic text-black">
        <div className="flex items-center justify-between">
          <div>
            <p>BM/05-000-005</p>
            <p>Ban hành lần: 1</p>
          </div>
          <div className="text-center">
            <p>Ban hành ngày 01/7/2024</p>
          </div>
          <div className="text-right">
            <p>Trang số: 1/1</p>
          </div>
        </div>
      </div>
    </div>
  );
}
