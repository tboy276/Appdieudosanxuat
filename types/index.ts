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
