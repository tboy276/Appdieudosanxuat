export type UserRole = "ADMIN" | "DISPATCHER" | "VIEWER";

export interface User {
  id: string;
  username: string;
  passwordHash: string;
  role: UserRole;
  createdAt: string;
}

export interface WorkCenter {
  code: string;
  name: string;
  scrapRate: number;
  isFirstStep?: boolean;
  isFinalStep?: boolean;
}

export interface StockState {
  tonPhoi: number;
  tonPhoiDauVao: number;
  tonBanThanhPham: number;
}

export interface Product {
  sku: string;
  nameVi: string;
  nameEn?: string;
  legacySymbols?: string[];
  routing: string[];
  unit: string;
  needsRouting?: boolean;
  createdAt: string;
  updatedAt: string;
}
