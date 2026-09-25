/**
 * isDestructive() — first-pass heuristic, BETA status.
 *
 * Pure module: no chrome APIs, no DOM access, unit-testable in Node.
 * Decides whether a proposed browser action should require human
 * approval. In Beta it is NOT wired to any live action (there is no
 * content.js yet); Final wires it in front of every
 * click/type/select_option/submit execution with the blocking
 * Approve/Deny flow (README §7.2).
 *
 * Design rules (locked):
 *  - Judges what the action WOULD DO from tool + element signals only.
 *  - Never trusts who asked: caller identity is not an input, so no
 *    caller can be special-cased (prompt-injection defense).
 *  - Fail-closed: unrecognised submit-ish shapes count as destructive.
 */

const DESTRUCTIVE_PATTERNS = [
  /delete|remove|erase|destroy|wipe/i,
  /buy|purchase|checkout|pay\b|payment|order\b/i,
  /\bsend\b|\bsubmit\b|confirm|irreversible|permanent/i,
  /cancel (order|subscription|account)|close account|deactivate/i,
  /transfer|withdraw/i,
];

const EXPLICITLY_SAFE_INPUT_TYPES = new Set([
  "text",
  "search",
  "email",
  "tel",
  "url",
  "password",
  "number",
]);

/**
 * @param {object} action
 * @param {string} action.tool - click | type | select_option | submit | scroll
 * @param {string} [action.label] - accessible name / aria-label / <label> text
 * @param {string} [action.text] - visible button/link text
 * @param {string} [action.inputType] - for type/select_option targets
 * @param {boolean} [action.isFormSubmit] - true when the target submits a form
 * @returns {{ destructive: boolean, reasons: string[] }}
 */
export function isDestructive(action = {}) {
  const reasons = [];
  const { tool = "", label = "", text = "", inputType = "", isFormSubmit = false } = action;
  const haystack = `${label} ${text}`.trim();

  if (tool === "submit" || isFormSubmit) {
    reasons.push("form-submit");
  }

  for (const re of DESTRUCTIVE_PATTERNS) {
    if (re.test(haystack)) {
      reasons.push(`keyword:${re.source.slice(0, 32)}`);
      break;
    }
  }

  if (tool === "type" || tool === "select_option") {
    // Typing into a plain field is non-destructive by itself; the gate that
    // matters is what gets SUBMITTED afterwards. Unknown control kinds stay
    // fail-closed so Final can refine per inputType.
    if (inputType && !EXPLICITLY_SAFE_INPUT_TYPES.has(String(inputType).toLowerCase())) {
      reasons.push(`unknown-input-type:${inputType}`);
    }
  }

  if (tool !== "click" && tool !== "type" && tool !== "select_option" && tool !== "submit") {
    reasons.push(`unknown-tool:${tool || "(missing)"}`);
  }

  return { destructive: reasons.length > 0, reasons };
}
