"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import POPipelineMatrix from "@/components/POPipelineMatrix";

function PipelineContent() {
  const searchParams = useSearchParams();
  const poId = searchParams.get("poId") || undefined;

  return <POPipelineMatrix initialPoId={poId} />;
}

export default function PipelinePage() {
  return (
    <Suspense fallback={<div className="p-6 text-xs text-txt-secondary">Đang tải tiến độ PO...</div>}>
      <PipelineContent />
    </Suspense>
  );
}
