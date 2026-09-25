import { z } from "zod";

export const name = "click";
export const description =
  "Click an element by its ref. Gated by the extension validator: blocks up to 60s for human approval on destructive targets, then returns ok, denied, or timeout.";
export const inputSchema = z.object({
  tabId: z.number().int().positive().optional().describe("Target tab id; omit for the active tab."),
  ref: z.string().min(1).describe("Element ref from list_interactive_elements."),
});
