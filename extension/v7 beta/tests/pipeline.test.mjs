import test from "node:test";
import assert from "node:assert/strict";

import { classifyGpuTier } from "../src/pipeline/gpu.js";
import {
  extractSensitiveFieldCandidates,
  extractLabelValueSameLine,
  extractLabelValueVertical,
  buildReadingOrder,
  fuseRedactionCandidates,
  resolveSensitiveValueBBox,
} from "../src/pipeline/heuristics.js";
import {
  extractJsonObject,
  validateFastVLMRedactionOutput,
  adjudicateOrFallback,
} from "../src/pipeline/safety.js";
import { _iou, _nmsFaceDetections } from "../src/pipeline/face.js";
import { clampBBox, uniqueRedactionRegions } from "../src/pipeline/canvas-redactor.js";

test("GPU Classifier: detects dedicated NVIDIA RTX 4050", () => {
  const info = {
    vendor: "nvidia",
    description: "NVIDIA GeForce RTX 4050 Laptop GPU",
    architecture: "ada lovelace",
  };
  const tier = classifyGpuTier(info);
  assert.equal(tier, "dedicated");
});

test("GPU Classifier: detects integrated AMD Radeon 740M", () => {
  const info = {
    vendor: "amd",
    description: "AMD Radeon 740M Graphics",
    architecture: "rdna3",
  };
  const tier = classifyGpuTier(info);
  assert.equal(tier, "integrated");
});

test("GPU Classifier: falls back to CPU when adapter is fallback", () => {
  const info = { vendor: "", description: "Software Rasterizer" };
  const tier = classifyGpuTier(info, true);
  assert.equal(tier, "cpu");
});

test("Heuristics: extracts sensitive field phone and email", () => {
  const ocr = {
    text: "Email: user@example.com Phone: 9876543210",
    items: [
      { id: "ocr_0", text: "Email: user@example.com", bbox: [10, 10, 200, 30], confidence: 0.95 },
      { id: "ocr_1", text: "Phone: 9876543210", bbox: [10, 40, 200, 60], confidence: 0.98 },
    ],
  };
  const candidates = extractSensitiveFieldCandidates(ocr);
  assert.ok(candidates.length >= 2, "Expected at least 2 sensitive candidates");
  const types = candidates.map((c) => c.field_type);
  assert.ok(types.includes("EMAIL"));
  assert.ok(types.includes("PHONE"));
});

test("Candidate Fusion: merges NER and deterministic candidates", () => {
  const ettinFindings = [
    { entity: "EMAIL", text: "user@example.com", score: 0.92, source_id: "ocr_0", bbox: [50, 10, 190, 30] },
  ];
  const deterministicFindings = [
    { label: "Email", value: "user@example.com", field_type: "EMAIL", confidence: 0.95, ocr_ids: ["ocr_0"], bbox: [10, 10, 200, 30], reason: "same_line" },
  ];
  const fused = fuseRedactionCandidates({ ettinFindings, deterministicFindings });
  assert.equal(fused.length, 1);
  assert.equal(fused[0].candidate_types[0], "EMAIL");
});

test("Safety: extracts JSON object from markdown fenced block", () => {
  const rawText = "Here is the result:\n```json\n{\"caption\": \"A login form with username and password\", \"redactions\": [\"ocr_1\"], \"rejected_candidates\": []}\n```";
  const jsonStr = extractJsonObject(rawText);
  const parsed = JSON.parse(jsonStr);
  assert.equal(parsed.caption, "A login form with username and password");
  assert.deepEqual(parsed.redactions, ["ocr_1"]);
});

test("Face Detection: NMS correctly suppresses overlapping face detections", () => {
  const dets = [
    { bbox: [100, 100, 200, 200], score: 0.95 },
    { bbox: [105, 105, 195, 195], score: 0.85 }, // High overlap with first
    { bbox: [300, 300, 400, 400], score: 0.90 }, // Disjoint second face
  ];
  const kept = _nmsFaceDetections(dets, 0.3);
  assert.equal(kept.length, 2);
  assert.equal(kept[0].score, 0.95);
  assert.equal(kept[1].score, 0.90);
});

test("Canvas Redactor: clampBBox prevents bounds overflow", () => {
  const bbox = [-10, -5, 510, 310];
  const clamped = clampBBox(bbox, 500, 300, 0);
  assert.deepEqual(clamped.bbox, [0, 0, 500, 300]);
});

test("Safety & Geometry: resolveSensitiveValueBBox resolves exact and proportional sub-bboxes", () => {
  const evidence = {
    ocr: [
      { id: "ocr_0", text: "Bhushan Diwakar", bbox: [100, 50, 300, 90] },
      { id: "ocr_1", text: "DOB : 05/07/2002", bbox: [100, 100, 300, 140] },
    ],
  };
  const bboxExact = resolveSensitiveValueBBox({
    text: "Bhushan Diwakar",
    ocrIds: ["ocr_0"],
    evidence,
  });
  assert.ok(bboxExact, "Expected exact bbox resolution");
  assert.deepEqual(bboxExact, [100, 50, 300, 90]);

  const bboxSub = resolveSensitiveValueBBox({
    text: "05/07/2002",
    ocrIds: ["ocr_1"],
    evidence,
  });
  assert.ok(bboxSub, "Expected sub-bbox resolution");
  assert.ok(bboxSub[0] > 100, "Expected sub-bbox to be shifted past label");
  assert.equal(bboxSub[3], 140);
});
