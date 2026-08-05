import { supabaseAdmin } from "../lib/supabase";

export const INITIAL_WORKSHOPS = [
  { code: "CUAPHOI", name: "Tổ cưa phôi PSX", is_ktp: false },
  { code: "D1", name: "Xưởng Đúc 1", is_ktp: false },
  { code: "D2", name: "Xưởng Đúc 2", is_ktp: false },
  { code: "R1", name: "Xưởng Rèn 1", is_ktp: false },
  { code: "R2", name: "Xưởng Rèn 2", is_ktp: false },
  { code: "CK1", name: "Xưởng Cơ Khí 1", is_ktp: false },
  { code: "CK2", name: "Xưởng Cơ Khí 2", is_ktp: false },
  { code: "CK3", name: "Xưởng Cơ Khí 3", is_ktp: false },
  { code: "MNL", name: "Xưởng Mạ Nhiệt Luyện", is_ktp: false },
  { code: "LR", name: "Xưởng Lắp Ráp", is_ktp: false },
  { code: "KTP", name: "Kho Thành Phẩm", is_ktp: true },
];

export async function seedWorkshops() {
  console.log("🌱 Seeding initial workshops into Supabase...");

  for (const ws of INITIAL_WORKSHOPS) {
    const { data, error } = await supabaseAdmin
      .from("workshops")
      .upsert(
        { code: ws.code, name: ws.name, is_ktp: ws.is_ktp },
        { onConflict: "code" }
      )
      .select();

    if (error) {
      console.error(`❌ Failed to seed workshop ${ws.code}:`, error.message);
      throw error;
    }
  }

  console.log(`✅ Successfully seeded ${INITIAL_WORKSHOPS.length} workshops into Supabase!`);
}

if (require.main === module) {
  seedWorkshops().catch((err) => {
    console.error("Seeding failed:", err);
    process.exit(1);
  });
}
