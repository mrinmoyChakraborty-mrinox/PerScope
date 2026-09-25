import { z } from "zod";

export const name = "select_option";
export const description =
  "Select an option in a <select> element by its ref. Same validator gate and blocking confirm-flow as click.";
export const inputSchema = z.object({
  tabId: z.number().int().positive().optional().describe("Target tab id; omit for the active tab."),
  ref: z.string().min(1).describe("Element ref from list_interactive_elements."),
  value: z.string().describe("Option value to select."),
});
