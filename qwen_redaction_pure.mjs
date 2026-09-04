// Pure pipeline logic extracted from v3.mjs — no heavy deps (sharp, paddle, transformers)
// Used by tests and can be imported by v3.mjs to avoid duplication

function asString(value) {
    return value === null || value === undefined ? "" : String(value);
}
function cleanText(value) {
    return asString(value).replace(/\s+/g, " ").trim();
}

function clampBBox(bbox, width, height, padding = 0) {
    if (!Array.isArray(bbox) || bbox.length !== 4) return null;
    const raw = bbox.map(Number);
    if (!raw.every(Number.isFinite)) return null;
    let x1 = Math.min(raw[0], raw[2]) - padding;
    let y1 = Math.min(raw[1], raw[3]) - padding;
    let x2 = Math.max(raw[0], raw[2]) + padding;
    let y2 = Math.max(raw[1], raw[3]) + padding;
    x1 = Math.max(0, Math.min(width - 1, Math.floor(x1)));
    y1 = Math.max(0, Math.min(height - 1, Math.floor(y1)));
    x2 = Math.max(x1 + 1, Math.min(width, Math.ceil(x2)));
    y2 = Math.max(y1 + 1, Math.min(height, Math.ceil(y2)));
    return { left: x1, top: y1, width: Math.max(1, x2 - x1), height: Math.max(1, y2 - y1) };
}

/* reading order */
export function buildReadingOrder(ocr) {
    if (!ocr?.items?.length) return { ordered: [], rows: [] };
    const items = ocr.items.map((it) => ({ ...it, bbox: it.bbox ?? [0, 0, 0, 0], text: cleanText(it.text) }));
    const sortedByY = [...items].sort((a, b) => ((a.bbox[1] + a.bbox[3]) / 2) - ((b.bbox[1] + b.bbox[3]) / 2));
    const rows = [];
    for (const item of sortedByY) {
        const cy = (item.bbox[1] + item.bbox[3]) / 2;
        const h = Math.max(1, item.bbox[3] - item.bbox[1]);
        const tol = Math.max(8, h * 0.6);
        let row = rows.find((r) => Math.abs(r.cy - cy) < tol);
        if (!row) { row = { cy, items: [] }; rows.push(row); }
        row.items.push(item);
        row.cy = row.items.reduce((s, it) => s + (it.bbox[1] + it.bbox[3]) / 2, 0) / row.items.length;
    }
    rows.sort((a, b) => a.cy - b.cy);
    let order = 0;
    const ordered = [];
    for (const row of rows) { row.items.sort((a, b) => a.bbox[0] - b.bbox[0]); for (const it of row.items) ordered.push({ ...it, reading_order: order++ }); }
    return { ordered, rows };
}

export const SENSITIVE_FIELD_VOCABULARY = [
    { label: "Certificate No", field_type: "CERTIFICATE_NUMBER" },
    { label: "Certificate Number", field_type: "CERTIFICATE_NUMBER" },
    { label: "Cert No", field_type: "CERTIFICATE_NUMBER" },
    { label: "Cert Number", field_type: "CERTIFICATE_NUMBER" },
    { label: "Certificate No.", field_type: "CERTIFICATE_NUMBER" },
    { label: "Registration No", field_type: "REGISTRATION_NUMBER" },
    { label: "Registration Number", field_type: "REGISTRATION_NUMBER" },
    { label: "Reg No", field_type: "REGISTRATION_NUMBER" },
    { label: "Application No", field_type: "APPLICATION_NUMBER" },
    { label: "Application Number", field_type: "APPLICATION_NUMBER" },
    { label: "Application ID", field_type: "APPLICATION_ID" },
    { label: "Student ID", field_type: "STUDENT_ID" },
    { label: "Student Number", field_type: "STUDENT_ID" },
    { label: "Roll No", field_type: "ROLL_NUMBER" },
    { label: "Roll Number", field_type: "ROLL_NUMBER" },
    { label: "Admission No", field_type: "ADMISSION_NUMBER" },
    { label: "Admission Number", field_type: "ADMISSION_NUMBER" },
    { label: "Employee ID", field_type: "EMPLOYEE_ID" },
    { label: "Employee Number", field_type: "EMPLOYEE_ID" },
    { label: "Passport No", field_type: "PASSPORT_NUMBER" },
    { label: "Passport Number", field_type: "PASSPORT_NUMBER" },
    { label: "License No", field_type: "LICENSE_NUMBER" },
    { label: "Licence No", field_type: "LICENSE_NUMBER" },
    { label: "Policy Number", field_type: "POLICY_NUMBER" },
    { label: "Policy No", field_type: "POLICY_NUMBER" },
    { label: "Reference Number", field_type: "REFERENCE_NUMBER" },
    { label: "Reference No", field_type: "REFERENCE_NUMBER" },
    { label: "Document Number", field_type: "DOCUMENT_NUMBER" },
    { label: "Document No", field_type: "DOCUMENT_NUMBER" },
    { label: "Serial Number", field_type: "SERIAL_NUMBER" },
    { label: "Serial No", field_type: "SERIAL_NUMBER" },
    { label: "Date of Birth", field_type: "DATE_OF_BIRTH" },
    { label: "DOB", field_type: "DATE_OF_BIRTH" },
    { label: "Email", field_type: "EMAIL" },
    { label: "Email Address", field_type: "EMAIL" },
    { label: "Phone", field_type: "PHONE" },
    { label: "Phone Number", field_type: "PHONE" },
    { label: "Mobile", field_type: "PHONE" },
    { label: "Mobile Number", field_type: "PHONE" },
    { label: "Account Number", field_type: "ACCOUNT_NUMBER" },
    { label: "Account No", field_type: "ACCOUNT_NUMBER" },
    { label: "Card Number", field_type: "CARD_NUMBER" },
    { label: "UPI ID", field_type: "UPI_ID" },
    { label: "IFSC", field_type: "IFSC" },
    { label: "IBAN", field_type: "IBAN" },
];

export function normalizeLabelForMatch(text) {
    let v = String(text ?? "").toLowerCase();
    v = v.replace(/0/g, "o");
    v = v.replace(/[.\-_:;\/\\]+/g, " ");
    v = v.replace(/\s+/g, " ").trim();
    return v;
}
const NORMALIZED_VOCAB = SENSITIVE_FIELD_VOCABULARY.map((e) => ({ ...e, normalized: normalizeLabelForMatch(e.label) }));
NORMALIZED_VOCAB.sort((a, b) => b.normalized.length - a.normalized.length);

export function findFieldLabelMatch(text) {
    const norm = normalizeLabelForMatch(text);
    for (const entry of NORMALIZED_VOCAB) {
        if (norm === entry.normalized || norm.includes(entry.normalized) || entry.normalized.includes(norm)) {
            if (norm.includes(entry.normalized)) return entry;
            if (entry.normalized.includes(norm) && norm.length >= 3) return entry;
        }
    }
    for (const entry of NORMALIZED_VOCAB) {
        if (Math.abs(norm.length - entry.normalized.length) > 2) continue;
        if (entry.normalized.length < 6) continue;
        let diffs = 0; const len = Math.min(norm.length, entry.normalized.length);
        for (let i = 0; i < len; i++) if (norm[i] !== entry.normalized[i]) diffs++;
        diffs += Math.abs(norm.length - entry.normalized.length);
        if (diffs <= 2) return entry;
    }
    return null;
}
export function isPlausibleValue(text) {
    const v = String(text ?? "").trim();
    if (!v) return false;
    if (v.length < 2) return false;
    if (v.length > 80) return false;
    if (!/[a-z0-9]/i.test(v)) return false;
    if (/^[.,:;\/\-_]+$/.test(v)) return false;
    const words = v.split(/\s+/);
    if (words.length > 8) return false;
    if (words.length > 4 && /^[a-z\s.,]+$/i.test(v) && !/[\d\-_\/]/.test(v)) return false;
    return true;
}
export function extractLabelValueSameLine(ocrItems) {
    const candidates = [];
    for (const item of ocrItems) {
        const raw = String(item.text ?? "");
        let labelPart = null, valuePart = null;
        const colonIdx = raw.indexOf(":");
        if (colonIdx >= 0) { labelPart = raw.slice(0, colonIdx + 1); valuePart = raw.slice(colonIdx + 1).trim(); }
        else { const m = raw.match(/^(.+?)\s{2,}(.+)$/); if (m) { labelPart = m[1]; valuePart = m[2].trim(); } }
        if (!labelPart || !valuePart) continue;
        const labelMatch = findFieldLabelMatch(labelPart);
        if (!labelMatch) continue;
        if (!isPlausibleValue(valuePart)) continue;
        candidates.push({ source: "deterministic_context", ocr_ids: [item.id], label: labelMatch.label, value: cleanText(valuePart), field_type: labelMatch.field_type, confidence: 0.98, reason: `Sensitive identifier value associated with ${labelMatch.label} label (same line)`, bbox: item.bbox ?? null, raw_text: raw });
    }
    return candidates;
}
export function extractLabelValueSideBySide(orderedItems, rows) {
    const candidates = [];
    for (const row of rows) {
        const rowItems = [...row.items].sort((a, b) => a.bbox[0] - b.bbox[0]);
        for (let i = 0; i < rowItems.length; i++) {
            const labelItem = rowItems[i];
            const labelMatch = findFieldLabelMatch(labelItem.text);
            if (!labelMatch) continue;
            for (let j = i + 1; j < rowItems.length; j++) {
                const valueItem = rowItems[j];
                const gap = valueItem.bbox[0] - labelItem.bbox[2];
                if (gap < -5) continue;
                if (!isPlausibleValue(valueItem.text)) continue;
                candidates.push({ source: "deterministic_context", ocr_ids: [labelItem.id, valueItem.id], label: labelMatch.label, value: cleanText(valueItem.text), field_type: labelMatch.field_type, confidence: 0.92, reason: `Sensitive identifier value associated with ${labelMatch.label} label (side-by-side)`, bbox: valueItem.bbox ?? null, raw_text: `${labelItem.text} ${valueItem.text}` });
                break;
            }
        }
    }
    return candidates;
}
export function extractLabelValueVertical(orderedItems, rows) {
    const candidates = [];
    const sortedRows = [...rows].sort((a, b) => a.cy - b.cy);
    for (let r = 0; r < sortedRows.length - 1; r++) {
        const labelRow = sortedRows[r]; const valueRow = sortedRows[r + 1];
        const verticalGap = Math.min(...valueRow.items.map((it) => it.bbox[1])) - Math.max(...labelRow.items.map((it) => it.bbox[3]));
        if (verticalGap < 0 || verticalGap > 50) continue;
        for (const labelItem of labelRow.items) {
            const labelMatch = findFieldLabelMatch(labelItem.text);
            if (!labelMatch) continue;
            for (const valueItem of valueRow.items) {
                const overlapLeft = Math.max(labelItem.bbox[0], valueItem.bbox[0]);
                const overlapRight = Math.min(labelItem.bbox[2], valueItem.bbox[2]);
                const overlap = Math.max(0, overlapRight - overlapLeft);
                const maxW = Math.max(labelItem.bbox[2] - labelItem.bbox[0], valueItem.bbox[2] - valueItem.bbox[0]);
                const ratio = maxW > 0 ? overlap / maxW : 0;
                const centerDx = Math.abs((labelItem.bbox[0] + labelItem.bbox[2]) / 2 - (valueItem.bbox[0] + valueItem.bbox[2]) / 2);
                if (ratio < 0.15 && centerDx > maxW * 0.8) continue;
                if (!isPlausibleValue(valueItem.text)) continue;
                candidates.push({ source: "deterministic_context", ocr_ids: [labelItem.id, valueItem.id], label: labelMatch.label, value: cleanText(valueItem.text), field_type: labelMatch.field_type, confidence: 0.90, reason: `Sensitive identifier value associated with ${labelMatch.label} label (vertical)`, bbox: valueItem.bbox ?? null, raw_text: `${labelItem.text} / ${valueItem.text}` });
            }
        }
    }
    return candidates;
}
function extractMultiLineLabel(ocrItems, rows) {
    const candidates = [];
    const sortedRows = [...rows].sort((a, b) => a.cy - b.cy);
    for (let r = 0; r < sortedRows.length - 1; r++) {
        const upperRow = sortedRows[r]; const middleRow = sortedRows[r + 1];
        for (const u of upperRow.items) for (const m of middleRow.items) {
            const combined = `${u.text} ${m.text}`;
            const labelMatch = findFieldLabelMatch(combined);
            if (!labelMatch) continue;
            const colonIdx = m.text.indexOf(":");
            if (colonIdx >= 0) {
                const after = m.text.slice(colonIdx + 1).trim();
                if (isPlausibleValue(after)) {
                    candidates.push({ source: "deterministic_context", ocr_ids: [u.id, m.id], label: labelMatch.label, value: cleanText(after), field_type: labelMatch.field_type, confidence: 0.88, reason: `Sensitive identifier value associated with ${labelMatch.label} label (multi-line label)`, bbox: m.bbox ?? null, raw_text: combined });
                    continue;
                }
            }
            if (r + 2 < sortedRows.length) {
                const valueRow = sortedRows[r + 2];
                for (const v of valueRow.items) {
                    if (!isPlausibleValue(v.text)) continue;
                    candidates.push({ source: "deterministic_context", ocr_ids: [u.id, m.id, v.id], label: labelMatch.label, value: cleanText(v.text), field_type: labelMatch.field_type, confidence: 0.86, reason: `Sensitive identifier value associated with ${labelMatch.label} label (multi-line label + vertical value)`, bbox: v.bbox ?? null, raw_text: `${combined} / ${v.text}` });
                }
            }
        }
    }
    return candidates;
}
export function extractSensitiveFieldCandidates(ocr) {
    if (!ocr?.items?.length) return [];
    const { ordered, rows } = buildReadingOrder(ocr);
    const sameLine = extractLabelValueSameLine(ocr.items);
    const sideBySide = extractLabelValueSideBySide(ordered, rows);
    const vertical = extractLabelValueVertical(ordered, rows);
    const multiLine = extractMultiLineLabel(ocr.items, rows);
    const all = [...sameLine, ...sideBySide, ...vertical, ...multiLine];
    const seen = new Map();
    for (const c of all) { const key = `${c.field_type}|${c.value}|${[...c.ocr_ids].sort().join(",")}`; if (!seen.has(key) || seen.get(key).confidence < c.confidence) seen.set(key, c); }
    const deduped = [...seen.values()];
    deduped.sort((a, b) => b.confidence - a.confidence);
    const finalMap = new Map();
    for (const c of deduped) { const vkey = `${c.field_type}|${c.value}`; if (!finalMap.has(vkey)) finalMap.set(vkey, c); }
    return [...finalMap.values()];
}
function normalizeCandidateText(t) { return cleanText(t).toLowerCase(); }
function isContained(smaller, larger) { const s = normalizeCandidateText(smaller); const l = normalizeCandidateText(larger); if (!s || !l) return false; if (s === l) return false; return l.includes(s); }
export function fuseRedactionCandidates({ ettinFindings = [], deterministicFindings = [] }) {
    const raw = []; let cid = 0; const nextId = () => `cand_${String(cid++).padStart(3, "0")}`;
    for (const f of ettinFindings) {
        const text = cleanText(f.text); if (!text) continue;
        const ocrIds = f.source_id && f.source_id !== "unmapped" ? [f.source_id] : [];
        raw.push({ candidate_id: nextId(), ocr_ids: ocrIds, text, label_context: null, candidate_types: [f.entity ?? "UNKNOWN"], sources: ["ettin"], confidence: Number(f.score ?? 0), bbox: f.bbox ?? null, original: f });
    }
    for (const d of deterministicFindings) raw.push({ candidate_id: nextId(), ocr_ids: [...(d.ocr_ids ?? [])], text: cleanText(d.value), label_context: d.label ?? null, candidate_types: [d.field_type ?? "UNKNOWN"], sources: ["deterministic_context"], confidence: Number(d.confidence ?? 0.9), bbox: d.bbox ?? null, original: d });
    const byKey = new Map();
    for (const c of raw) { const key = `${normalizeCandidateText(c.text)}|${[...c.ocr_ids].sort().join(",")}`; if (!byKey.has(key)) byKey.set(key, c); else { const existing = byKey.get(key); existing.sources = [...new Set([...existing.sources, ...c.sources])]; existing.candidate_types = [...new Set([...existing.candidate_types, ...c.candidate_types])]; existing.confidence = Math.max(existing.confidence, c.confidence); if (!existing.label_context && c.label_context) existing.label_context = c.label_context; if (!existing.bbox && c.bbox) existing.bbox = c.bbox; } }
    let candidates = [...byKey.values()];
    candidates.sort((a, b) => b.text.length - a.text.length || b.confidence - a.confidence);
    const keep = [];
    for (const c of candidates) {
        let contained = false;
        for (const k of keep) {
            const sameRegion = c.ocr_ids.length && k.ocr_ids.length && c.ocr_ids.some((id) => k.ocr_ids.includes(id));
            const textContained = isContained(c.text, k.text);
            if (textContained && (sameRegion || k.text.toLowerCase().includes(c.text.toLowerCase()))) { contained = true; if (!k.label_context && c.label_context) k.label_context = c.label_context; k.sources = [...new Set([...k.sources, ...c.sources])]; k.candidate_types = [...new Set([...k.candidate_types, ...c.candidate_types])]; break; }
            if (c.bbox && k.bbox && textContained) { const overlap = !(c.bbox[2] < k.bbox[0] || c.bbox[0] > k.bbox[2] || c.bbox[3] < k.bbox[1] || c.bbox[1] > k.bbox[3]); if (overlap) { contained = true; break; } }
        }
        if (!contained) keep.push(c);
    }
    return keep;
}
export const ALLOWED_QWEN_TYPES = new Set(["certificate_number","registration_number","application_number","application_id","student_id","roll_number","admission_number","employee_id","passport_number","license_number","policy_number","reference_number","document_number","serial_number","date_of_birth","email","phone","account_number","card_number","upi_id","ifsc","iban","unique_id","person","other"]);
export function buildQwenRedactionEvidence({ image, ocr, florence, ettinFindings, deterministicFindings, fusedCandidates }) {
    return { image: { width: image.width, height: image.height }, florence: { description: florence?.global_description?.parsed?.["<MORE_DETAILED_CAPTION>"] ? cleanText(florence.global_description.parsed["<MORE_DETAILED_CAPTION>"]) : "" }, ocr: (ocr.items || []).map((it) => ({ id: it.id, text: cleanText(it.text), bbox: it.bbox ?? null, confidence: it.confidence ?? null })), ettin_candidates: (ettinFindings || []).map((f) => ({ entity: f.entity, text: cleanText(f.text), score: f.score, source_id: f.source_id, bbox: f.bbox ?? null })), deterministic_candidates: (deterministicFindings || []).map((d) => ({ label: d.label, value: cleanText(d.value), field_type: d.field_type, confidence: d.confidence, ocr_ids: d.ocr_ids, bbox: d.bbox ?? null, reason: d.reason })), fused_candidates: (fusedCandidates || []).map((c) => ({ candidate_id: c.candidate_id, ocr_ids: c.ocr_ids, text: c.text, label_context: c.label_context, candidate_types: c.candidate_types, sources: c.sources, confidence: c.confidence, bbox: c.bbox ?? null })) };
}
export function buildQwenRedactionPrompt(evidence) {
    const cap = evidence.florence?.description || "(no caption)";
    const ocrLines = evidence.ocr.map((o) => `- [${o.id}] [${o.bbox ? o.bbox.map((n) => Math.round(n)).join(",") : ""}] "${o.text}"`).join("\n") || "(no OCR)";
    const ettinLines = evidence.ettin_candidates.map((e) => `- ${e.entity} "${e.text}" score=${Number(e.score).toFixed(3)} source=${e.source_id}`).join("\n") || "(none)";
    const detLines = evidence.deterministic_candidates.map((d) => `- ${d.field_type} "${d.value}" label="${d.label}" ocr=${d.ocr_ids.join(",")} conf=${d.confidence}`).join("\n") || "(none)";
    const fusedLines = evidence.fused_candidates.map((c) => `- ${c.candidate_id} "${c.text}" types=[${c.candidate_types.join(",")}] sources=[${c.sources.join(",")}] ocr=${c.ocr_ids.join(",")} label_context=${c.label_context ?? ""} bbox=${c.bbox ? c.bbox.join(",") : ""} conf=${c.confidence.toFixed(3)}`).join("\n") || "(none)";
    return `You are the final privacy redaction adjudicator.

You receive:
1. The original image.
2. A Florence visual description.
3. OCR text with bounding boxes.
4. Ettin PII candidates.
5. Deterministic label/value candidates.

Determine which exact visible values in the image MUST be redacted.

Rules:
- Treat Ettin and deterministic candidates as evidence, not absolute truth.
- Use the original image to resolve ambiguity.
- A sensitive label does not itself need redaction; redact the associated value.
- Example: in "Certificate No: ABC123XY98", redact "ABC123XY98", not "Certificate No".
- Reject partial substrings when a larger candidate clearly contains them.
- Never invent or reconstruct text that is not visibly supported.
- Never guess a hidden/redacted value.
- Prefer the smallest exact sensitive value.
- If evidence is insufficient, do not invent a redaction.
- Return ONLY the requested JSON schema.

OUTPUT JSON SCHEMA (return ONLY this JSON, no prose):
{
  "redactions": [{ "candidate_id": "cand_012", "ocr_ids": ["ocr_7"], "text": "ABC123XY98", "type": "certificate_number", "confidence": 0.99, "reason": "Value associated with Certificate No label" }],
  "rejected_candidates": [{ "candidate_id": "cand_013", "reason": "Partial substring" }],
  "confidence_notes": "..."
}

EVIDENCE — FLORENCE:
${cap}

EVIDENCE — OCR REGIONS:
${ocrLines}

EVIDENCE — ETTIN CANDIDATES:
${ettinLines}

EVIDENCE — DETERMINISTIC CANDIDATES:
${detLines}

EVIDENCE — FUSED CANDIDATES (choose from these candidate_ids):
${fusedLines}

EVIDENCE — IMAGE DIMENSIONS: ${evidence.image.width} x ${evidence.image.height} px

Respond with ONLY valid JSON matching the schema above.`;
}
export function validateQwenRedactionOutput(parsed, evidence) {
    if (!parsed || typeof parsed !== "object") return { valid: false, reason: "root not object" };
    if (!Array.isArray(parsed.redactions)) return { valid: false, reason: "redactions must be array" };
    const fusedIds = new Set((evidence.fused_candidates || []).map((c) => c.candidate_id));
    const ocrIds = new Set((evidence.ocr || []).map((o) => o.id));
    const knownTexts = new Set([...(evidence.ocr || []).map((o) => normalizeCandidateText(o.text)), ...(evidence.fused_candidates || []).map((c) => normalizeCandidateText(c.text)), ...(evidence.ettin_candidates || []).map((e) => normalizeCandidateText(e.text)), ...(evidence.deterministic_candidates || []).map((d) => normalizeCandidateText(d.value))]);
    for (const r of parsed.redactions) {
        if (!r.candidate_id || typeof r.candidate_id !== "string") return { valid: false, reason: `redaction missing candidate_id: ${JSON.stringify(r)}` };
        if (!fusedIds.has(r.candidate_id)) return { valid: false, reason: `fabricated candidate_id: ${r.candidate_id}` };
        if (!Array.isArray(r.ocr_ids) || r.ocr_ids.length === 0) return { valid: false, reason: `redaction ${r.candidate_id} missing ocr_ids` };
        for (const oid of r.ocr_ids) if (!ocrIds.has(oid)) return { valid: false, reason: `fabricated ocr_id: ${oid}` };
        if (!r.text || typeof r.text !== "string") return { valid: false, reason: `redaction ${r.candidate_id} missing text` };
        const nt = normalizeCandidateText(r.text);
        if (!knownTexts.has(nt)) { const anyContains = [...knownTexts].some((k) => k.includes(nt) || nt.includes(k)); if (!anyContains) return { valid: false, reason: `text not supported by evidence: "${r.text}"` }; }
        const typeNorm = String(r.type ?? "").toLowerCase();
        if (!ALLOWED_QWEN_TYPES.has(typeNorm)) return { valid: false, reason: `unsupported type: ${r.type}` };
        if (r.confidence !== undefined) { const c = Number(r.confidence); if (!Number.isFinite(c) || c < 0 || c > 1) return { valid: false, reason: `confidence out of range: ${r.confidence}` }; }
    }
    if (parsed.rejected_candidates !== undefined) { if (!Array.isArray(parsed.rejected_candidates)) return { valid: false, reason: "rejected_candidates must be array" }; for (const rej of parsed.rejected_candidates) if (!rej.candidate_id || !fusedIds.has(rej.candidate_id)) return { valid: false, reason: `rejected fabricated candidate_id: ${rej.candidate_id}` }; }
    return { valid: true };
}
export function resolveFinalRedactionRegions(qwenResult, evidence) {
    const redactions = qwenResult?.parsed?.redactions ?? [];
    const ocrById = new Map((evidence.ocr || []).map((o) => [o.id, o]));
    const fusedById = new Map((evidence.fused_candidates || []).map((c) => [c.candidate_id, c]));
    const resolved = [];
    for (const r of redactions) {
        const fused = fusedById.get(r.candidate_id);
        let ocrIds = Array.isArray(r.ocr_ids) && r.ocr_ids.length ? r.ocr_ids : (fused?.ocr_ids ?? []);
        const want = normalizeCandidateText(r.text);
        let bboxes = [];
        for (const oid of ocrIds) { const ocrItem = ocrById.get(oid); if (!ocrItem) continue; const have = normalizeCandidateText(ocrItem.text); if (have.includes(want) || want.includes(have)) bboxes.push(ocrItem.bbox); else if (fused && fused.bbox) bboxes.push(fused.bbox); }
        if (bboxes.length === 0 && fused?.bbox) bboxes.push(fused.bbox);
        for (const bbox of bboxes) resolved.push({ source_id: ocrIds[0] ?? fused?.ocr_ids?.[0] ?? r.candidate_id, entity: r.type ?? fused?.candidate_types?.[0] ?? "PII", score: Number(r.confidence ?? fused?.confidence ?? 1), text: r.text, bbox, candidate_id: r.candidate_id, ocr_ids: ocrIds, reason: r.reason ?? "" });
    }
    return resolved;
}
const FINAL_THRESHOLD = Number(process.env.FINAL_REDACTION_CONFIDENCE_THRESHOLD ?? 0.5);
export function applySafetyGates(findings, evidence, imageWidth, imageHeight) {
    const ocrTexts = new Map((evidence.ocr || []).map((o) => [o.id, normalizeCandidateText(o.text)]));
    const filtered = [];
    for (const f of findings) {
        if (!Array.isArray(f.bbox) || f.bbox.length !== 4) continue;
        const nums = f.bbox.map(Number); if (!nums.every(Number.isFinite)) continue;
        const w = Math.abs(nums[2] - nums[0]); const h = Math.abs(nums[3] - nums[1]); if (w <= 0 || h <= 0) continue;
        const rect = clampBBox(f.bbox, imageWidth, imageHeight, 0); if (!rect) continue;
        const hasKnownOcr = (f.ocr_ids ?? []).some((id) => ocrTexts.has(id)) || ocrTexts.has(f.source_id) || !!f.bbox; if (!hasKnownOcr) continue;
        if (!isPlausibleValue(f.text ?? "")) continue;
        if (findFieldLabelMatch(f.text ?? "")) { const labelMatch = findFieldLabelMatch(f.text); if (labelMatch && normalizeCandidateText(labelMatch.label) === normalizeCandidateText(f.text)) continue; }
        if (Number(f.score) < FINAL_THRESHOLD) continue;
        filtered.push(f);
    }
    filtered.sort((a, b) => (b.text?.length ?? 0) - (a.text?.length ?? 0));
    const deduped = [];
    for (const f of filtered) { const nt = normalizeCandidateText(f.text); let contained = false; for (const k of deduped) { const kText = normalizeCandidateText(k.text); if (kText.includes(nt) && nt !== kText) { contained = true; break; } if (f.bbox && k.bbox && nt !== kText) { const overlap = !(f.bbox[2] < k.bbox[0] || f.bbox[0] > k.bbox[2] || f.bbox[3] < k.bbox[1] || f.bbox[1] > k.bbox[3]); if (overlap && kText.includes(nt)) { contained = true; break; } } } if (!contained) deduped.push(f); }
    return deduped;
}
export function adjudicateOrFallback({ fusedCandidates, qwenResult, evidence, image }) {
    let finalFindings = []; let qwenStatus = qwenResult?.status ?? "skipped"; let validation = null;
    const QWEN_REQUIRED = process.env.QWEN_REQUIRED === "1";
    const QWEN_FALLBACK_POLICY = process.env.QWEN_FALLBACK_POLICY || "fusion";
    if (qwenResult?.status === "ok" && qwenResult.parsed) {
        validation = validateQwenRedactionOutput(qwenResult.parsed, evidence.qwen_evidence);
        if (validation.valid) { const resolved = resolveFinalRedactionRegions(qwenResult, evidence.qwen_evidence); finalFindings = applySafetyGates(resolved, evidence.qwen_evidence, image.width, image.height); qwenStatus = "ok"; }
        else { qwenStatus = "validation_failed"; }
    }
    const needsFallback = qwenStatus !== "ok";
    if (needsFallback) {
        if (QWEN_FALLBACK_POLICY === "fail_closed" || QWEN_REQUIRED) return { status: qwenStatus === "skipped" ? "qwen_skipped" : "qwen_failed", redaction_complete: false, finalFindings: [], validation, fallback: "fail_closed" };
        const fallbackFindings = (fusedCandidates || []).map((c) => ({ source_id: c.ocr_ids?.[0] ?? c.candidate_id, entity: c.candidate_types?.[0] ?? "PII", score: c.confidence, text: c.text, bbox: c.bbox, candidate_id: c.candidate_id, ocr_ids: c.ocr_ids }));
        finalFindings = applySafetyGates(fallbackFindings, evidence.qwen_evidence, image.width, image.height);
        return { status: qwenStatus === "skipped" ? "fallback_fusion" : "fallback_after_qwen_failure", redaction_complete: true, finalFindings, validation, fallback: "fusion" };
    }
    return { status: "ok", redaction_complete: true, finalFindings, validation, fallback: null };
}
