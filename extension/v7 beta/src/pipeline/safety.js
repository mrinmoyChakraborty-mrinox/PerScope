// Safety gating, JSON validation, and candidate adjudication ported 1:1 from v7.mjs

/* ---- Constants matching v7.mjs ---- */
const FASTVLM_DEBUG = false; // set to true for verbose geometry logs
const FINAL_REDACTION_CONFIDENCE_THRESHOLD = 0.5;
const FALLBACK_CONFIDENCE_THRESHOLD = 0.72;

import {
  cleanText,
  estimateTextSubBBox,
  isLikelyValueOnlyBBox,
  findFieldLabelMatch,
  isPlausibleValue,
  resolveSensitiveValueBBox,
  normalizeCandidateText,
  isContained,
} from "./heuristics.js";
import { clampBBox } from "./canvas-redactor.js";
import { ALLOWED_FASTVLM_TYPES } from "./prompts.js";


function extractJsonObject(text) {
    let s = String(text ?? "").trim();
    if (!s) throw new Error("No JSON object found in FastVLM output");
    // 1: Remove markdown code fences if present (handles ```json ... ``` and ``` ... ```)
    s = s.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();
    // 2: Remove <think>...</think> if accidentally emitted
    s = s.replace(/<think>[\s\S]*?<\/think>\s*/gi, "").trim();
    // 3: Try to find JSON object with brace depth (tolerant to single quotes -> double quotes)
    // Normalize single-quoted JSON to double quotes for salvage attempt
    let candidate = s;
    const first = candidate.indexOf("{");
    if (first === -1) {
        // No object found - try to see if model output a raw array like "redactions": [...]
        // Try to salvage by wrapping in braces
        const arrIdx = candidate.indexOf('"redactions"');
        if (arrIdx !== -1) {
            candidate = "{" + candidate.slice(arrIdx);
        } else {
            throw new Error("No JSON object found in FastVLM output. Preview: " + candidate.slice(0, 400));
        }
    }
    const startIdx = candidate.indexOf("{");
    if (startIdx === -1) throw new Error("No JSON object found in FastVLM output. Preview: " + candidate.slice(0, 400));
    let depth = 0;
    let end = -1;
    let inString = false;
    let escape = false;
    // Use the candidate string for brace matching to avoid issues with preceding prose
    const src = candidate;
    const base = startIdx;
    for (let i = base; i < src.length; i++) {
        const ch = src[i];
        if (inString) {
            if (escape) escape = false;
            else if (ch === "\\") escape = true;
            else if (ch === '"') inString = false;
        } else {
            if (ch === '"') inString = true;
            else if (ch === "{") depth++;
            else if (ch === "}") {
                depth--;
                if (depth === 0) { end = i; break; }
            }
        }
    }
    if (end === -1) {
        // Truncated - try to auto-close by counting open braces and appending }
        if (depth > 0) {
            // Attempt to recover truncated JSON by closing braces
            const jsonStrTrunc = src.slice(base) + "}".repeat(depth);
            try {
                JSON.parse(jsonStrTrunc);
                console.warn("[FASTVLM] Recovered truncated JSON by auto-closing braces");
                return jsonStrTrunc;
            } catch {}
        }
        throw new Error("JSON output truncated or incomplete. Preview: " + src.slice(base, base+500));
    }
    // JSON-compliance repair (attempt-only, never corrupting): the 0.5B model
    // emits JS-object-literal shape with UNQUOTED keys
    // ({redactions: [..], caption: ".."}). Try quoting bare keys; success is
    // proven by JSON.parse — on failure the exact original slice is returned
    // and the caller follows the normal path. String contents may contain
    // `word:` patterns the regex also quotes, but a mangled string still
    // fails parse, so repair can only turn failure into success, never
    // success into failure.
    const rawSlice = src.slice(base, end + 1);
    const repairedSlice = rawSlice.replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*:)/g, '$1"$2"$3');
    if (repairedSlice !== rawSlice) {
        try {
            JSON.parse(repairedSlice);
            console.warn("[FASTVLM] Repaired unquoted JSON keys");
            return repairedSlice;
        } catch {}
    }
    return rawSlice;
}

function normalizeFastVLMRedactionItem(r, evidence) {
    if (!r) return null;
    const fusedById = new Map((evidence?.fused_candidates || []).map(c => [c.candidate_id, c]));
    const ocrById = new Map((evidence?.ocr || []).map(o => [o.id, o]));

    if (typeof r === "string") {
        const rawId = r.trim();
        if (fusedById.has(rawId)) {
            const c = fusedById.get(rawId);
            return {
                candidate_id: c.candidate_id,
                ocr_ids: c.ocr_ids || [],
                text: c.text,
                type: c.candidate_types?.[0] || "person",
                confidence: c.confidence ?? 0.9,
                reason: "fastvlm approved candidate",
                decision_source: "fastvlm_existing"
            };
        }
        if (ocrById.has(rawId)) {
            const o = ocrById.get(rawId);
            const matchingFused = (evidence?.fused_candidates || []).find(c => (c.ocr_ids || []).includes(rawId));
            return {
                candidate_id: matchingFused?.candidate_id || `fastvlm_${rawId}`,
                ocr_ids: [rawId],
                text: matchingFused?.text || o.text,
                type: matchingFused?.candidate_types?.[0] || "person",
                confidence: matchingFused?.confidence ?? (o.confidence ?? 0.9),
                reason: "fastvlm approved ocr id",
                decision_source: matchingFused ? "fastvlm_existing" : "fastvlm_additional"
            };
        }
        const matchByText = (evidence?.fused_candidates || []).find(c => normalizeCandidateText(c.text) === normalizeCandidateText(rawId));
        if (matchByText) {
            return {
                candidate_id: matchByText.candidate_id,
                ocr_ids: matchByText.ocr_ids || [],
                text: matchByText.text,
                type: matchByText.candidate_types?.[0] || "person",
                confidence: matchByText.confidence ?? 0.9,
                reason: "fastvlm approved text",
                decision_source: "fastvlm_existing"
            };
        }
        return {
            candidate_id: `fastvlm_${rawId}`,
            ocr_ids: [],
            text: rawId,
            type: "person",
            confidence: 0.9,
            decision_source: "fastvlm_additional"
        };
    }

    if (typeof r === "object") {
        let candidate_id = r.candidate_id;
        let ocr_ids = Array.isArray(r.ocr_ids) ? r.ocr_ids : (r.ocr_id ? [r.ocr_id] : (r.source_id ? [r.source_id] : []));
        let matchingFused = candidate_id ? fusedById.get(candidate_id) : null;
        if (!matchingFused && ocr_ids.length > 0) {
            matchingFused = (evidence?.fused_candidates || []).find(c => (c.ocr_ids || []).some(id => ocr_ids.includes(id)));
            if (matchingFused && !candidate_id) candidate_id = matchingFused.candidate_id;
        }
        if (!matchingFused && r.text) {
            matchingFused = (evidence?.fused_candidates || []).find(c => normalizeCandidateText(c.text) === normalizeCandidateText(r.text));
            if (matchingFused && !candidate_id) candidate_id = matchingFused.candidate_id;
        }
        return {
            candidate_id: candidate_id || matchingFused?.candidate_id || `fastvlm_item`,
            ocr_ids: ocr_ids.length > 0 ? ocr_ids : (matchingFused?.ocr_ids || []),
            text: r.text || matchingFused?.text || "",
            type: r.type || matchingFused?.candidate_types?.[0] || "person",
            confidence: r.confidence ?? matchingFused?.confidence ?? 0.9,
            reason: r.reason || "fastvlm approved",
            decision_source: matchingFused ? "fastvlm_existing" : (r.decision_source || "fastvlm_additional")
        };
    }
    return r;
}

function validateFastVLMRedactionOutput(parsed, evidence) {
    if (
        !parsed ||
        typeof parsed !== "object"
    ) {
        return {
            valid: false,
            reason: "root not object",
        };
    }

    if (!Array.isArray(parsed.redactions)) {
        return {
            valid: false,
            reason: "redactions must be array",
        };
    }

    parsed.redactions = parsed.redactions
        .map(r => normalizeFastVLMRedactionItem(r, evidence))
        .filter(Boolean);

    if (parsed.additional_redactions !== undefined) {
        if (!Array.isArray(parsed.additional_redactions)) {
            return {
                valid: false,
                reason: "additional_redactions must be array",
            };
        }
        parsed.additional_redactions = parsed.additional_redactions
            .map(r => normalizeFastVLMRedactionItem(r, evidence))
            .filter(Boolean);
    }

    if (
        parsed.caption !== undefined &&
        parsed.caption !== null &&
        typeof parsed.caption !== "string"
    ) {
        return {
            valid: false,
            reason: "caption must be string",
        };
    }

    const fusedIds =
        new Set(
            (
                evidence.fused_candidates ||
                []
            ).map(
                c => c.candidate_id
            )
        );

    const ocrIds =
        new Set(
            (
                evidence.ocr ||
                []
            ).map(
                o => o.id
            )
        );

    const knownTexts =
        new Set([
            ...(
                evidence.ocr || []
            ).map(
                o =>
                    normalizeCandidateText(
                        o.text
                    )
            ),

            ...(
                evidence.fused_candidates ||
                []
            ).map(
                c =>
                    normalizeCandidateText(
                        c.text
                    )
            ),

            ...(
                evidence.ettin_candidates ||
                []
            ).map(
                e =>
                    normalizeCandidateText(
                        e.text
                    )
            ),

            ...(
                evidence.deterministic_candidates ||
                []
            ).map(
                d =>
                    normalizeCandidateText(
                        d.value
                    )
            ),
        ]);

    for (
        const r of parsed.redactions
    ) {
        if (
            !r.candidate_id ||
            typeof r.candidate_id !==
                "string"
        ) {
            return {
                valid: false,
                reason:
                    "redaction missing candidate_id",
            };
        }

        if (
            !fusedIds.has(
                r.candidate_id
            )
        ) {
            return {
                valid: false,
                reason:
                    `fabricated candidate_id: ${r.candidate_id}`,
            };
        }

        if (
            !Array.isArray(
                r.ocr_ids
            ) ||
            r.ocr_ids.length === 0
        ) {
            return {
                valid: false,
                reason:
                    `redaction ${r.candidate_id} missing ocr_ids`,
            };
        }

        for (
            const oid of r.ocr_ids
        ) {
            if (!ocrIds.has(oid)) {
                return {
                    valid: false,
                    reason:
                        `fabricated ocr_id: ${oid}`,
                };
            }
        }

        if (
            !r.text ||
            typeof r.text !==
                "string"
        ) {
            return {
                valid: false,
                reason:
                    `redaction ${r.candidate_id} missing text`,
            };
        }

        const nt =
            normalizeCandidateText(
                r.text
            );

        if (!knownTexts.has(nt)) {
            const supported =
                [...knownTexts].some(
                    k =>
                        k.includes(nt) ||
                        nt.includes(k)
                );

            if (!supported) {
                return {
                    valid: false,
                    reason:
                        `text not supported by evidence: "${r.text}"`,
                };
            }
        }

        const typeNorm =
            String(
                r.type ?? ""
            ).toLowerCase();

        if (
            !ALLOWED_FASTVLM_TYPES.has(
                typeNorm
            )
        ) {
            return {
                valid: false,
                reason:
                    `unsupported type: ${r.type}`,
            };
        }

        if (
            r.confidence !==
            undefined
        ) {
            const c =
                Number(
                    r.confidence
                );

            if (
                !Number.isFinite(c) ||
                c < 0 ||
                c > 1
            ) {
                return {
                    valid: false,
                    reason:
                        `confidence out of range: ${r.confidence}`,
                };
            }
        }
    }

    return {
        valid: true,
    };
}

/* ============================================================
    PHASE 6 — FINAL REDACTION RESOLUTION + SAFETY GATES
    ============================================================ */

// 2C: single normalized FastVLM decision — ONLY source for successful FastVLM final findings
function buildFastVLMFinalCandidates(fastvlmResult, evidence) {
    const out = [];
    let addIdx = 0;

    for (const r of (fastvlmResult?.parsed?.redactions ?? [])) {
        const norm = normalizeFastVLMRedactionItem(r, evidence);
        if (norm) {
            out.push({
                ...norm,
                decision_source: norm.decision_source || "fastvlm_existing",
            });
        }
    }

    for (const r of (fastvlmResult?.parsed?.additional_redactions ?? [])) {
        const norm = normalizeFastVLMRedactionItem(r, evidence);
        if (norm) {
            out.push({
                ...norm,
                candidate_id: norm.candidate_id || `fastvlm_additional_${String(addIdx++).padStart(3, "0")}`,
                decision_source: "fastvlm_additional",
            });
        }
    }

    return out;
}
function resolveFinalRedactionRegions(fastvlmResult, evidence) {
    const normalized = fastvlmResult?._normalizedCandidates ?? buildFastVLMFinalCandidates(fastvlmResult, evidence);
    const fusedById = new Map((evidence.fused_candidates || []).map((c) => [c.candidate_id, c]));
    const resolved = [];
    let rejectedLabelBboxes = 0;
    let rejectedWholeLine = 0;
    let unresolved = 0;
    for (const r of normalized) {
        const isAdditional = r.decision_source === "fastvlm_additional";
        const fused = !isAdditional ? fusedById.get(r.candidate_id) : null;
        let ocrIds = Array.isArray(r.ocr_ids) && r.ocr_ids.length ? r.ocr_ids : (fused?.ocr_ids ?? []);
        // Strict value-only resolution via central helper (Â§8)
        // 1. Find OCR item by OCR ID
        // 2. Check OCR text
        // 3. If exact equals -> use bbox
        // 4. Else if contains -> calculate value sub-bbox
        // 5. Else DO NOT use that OCR bbox (forbidden fallback removed)
        // 6. Continue searching other supplied OCR IDs
        // 7. If no valid OCR value bbox: optionally use fused bbox ONLY if value-specific
        // 8. Otherwise reject/skip
        const bbox = resolveSensitiveValueBBox({ text: r.text, ocrIds, evidence, fusedCandidate: fused });
        if (!bbox) {
            // Distinguish label-only vs whole-line vs unresolved
            const want = cleanText(r.text);
            let hasLabelOnly = false;
            let hasWholeLine = false;
            const ocrById = new Map((evidence.ocr || []).map((o) => [o.id, o]));
            for (const oid of ocrIds || []) {
                const it = ocrById.get(oid);
                if (!it) continue;
                const ot = cleanText(it.text);
                if (!ot) continue;
                if (!ot.toLowerCase().includes(want.toLowerCase())) hasLabelOnly = true;
                else if (ot.length > want.length + 3) hasWholeLine = true;
            }
            if (hasLabelOnly) rejectedLabelBboxes++;
            else if (hasWholeLine) rejectedWholeLine++;
            else unresolved++;
            if (FASTVLM_DEBUG) {
                const preview = String(r.text).slice(0, 20);
                console.log(`[GEOMETRY] resolved: candidate=${r.candidate_id} ocr_ids=[${ocrIds.join(",")}] bbox=null (rejected preview="${preview}")`);
            } else {
                console.log(`[GEOMETRY] resolved: candidate=${r.candidate_id} ocr_ids=[${ocrIds.join(",")}] bbox=null`);
            }
            continue;
        }
        resolved.push({
            source_id: ocrIds[0] ?? fused?.ocr_ids?.[0] ?? r.candidate_id,
            entity: r.type ?? fused?.candidate_types?.[0] ?? "PII",
            score: Number(r.confidence ?? fused?.confidence ?? 1),
            text: r.text,
            bbox,
            candidate_id: r.candidate_id,
            ocr_ids: ocrIds,
            reason: r.reason ?? "",
            decision_source: r.decision_source,
        });
        if (FASTVLM_DEBUG) {
            const preview = String(r.text).slice(0, 20);
            console.log(`[GEOMETRY] resolved: candidate=${r.candidate_id} ocr_ids=[${ocrIds.join(",")}] bbox=[${bbox.map(n=>Math.round(n)).join(",")}] preview="${preview}"`);
        } else {
            console.log(`[GEOMETRY] resolved: candidate=${r.candidate_id} ocr_ids=[${ocrIds.join(",")}] bbox=[${bbox.map(n=>Math.round(n)).join(",")}]`);
        }
    }
    resolveFinalRedactionRegions._lastRejectedLabel = rejectedLabelBboxes;
    resolveFinalRedactionRegions._lastRejectedWhole = rejectedWholeLine;
    resolveFinalRedactionRegions._lastUnresolved = unresolved;
    resolveFinalRedactionRegions._lastRejected = rejectedLabelBboxes + rejectedWholeLine + unresolved;
    return resolved;
}

function applySafetyGates(findings, evidence, imageWidth, imageHeight) {
    const ocrById = new Map((evidence.ocr || []).map((o) => [o.id, o]));
    const ocrTexts = new Map((evidence.ocr || []).map((o) => [o.id, normalizeCandidateText(o.text)]));
    // Content-free per-candidate trace (always on): ids, types, sources,
    // scores and LENGTHS only — never text values, so no PII reaches the
    // console. Every gate drop logs which gate ate it; "no more dark
    // corners", only readings.
    const traceId = (f) => `${f.candidate_id ?? f.source_id ?? "?"}[${((f.candidate_types || [f.entity]) || []).filter(Boolean).join("+")}|${(f.sources || []).join("+")}|${Number(f.score ?? f.confidence ?? 0).toFixed(2)}|len=${String(f.text ?? "").length}]`;
    const traceDrop = (f, gate, note) => console.log(`[TRACE] drop ${traceId(f)} gate=${gate}${note ? ` ${note}` : ""}`);
    const filtered = [];
    for (const f of findings) {
        // Gate 1: valid bbox
        if (!Array.isArray(f.bbox) || f.bbox.length !== 4) { traceDrop(f, 1, "bbox-shape"); continue; }
        const nums = f.bbox.map(Number);
        if (!nums.every(Number.isFinite)) { traceDrop(f, 1, "bbox-nan"); continue; }
        const w = Math.abs(nums[2] - nums[0]);
        const h = Math.abs(nums[3] - nums[1]);
        if (w <= 0 || h <= 0) { traceDrop(f, 1, "bbox-area"); continue; }
        const rect = clampBBox(f.bbox, imageWidth, imageHeight, 0);
        if (!rect) { traceDrop(f, 1, "bbox-clamp"); continue; }
        // Gate 2: valid OCR mapping (at least one ocr_id known)
        const hasKnownOcr = (f.ocr_ids ?? []).some((id) => ocrTexts.has(id)) || ocrTexts.has(f.source_id) || !!f.bbox;
        if (!hasKnownOcr) { traceDrop(f, 2, "ocr-map"); continue; }
        // Gate 3: text consistency
        if (f.text) {
            const nt = normalizeCandidateText(f.text);
            const ocrId = f.ocr_ids?.[0] ?? f.source_id;
            const ocrText = ocrId ? ocrTexts.get(ocrId) : null;
            if (ocrText && !ocrText.includes(nt) && !nt.includes(ocrText)) {
                if (FASTVLM_DEBUG) console.warn(`[GATE] text mismatch: "${f.text}" vs OCR "${ocrText}"`);
            }
        }
        // Gate 7: geometry-aware â€” NEVER enlarge value bbox into label+value (Â§17)
        // If bbox is whole line while value is substring, fix to value sub-bbox or reject
        {
            const ocrId = f.ocr_ids?.[0] ?? f.source_id;
            const ocrItem = ocrId ? ocrById.get(ocrId) : null;
            if (ocrItem && f.text && ocrItem.text) {
                const normOcr = normalizeCandidateText(ocrItem.text);
                const normVal = normalizeCandidateText(f.text);
                // Spacing-tolerant (live-OCR fix): OCR inserts spaces inside
                // tokens ("W BSC0LM 1234"), so raw substring checks fail on
                // values the row-joined pass already resolved to a
                // value-specific union bbox. Compare whitespace-collapsed
                // forms; when those match but raw substring geometry is
                // unavailable, KEEP the candidate bbox instead of dropping.
                const flatOcr = normOcr.replace(/\s+/g, "");
                const flatVal = normVal.replace(/\s+/g, "");
                const rawIncludes = normOcr.includes(normVal) && normOcr.length > normVal.length + 3;
                const flatIncludes = flatOcr.includes(flatVal) && flatOcr.length > flatVal.length + 3;
                if (rawIncludes) {
                    const expected = estimateTextSubBBox(ocrItem, f.text);
                    if (expected) {
                        const expW = Math.abs(expected[2] - expected[0]);
                        const actW = Math.abs(f.bbox[2] - f.bbox[0]);
                        // If actual is >1.8x expected width, it's likely whole line
                        if (actW > expW * 1.8 && expW > 5) {
                            if (FASTVLM_DEBUG) console.log(`[SECURITY] rejecting non-value-specific bbox at ${ocrId} expected ${expW.toFixed(1)} vs actual ${actW.toFixed(1)}`);
                            // NEVER enlarge: replace with tighter value-only bbox (shrinking)
                            const isValueOnly = isLikelyValueOnlyBBox({ bbox: expected, item: ocrItem, targetText: f.text });
                            if (isValueOnly) f.bbox = expected;
                            else { traceDrop(f, 7, "wide-box"); continue; }
                        } else if (!isLikelyValueOnlyBBox({ bbox: f.bbox, item: ocrItem, targetText: f.text })) {
                            console.log(`[SECURITY] rejecting non-value-specific bbox`);
                            traceDrop(f, 7, "not-value-only");
                            continue;
                        }
                    } else {
                        const ocrLen = normOcr.length;
                        const valLen = normVal.length;
                        if (ocrLen > valLen * 2.5) {
                            if (FASTVLM_DEBUG) console.log(`[GATE] Geometry suspicious at ${ocrId}`);
                            const est = estimateTextSubBBox(ocrItem, f.text);
                            if (est && isLikelyValueOnlyBBox({ bbox: est, item: ocrItem, targetText: f.text })) f.bbox = est;
                            else if (flatIncludes) {
                                // Spacing-only mismatch: the value IS in this
                                // OCR region modulo inserted spaces (row-joined
                                // union bbox already value-specific). Keep it.
                                if (FASTVLM_DEBUG) console.log(`[GATE] keeping spacing-mismatched value bbox at ${ocrId}`);
                            }
                            else { traceDrop(f, 7, "geometry"); continue; }
                        }
                    }
                }
            }
        }
        // Gate 5: no label-only redaction - value must be plausible.
        // EMAIL-shaped values are never prose: spoken addresses fail the
        // generic letters-only prose branch, so they get a narrow shape
        // check instead (mirrors the Tier-0 sub-pass exemption).
        {
            const gv = String(f.text ?? '');
            const emailShaped = /@/.test(gv) || (/\bdot\b/i.test(gv) && /\bat\b/i.test(gv));
            if (emailShaped) {
                if (!/[a-z0-9]/i.test(gv) || gv.length < 6 || gv.length > 80) { traceDrop(f, 5, "email-shape"); continue; }
            } else if (!isPlausibleValue(f.text ?? '')) { traceDrop(f, 5, "implausible"); continue; }
        }
        // Also reject if text looks like a pure label
        if (findFieldLabelMatch(f.text ?? "")) {
            const labelMatch = findFieldLabelMatch(f.text);
            if (labelMatch && normalizeCandidateText(labelMatch.label) === normalizeCandidateText(f.text)) { traceDrop(f, 5, "label-only"); continue; }
        }
        // Gate 6: confidence policy — tiered threshold based on evidence strength:
        // - FastVLM-adjudicated: FINAL_REDACTION_CONFIDENCE_THRESHOLD (0.5)
        // - Dual-source (NER + deterministic agree): 0.5 — two independent detectors
        //   agreeing is equivalent confidence to FastVLM confirmation (parity with v7.mjs)
        // - Fail-closed (T2 attempted but failed): 0.5 for everything at/above
        //   the floor — a T2 failure must never mean less protection (leak fix).
        //   Geometry/plausibility gates still apply; only the confidence floor
        //   moves. "skipped" keeps old thresholds.
        // - Prose-salvage (FastVLM mentioned OCR/Candidate ID in prose): 0.5
        // - T2 crop-confirmed (per-candidate FastVLM check said "yes"): 0.5 —
        //   a legible-crop verdict is first-hand confirmation, equivalent to
        //   adjudication (mirrors _prose_salvage; set pre-fallback in
        //   v7-extension.js, carried through the fallback push below).
        // - Name entities (first_name, last_name, user_name, person, name): 0.5
        //   (names lack deterministic regex support, so single-source floor 0.72 overlooks them)
        // - Single-source fusion fallback for other fields: FALLBACK_CONFIDENCE_THRESHOLD (0.72)
        {
            const isDualSource =
                f.decision_source === "fusion_fallback" &&
                Array.isArray(f.sources) &&
                f.sources.length >= 2 &&
                f.sources.includes("ettin") &&
                f.sources.includes("deterministic_context");
            const isProseSalvage = !!f._prose_salvage;
            const isT2Confirmed = !!f._t2_confirmed;
            const entityType = String(f.entity || "").toLowerCase();
            const isNameEntity =
                entityType.includes("name") ||
                entityType.includes("person") ||
                (Array.isArray(f.candidate_types) && f.candidate_types.some((t) => {
                    const tl = String(t).toLowerCase();
                    return tl.includes("name") || tl.includes("person");
                }));
            const threshold =
                f.decision_source !== "fusion_fallback"
                    ? FINAL_REDACTION_CONFIDENCE_THRESHOLD
                    : (isDualSource || isProseSalvage || isNameEntity || isT2Confirmed || f.t2Failed === true)
                        ? FINAL_REDACTION_CONFIDENCE_THRESHOLD
                        : FALLBACK_CONFIDENCE_THRESHOLD;
            if (Number(f.score) < threshold) {
                if (FASTVLM_DEBUG) console.log(
                    `[GATE6] filtered ${f.candidate_id ?? f.source_id}` +
                    ` score=${Number(f.score).toFixed(3)} < ${threshold}` +
                    ` (${f.decision_source}${isDualSource ? "/dual" : ""}${isProseSalvage ? "/salvage" : ""}${isNameEntity ? "/name" : ""}${isT2Confirmed ? "/t2confirmed" : ""}${f.t2Failed === true ? "/failclosed" : ""})`
                );
                traceDrop(f, 6, `conf<${threshold}${isDualSource ? "/dual" : ""}${isNameEntity ? "/name" : ""}${isT2Confirmed ? "/t2confirmed" : ""}${f.t2Failed === true ? "/failclosed" : ""}`);
                continue;
            }
        }
        filtered.push(f);
    }
    // Gate 4: candidate containment â€” remove redundant sub-spans only when same region/bboxes overlap
    filtered.sort((a, b) => (b.text?.length ?? 0) - (a.text?.length ?? 0));
    const deduped = [];
    for (const f of filtered) {
        const nt = normalizeCandidateText(f.text);
        // Spacing-insensitive twin of the includes below: OCR spacing splits
        // ("Tamluk @ 2019" vs "Tamluk@2019") must not double-redact the same
        // region (mirrors isContained in heuristics.js).
        const nft = nt.replace(/\s+/g, "");
        let contained = false;
        for (const k of deduped) {
            const kText = normalizeCandidateText(k.text);
            const kft = kText.replace(/\s+/g, "");
            if (((kText.includes(nt) && nt !== kText) || (kft.includes(nft) && nft !== kft && nft && kft)) || (nt === kText) || (nft === kft && nft)) {
                const sameOcr = (f.ocr_ids || []).some((id) => (k.ocr_ids || []).includes(id));
                const overlap = f.bbox && k.bbox ? !(f.bbox[2] < k.bbox[0] || f.bbox[0] > k.bbox[2] || f.bbox[3] < k.bbox[1] || f.bbox[1] > k.bbox[3]) : false;
                if (sameOcr || overlap) { contained = true; break; }
            }
            // same bbox containment (kept for completeness)
            if (f.bbox && k.bbox && nt !== kText) {
                const overlap = !(f.bbox[2] < k.bbox[0] || f.bbox[0] > k.bbox[2] || f.bbox[3] < k.bbox[1] || f.bbox[1] > k.bbox[3]);
                if (overlap && kText.includes(nt)) { contained = true; break; }
            }
        }
        if (!contained) deduped.push(f);
        else traceDrop(f, 4, "contained");
    }
    console.log(`[TRACE] gates kept ${deduped.length}/${findings.length}${findings.length ? `: ${deduped.map((d) => d.candidate_id ?? d.source_id).join(",")}` : ""}`);
    return deduped;
}

function adjudicateOrFallback({
    ettinFindings,
    deterministicFindings,
    fusedCandidates,
    fastvlmResult,
    evidence,
    image,
}) {
    let finalFindings = [];

    let status =
        fastvlmResult?.status ??
        "skipped";

    let validation = null;

    if (
        fastvlmResult?.status ===
            "ok" &&
        fastvlmResult.parsed
    ) {
        validation =
            validateFastVLMRedactionOutput(
                fastvlmResult.parsed,
                evidence.fastvlm_evidence
            );

        if (validation.valid) {
            const normalized =
                buildFastVLMFinalCandidates(
                    fastvlmResult,
                    evidence.fastvlm_evidence
                );

            fastvlmResult._normalizedCandidates =
                normalized;

            const resolved =
                resolveFinalRedactionRegions(
                    fastvlmResult,
                    evidence.fastvlm_evidence
                );

            finalFindings =
                applySafetyGates(
                    resolved,
                    evidence.fastvlm_evidence,
                    image.width,
                    image.height
                );

            status = "ok";
        } else {
            console.warn(
                `[FASTVLM] validation failed: ${validation.reason}`
            );

            status =
                "validation_failed";
        }
    }

    // Prose salvage: FastVLM emitted readable text instead of JSON (common with quantized models).
    // Extract any ocr_N or cand_N IDs mentioned in the raw prose and mark matching fused candidates
    // as "prose_salvage" so they receive the lower 0.5 threshold (same as FastVLM-confirmed).
    if (
        status !== "ok" &&
        fastvlmResult?.raw &&
        typeof fastvlmResult.raw === "string"
    ) {
        const mentionedOcrIds = new Set(
            [...fastvlmResult.raw.matchAll(/\bocr_\d+\b/g)].map((m) => m[0])
        );
        const mentionedCandIds = new Set(
            [...fastvlmResult.raw.matchAll(/\bcand_\d+\b/g)].map((m) => m[0])
        );
        if (mentionedOcrIds.size > 0 || mentionedCandIds.size > 0) {
            console.log(`[FASTVLM] Prose salvage: found OCR/Candidate ID(s) in raw output: ${[...mentionedOcrIds, ...mentionedCandIds].join(", ")}`);
            // Tag matching fused candidates so applySafetyGates uses a tighter threshold
            for (const c of fusedCandidates || []) {
                if (mentionedCandIds.has(c.candidate_id) || (c.ocr_ids || []).some((id) => mentionedOcrIds.has(id))) {
                    c._prose_salvage = true;
                }
            }
        }
    }

    /*
     * Empty FastVLM result is a valid success.
     * Only fall back when FastVLM failed/skipped.
     */

    if (
        status === "ok"
    ) {
        return {
            status: "ok",
            finalFindings,
            redaction_complete:
                true,
            fallback: false,
            validation,
        };
    }

    const fallback = [];

    // Fail-closed doctrine (PII-leak fix): when T2 was attempted but produced
    // nothing usable (error/load_failed/timeout/validation_failed/garbage),
    // the old 0.72 single-source floor in Gate 6 dropped nearly everything
    // (ambiguous: 4 fused -> 1 name-only finding = a leak). A T2 failure must
    // never mean less protection: every fused candidate at/above the floor F
    // (0.50) is kept. Geometry/plausibility gates still apply — fail-closed
    // never invents a bbox. "skipped" (T2 never fired: clean pages) keeps the
    // old thresholds; only attempted-but-failed gets the floor. Crop-check
    // statuses ("candidate_checks", "partial") count as attempted here —
    // harmless: HIGH passes normal thresholds by construction and confirmed
    // items carry _t2_confirmed, so the floor only ever nets stragglers.
    const t2Failed = !!fastvlmResult && !["ok", "skipped"].includes(fastvlmResult.status);

    for (
        const candidate
            of fusedCandidates || []
    ) {
        const bbox =
            resolveSensitiveValueBBox({
                text:
                    candidate.text,

                ocrIds:
                    candidate.ocr_ids,

                evidence:
                    evidence.fastvlm_evidence,

                fusedCandidate:
                    candidate,
            });

        if (!bbox) {
            // Content-free: ids/types only, never values (mirrors [TRACE]).
            console.log(`[TRACE] drop ${candidate.candidate_id}[${(candidate.candidate_types || []).join("+")}] gate=0 nobbox`);
            continue;
        }

        fallback.push({
            source_id:
                candidate
                    .ocr_ids
                    ?.find(Boolean) ??
                candidate.candidate_id,

            entity:
                candidate
                    .candidate_types
                    ?.[0] ??
                "PII",

            score:
                candidate.confidence,

            text:
                candidate.text,

            bbox,

            candidate_id:
                candidate.candidate_id,

            ocr_ids:
                candidate.ocr_ids,

            // Preserve sources so Gate 6 in applySafetyGates can apply
            // the dual-source threshold (NER + deterministic → 0.5 instead of 0.72).
            // Fail-closed: when T2 was attempted but failed, every item keeps
            // the 0.50 floor regardless of source count (see Gate 6).
            sources:
                candidate.sources ?? [],

            t2Failed,

            // T2 crop-check confirmation (see Gate 6): a "yes" verdict on a
            // legible native-res crop clears the 0.5 floor honestly.
            _t2_confirmed:
                candidate._t2_confirmed === true,

            reason:
                candidate.reason ??
                "fusion fallback",

            decision_source:
                "fusion_fallback",
        });
    }

    finalFindings =
        applySafetyGates(
            fallback,
            evidence.fastvlm_evidence,
            image.width,
            image.height
        );

    return {
        status:
            status ===
            "skipped"
                ? "skipped"
                : "fallback",

        finalFindings,

        redaction_complete:
            true,

        fallback:
            true,

        validation,
    };
}

/* ============================================================
    CAPTION SANITIZATION
    Deterministic post-filter: the 0.5B model is explicitly told not to
    repeat sensitive values (prompt rule 10) but echoes them anyway, and
    runFastVLMAdjudication additionally salvages raw prose as the caption.
    Never trust the model — scrub every known sensitive value out of any
    caption/description before it reaches evidence or the UI.
    ============================================================ */

function escapeRegExp(s) {
    return String(s ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Builds a whitespace-tolerant pattern for a value: tokens may be joined
// by any whitespace (handles "Aadhaar is proofof" vs "Aadhaar is  proofof").
function valuePattern(value) {
    const tokens = String(value ?? "").split(/\s+/).filter(Boolean).map(escapeRegExp);
    if (!tokens.length) return null;
    return tokens.join("\\s+");
}

function sanitizeCaption(caption, evidence) {
    let out = String(caption ?? "");
    if (!out) return out;
    const ev = evidence?.fastvlm_evidence || evidence || {};
    const repl = [];
    // Issuer / layout words are NOT sensitive values: keep them so the
    // caption stays sufficient and complete ("Indian", "Government of
    // India", "Aadhaar", "Male", issuer org names). Only real PII values
    // (names, dates, numbers, addresses, emails, phones, IDs) get scrubbed.
    const CAPTION_SCRUB_SKIP = new Set([
        "COUNTRY", "GENDER", "ORGANIZATION", "ORG", "COMPANY",
        "COMPANY_NAME", "NATIONALITY", "LANGUAGE",
    ]);
    const push = (text, type) => {
        const tag = String(type || "PII").toUpperCase().replace(/[^A-Z0-9_]/g, "_") || "PII";
        if (CAPTION_SCRUB_SKIP.has(tag)) return;
        const t = cleanText(text);
        if (!t || t.length < 2) return;
        repl.push({ text: t, type: tag });
        // Digit-flex variant: match compact vs spaced digit runs
        // ("4906 5637 6032" must also catch "490656376032" and vice versa).
        const digits = t.replace(/\D+/g, "");
        if (digits.length >= 4) {
            repl.push({ text: t, type: tag, digitsOnly: digits });
        }
    };
    for (const c of ev.fused_candidates || []) push(c.text, (c.candidate_types || [])[0]);
    for (const d of ev.deterministic_candidates || []) push(d.value, d.field_type);
    for (const e of ev.ettin_candidates || []) push(e.text, e.entity);
    // Longest first so "A / DOB :05/07/2002" wins over "05/07/2002" fragments.
    repl.sort((a, b) => (b.digitsOnly || b.text).length - (a.digitsOnly || a.text).length);
    for (const r of repl) {
        let pat = null;
        if (r.digitsOnly) {
            // Any non-alphanumeric separators tolerated: "05072002" catches
            // "05/07/2002", "05-07-2002", "05 07 2002" etc.
            pat = r.digitsOnly.split("").map(escapeRegExp).join("[^A-Za-z0-9]*");
        } else {
            pat = valuePattern(r.text);
        }
        if (!pat) continue;
        try {
            out = out.replace(new RegExp(pat, "gi"), `[REDACTED:${r.type}]`);
        } catch {}
    }
    // Collapse greedy-decoding repetition loops (0.5B model repeats the same
    // sentence/category list when it misses the JSON schema). Dedupe
    // sentences, then hard-cap length so a fallback caption stays one short
    // layout sentence instead of kilobytes of "sensitive information such as...".
    out = out.replace(/\s+/g, " ").trim();
    try {
        const parts = out.split(/(?<=[.!?])\s+/);
        const seen = new Set();
        const uniq = [];
        for (const p of parts) {
            const k = p.toLowerCase().trim();
            if (!k) continue;
            if (seen.has(k)) continue;
            seen.add(k);
            uniq.push(p.trim());
        }
        out = uniq.join(" ");
        out = out.replace(/(\b.{16,}?)\s*(?:\.\s*)?\1+/gi, "$1");
    } catch {}
    // Hard-cap length, but never end mid-sentence: back off to the last
    // sentence boundary so captions don't trail off like "... If you".
    if (out.length > 600) {
        const cut = out.slice(0, 600);
        const lastEnd = Math.max(cut.lastIndexOf("."), cut.lastIndexOf("!"), cut.lastIndexOf("?"));
        out = (lastEnd > 120 ? cut.slice(0, lastEnd + 1) : cut.replace(/\s+\S*$/, "")).trim();
    }
    return out;
}

/* ============================================================
    REDACTION
    ============================================================ */

function redactChunks(chunks, findings) {
    const findingsBySource = new Map();
    for (const finding of findings) {
        if (!findingsBySource.has(finding.source_id)) {
            findingsBySource.set(finding.source_id, []);
        }
        findingsBySource.get(finding.source_id).push(finding);
    }

    return chunks.map((chunk) => {
        const chunkFindings = findingsBySource.get(chunk.id) || [];
        let text = chunk.text;

        // Longest match first so overlapping/nested findings don't leave
        // partial fragments of a redacted value behind.
        const sorted = [...chunkFindings].sort(
            (a, b) => (b.text?.length ?? 0) - (a.text?.length ?? 0)
        );

        for (const finding of sorted) {
            if (!finding.text) continue;
            const escaped = finding.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const pattern = new RegExp(escaped, "gi");
            text = text.replace(pattern, `[REDACTED:${finding.entity}]`);
        }

        return { ...chunk, text, redacted: chunkFindings.length > 0 };
    });
}

/* ============================================================
   IMAGE REDACTION
   ============================================================ */

export {
    extractJsonObject,
    validateFastVLMRedactionOutput,
    buildFastVLMFinalCandidates,
    resolveFinalRedactionRegions,
    applySafetyGates,
    adjudicateOrFallback,
    redactChunks,
    sanitizeCaption
};
