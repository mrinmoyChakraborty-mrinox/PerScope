import { z } from "zod";

export const name = "list_interactive_elements";
export const description =
  "Enumerate clickable/typeable elements on a tab with stable references for use with click/type/select_option/submit.";
export const inputSchema = z.object({
  tabId: z.number().int().positive().optional().describe("Target tab id; omit for the active tab."),
});
