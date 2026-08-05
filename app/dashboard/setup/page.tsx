"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function SystemSetupPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/dashboard/products");
  }, [router]);

  return (
    <div className="p-8 text-center text-xs text-txt-secondary">
      Đang chuyển hướng về trang Danh Mục Part No. ...
    </div>
  );
}
