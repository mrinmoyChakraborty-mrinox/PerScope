import assert from "node:assert/strict";
import {
  buildReadingOrder,
  extractSensitiveFieldCandidates,
  fuseRedactionCandidates,
  normalizeLabelForMatch,
  findFieldLabelMatch,
  isPlausibleValue,
  validateQwenRedactionOutput,
  resolveFinalRedactionRegions,
  applySafetyGates,
  adjudicateOrFallback,
} from "../qwen_redaction_pure.mjs";

// helper to make OCR items
function ocrItem(id, text, bbox) {
  return { id, text, bbox: bbox ?? [0, 0, 200, 20], confidence: 0.9 };
}
function mockOcr(items) {
  return { text: items.map((i) => i.text).join(" "), items };
}

// --- Phase 1: reading order ---
{
  const ocr = mockOcr([
    ocrItem("ocr_0", "Certificate No: ABC123XY98", [100, 300, 620, 340]),
    ocrItem("ocr_1", "Name: John", [100, 100, 300, 130]),
    ocrItem("ocr_2", "Batch: 98", [100, 500, 200, 530]),
  ]);
  const { ordered } = buildReadingOrder(ocr);
  // Should be sorted top-bottom: ocr_1, ocr_0, ocr_2
  assert.equal(ordered[0].id, "ocr_1");
  assert.equal(ordered[1].id, "ocr_0");
  assert.equal(ordered[2].id, "ocr_2");
  console.log("✓ reading order");
}

// --- Phase 2: deterministic extraction ---
{
  // Test A — same line
  const ocr = mockOcr([ocrItem("ocr_0", "Certificate No: ABC123XY98", [100, 300, 620, 340])]);
  const cands = extractSensitiveFieldCandidates(ocr);
  assert.equal(cands.length, 1);
  assert.equal(cands[0].value, "ABC123XY98");
  assert.equal(cands[0].field_type, "CERTIFICATE_NUMBER");
  console.log("✓ Test A same-line");
}
{
  // Test B — vertical
  const ocr = mockOcr([
    ocrItem("ocr_0", "Certificate No:", [100, 300, 300, 330]),
    ocrItem("ocr_1", "ABC123XY98", [100, 340, 300, 370]),
  ]);
  const cands = extractSensitiveFieldCandidates(ocr);
  assert.ok(cands.some((c) => c.value === "ABC123XY98"), "vertical should find value");
  console.log("✓ Test B vertical");
}
{
  // Test G — poor OCR label Certiflcate N0 -> still matches via normalization (0->o)
  const ocr = mockOcr([ocrItem("ocr_0", "Certiflcate N0: ABCl23XY98", [0, 0, 100, 20])]);
  const m = findFieldLabelMatch("Certiflcate N0");
  // normalized N0 -> no, so should match Certificate No
  assert.ok(m, "poor OCR label should match");
  assert.equal(normalizeLabelForMatch("CERTIFICATE N0."), normalizeLabelForMatch("certificate no"));
  console.log("✓ Test G OCR tolerance");
}
{
  // Test C — spaced identifier (right-side)
  const ocr = mockOcr([
    ocrItem("ocr_0", "Certificate Number", [100, 300, 280, 330]),
    ocrItem("ocr_1", "ABC 123 XY 98", [400, 300, 600, 330]),
  ]);
  const cands = extractSensitiveFieldCandidates(ocr);
  // side-by-side should produce candidate
  assert.ok(cands.some((c) => c.value === "ABC 123 XY 98"));
  console.log("✓ Test C spaced side-by-side");
}
{
  // Test D — Registration
  const ocr = mockOcr([ocrItem("ocr_0", "Registration No: 24CSE01872", [0, 0, 100, 20])]);
  const cands = extractSensitiveFieldCandidates(ocr);
  assert.ok(cands.some((c) => c.field_type === "REGISTRATION_NUMBER" && c.value === "24CSE01872"));
  console.log("✓ Test D registration");
}
{
  // Test I — label-only: isPlausibleValue true but safety gate rejects pure label (separate check)
  assert.equal(isPlausibleValue("Certificate No"), true, "label text passes weak plausibility; gate filters via findFieldLabelMatch");
  // value validation: empty, punctuation only -> false
  assert.equal(isPlausibleValue(""), false);
  assert.equal(isPlausibleValue("..."), false);
  assert.equal(isPlausibleValue("ABC123XY98"), true);
  console.log("✓ value plausibility");
}
{
  // No candidates for non-sensitive text
  const ocr = mockOcr([ocrItem("ocr_0", "Hello World", [0, 0, 100, 20])]);
  const cands = extractSensitiveFieldCandidates(ocr);
  assert.equal(cands.length, 0);
  console.log("✓ no false positive for generic text");
}

// --- Phase 4: fusion containment ---
{
  // Test F — Ettin returns ABC123XY98 and 98 overlapping -> keep larger
  const ettin = [
    { source_id: "ocr_0", entity: "UNIQUE_ID", score: 0.9, text: "ABC123XY98", bbox: [100, 300, 620, 340] },
    { source_id: "ocr_0", entity: "UNIQUE_ID", score: 0.6, text: "98", bbox: [500, 300, 620, 340] },
  ];
  const fused = fuseRedactionCandidates({ ettinFindings: ettin, deterministicFindings: [] });
  assert.equal(fused.length, 1);
  assert.equal(fused[0].text, "ABC123XY98");
  console.log("✓ Test F fusion containment");
}
{
  // Deterministic + Ettin same value merges sources
  const ettin = [{ source_id: "ocr_0", entity: "CERTIFICATE_NUMBER", score: 0.8, text: "ABC123XY98", bbox: [0, 0, 100, 20] }];
  const det = [{ ocr_ids: ["ocr_0"], label: "Certificate No", value: "ABC123XY98", field_type: "CERTIFICATE_NUMBER", confidence: 0.98, bbox: [0, 0, 100, 20], reason: "" }];
  const fused = fuseRedactionCandidates({ ettinFindings: ettin, deterministicFindings: det });
  assert.equal(fused.length, 1);
  assert.ok(fused[0].sources.includes("ettin") && fused[0].sources.includes("deterministic_context"));
  console.log("✓ fusion merges deterministic+ettin");
}
{
  // Adjacent non-overlapping should NOT merge
  const ettin = [
    { source_id: "ocr_0", entity: "EMAIL", score: 0.9, text: "a@b.com", bbox: [0, 0, 100, 20] },
    { source_id: "ocr_1", entity: "PHONE", score: 0.9, text: "9876543210", bbox: [200, 0, 300, 20] },
  ];
  const fused = fuseRedactionCandidates({ ettinFindings: ettin, deterministicFindings: [] });
  assert.equal(fused.length, 2);
  console.log("✓ fusion does not merge adjacent");
}

// --- Phase 5-6: Qwen validation ---
{
  const evidence = {
    ocr: [{ id: "ocr_0", text: "Certificate No: ABC123XY98", bbox: [0, 0, 100, 20] }],
    fused_candidates: [{ candidate_id: "cand_000", text: "ABC123XY98", ocr_ids: ["ocr_0"] }],
    ettin_candidates: [],
    deterministic_candidates: [],
  };
  // valid
  const parsed = {
    redactions: [{ candidate_id: "cand_000", ocr_ids: ["ocr_0"], text: "ABC123XY98", type: "certificate_number", confidence: 0.99, reason: "label" }],
    rejected_candidates: [],
  };
  const v = validateQwenRedactionOutput(parsed, evidence);
  assert.equal(v.valid, true);
  // fabricated candidate_id -> invalid
  const bad1 = { redactions: [{ candidate_id: "cand_999", ocr_ids: ["ocr_0"], text: "ABC123XY98", type: "certificate_number" }] };
  assert.equal(validateQwenRedactionOutput(bad1, evidence).valid, false);
  // fabricated ocr_id -> invalid
  const bad2 = { redactions: [{ candidate_id: "cand_000", ocr_ids: ["ocr_999"], text: "ABC123XY98", type: "certificate_number" }] };
  assert.equal(validateQwenRedactionOutput(bad2, evidence).valid, false);
  // unsupported type -> invalid
  const bad3 = { redactions: [{ candidate_id: "cand_000", ocr_ids: ["ocr_0"], text: "ABC123XY98", type: "evil_type" }] };
  assert.equal(validateQwenRedactionOutput(bad3, evidence).valid, false);
  // text not in evidence -> invalid
  const bad4 = { redactions: [{ candidate_id: "cand_000", ocr_ids: ["ocr_0"], text: "INVENTED999", type: "certificate_number" }] };
  assert.equal(validateQwenRedactionOutput(bad4, evidence).valid, false);
  console.log("✓ Qwen validation gates");
}
{
  // resolve + safety gates: label-only rejected
  const evidence = {
    ocr: [{ id: "ocr_0", text: "Certificate No", bbox: [0, 0, 100, 20] }],
    fused_candidates: [{ candidate_id: "cand_000", text: "Certificate No", ocr_ids: ["ocr_0"], candidate_types: ["CERTIFICATE_NUMBER"], confidence: 0.9, bbox: [0, 0, 100, 20] }],
  };
  const qwenResult = { parsed: { redactions: [{ candidate_id: "cand_000", ocr_ids: ["ocr_0"], text: "Certificate No", type: "certificate_number", confidence: 0.99 }] } };
  const resolved = resolveFinalRedactionRegions(qwenResult, evidence);
  const gated = applySafetyGates(resolved, evidence, 1000, 1000);
  assert.equal(gated.length, 0, "label-only must be filtered by safety gate");
  console.log("✓ safety gate label-only");
}
{
  // safety gate confidence threshold
  const evidence = {
    ocr: [{ id: "ocr_0", text: "ABC123XY98", bbox: [0, 0, 100, 20] }],
    fused_candidates: [],
  };
  const findings = [{ source_id: "ocr_0", entity: "certificate_number", score: 0.1, text: "ABC123XY98", bbox: [0, 0, 100, 20], ocr_ids: ["ocr_0"] }];
  const gated = applySafetyGates(findings, evidence, 1000, 1000);
  assert.equal(gated.length, 0, "low confidence filtered");
  console.log("✓ safety gate confidence");
}
{
  // bbox outside image -> filtered
  const evidence = { ocr: [{ id: "ocr_0", text: "ABC123XY98", bbox: [0, 0, 100, 20] }] };
  const findings = [{ source_id: "ocr_0", entity: "certificate_number", score: 0.9, text: "ABC123XY98", bbox: [5000, 5000, 5100, 5100], ocr_ids: ["ocr_0"] }];
  // still passes clamp? clamp will clamp to image bounds, so it won't be filtered by gate1 fully; but gate will clamp and still produce rect. So we test invalid bbox array instead
  const badBbox = [{ source_id: "ocr_0", entity: "certificate_number", score: 0.9, text: "ABC123XY98", bbox: null, ocr_ids: ["ocr_0"] }];
  assert.equal(applySafetyGates(badBbox, evidence, 1000, 1000).length, 0);
  console.log("✓ safety gate bbox");
}
{
  // adjudication fallback when Qwen unavailable -> fusion fallback
  const mockImage = { width: 1000, height: 1000 };
  const qwenEvidence = {
    ocr: [{ id: "ocr_0", text: "Certificate No: ABC123XY98", bbox: [0, 0, 100, 20] }],
    fused_candidates: [{ candidate_id: "cand_000", ocr_ids: ["ocr_0"], text: "ABC123XY98", candidate_types: ["CERTIFICATE_NUMBER"], sources: ["deterministic_context"], confidence: 0.98, bbox: [0, 0, 100, 20] }],
    ettin_candidates: [],
    deterministic_candidates: [],
  };
  const fused = qwenEvidence.fused_candidates;
  const result = adjudicateOrFallback({
    ettinFindings: [],
    deterministicFindings: [],
    fusedCandidates: fused,
    qwenResult: { status: "unavailable", reason: "model not loaded" },
    evidence: { qwen_evidence: qwenEvidence },
    image: mockImage,
  });
  assert.equal(result.status, "fallback_after_qwen_failure");
  assert.equal(result.finalFindings.length, 1);
  assert.equal(result.redaction_complete, true);
  console.log("✓ fallback fusion when Qwen unavailable");
}

console.log("\nAll regression tests passed.");
