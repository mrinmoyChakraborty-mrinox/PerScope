import { z } from "zod";

export const name = "list_tabs";
export const description =
  "List open tabs the extension can see (id, title, url, active flag) for targeting tabId in other tools. Omit tabId elsewhere to use the active tab.";
export const inputSchema = z.object({});
