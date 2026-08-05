export type UserRole = "ADMIN" | "DISPATCHER" | "VIEWER";
export type UserStatus = "ACTIVE" | "LOCKED";

export interface User {
  id: string;
  username: string;
  passwordHash: string;
  role: UserRole;
  status?: UserStatus;
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
  tonThanhPham: number;
}

export interface Product {
  sku: string;
  nameVi: string;
  customerNames?: string[];
  customerName?: string;
  rawWeight?: number;
  material?: string;
  routing: string[];
  routingScrapRates?: Record<string, number>;
  routingLeadTimes?: Record<string, number>;
  unit: string;
  needsRouting?: boolean;
  createdAt: string;
  updatedAt: string;
}
