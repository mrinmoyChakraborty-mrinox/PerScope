// Pure heuristic and structural analysis functions ported 1:1 from v7.mjs

const FASTVLM_DEBUG = false;

function asString(value) {
    return value === null || value === undefined ? "" : String(value);
}

function cleanText(value) {
    return asString(value).replace(/\s+/g, " ").trim();
}

/* ============================================================
   VALUE SUB-BBOX ESTIMATION
   Returns bbox covering only targetText inside OCR item.
   Uses proportional character positioning (character-based
   horizontal proportion per spec Â§2).
   Signature: estimateTextSubBBox(item, targetText) where
   item = { text, bbox }. Never throws, returns null if
   localization not possible.
   ============================================================ */
function estimateTextSubBBox(item, targetText) {
    try {
        if (!item?.bbox || !Array.isArray(item.bbox) || item.bbox.length !== 4) return null;
        const rawFull = String(item.text ?? "");
        const rawTarget = String(targetText ?? "").trim();
        if (!rawFull || !rawTarget) return null;
        const fullText = cleanText(rawFull);
        const target = cleanText(rawTarget);
        if (!fullText || !target) return null;
        const lowerFull = fullText.toLowerCase();
        const lowerTarget = target.toLowerCase();
        // zero-width bbox guard
        const nums = item.bbox.map(Number);
        if (!nums.every(Number.isFinite)) return null;
        const x1 = Math.min(nums[0], nums[2]);
        const y1 = Math.min(nums[1], nums[3]);
        const x2 = Math.max(nums[0], nums[2]);
        const y2 = Math.max(nums[1], nums[3]);
        const width = x2 - x1;
        if (width <= 0) return null;
        // Normalized whitespace matching: cleanText already collapses,
        // so "Certificate   No:   ABC123XY98" -> "Certificate No: ABC123XY98"
        let startIndex = lowerFull.indexOf(lowerTarget);
        // If not found with cleanText, try whitespace-normalized raw fallback
        if (startIndex < 0) {
            const wsFull = rawFull.replace(/\s+/g, " ").trim().toLowerCase();
            const wsTarget = rawTarget.replace(/\s+/g, " ").trim().toLowerCase();
            // map via cleaned versions lengths proportionally (approx)
            const wsIdx = wsFull.indexOf(wsTarget);
            if (wsIdx < 0) return null;
            // approximate ratio via whitespace-normalized lengths
            const ratioStart = wsIdx / Math.max(1, wsFull.length);
            const ratioEnd = (wsIdx + wsTarget.length) / Math.max(1, wsFull.length);
            return _proportionalBBox([x1, y1, x2, y2], ratioStart, ratioEnd);
        }
        const startRatio = startIndex / fullText.length;
        const endRatio = (startIndex + target.length) / fullText.length;
        if (endRatio <= startRatio) return null;
        // guard degenerate tiny ratio (e.g., 1 char in long line)
        if (endRatio - startRatio < 0.015) {
            // still return sub-bbox but ensure minimal width 4px
            const est = _proportionalBBox([x1, y1, x2, y2], startRatio, endRatio);
            if (est && (est[2] - est[0]) < 2) return null;
            return est;
        }
        if (endRatio - startRatio > 0.98) {
            // target is essentially the whole line -> value is line
            return [x1, y1, x2, y2];
        }
        return _proportionalBBox([x1, y1, x2, y2], startRatio, endRatio);
    } catch {
        return null;
    }
}
function _proportionalBBox(bbox, ratioStart, ratioEnd) {
    try {
        const nums = bbox.map(Number);
        if (!nums.every(Number.isFinite)) return null;
        const x1 = Math.min(nums[0], nums[2]);
        const y1 = Math.min(nums[1], nums[3]);
        const x2 = Math.max(nums[0], nums[2]);
        const y2 = Math.max(nums[1], nums[3]);
        const width = Math.max(1, x2 - x1);
        const rs = Math.max(0, Math.min(1, ratioStart));
        const re = Math.max(0, Math.min(1, ratioEnd));
        if (re <= rs) return null;
        if (width <= 0) return null;
        return [
            x1 + width * rs,
            y1,
            x1 + width * re,
            y2
        ];
    } catch {
        return null;
    }
}
/* ------------------------------------------------------------
   GEOMETRY VALIDATION (Â§12)
   Reject bbox that is clearly the entire mixed label+value line
   when target is only a substring. Prefer tighter sub-bbox.
   ------------------------------------------------------------ */
function isLikelyValueOnlyBBox({ bbox, item, targetText }) {
    try {
        if (!bbox || !item?.bbox || !targetText) return false;
        const b = bbox.map(Number);
        const ib = item.bbox.map(Number);
        if (!b.every(Number.isFinite) || !ib.every(Number.isFinite)) return false;
        const bw = Math.abs(b[2] - b[0]);
        const iw = Math.abs(ib[2] - ib[0]);
        if (iw <= 0 || bw <= 0) return false;
        // If bbox equals whole item bbox while OCR text is much longer than target,
        // it's a whole-line bbox â€” not value-only.
        const exactMatch = b[0] === ib[0] && b[1] === ib[1] && b[2] === ib[2] && b[3] === ib[3];
        if (exactMatch) {
            const ocrText = cleanText(item.text);
            const target = cleanText(targetText);
            if (!ocrText || !target) return false;
            if (ocrText.toLowerCase().includes(target.toLowerCase()) && ocrText.length > target.length + 3) {
                return false; // whole line masquerading as value
            }
            return true;
        }
        // If bbox width is close to full width but target is substring -> unsafe
        const target = cleanText(targetText);
        const ocrText = cleanText(item.text);
        if (ocrText.toLowerCase().includes(target.toLowerCase()) && ocrText.length > target.length + 3) {
            const ratio = bw / iw;
            if (ratio > 0.92) return false;
        }
        return true;
    } catch {
        return false;
    }
}
/* Central value-bbox resolver â€” strict value-only geometry (Â§13)
   ONLY function to determine final redaction geometry. Prevents
   future paths from accidentally using whole OCR boxes.
   Algorithm Â§8:
    1. Find OCR item by OCR ID
    2. Check OCR text
    3. If exact equals sensitive value -> use OCR bbox
    4. Else if contains -> calculate value sub-bbox
    5. Else DO NOT use that OCR bbox
    6. Continue searching other supplied OCR IDs
    7. If no valid OCR value bbox: optionally use fused bbox ONLY if value-specific
    8. Otherwise reject/skip
   Forbidden: else if (ocrItem.bbox) push(whole bbox)
*/
function resolveSensitiveValueBBox({ text, ocrIds, evidence, fusedCandidate = null }) {
    try {
        const want = cleanText(text);
        if (!want) return null;
        const ocrById = new Map((evidence.ocr || []).map((o) => [o.id, o]));
        // Iterate only supplied OCR IDs â€” never invent bbox
        for (const oid of ocrIds || []) {
            const ocrItem = ocrById.get(oid);
            if (!ocrItem?.bbox) continue;
            const ocrText = cleanText(ocrItem.text);
            if (!ocrText) continue;
            const lowerOcr = ocrText.toLowerCase();
            const lowerWant = want.toLowerCase();
            // Exact equality -> use full OCR bbox (value is line)
            if (lowerOcr === lowerWant) {
                if (FASTVLM_DEBUG) console.log(`[GEOMETRY] resolved: candidate exact ocr_ids=${oid} bbox=[${ocrItem.bbox.map(n=>Math.round(n)).join(",")}]`);
                return [...ocrItem.bbox.map(Number)];
            }
            // Contains -> calculate value sub-bbox
            if (lowerOcr.includes(lowerWant)) {
                const sub = estimateTextSubBBox(ocrItem, want);
                if (sub) {
                    // Validate not whole line
                    if (!isLikelyValueOnlyBBox({ bbox: sub, item: ocrItem, targetText: want })) {
                        if (FASTVLM_DEBUG) console.log(`[SECURITY] rejecting non-value-specific bbox for "${want}" at ${oid}`);
                        continue;
                    }
                    if (FASTVLM_DEBUG) console.log(`[GEOMETRY] resolved: candidate sub-bbox ocr_ids=${oid} bbox=[${sub.map(n=>Math.round(n)).join(",")}]`);
                    return sub;
                }
                // If substring exists but sub-bbox failed, only allow fallback if OCR is essentially the value
                if (ocrText.length <= want.length + 2) {
                    return [...ocrItem.bbox.map(Number)];
                }
                continue;
            }
            // OCR does not contain value â€” ignore this OCR ID entirely (Â§9)
            if (FASTVLM_DEBUG) console.log(`[GEOMETRY] Skip OCR ${oid} does not contain value`);
        }
        // Â§11: fused fallback â€” only when no explicit value bbox found
        // Prefer OCR-derived sub-bbox from fused text, not blind fused.bbox
        if (fusedCandidate?.bbox) {
            const fusedText = cleanText(fusedCandidate.text);
            if (fusedText && fusedText.toLowerCase() === want.toLowerCase()) {
                // Try to locate fused text inside any OCR item that contains it for a value-specific bbox
                for (const oi of evidence.ocr || []) {
                    const ot = cleanText(oi.text);
                    if (!ot) continue;
                    if (ot.toLowerCase() === fusedText.toLowerCase()) {
                        return [...oi.bbox.map(Number)];
                    }
                    if (ot.toLowerCase().includes(fusedText.toLowerCase())) {
                        const sub = estimateTextSubBBox(oi, fusedText);
                        if (sub && isLikelyValueOnlyBBox({ bbox: sub, item: oi, targetText: fusedText })) return sub;
                    }
                }
                // For additional candidates (no fusedCandidate), allow direct fallback only if ocrIds empty
                if (!ocrIds || ocrIds.length === 0) {
                    // Validate fused bbox is value-specific before trusting
                    // Check if any OCR item's bbox equals fused bbox and that item is mixed -> reject
                    let isMixedWholeLine = false;
                    for (const oi of evidence.ocr || []) {
                        if (!oi.bbox) continue;
                        const same = oi.bbox[0]===fusedCandidate.bbox[0] && oi.bbox[1]===fusedCandidate.bbox[1] && oi.bbox[2]===fusedCandidate.bbox[2] && oi.bbox[3]===fusedCandidate.bbox[3];
                        if (same) {
                            const ot = cleanText(oi.text);
                            if (ot.toLowerCase().includes(fusedText.toLowerCase()) && ot.length > fusedText.length + 3) {
                                isMixedWholeLine = true;
                                break;
                            }
                        }
                    }
                    if (!isMixedWholeLine) {
                        if (FASTVLM_DEBUG) console.log(`[GEOMETRY] Fallback to fused bbox for value-only`);
                        return [...fusedCandidate.bbox.map(Number)];
                    } else {
                        if (FASTVLM_DEBUG) console.log(`[SECURITY] rejecting non-value-specific fused bbox`);
                    }
                }
            }
        }
        return null;
    } catch {
        return null;
    }
}

/* ============================================================
   PLACEHOLDER / NOISE FILTER
   Keeps obvious UI labels and example values out of the NER pass
   so we don't waste model calls (or raise false PII flags) on
   things like a literal "Email Address" field label.
   ============================================================ */

const EXACT_PLACEHOLDERS = new Set([
    "name@example.com", "user@example.com", "test@example.com",
    "example@example.com", "your@email.com", "yourname@example.com",
    "example.com", "enter your email", "enter email", "your email",
    "email address", "enter username", "your username", "username",
    "enter password", "your password", "password", "phone number",
    "enter phone number", "123456", "000000", "xxxx", "xxxxx", "********",
]);

const EXAMPLE_EMAIL_DOMAINS = new Set(["example.com", "example.org", "example.net"]);

function isExampleEmail(text) {
    const value = cleanText(text).toLowerCase();
    const match = value.match(/^[^\s@]+@([a-z0-9.-]+\.[a-z]{2,})$/i);
    return match ? EXAMPLE_EMAIL_DOMAINS.has(match[1]) : false;
}

function isPlaceholderText(text) {
    const value = cleanText(text).toLowerCase();
    if (!value) return true;
    if (EXACT_PLACEHOLDERS.has(value)) return true;
    if (isExampleEmail(value)) return true;
    return false;
}

function filterPlaceholderChunks(chunks) {
    return chunks.filter((chunk) => {
        if (!chunk || !chunk.text) return false;
        if (isPlaceholderText(chunk.text)) return false;
        return true;
    });
}

/* ============================================================

/* ============================================================
   OCR GLOBAL SPAN MAPPING
   Maps each OCR region back to its character offsets in the
   complete OCR text. Uses cursor-based sequential matching
   to handle duplicate UI text (e.g. multiple "Name" labels).
   ============================================================ */

function buildOCRGlobalSpans(ocr) {
    if (!ocr?.text || !ocr?.items) {
        return { text: ocr?.text ?? "", spans: [] };
    }

    const sourceText = ocr.text;
    const spans = [];
    let cursor = 0;

    for (const item of ocr.items) {
        const regionText = cleanText(item.text);
        if (!regionText) {
            continue;
        }

        // Search for the region text starting from current cursor position
        const matchIndex = sourceText.indexOf(regionText, cursor);

        if (matchIndex >= 0) {
            // Found exact match at or after cursor
            const start = matchIndex;
            const end = matchIndex + regionText.length;
            cursor = end;

            spans.push({
                id: item.id,
                text: regionText,
                originalText: item.text,
                bbox: item.bbox ?? null,
                confidence: item.confidence ?? null,
                start,
                end,
            });
        } else {
            // Fallback: try case-insensitive or whitespace-normalized match
            const normalizedSource = sourceText
                .slice(cursor)
                .replace(/\s+/g, " ");
            const normalizedRegion = regionText.replace(/\s+/g, " ");

            const fallbackIndex = normalizedSource.indexOf(normalizedRegion);

            if (fallbackIndex >= 0) {
                // Map back to approximate position in original text
                const approxStart = cursor + fallbackIndex;
                const approxEnd = approxStart + regionText.length;

                spans.push({
                    id: item.id,
                    text: regionText,
                    originalText: item.text,
                    bbox: item.bbox ?? null,
                    confidence: item.confidence ?? null,
                    start: approxStart,
                    end: approxEnd,
                });
                cursor = approxEnd;
            } else {
                // Cannot map this region confidently
                console.warn(
                    `[WARN] Could not map OCR region to global text: "${regionText}" (id: ${item.id})`
                );
                spans.push({
                    id: item.id,
                    text: regionText,
                    originalText: item.text,
                    bbox: item.bbox ?? null,
                    confidence: item.confidence ?? null,
                    start: null,
                    end: null,
                });
            }
        }
    }

    return { text: sourceText, spans };
}

/* ============================================================
   ENTITY SPAN TO OCR REGION MAPPING
   Maps a global character span from Ettin back to OCR regions.
   ============================================================ */

function findOCRRegionsForSpan(entityStart, entityEnd, ocrSpans) {
    const matchingRegions = [];

    for (const span of ocrSpans) {
        if (span.start === null || span.end === null) continue;

        // Check if entity span intersects with this OCR region
        const intersects =
            entityStart < span.end && entityEnd > span.start;

        if (intersects) {
            matchingRegions.push(span);
        }
    }

    return matchingRegions;
}

function buildFindingsFromEntity(entity, ocrSpans, entityType) {
    const regions = findOCRRegionsForSpan(
        entity.start,
        entity.end,
        ocrSpans
    );

    if (regions.length === 0) {
        // Entity couldn't be mapped to any OCR region
        return [{
            source_id: "unmapped",
            entity: entityType,
            score: entity.score,
            text: entity.text,
            bbox: null,
            start: entity.start,
            end: entity.end,
            mapped: false,
        }];
    }

    // Create a finding for each OCR region this entity covers
    return regions.map((region) => ({
        source_id: region.id,
        entity: entityType,
        score: entity.score,
        text: region.text,
        bbox: region.bbox,
        start: entity.start,
        end: entity.end,
        mapped: true,
    }));
}

/* ============================================================
   PHASE 1 Ã¢â‚¬" OCR READING ORDER (spatial, non-destructive)
   ============================================================ */

function buildReadingOrder(ocr) {
    if (!ocr?.items?.length) return { ordered: [], rows: [] };
    const items = ocr.items.map((it) => ({
        ...it,
        bbox: it.bbox ?? [0, 0, 0, 0],
        text: cleanText(it.text),
    }));
    // Row clustering by y center
    const sortedByY = [...items].sort((a, b) => {
        const ay = (a.bbox[1] + a.bbox[3]) / 2;
        const by = (b.bbox[1] + b.bbox[3]) / 2;
        return ay - by;
    });
    const rows = [];
    for (const item of sortedByY) {
        const cy = (item.bbox[1] + item.bbox[3]) / 2;
        const h = Math.max(1, item.bbox[3] - item.bbox[1]);
        const tol = Math.max(8, h * 0.6);
        let row = rows.find((r) => Math.abs(r.cy - cy) < tol);
        if (!row) {
            row = { cy, items: [] };
            rows.push(row);
        }
        row.items.push(item);
        // update cy as mean
        row.cy = row.items.reduce((s, it) => s + (it.bbox[1] + it.bbox[3]) / 2, 0) / row.items.length;
    }
    // Sort rows top-bottom, items left-right
    rows.sort((a, b) => a.cy - b.cy);
    let order = 0;
    const ordered = [];
    for (const row of rows) {
        row.items.sort((a, b) => a.bbox[0] - b.bbox[0]);
        for (const it of row.items) {
            ordered.push({ ...it, reading_order: order++ });
        }
    }
    return { ordered, rows };
}

/* ============================================================
   PHASE 2 Ã¢â‚¬" DETERMINISTIC CONTEXT ANALYZER
   ============================================================ */

const SENSITIVE_FIELD_VOCABULARY = [
    // Certificate / registration / application
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

function normalizeLabelForMatch(text) {
    let v = String(text ?? "").toLowerCase();
    // tolerate common OCR substitutions when matching labels only
    // do this before stripping punctuation so N0->no works
    v = v.replace(/0/g, "o");
    // normalize punctuation: . : - _ / all to space, collapse
    v = v.replace(/[.\-_:;\/\\]+/g, " ");
    v = v.replace(/\s+/g, " ").trim();
    // also tolerate 1/l/I confusion by normalizing single-char tokens? keep simple
    return v;
}

const NORMALIZED_VOCAB = SENSITIVE_FIELD_VOCABULARY.map((entry) => ({
    ...entry,
    normalized: normalizeLabelForMatch(entry.label),
}));

// longest normalized label first so "certificate number" wins over "certificate"
NORMALIZED_VOCAB.sort((a, b) => b.normalized.length - a.normalized.length);

function findFieldLabelMatch(text) {
    const norm = normalizeLabelForMatch(text);
    for (const entry of NORMALIZED_VOCAB) {
        if (norm === entry.normalized || norm.includes(entry.normalized) || entry.normalized.includes(norm)) {
            // require word-boundary-ish: check that matched label is not just substring of unrelated word
            // by ensuring normalized label appears as substring
            if (norm.includes(entry.normalized)) return entry;
            if (entry.normalized.includes(norm) && norm.length >= 3) return entry;
        }
    }
    // fuzzy: allow one-char difference for labels >=6 chars
    for (const entry of NORMALIZED_VOCAB) {
        if (Math.abs(norm.length - entry.normalized.length) > 2) continue;
        if (entry.normalized.length < 6) continue;
        let diffs = 0;
        const len = Math.min(norm.length, entry.normalized.length);
        for (let i = 0; i < len; i++) if (norm[i] !== entry.normalized[i]) diffs++;
        diffs += Math.abs(norm.length - entry.normalized.length);
        if (diffs <= 2) return entry;
    }
    return null;
}

function isPlausibleValue(text) {
    const v = String(text ?? "").trim();
    if (!v) return false;
    if (v.length < 2) return false;
    if (v.length > 80) return false;
    if (!/[a-z0-9]/i.test(v)) return false; // must contain alphanumeric
    if (/^[.,:;\/\-_]+$/.test(v)) return false;
    // reject ordinary long prose (many words, no identifier chars)
    const words = v.split(/\s+/);
    if (words.length > 8) return false;
    // FIX: strip leading ordinal like "13." / "14a." / "3)" before prose check so
    // "13. Do you have permanent U.S. Resident status?" is correctly classified
    // as prose/question, not a value, regardless of the leading number.
    const strippedForProse = v.replace(/^\s*\d+[a-z]?[.)]\s*/i, "");
    const proseWords = strippedForProse.split(/\s+/).filter(Boolean);
    if (proseWords.length > 4 && /^[a-z\s.,?()]+$/i.test(strippedForProse) && !/[\d\-_\/]/.test(strippedForProse)) return false;
    // Also reject if stripped form is long prose even with trailing punctuation (covers "?" / ")" cases)
    if (proseWords.length > 4 && !/[\d\-_\/]/.test(strippedForProse) && /^[a-z\s.,?()'"]+$/i.test(strippedForProse)) return false;
    // FIX: numbered field labels/questions like "9. Current Address", "2. Grades", "10. Phone Numbers"
    // are never plausible values â€” they are headers. If original starts with ordinal and stripped
    // contains no digits/@ (no PII-like chars), reject regardless of word count.
    if (/^\s*\d+[a-z]?[.)]\s+/i.test(v)) {
        const stripped = v.replace(/^\s*\d+[a-z]?[.)]\s*/i, "").trim();
        if (stripped && !/[\d@]/.test(stripped)) {
            // stripped is all letters/punct, no digits/email â€” it's a label, not a value
            // covers "9. Current Address" (2 words), "2. Grades" (1 word), "8. Place of Birth" etc.
            if (/^[a-z\s.,'()\/\-]+$/i.test(stripped)) return false;
        }
    }
    return true;
}

function extractLabelValueSameLine(ocrItems) {
    const candidates = [];
    // Ordered separator patterns â€” colon first (most specific), then hyphen/dash variants,
    // then 2+ spaces. Hyphen branch only accepted if label side is a known vocabulary entry,
    // so plain hyphenated prose does not create false positives.
    const SEPARATOR_PATTERNS = [
        /^(.+?):\s*(.+)$/,                 // "Label: value"
        /^(.+?[.:]?\s*[-â€“â€”]+)\s+(.+)$/,    // "Label.- value" / "Label- value" / "Label:- value" / "Reg. No.- value" (requires space after hyphen)
        /^(.+?)\s{2,}(.+)$/,               // "Label    value"
    ];
    for (const item of ocrItems) {
        const raw = String(item.text ?? "");
        let labelPart = null;
        let valuePart = null;
        let labelMatch = null;
        // Try each separator in order; keep first that BOTH matches regex AND is a known label
        for (const re of SEPARATOR_PATTERNS) {
            const m = raw.match(re);
            if (!m) continue;
            const candLabel = m[1];
            const candValue = m[2] ? m[2].trim() : "";
            if (!candLabel || !candValue) continue;
            const lm = findFieldLabelMatch(candLabel);
            if (!lm) continue; // hyphen split on non-label text â€” try next pattern (or skip)
            labelPart = candLabel;
            valuePart = candValue;
            labelMatch = lm;
            break;
        }
        if (!labelPart || !valuePart || !labelMatch) continue;
        if (!isPlausibleValue(valuePart)) continue;
        const valueBBox = estimateTextSubBBox(item, valuePart);
        // If value bbox cannot be confidently estimated, leave null (do NOT use full label+value bbox per Â§4)
        candidates.push({
            source: "deterministic_context",
            ocr_ids: [item.id],
            label: labelMatch.label,
            value: cleanText(valuePart),
            field_type: labelMatch.field_type,
            confidence: 0.98,
            reason: `Sensitive identifier value associated with ${labelMatch.label} label (same line)`,
            bbox: valueBBox ?? null,
            raw_text: raw,
        });
    }
    return candidates;
}

function extractLabelValueSideBySide(orderedItems, rows) {
    const candidates = [];
    // For each row, look for label item followed by value item to the right
    for (const row of rows) {
        const rowItems = [...row.items].sort((a, b) => a.bbox[0] - b.bbox[0]);
        for (let i = 0; i < rowItems.length; i++) {
            const labelItem = rowItems[i];
            const labelMatch = findFieldLabelMatch(labelItem.text);
            if (!labelMatch) continue;
            // candidate value is next item(s) to the right in same row
            for (let j = i + 1; j < rowItems.length; j++) {
                const valueItem = rowItems[j];
                const gap = valueItem.bbox[0] - labelItem.bbox[2];
                if (gap < -5) continue; // overlapping
                if (!isPlausibleValue(valueItem.text)) continue;
                // also need horizontal proximity â€” not across whole page without gap check
                candidates.push({
                    source: "deterministic_context",
                    ocr_ids: [labelItem.id, valueItem.id],
                    label: labelMatch.label,
                    value: cleanText(valueItem.text),
                    field_type: labelMatch.field_type,
                    confidence: 0.92,
                    reason: `Sensitive identifier value associated with ${labelMatch.label} label (side-by-side)`,
                    bbox: valueItem.bbox ?? null,
                    raw_text: `${labelItem.text} ${valueItem.text}`,
                });
                break; // only first value to the right
            }
        }
    }
    return candidates;
}

function extractLabelValueVertical(orderedItems, rows) {
    const candidates = [];
    const sortedRows = [...rows].sort((a, b) => a.cy - b.cy);
    for (let r = 0; r < sortedRows.length - 1; r++) {
        const labelRow = sortedRows[r];
        const valueRow = sortedRows[r + 1];
        const verticalGap = Math.min(...valueRow.items.map((it) => it.bbox[1])) - Math.max(...labelRow.items.map((it) => it.bbox[3]));
        if (verticalGap < 0 || verticalGap > 50) continue;
        // find label in upper row
        for (const labelItem of labelRow.items) {
            const labelMatch = findFieldLabelMatch(labelItem.text);
            if (!labelMatch) continue;
            // check value row has plausible value with horizontal overlap
            for (const valueItem of valueRow.items) {
                const overlapLeft = Math.max(labelItem.bbox[0], valueItem.bbox[0]);
                const overlapRight = Math.min(labelItem.bbox[2], valueItem.bbox[2]);
                const overlap = Math.max(0, overlapRight - overlapLeft);
                const maxW = Math.max(labelItem.bbox[2] - labelItem.bbox[0], valueItem.bbox[2] - valueItem.bbox[0]);
                const ratio = maxW > 0 ? overlap / maxW : 0;
                const centerDx = Math.abs((labelItem.bbox[0] + labelItem.bbox[2]) / 2 - (valueItem.bbox[0] + valueItem.bbox[2]) / 2);
                if (ratio < 0.15 && centerDx > maxW * 0.8) continue;
                if (!isPlausibleValue(valueItem.text)) continue;
                candidates.push({
                    source: "deterministic_context",
                    ocr_ids: [labelItem.id, valueItem.id],
                    label: labelMatch.label,
                    value: cleanText(valueItem.text),
                    field_type: labelMatch.field_type,
                    confidence: 0.90,
                    reason: `Sensitive identifier value associated with ${labelMatch.label} label (vertical)`,
                    bbox: valueItem.bbox ?? null,
                    raw_text: `${labelItem.text} / ${valueItem.text}`,
                });
            }
        }
    }
    return candidates;
}

function extractMultiLineLabel(ocrItems, rows) {
    const candidates = [];
    const sortedRows = [...rows].sort((a, b) => a.cy - b.cy);
    for (let r = 0; r < sortedRows.length - 1; r++) {
        // Check if two consecutive rows together form a label, third row is value â€” simplified: label spans 2 lines
        const upperRow = sortedRows[r];
        const middleRow = sortedRows[r + 1];
        // try combining one item from upper + one from middle as multi-line label
        for (const u of upperRow.items) {
            for (const m of middleRow.items) {
                const combined = `${u.text} ${m.text}`;
                const labelMatch = findFieldLabelMatch(combined);
                if (!labelMatch) continue;
                // value could be same middle row after label, or next row
                // case: "Certificate" (row0) + "Number: ABC123XY98" (row1) â€” value in middle row itself
                const colonIdx = m.text.indexOf(":");
                if (colonIdx >= 0) {
                    const after = m.text.slice(colonIdx + 1).trim();
                    if (isPlausibleValue(after)) {
                        const afterBBox = estimateTextSubBBox(m, after);
                        candidates.push({
                            source: "deterministic_context",
                            ocr_ids: [u.id, m.id],
                            label: labelMatch.label,
                            value: cleanText(after),
                            field_type: labelMatch.field_type,
                            confidence: 0.88,
                            reason: `Sensitive identifier value associated with ${labelMatch.label} label (multi-line label)`,
                            bbox: afterBBox ?? null,
                            raw_text: combined,
                        });
                        continue;
                    }
                }
                // value in next row
                if (r + 2 < sortedRows.length) {
                    const valueRow = sortedRows[r + 2];
                    for (const v of valueRow.items) {
                        if (!isPlausibleValue(v.text)) continue;
                        candidates.push({
                            source: "deterministic_context",
                            ocr_ids: [u.id, m.id, v.id],
                            label: labelMatch.label,
                            value: cleanText(v.text),
                            field_type: labelMatch.field_type,
                            confidence: 0.86,
                            reason: `Sensitive identifier value associated with ${labelMatch.label} label (multi-line label + vertical value)`,
                            bbox: v.bbox ?? null,
                            raw_text: `${combined} / ${v.text}`,
                        });
                    }
                }
            }
        }
    }
    return candidates;
}

function extractSensitiveFieldCandidates(ocr) {
    if (!ocr?.items?.length) return [];
    const { ordered, rows } = buildReadingOrder(ocr);
    const sameLine = extractLabelValueSameLine(ocr.items);
    const sideBySide = extractLabelValueSideBySide(ordered, rows);
    const vertical = extractLabelValueVertical(ordered, rows);
    const multiLine = extractMultiLineLabel(ocr.items, rows);
    const all = [...sameLine, ...sideBySide, ...vertical, ...multiLine];
    // Deduplicate by ocr_ids+value
    const seen = new Map();
    for (const c of all) {
        const key = `${c.field_type}|${c.value}|${[...c.ocr_ids].sort().join(",")}`;
        if (!seen.has(key) || seen.get(key).confidence < c.confidence) seen.set(key, c);
    }
    // Also deduplicate by value alone if same field_type and overlapping bbox/value
    const deduped = [...seen.values()];
    // Prefer same-line over side-by-side when same value
    deduped.sort((a, b) => b.confidence - a.confidence);
    const finalMap = new Map();
    for (const c of deduped) {
        const vkey = `${c.field_type}|${c.value}`;
        if (!finalMap.has(vkey)) finalMap.set(vkey, c);
    }
    return [...finalMap.values()];
}


function normalizeCandidateText(t) {
    return cleanText(t).toLowerCase();
}

function isContained(smaller, larger) {
    const s = normalizeCandidateText(smaller);
    const l = normalizeCandidateText(larger);
    if (!s || !l) return false;
    if (s === l) return false;
    return l.includes(s);
}

function fuseRedactionCandidates({ ettinFindings = [], deterministicFindings = [] }) {
    const raw = [];
    let cid = 0;
    const nextId = () => `cand_${String(cid++).padStart(3, "0")}`;

    for (const f of ettinFindings) {
        const text = cleanText(f.text);
        if (!text) continue;
        const ocrIds = f.source_id && f.source_id !== "unmapped" ? [f.source_id] : [];
        raw.push({
            candidate_id: nextId(),
            ocr_ids: ocrIds,
            text,
            label_context: null,
            candidate_types: [f.entity ?? "UNKNOWN"],
            sources: ["ettin"],
            confidence: Number(f.score ?? 0),
            bbox: f.bbox ?? null,
            original: f,
        });
    }
    for (const d of deterministicFindings) {
        raw.push({
            candidate_id: nextId(),
            ocr_ids: [...(d.ocr_ids ?? [])],
            text: cleanText(d.value),
            label_context: d.label ?? null,
            candidate_types: [d.field_type ?? "UNKNOWN"],
            sources: ["deterministic_context"],
            confidence: Number(d.confidence ?? 0.9),
            bbox: d.bbox ?? null,
            original: d,
        });
    }

    // Merge duplicate sources that share same text+ocr_ids: boost confidence, merge sources
    const byKey = new Map();
    for (const c of raw) {
        const key = `${normalizeCandidateText(c.text)}|${[...c.ocr_ids].sort().join(",")}`;
        if (!byKey.has(key)) byKey.set(key, c);
        else {
            const existing = byKey.get(key);
            existing.sources = [...new Set([...existing.sources, ...c.sources])];
            existing.candidate_types = [...new Set([...existing.candidate_types, ...c.candidate_types])];
            existing.confidence = Math.max(existing.confidence, c.confidence);
            if (!existing.label_context && c.label_context) existing.label_context = c.label_context;
            if (!existing.bbox && c.bbox) existing.bbox = c.bbox;
        }
    }
    let candidates = [...byKey.values()];

    // Containment rule: if smaller text fully contained in larger text and shares OCR region or overlaps,
    // keep larger only. Also handle same OCR region containment.
    // Sort by text length descending so larger wins.
    candidates.sort((a, b) => b.text.length - a.text.length || b.confidence - a.confidence);
    const keep = [];
    for (const c of candidates) {
        let contained = false;
        for (const k of keep) {
            const sameRegion = c.ocr_ids.length && k.ocr_ids.length && c.ocr_ids.some((id) => k.ocr_ids.includes(id));
            const textContained = isContained(c.text, k.text);
            if (textContained && sameRegion) {
                contained = true;
                // merge evidence into keeper if smaller had deterministic label
                if (!k.label_context && c.label_context) k.label_context = c.label_context;
                k.sources = [...new Set([...k.sources, ...c.sources])];
                k.candidate_types = [...new Set([...k.candidate_types, ...c.candidate_types])];
                break;
            }
            // also handle bbox overlap containment when bboxes exist
            if (c.bbox && k.bbox && textContained) {
                const overlap = !(c.bbox[2] < k.bbox[0] || c.bbox[0] > k.bbox[2] || c.bbox[3] < k.bbox[1] || c.bbox[1] > k.bbox[3]);
                if (overlap) { contained = true; break; }
            }
        }
        if (!contained) keep.push(c);
    }

    // Do not merge adjacent non-overlapping entities solely by proximity
    return keep;
}

/* ============================================================
   UI STRUCTURE ANALYSIS
    Generic geometry-based UI role detection from OCR + image geometry.
    NO additional ML model required Ã¢â‚¬" uses OCR bboxes, text, and image dims.
   ============================================================ */

// ---- Normalize a single OCR item geometry ----

function normalizeOcrItem(item, imageWidth, imageHeight) {
    const bbox = item.bbox ? item.bbox : [0, 0, 0, 0];
    const x1 = bbox[0];
    const y1 = bbox[1];
    const x2 = bbox[2];
    const y2 = bbox[3];
    const width = Math.max(0, x2 - x1);
    const height = Math.max(0, y2 - y1);
    const centerX = x1 + width / 2;
    const centerY = y1 + height / 2;

    return {
        id: item.id,
        text: cleanText(item.text),
        originalText: item.text,
        bbox: [x1, y1, x2, y2],
        x1, y1, x2, y2,
        width, height,
        centerX, centerY,
        // Normalized coordinates (0-1 range)
        normX1: x1 / imageWidth,
        normY1: y1 / imageHeight,
        normX2: x2 / imageWidth,
        normY2: y2 / imageHeight,
        normWidth: width / imageWidth,
        normHeight: height / imageHeight,
        normCenterX: centerX / imageWidth,
        normCenterY: centerY / imageHeight,
    };
}

// ---- Geometric relationships between two normalized OCR items ----

function computeRelationship(itemA, itemB, imageWidth, imageHeight) {
    const dx = Math.abs(itemA.centerX - itemB.centerX);
    const dy = Math.abs(itemA.centerY - itemB.centerY);
    const minWidth = Math.min(itemA.width, itemB.width);
    const minHeight = Math.min(itemA.height, itemB.height);

    // Tolerances relative to image size and text dimensions
    const heightTol = Math.max(8, minHeight * 0.5);
    const widthTol = Math.max(8, minWidth * 0.5);

    // Horizontal overlap
    const overlapX = Math.max(0, Math.min(itemA.x2, itemB.x2) - Math.max(itemA.x1, itemB.x1));
    const overlapY = Math.max(0, Math.min(itemA.y2, itemB.y2) - Math.max(itemA.y1, itemB.y1));
    const overlaps = (overlapX > 0 && overlapY > 0);

    // Same row: vertical centers close relative to their heights
    const sameRow = dy < heightTol;

    // Same column: horizontal centers close relative to their widths
    const sameColumn = dx < widthTol;

    // Above: A's bottom is above B's top with small gap
    const above = itemA.y2 < itemB.y1 - 2;

    // Below: A's bottom is below B's top with small gap
    const below = itemA.y1 > itemB.y2 + 2;

    // Left of: A's right is left of B's left with small gap
    const leftOf = itemA.x2 < itemB.x1 - 2;

    // Right of: A's right is right of B's left with small gap
    const rightOf = itemA.x1 > itemB.x2 + 2;

    // Horizontally aligned: vertical centers within tolerance
    const horizontallyAligned = dy < heightTol;

    // Vertically aligned: horizontal centers within tolerance
    const verticallyAligned = dx < widthTol;

    // Near: generally close (both dx and dy small relative to dimensions)
    const near = dx < widthTol + 20 && dy < heightTol + 20;

    // Significant horizontal overlap (more than 30% of either text width)
    const significantOverlap = overlapX > Math.max(itemA.width, itemB.width) * 0.3;

    // Significant vertical overlap
    const significantVerticalOverlap = overlapY > Math.max(itemA.height, itemB.height) * 0.3;

    // One contains the other (bbox containment)
    const contains =
        itemA.x1 <= itemB.x1 && itemA.y1 <= itemB.y1 &&
        itemA.x2 >= itemB.x2 && itemA.y2 >= itemB.y2;

    // Reverse containment
    const containsReverse =
        itemB.x1 <= itemA.x1 && itemB.y1 <= itemA.y1 &&
        itemB.x2 >= itemA.x2 && itemB.y2 >= itemA.y2;

    // Same vertical position (centers within 10% of image height)
    const sameVerticalPosition = Math.abs(itemA.normCenterY - itemB.normCenterY) < 0.1;

    // Same horizontal position (centers within 10% of image width)
    const sameHorizontalPosition = Math.abs(itemA.normCenterX - itemB.normCenterX) < 0.1;

    // Estimate if two regions are likely in the same container
    const likelySameContainer = (dx < imageWidth * 0.3 && dy < imageHeight * 0.3) ||
        (significantOverlap && !sameRow) ||
        (significantVerticalOverlap && sameRow);

    return {
        sameRow,
        sameColumn,
        above,
        below,
        leftOf,
        rightOf,
        near,
        overlaps,
        horizontallyAligned,
        verticallyAligned,
        significantOverlap,
        significantVerticalOverlap,
        contains,
        containsReverse,
        likelySameContainer,
        sameVerticalPosition,
        sameHorizontalPosition,
    };
}

// ---- Detect horizontal sibling groups (segmented controls/tabs) ----

function detectHorizontalGroups(items) {
    // Cluster items that are on the same row, horizontally separated,
    // with similar heights, suggesting a segmented control/tab group.

    if (items.length < 2) return [];

    // Sort by centerY then centerX
    const sorted = [...items].sort((a, b) =>
        a.centerY - b.centerY || a.centerX - b.centerX
    );

    // Group items by row (clustering by centerY)
    const rows = [];
    for (const item of sorted) {
        const matchedRow = rows.find(row => {
            // Check if this item's centerY is close to any existing row
            return Math.abs(item.centerY - row.refCenterY) < (item.height * 0.5 + 6);
        });

        if (matchedRow) {
            matchedRow.items.push(item);
            // Update reference center
            matchedRow.refCenterY = (matchedRow.refCenterY * (matchedRow.items.length - 1) + item.centerY) / matchedRow.items.length;
            // Re-sort row by centerX
            matchedRow.items.sort((a, b) => a.centerX - b.centerX);
        } else {
            rows.push({
                refCenterY: item.centerY,
                items: [item],
            });
        }
    }

    // For each row with 2+ items, check if they form a horizontal group
    const groups = [];
    for (const row of rows) {
        if (row.items.length < 2) continue;

        // Check: are they horizontally separated but on same row?
        // And do they have similar heights?
        const heights = row.items.map(i => i.height);
        const heightMean = heights.reduce((a, b) => a + b, 0) / heights.length;
        const heightVariance = heights.reduce((a, b) => a + Math.pow(b - heightMean, 2), 0) / heights.length;
        const heightStd = Math.sqrt(heightVariance);
        const heightCoeff = heightStd / Math.max(heightMean, 1);

        // Items must be on same row (vertical alignment) and horizontally separated
        const areHorizontallySeparated = row.items.slice(1).every((it, i) =>
            it.centerX > row.items[0].centerX + Math.max(it.width, row.items[0].width) * 0.3
        );

        const haveSimilarHeight = heightCoeff < 0.5;

        if (areHorizontallySeparated && haveSimilarHeight) {
            // Sort by centerX
            const sortedItems = [...row.items].sort((a, b) => a.centerX - b.centerX);
            const bbox = [
                sortedItems[0].x1,
                Math.min(...sortedItems.map(i => i.y1)),
                sortedItems[sortedItems.length - 1].x2,
                Math.max(...sortedItems.map(i => i.y2)),
            ];

            groups.push({
                id: `group_${groups.length.toString().padStart(3, '0')}`,
                type: "segmented_control",
                bbox,
                children: sortedItems.map(item => item.id),
                confidence: 0.7 + 0.3 * (sortedItems.length / 4),
                evidence: ["same_row", "similar_height", "horizontal_siblings"],
            });
        }
    }

    return groups;
}

// ---- Detect label-value input candidates ----

function detectInputCandidates(items) {
    const candidates = [];

    // For each pair of items, check if one is above another forming a label-value pair
    for (let i = 0; i < items.length; i++) {
        for (let j = 0; j < items.length; j++) {
            if (i === j) continue;

            const a = items[i];
            const b = items[j];

            // Skip if either has very short text (likely not a label or value)
            if (a.text.length < 2 || b.text.length < 2) continue;

            // Check if B is below A (label above value pattern)
            // Conditions:
            // - B is below A (a.y2 < b.y1 with small gap)
            // - Significant horizontal overlap (they're aligned)
            // - Small vertical gap
            // - Reasonable width alignment

            const gap = b.y1 - a.y2;
            if (gap > 0 && gap < 40) { // Small vertical gap
                // Check horizontal overlap/alignment
                const overlapLeft = Math.max(a.x1, b.x1);
                const overlapRight = Math.min(a.x2, b.x2);
                const horizontalOverlap = Math.max(0, overlapRight - overlapLeft);
                const maxWidth = Math.max(a.width, b.width);
                const overlapRatio = maxWidth > 0 ? horizontalOverlap / maxWidth : 0;

                // Also check center alignment
                const centerDx = Math.abs(a.centerX - b.centerX);

                // Strong candidate: good horizontal overlap AND centered
                if (overlapRatio > 0.3 && centerDx < a.width * 0.5) {
                    candidates.push({
                        type: "input_candidate",
                        label_ocr_id: a.id,
                        value_ocr_id: b.id,
                        confidence: 0.5 + 0.3 * overlapRatio + 0.2 * (1 - centerDx / Math.max(a.width, 1)),
                        evidence: ["vertical_pair", "horizontal_alignment", "close_spacing"],
                        label_text: a.text,
                        value_text: b.text,
                    });
                }

                // Weak candidate: just vertically close with some alignment
                if (overlapRatio > 0.15 && centerDx < a.width * 1.0) {
                    candidates.push({
                        type: "input_candidate",
                        label_ocr_id: a.id,
                        value_ocr_id: b.id,
                        confidence: 0.3 + 0.4 * overlapRatio,
                        evidence: ["vertical_pair", "some_alignment"],
                        label_text: a.text,
                        value_text: b.text,
                    });
                }
            }
        }
    }

    // Deduplicate: if two candidates share the same value_ocr_id, keep the higher-confidence one
    const seenValueIds = new Set();
    const filtered = candidates.filter(candidate => {
        if (seenValueIds.has(candidate.value_ocr_id)) return false;
        seenValueIds.add(candidate.value_ocr_id);
        return true;
    });

    return filtered;
}

// ---- Detect button candidates ----

function detectButtonCandidates(items, imageWidth, imageHeight) {
    const candidates = [];

    for (const item of items) {
        if (!item.text) continue;
        const text = cleanText(item.text);
        if (!text) continue;

        // Skip very long text (likely not a button)
        if (text.length > 30) continue;

        // Button criteria (geometry-focused):
        // 1. Reasonably compact region (not too tall, not too wide)
        const aspectRatio = item.width / Math.max(item.height, 1);
        const isCompact = item.width < imageWidth * 0.6 && item.height < imageHeight * 0.3;

        // 2. Positioned below the main form area (typical for login forms)
        //    - y position is in the lower portion of the image
        const isBelowForm = item.normCenterY > 0.4;

        // 3. Isolated from body text (not near long paragraphs)
        //    - relatively short height compared to image
        const isIsolated = item.height < imageHeight * 0.25;

        let score = 0;
        let reasons = [];

        if (isCompact) {
            score += 0.3;
            reasons.push("compact_region");
        }
        if (isBelowForm) {
            score += 0.3;
            reasons.push("below_form");
        }
        if (isIsolated) {
            score += 0.2;
            reasons.push("isolated");
        }

        // Minimum score to qualify as button candidate
        if (score >= 0.75) {
            candidates.push({
                type: "button_candidate",
                text_ocr_id: item.id,
                confidence: Math.min(0.9, 0.5 + score * 0.7),
                evidence: reasons,
                text: text,
                bbox: item.bbox,
                normCenterX: item.normCenterX,
                normCenterY: item.normCenterY,
            });
        }
    }

    return candidates;
}

// ---- Detect link candidates ----

function detectLinkCandidates(items) {
    const candidates = [];

    for (const item of items) {
        if (!item.text) continue;
        const text = cleanText(item.text);
        if (!text) continue;

        // Skip very long text
        if (text.length > 40) continue;

        // Link-like semantic signals (weak, used with geometry)
        const lower = text.toLowerCase();
        const linkKeywords = ["forgot", "reset", "sign up", "login", "contact", "support",
            "previous", "next", "back", "home", "close", "cancel", "submit"];

        const hasLinkKeyword = linkKeywords.some(kw => lower.includes(kw));

        // Isolated text signal
        const isIsolated = item.height < 40;

        let score = 0;
        let reasons = [];

        if (hasLinkKeyword) {
            score += 0.3;
            reasons.push("link_keyword");
        }
        if (isIsolated) {
            score += 0.3;
            reasons.push("isolated");
        }

        if (score >= 0.3) {
            candidates.push({
                type: "link_candidate",
                text_ocr_id: item.id,
                confidence: Math.min(0.85, 0.4 + score * 0.7),
                evidence: reasons,
                text: text,
                bbox: item.bbox,
            });
        }
    }

    return candidates;
}

// ---- Detect containers/parent regions ----

function detectContainers(items, imageWidth, imageHeight) {
    // Try to infer visual containers around clusters of OCR regions.
    // Uses a simple approach: if a group of OCR items are tightly clustered
    // within a rectangular area, infer a container.

    if (items.length < 2) return [];

    // Sort by centerX then centerY
    const sorted = [...items].sort((a, b) => a.centerY - b.centerY || a.centerX - b.centerX);

    // Cluster items: find groups that are close together
    const clusters = [];
    const visited = new Set();

    for (let i = 0; i < sorted.length; i++) {
        const itemI = sorted[i];
        if (visited.has(itemI.id)) continue;

        const cluster = [itemI];
        visited.add(itemI.id);

        for (let j = i + 1; j < sorted.length; j++) {
            const itemJ = sorted[j];
            if (visited.has(itemJ.id)) continue;

            // Check if itemJ is close to any item in the cluster
            const clusterItem = cluster[0]; // Use first as reference
            const dx = Math.abs(itemJ.centerX - clusterItem.centerX);
            const dy = Math.abs(itemJ.centerY - clusterItem.centerY);

            // Close if within half the sum of widths/heights + some margin
            const close = dx < (clusterItem.width + itemJ.width) * 0.5 + 20 &&
                dy < (clusterItem.height + itemJ.height) * 0.5 + 20;

            if (close) {
                cluster.push(itemJ);
                visited.add(itemJ.id);
            }
        }

        if (cluster.length >= 2) {
            // Compute cluster bounding box
            const bbox = [
                Math.min(...cluster.map(i => i.x1)),
                Math.min(...cluster.map(i => i.y1)),
                Math.max(...cluster.map(i => i.x2)),
                Math.max(...cluster.map(i => i.y2)),
            ];

            // Only create container if it has reasonable size (not the whole image)
            const containerWidth = bbox[2] - bbox[0];
            const containerHeight = bbox[3] - bbox[1];
            const isReasonableSize = containerWidth < imageWidth * 0.8 && containerHeight < imageHeight * 0.8;

            if (isReasonableSize) {
                clusters.push({
                    id: `container_${clusters.length.toString().padStart(3, '0')}`,
                    bbox,
                    itemIds: cluster.map(i => i.id),
                    confidence: 0.5 + 0.3 * Math.min(cluster.length / 6, 1),
                    evidence: ["clustered_regions"],
                });
            }
        }
    }

    return clusters;
}

// ---- Main UI structure builder ----

/**
 * Builds a UI structure analysis from screenshot, OCR, and optional FastVLM caption.
 *
 * @param {Object} params - Parameters object
 * @param {Object} params.image - Image with width/height
 * @param {Object} params.ocr - OCR result with items array
 * @param {Object} params.fastvlm - Optional FastVLM caption result
 * @returns {Object} UI structure with elements, groups, relationships, containers
 */
function buildUIStructure({ image, ocr, fastvlm }) {
    const imageWidth = image.width;
    const imageHeight = image.height;

    // 1. Normalize all OCR items
    const normalizedItems = ocr.items.map(item =>
        normalizeOcrItem(item, imageWidth, imageHeight)
    ).filter(item => item.text && item.text.length > 0);

    // 2. Compute all pairwise relationships
    const relationships = [];
    for (let i = 0; i < normalizedItems.length; i++) {
        for (let j = i + 1; j < normalizedItems.length; j++) {
            const rel = computeRelationship(normalizedItems[i], normalizedItems[j], imageWidth, imageHeight);

            if (rel.sameRow || rel.sameColumn || rel.above || rel.below ||
                rel.overlaps || rel.contains || rel.containsReverse || rel.likelySameContainer) {
                relationships.push({
                    ocr_id_a: normalizedItems[i].id,
                    ocr_id_b: normalizedItems[j].id,
                    ...rel,
                });
            }
        }
    }

    // 3. Detect horizontal sibling groups (segmented controls/tabs)
    const groups = detectHorizontalGroups(normalizedItems);

    // 4. Detect input candidates (label above value)
    const inputCandidates = detectInputCandidates(normalizedItems);

    // 5. Detect button candidates
    const buttonCandidates = detectButtonCandidates(normalizedItems, imageWidth, imageHeight);

    // 6. Detect link candidates
    const linkCandidates = detectLinkCandidates(normalizedItems);

    // 7. Detect containers
    const containers = detectContainers(normalizedItems, imageWidth, imageHeight);

    // 8. Build elements summary
    const elements = normalizedItems.map(item => ({
        id: item.id,
        text: item.text,
        bbox: item.bbox,
        centerX: item.centerX,
        centerY: item.centerY,
        normCenterX: item.normCenterX,
        normCenterY: item.normCenterY,
        width: item.width,
        height: item.height,
    }));

    return {
        imageWidth,
        imageHeight,
        elements,
        groups,
        relationships,
        inputCandidates,
        buttonCandidates,
        linkCandidates,
        containers,
    };
}


export {
    asString,
    cleanText,
    estimateTextSubBBox,
    _proportionalBBox,
    isLikelyValueOnlyBBox,
    isExampleEmail,
    isPlaceholderText,
    filterPlaceholderChunks,
    buildOCRGlobalSpans,
    findOCRRegionsForSpan,
    buildFindingsFromEntity,
    buildReadingOrder,
    SENSITIVE_FIELD_VOCABULARY,
    normalizeLabelForMatch,
    findFieldLabelMatch,
    isPlausibleValue,
    extractLabelValueSameLine,
    extractLabelValueSideBySide,
    extractLabelValueVertical,
    extractMultiLineLabel,
    extractSensitiveFieldCandidates,
    resolveSensitiveValueBBox,
    normalizeCandidateText,
    isContained,
    fuseRedactionCandidates,
    normalizeOcrItem,
    computeRelationship,
    detectHorizontalGroups,
    detectInputCandidates,
    detectButtonCandidates,
    detectLinkCandidates,
    detectContainers,
    buildUIStructure
};
