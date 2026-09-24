import { z } from "zod";

export const name = "read_page";
export const description =
  "Trigger DOM extraction + text-redaction on a tab. Returns sanitized structured text and findings. The live DOM is not modified.";
export const inputSchema = z.object({
  tabId: z.number().int().positive().optional().describe("Target tab id; omit for the active tab."),
});
