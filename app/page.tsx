import Link from "next/link";
import { Factory, ShieldCheck, Cpu, ArrowRight } from "lucide-react";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-6 bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-slate-100">
      <div className="relative flex place-items-center mb-8">
        <div className="absolute -inset-1 rounded-full bg-gradient-to-r from-blue-600 to-indigo-600 opacity-75 blur-lg"></div>
        <div className="relative flex items-center justify-center w-20 h-20 rounded-full bg-slate-900 border border-slate-700 shadow-2xl">
          <Factory className="w-10 h-10 text-blue-400" />
        </div>
      </div>

      <div className="text-center max-w-2xl space-y-4">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-950/80 border border-blue-800/50 text-blue-300 text-xs font-semibold uppercase tracking-wider">
          <Cpu className="w-3.5 h-3.5" /> MES-Lite Production System
        </div>
        <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl bg-clip-text text-transparent bg-gradient-to-r from-white via-slate-200 to-slate-400">
          Điều Độ & Quản Lý Sản Xuất Cơ Khí
        </h1>
        <p className="text-slate-400 text-base sm:text-lg">
          Hệ thống điều độ sản xuất real-time, cân bằng vật tư tự động và quản lý tiến độ PO/WO cho Nhà máy Cơ khí.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-3xl w-full mt-10">
        <div className="p-5 rounded-xl bg-slate-900/60 border border-slate-800 backdrop-blur">
          <div className="text-blue-400 font-semibold text-sm mb-1">10 Xưởng Sản Xuất</div>
          <p className="text-slate-400 text-xs">Cưa phôi, Đúc 1-2, Rèn 1-2, Cơ khí 1-3, Mạ & Lắp ráp</p>
        </div>
        <div className="p-5 rounded-xl bg-slate-900/60 border border-slate-800 backdrop-blur">
          <div className="text-emerald-400 font-semibold text-sm mb-1">Cân Bằng Atomic</div>
          <p className="text-slate-400 text-xs">Redis Lua Scripts đảm bảo khoá kho chống race condition</p>
        </div>
        <div className="p-5 rounded-xl bg-slate-900/60 border border-slate-800 backdrop-blur">
          <div className="text-amber-400 font-semibold text-sm mb-1">Phân Quyền 3 Vai Trò</div>
          <p className="text-slate-400 text-xs">ADMIN (Toàn quyền), DISPATCHER (Điều độ), VIEWER (Chỉ xem)</p>
        </div>
      </div>

      <div className="mt-10 flex gap-4">
        <Link
          href="/login"
          className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium text-sm transition-all shadow-lg shadow-blue-600/25"
        >
          <ShieldCheck className="w-4 h-4" /> Đăng Nhập Hệ Thống <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    </main>
  );
}
