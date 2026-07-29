# MES-Lite: Hệ Thống Quản Lý & Điều Độ Sản Xuất Cơ Khí Real-time

Hệ thống quản lý và điều độ sản xuất cơ khí tối giản (MES-Lite), hỗ trợ cân bằng tồn kho vật lý Xuất-Nhập-Tồn (XNT) real-time, tính toán quy trình công nghệ giật lùi, quản lý PO/WO và xuất hàng.

---

## 🛠️ Công Nghệ & Kiến Trúc

- **Core Framework**: Next.js 14 (App Router) + TypeScript.
- **Styling & UI**: Tailwind CSS (Monochromatic Industrial Minimalist Design System).
- **Database Layer**: `@upstash/redis` SDK (Serverless Redis REST API) kèm bộ fallback In-Memory Redis tự động chạy offline cho môi trường phát triển local.
- **Authentication**: JWT HttpOnly Cookies + Middleware kiểm soát phân quyền 3 cấp (RBAC: `ADMIN`, `DISPATCHER`, `VIEWER`).
- **Real-time Sync**: SWR (`useSWR`) với 5-second polling interval & global cache mutation.
- **Excel Engine**: SheetJS (`xlsx`) parse dữ liệu đơn hàng 100% ở trình duyệt (Client-side).

---

## 🚀 Hướng Dẫn Deploy Sản Phẩm Lên Vercel & Upstash Redis

### Bước 1: Tạo Database Upstash Redis
1. Đăng ký/Đăng nhập tại [Upstash Console](https://console.upstash.com/).
2. Chọn **Create Database**, đặt tên `mes-lite-db`, chọn vùng (Region) gần Việt Nam nhất (ví dụ: `ap-southeast-1` Singapore).
3. Sau khi tạo thành công, cuộn xuống phần **REST API**:
   - Sao chép giá trị `UPSTASH_REDIS_REST_URL`.
   - Sao chép giá trị `UPSTASH_REDIS_REST_TOKEN`.

---

### Bước 2: Khởi Tạo Git & Push Code Lên GitHub
Chạy các lệnh sau tại thư mục gốc dự án:

```bash
# 1. Khởi tạo kho chứa Git
git init

# 2. Thêm toàn bộ mã nguồn
git add .

# 3. Commit mã nguồn
git commit -m "Feat: Complete MES-Lite System Phase 1-14"

# 4. Tạo repo mới trên GitHub, sau đó kết nối và push:
git remote add origin https://github.com/<YOUR_USERNAME>/mes-lite.git
git branch -M main
git push -u origin main
```

---

### Bước 3: Deploy Lên Vercel
1. Đăng nhập [Vercel Console](https://vercel.com/) và bấm **Add New Project**.
2. Kết nối với tài khoản GitHub và chọn repository `mes-lite`.
3. Tại phần **Environment Variables**, khai báo các biến môi trường bắt buộc:

| Biến Môi Trường | Giá Trị mẫu | Mô Tả |
| --- | --- | --- |
| `UPSTASH_REDIS_REST_URL` | `https://xxxx.upstash.io` | URL kết nối REST API của Upstash DB |
| `UPSTASH_REDIS_REST_TOKEN` | `AXXXXXX...` | Token xác thực REST API Upstash |
| `JWT_SECRET` | `super-secret-key-32-chars-long-12345` | Secret key dùng mã hóa và giải mã JWT |
| `SEED_ADMIN_PASSWORD` | `MySecretPass@2026!` | Mật khẩu Admin khởi tạo ban đầu (bắt buộc) |

4. Bấm **Deploy**. Vercel sẽ tự động build và cung cấp domain thật dạng `https://mes-lite.vercel.app`.

---

### Bước 4: Khởi Tạo Dữ Liệu Ban Đầu (Seed Upstash Production)
Để khởi tạo 10 xưởng sản xuất chuẩn và tài khoản Admin ban đầu trên Upstash Redis thật, người vận hành **bắt buộc** phải cấu hình biến `SEED_ADMIN_PASSWORD`:

Mở terminal trên máy local và chạy lệnh seed trỏ trực tiếp tới URL production của Upstash:

```bash
UPSTASH_REDIS_REST_URL="https://xxxx.upstash.io" UPSTASH_REDIS_REST_TOKEN="AXXXXXX..." SEED_ADMIN_PASSWORD="MySecretPass@2026!" npm run seed
```

Hoặc cập nhật `SEED_ADMIN_PASSWORD` vào file `.env.local` rồi chạy:

```bash
npm run seed
```

> [!WARNING]
> **BẮT BUỘC ĐỔI MẬT KHẨU SAU KHỞI TẠO:**  
> Sau khi seed hoặc reset hệ thống lần đầu tiên, người quản trị **bắt buộc phải đăng nhập vào hệ thống và thực hiện đổi mật khẩu tài khoản Admin ngay lập tức**. Tuyệt đối không dùng mật khẩu seed ban đầu để vận hành lâu dài.

---

## 📋 Quy Trình Kiểm Thử E2E (End-to-End Acceptance Flow)

Thực hiện quy trình kiểm thử trọn vẹn luồng nghiệp vụ sản xuất trên giao diện thật:

1. **Đăng nhập**:
   - Truy cập trang `/login` với tài khoản `admin` và mật khẩu đã cấu hình trong `SEED_ADMIN_PASSWORD`.
2. **Khai báo tồn đầu kỳ**:
   - Gửi request `POST /api/inventory/opening` (hoặc qua giao diện) để thiết lập số dư ban đầu cho các xưởng công đoạn 1 (`CUAPHOI`, `D1`, `D2`, `R1`, `R2`).
3. **Khai báo Sản Phẩm & Routing**:
   - Vào Tab **Danh Mục Sản Phẩm** (`/dashboard/products`), thêm SKU `SKU-TEST-01` với quy trình công nghệ `D1 → CK1 → MNL → LR`.
4. **Tạo Đơn Hàng PO**:
   - Vào Tab **Đơn Hàng PO** (`/dashboard/po`), chọn **Tạo PO Mới** (hoặc dùng tính năng Import Excel) với số lượng đặt `100 pcs`.
5. **Tạo Lệnh Sản Xuất WO**:
   - Vào Tab **Lệnh Sản Xuất WO** (`/dashboard/wo`), bấm **Lập WO Mới Từ PO** vừa tạo. System sẽ tính toán sản lượng kế hoạch cho 4 bước `D1`, `CK1`, `MNL`, `LR`.
6. **Nhập Sản Lượng Thực Tế**:
   - Vào Tab **Sản Xuất & Chuyển Phôi** (`/dashboard/production`), chọn xưởng `D1`, báo cáo hoàn thành `100 pcs`.
7. **Xuất Chuyển Phôi Xưởng**:
   - Vào Tab **Chuyển Phôi**, xuất chuyển `100 pcs` phôi từ `D1` sang xưởng kế tiếp (`CK1`).
8. **Hoàn Thành Bước LR & Đóng WO**:
   - Nhập sản lượng tiếp tục qua các bước cho tới xưởng lắp ráp `LR` hoàn thành `100 pcs`.
   - Vào Tab **Lệnh Sản Xuất WO**, kiểm tra nút **Đóng WO** sáng lên và bấm Đóng. Trạng thái WO chuyển sang `READY_TO_SHIP`.
9. **Xuất Hàng Đợt 1 (Xuất Một Phần - 60 pcs)**:
   - Vào Tab **Xuất Hàng** (`/dashboard/shipment`), chọn WO, nhập số lượng xuất `60 pcs`.
   - Xác nhận: PO chuyển sang trạng thái `PARTIALLY_SHIPPED`, WO vẫn giữ `READY_TO_SHIP` với phần còn lại hiển thị `40 pcs`.
10. **Xuất Hàng Đợt 2 (Xuất Nốt - 40 pcs)**:
    - Tiếp tục xuất nốt `40 pcs` còn lại.
    - Xác nhận: PO chuyển sang `COMPLETED`, WO chuyển sang `SHIPPED`, dữ liệu bảng XNT Real-time trừ tồn BTP chính xác.

---

## 🧪 Chạy Test Local

```bash
# Chạy Unit & Integration Test suite bằng Vitest
npm run test

# Chạy build kiểm tra mã nguồn
npm run build
```
