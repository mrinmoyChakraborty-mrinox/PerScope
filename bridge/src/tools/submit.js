import { z } from "zod";

export const name = "submit";
export const description =
  "Submit the form associated with an element by its ref. Same validator gate and blocking confirm-flow as click.";
export const inputSchema = z.object({
  tabId: z.number().int().positive().optional().describe("Target tab id; omit for the active tab."),
  ref: z.string().min(1).describe("Element ref from list_interactive_elements."),
});
