import { z } from "zod";

export const stockQuerySchema = z.object({
  q: z.string().max(300).default(""),
  warehouse: z.string().max(200).default("all"),
  locationType: z.union([z.literal("all"), z.string().uuid()]).default("all"),
  category: z.string().max(300).default("all"),
  tracking: z.enum(["all", "regular", "serialized"]).default("all"),
  availability: z.enum(["all", "in-stock", "available", "reserved", "out-of-stock"]).default("all"),
  sort: z.enum(["item-asc", "item-desc", "location-asc", "location-desc", "available-asc", "available-desc"]).default("item-asc"),
  offset: z.coerce.number().int().min(0).max(10000000).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type StockQuery = z.infer<typeof stockQuerySchema>;
export const serialQuerySchema = z.object({
  warehouse: z.string().min(1).max(200), item: z.string().min(1).max(200),
  q: z.string().max(300).default(""),
  offset: z.coerce.number().int().min(0).max(10000000).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type SerialQuery = z.infer<typeof serialQuerySchema>;
