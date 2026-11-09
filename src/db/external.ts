import { pgTable, uuid } from "drizzle-orm/pg-core";

/** Tables of other owners that freelance rows reference (foreign keys only). */
export const users = pgTable("users", { id: uuid("id").primaryKey() });
export const companies = pgTable("companies", { id: uuid("id").primaryKey() });
