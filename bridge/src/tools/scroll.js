import { z } from "zod";

export const name = "scroll";
export const description = "Scroll a tab up or down. Never gated by the validator.";
export const inputSchema = z.object({
  tabId: z.number().int().positive().optional().describe("Target tab id; omit for the active tab."),
  direction: z.enum(["up", "down"]).describe("Scroll direction."),
  amount: z.number().int().positive().optional().describe("Pixels to scroll; omit for one page."),
});
