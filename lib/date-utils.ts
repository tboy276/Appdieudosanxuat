import * as XLSX from "xlsx";

/**
 * Standard Date & Time Utility Module for MES Lite Application
 *
 * Rules:
 * 1. Calendar Date Only (YYYY-MM-DD): Stored and compared as string. Never shifted by timezone.
 * 2. Real Timestamps (ISO 8601 UTC): Converted to Vietnam Time (UTC+7) ONLY at UI display step.
 * 3. Excel Export Date Cells: Exported as true Excel Date cells with format "dd/mm/yyyy".
 */

/**
 * Get current date in Vietnam Timezone (UTC+7) as YYYY-MM-DD.
 * Prevents off-by-one day bugs when server runs in UTC late hours (17:00-23:59 UTC).
 */
export function getTodayVN(offsetDays: number = 0): string {
  const now = new Date();
  // UTC+7 offset calculation in milliseconds
  const utc7Time = new Date(now.getTime() + (7 * 60 + now.getTimezoneOffset()) * 60000);
  if (offsetDays !== 0) {
    utc7Time.setDate(utc7Time.getDate() + offsetDays);
  }
  const yyyy = utc7Time.getFullYear();
  const mm = String(utc7Time.getMonth() + 1).padStart(2, "0");
  const dd = String(utc7Time.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Format a calendar date string (YYYY-MM-DD) to Vietnamese display format (DD/MM/YYYY).
 * Pure string formatting without passing through Date timezone conversion.
 */
export function formatDateDisplay(dateStr?: string | null): string {
  if (!dateStr || typeof dateStr !== "string") return "—";
  const clean = dateStr.trim().slice(0, 10);
  const parts = clean.split("-");
  if (parts.length === 3 && parts[0].length === 4) {
    const [yyyy, mm, dd] = parts;
    return `${dd}/${mm}/${yyyy}`;
  }
  return dateStr;
}

/**
 * Format an ISO 8601 UTC timestamp string to Vietnam Time (UTC+7) display: "DD/MM/YYYY HH:mm".
 */
export function formatTimestampDisplay(isoString?: string | null): string {
  if (!isoString) return "—";
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return "—";
    const utc7Time = new Date(date.getTime() + (7 * 60 + date.getTimezoneOffset()) * 60000);
    const yyyy = utc7Time.getFullYear();
    const mm = String(utc7Time.getMonth() + 1).padStart(2, "0");
    const dd = String(utc7Time.getDate()).padStart(2, "0");
    const hh = String(utc7Time.getHours()).padStart(2, "0");
    const min = String(utc7Time.getMinutes()).padStart(2, "0");
    return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
  } catch {
    return "—";
  }
}

/**
 * Parse YYYY-MM-DD string to UTC midnight epoch timestamp (milliseconds).
 * Pure calendar arithmetic without timezone shifting.
 */
export function parseCalendarDateToUtcTimestamp(dateStr: string): number {
  if (!dateStr) return 0;
  const clean = dateStr.trim().slice(0, 10);
  const parts = clean.split("-").map(Number);
  if (parts.length === 3 && !isNaN(parts[0])) {
    return Date.UTC(parts[0], parts[1] - 1, parts[2]);
  }
  return 0;
}

/**
 * Calculate difference in calendar days between dateStr1 and dateStr2 (dateStr2 - dateStr1).
 * Example: daysBetween("2026-07-31", "2026-08-05") => 5.
 */
export function daysBetween(dateStr1: string, dateStr2: string): number {
  const t1 = parseCalendarDateToUtcTimestamp(dateStr1);
  const t2 = parseCalendarDateToUtcTimestamp(dateStr2);
  if (!t1 || !t2) return 0;
  return Math.round((t2 - t1) / (1000 * 60 * 60 * 24));
}

/**
 * Parse Excel date (either number serial or text DD/MM/YYYY) to standard YYYY-MM-DD string.
 */
export function parseExcelDate(val: any): string {
  if (!val && val !== 0) return getTodayVN();

  if (typeof val === "number") {
    try {
      const dateObj = XLSX.SSF.parse_date_code(val);
      if (dateObj) {
        const yyyy = dateObj.y;
        const mm = String(dateObj.m).padStart(2, "0");
        const dd = String(dateObj.d).padStart(2, "0");
        return `${yyyy}-${mm}-${dd}`;
      }
    } catch {
      // Fallback
    }
  }

  const str = String(val).trim();
  if (!str) return getTodayVN();

  // Check YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    return str.slice(0, 10);
  }

  // Check DD/MM/YYYY or DD-MM-YYYY
  const parts = str.split(/[/.-]/);
  if (parts.length === 3) {
    if (parts[2].length === 4) {
      const dd = String(parts[0]).padStart(2, "0");
      const mm = String(parts[1]).padStart(2, "0");
      const yyyy = parts[2];
      return `${yyyy}-${mm}-${dd}`;
    } else if (parts[0].length === 4) {
      const yyyy = parts[0];
      const mm = String(parts[1]).padStart(2, "0");
      const dd = String(parts[2]).padStart(2, "0");
      return `${yyyy}-${mm}-${dd}`;
    }
  }

  return getTodayVN();
}

/**
 * Convert YYYY-MM-DD string into a true Excel Date cell object for XLSX export.
 * Formats cell as true Date type with "dd/mm/yyyy" number format.
 */
export function createExcelDateCell(dateStr?: string | null): any {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}/.test(dateStr.trim())) {
    return dateStr || "—";
  }
  const clean = dateStr.trim().slice(0, 10);
  const [yyyy, mm, dd] = clean.split("-").map(Number);
  const utcDate = new Date(Date.UTC(yyyy, mm - 1, dd));
  return {
    v: utcDate,
    t: "d",
    z: "dd/mm/yyyy",
  };
}

/**
 * Subtract N calendar days from YYYY-MM-DD string without timezone distortion.
 * Example: subtractDays("2026-08-30", 5) => "2026-08-25".
 */
export function subtractDays(dateStr: string, days: number): string {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}/.test(dateStr.trim())) {
    return dateStr || getTodayVN();
  }
  const clean = dateStr.trim().slice(0, 10);
  const [yyyy, mm, dd] = clean.split("-").map(Number);
  const utcDate = new Date(Date.UTC(yyyy, mm - 1, dd));
  utcDate.setUTCDate(utcDate.getUTCDate() - Math.max(0, days));

  const resY = utcDate.getUTCFullYear();
  const resM = String(utcDate.getUTCMonth() + 1).padStart(2, "0");
  const resD = String(utcDate.getUTCDate()).padStart(2, "0");
  return `${resY}-${resM}-${resD}`;
}
