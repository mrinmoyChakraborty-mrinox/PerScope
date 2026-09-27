import { z } from "zod";

export const name = "capture_tab";
export const description =
  "Trigger the extension's image pipeline (OCR/NER/heuristics/FastVLM/redaction) on a tab. Returns the redacted image plus evidence. Omit tabId for the active tab.";
export const inputSchema = z.object({
  tabId: z.number().int().positive().optional().describe("Target tab id; omit for the active tab."),
  // Phase 4 plumbing: the MCP SDK strips unknown keys against this schema,
  // so without this line the harness --recycle-after flag silently never
  // reached the extension (found live 2026-09-28: recycle fired at 15
  // despite --recycle-after=0 on every run).
  recycleAfterCaptures: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe(
      "Offscreen recycle override: reload models fresh after this many captures (0 = never). Omit for the extension default (15).",
    ),
});
