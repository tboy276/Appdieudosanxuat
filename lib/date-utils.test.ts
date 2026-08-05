import { describe, it, expect } from "vitest";
import {
  getTodayVN,
  formatDateDisplay,
  formatTimestampDisplay,
  daysBetween,
  parseExcelDate,
  createExcelDateCell,
} from "./date-utils";

describe("lib/date-utils.ts - Date & Time Standardization Unit Tests", () => {
  it("Case 1: getTodayVN returns valid YYYY-MM-DD string in Vietnam Time", () => {
    const todayStr = getTodayVN();
    expect(todayStr).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const tomorrowStr = getTodayVN(1);
    expect(daysBetween(todayStr, tomorrowStr)).toBe(1);
  });

  it("Case 2: formatDateDisplay formats YYYY-MM-DD to DD/MM/YYYY without timezone shifting", () => {
    expect(formatDateDisplay("2026-07-31")).toBe("31/07/2026");
    expect(formatDateDisplay("2026-01-05")).toBe("05/01/2026");
    expect(formatDateDisplay("")).toBe("—");
    expect(formatDateDisplay(null)).toBe("—");
  });

  it("Case 3: formatTimestampDisplay formats ISO UTC timestamp to DD/MM/YYYY HH:mm in Vietnam Time", () => {
    // 2026-07-31T04:02:25.023Z + 7h = 2026-07-31 11:02
    const formatted = formatTimestampDisplay("2026-07-31T04:02:25.023Z");
    expect(formatted).toBe("31/07/2026 11:02");
    expect(formatTimestampDisplay("")).toBe("—");
  });

  it("Case 4: daysBetween calculates calendar difference accurately without timezone errors", () => {
    expect(daysBetween("2026-07-31", "2026-08-01")).toBe(1);
    expect(daysBetween("2026-07-31", "2026-07-31")).toBe(0);
    expect(daysBetween("2026-08-05", "2026-07-31")).toBe(-5);
  });

  it("Case 5: parseExcelDate handles both Excel serial numbers and text formats", () => {
    // 46234 serial number corresponds to 2026-07-31 in Excel SSF
    const fromSerial = parseExcelDate(46234);
    expect(fromSerial).toBe("2026-07-31");

    // Text format DD/MM/YYYY
    expect(parseExcelDate("15/09/2026")).toBe("2026-09-15");
    // Text format YYYY-MM-DD
    expect(parseExcelDate("2026-10-20")).toBe("2026-10-20");
  });

  it("Case 6: createExcelDateCell exports true Excel Date cell object", () => {
    const cell = createExcelDateCell("2026-07-31");
    expect(cell.t).toBe("d");
    expect(cell.z).toBe("dd/mm/yyyy");
    expect(cell.v).toBeInstanceOf(Date);
    expect(cell.v.getUTCFullYear()).toBe(2026);
    expect(cell.v.getUTCMonth()).toBe(6); // 0-indexed July
    expect(cell.v.getUTCDate()).toBe(31);
  });
});
