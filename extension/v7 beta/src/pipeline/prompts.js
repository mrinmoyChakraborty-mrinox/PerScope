// FastVLM prompts and evidence formatting ported 1:1 from v7.mjs
import { cleanText } from "./heuristics.js";

const ALLOWED_FASTVLM_TYPES = new Set([
    "first_name",
    "last_name",
    "user_name",
    "name",
    "full_name",
    "person",
    "person_name",
    "company_name",
    "company",
    "organization",
    "org",
    "certificate_number",
    "certificate_license_number",
    "registration_number",
    "application_number",
    "application_id",
    "student_id",
    "roll_number",
    "admission_number",
    "employee_id",
    "customer_id",
    "passport_number",
    "license_number",
    "policy_number",
    "reference_number",
    "document_number",
    "serial_number",
    "date",
    "date_of_birth",
    "dob",
    "time",
    "date_time",
    "email",
    "phone",
    "phone_number",
    "mobile",
    "fax_number",
    "account_number",
    "card_number",
    "credit_debit_card",
    "cvv",
    "pin",
    "bank_routing_number",
    "swift_bic",
    "upi_id",
    "ifsc",
    "iban",
    "unique_id",
    "ssn",
    "national_id",
    "tax_id",
    "license_plate",
    "vehicle_identifier",
    "device_identifier",
    "biometric_identifier",
    "medical_record_number",
    "health_plan_beneficiary_number",
    "street_address",
    "city",
    "state",
    "county",
    "country",
    "postcode",
    "address",
    "coordinate",
    "password",
    "api_key",
    "age",
    "gender",
    "blood_type",
    "education_level",
    "employment_status",
    "occupation",
    "pii",
    "other",
    "unknown",
]);

function buildFastVLMRedactionEvidence({ image, ocr, ettinFindings, deterministicFindings, fusedCandidates }) {
    return {
        image: { width: image.width, height: image.height },
        ocr: (ocr.items || []).map((it) => ({
            id: it.id,
            text: cleanText(it.text),
            bbox: it.bbox ?? null,
            confidence: it.confidence ?? null,
        })),
        ettin_candidates: (ettinFindings || []).map((f) => ({
            entity: f.entity,
            text: cleanText(f.text),
            score: f.score,
            source_id: f.source_id,
            bbox: f.bbox ?? null,
        })),
        deterministic_candidates: (deterministicFindings || []).map((d) => ({
            label: d.label,
            value: cleanText(d.value),
            field_type: d.field_type,
            confidence: d.confidence,
            ocr_ids: d.ocr_ids,
            bbox: d.bbox ?? null,
            reason: d.reason,
        })),
        fused_candidates: (fusedCandidates || []).map((c) => ({
            candidate_id: c.candidate_id,
            ocr_ids: c.ocr_ids,
            text: c.text,
            label_context: c.label_context,
            candidate_types: c.candidate_types,
            sources: c.sources,
            confidence: c.confidence,
            bbox: c.bbox ?? null,
        })),
    };
}

function buildFastVLMRedactionPrompt(evidence) {
    const ocrJoined =
        evidence.ocr
            .map(
                o => o.text
            )
            .join(" | ")
            .slice(0, 12000) ||
        "(no OCR)";

    const ocrIds =
        evidence.ocr
            .map(
                o => o.id
            )
            .join(",") ||
        "(none)";

    const fusedLines =
        evidence.fused_candidates
            .map(
                c =>
                    `${c.candidate_id} "${c.text}" types=[${(
                        c.candidate_types ||
                        []
                    ).join(",")}] conf=${Number(
                        c.confidence ?? 0
                    ).toFixed(
                        2
                    )} ocr=${(
                        c.ocr_ids ||
                        []
                    ).join(",")}`
            )
            .join("\n") ||
        "(none)";

    return `
You are PerScope's local multimodal
privacy-redaction adjudicator.

Inspect the screenshot directly.

Use the OCR and candidate evidence only
as supporting evidence.

Your job is to decide which actual VALUES
visible in the screenshot are sensitive
personal or confidential information.

OUTPUT ONLY ONE JSON OBJECT.
NO MARKDOWN.
NO CODE FENCES.
NO EXPLANATION.
NO REASONING.

Schema:

{
  "caption": "detailed visual description of everything visible, without repeating sensitive values",
  "redactions": [],
  "additional_redactions": [],
  "rejected_candidates": []
}

RULES:

1. Approve only genuine sensitive VALUES.

2. Never redact:
   - labels
   - headings
   - field names
   - section titles
   - questions
   - instructions
   - button labels

3. Example:
   "Certificate No: ABC123XY98"
   -> redact "ABC123XY98"
   -> DO NOT redact "Certificate No"

4. Existing redactions MUST use a
   candidate_id from the FUSED list.

5. Additional redactions MUST use:
   - an existing OCR ID
   - text actually present in OCR

6. Never invent:
   - candidate IDs
   - OCR IDs
   - text
   - PII

7. Reject UI labels/questions such as:
   "Current Address"
   "Phone Numbers"
   "Grades"
   "Position Title"

 8. Value types are given by the FUSED candidate types.
    Do NOT enumerate or list category names anywhere in your
    output, especially not in the caption.

 9. Never reconstruct text hidden behind
    [REDACTED:*].

  10. Caption is a DETAILED visual description of everything visible:
      main subjects and their appearance, clothing, background, colors,
      composition, objects, text regions, photo/emblem/QR presence.
      Write 2-4 full sentences. Be concrete and specific about what you
      SEE (e.g. "short hair", "light-colored shirt", "blurred background").
      It must NEVER contain, repeat, or reconstruct ANY sensitive value
      from OCR or the FUSED list — not names, numbers, dates, IDs, or parts
      of them. It must NEVER mention rules, redaction, sensitivity,
      confidentiality, or policy, and must NEVER give verdicts such as
      "there are no sensitive details" or refuse to describe: just describe.
      GOOD: "Portrait photo of a person with short hair wearing a
      light-colored shirt, centered against a blurred indoor background
      with soft frontal lighting and warm colors."
     BAD (critical failure, NEVER do this): "Aadhaar card of Bhushan
     Diwakar, DOB 05/07/2002, number 4906 5637 6032" — this leaks PII.

 11. Confidence must be between 0 and 1.

OCR IDS:
${ocrIds}

FUSED CANDIDATES:
${fusedLines}

OCR:
${ocrJoined}
`;
}

// Isolated loader â€” text-only Q4F16 quantized FastVLM-0.5B adjudication with WebGPU.
// Verified: @huggingface/transformers 4.2.0 exports AutoModelForImageTextToText (multimodal
// variant of multimodal family). When loaded via ImageTextToText, resolveTypeConfig()
// sets textOnly=true so only embed_tokens + decoder_model_merged are requested â€”
// vision_encoder is NOT downloaded/initialized (session_config.js: ImageTextToText).
// Verified repo siblings (onnx-community/FastVLM-0.5B-ONNX): embed_tokens_q4.onnx and
// decoder_model_merged_q4f16.onnx exist; dtype mapping uses
//   DEFAULT_DTYPE_SUFFIX_MAPPING = { q4: "_q4", q4f16: "_q4f16" }.
// Verified devices (transformers 4.2.0 src/utils/devices.js + src/backends/onnx.js):
//   webgpu, wasm, cpu, auto are valid; defaultDevices: cpu (Node) / wasm (Browser),
//   supportedDevices includes webgpu. Env apis.IS_WEBGPU_AVAILABLE = IS_NODE_ENV || ('gpu' in navigator).

function buildPerceptionPrompt(evidence) {
    // Shim: original vision-based perception prompt removed.
    // For FastVLM, reuse the redaction prompt evidence.
    try {
        const ev = evidence.fastvlm_evidence || evidence;
        return buildFastVLMRedactionPrompt(ev);
    } catch {
        return "Perception prompt unavailable";
    }
}



export {
    ALLOWED_FASTVLM_TYPES,
    buildFastVLMRedactionEvidence,
    buildFastVLMRedactionPrompt,
    buildPerceptionPrompt
};
