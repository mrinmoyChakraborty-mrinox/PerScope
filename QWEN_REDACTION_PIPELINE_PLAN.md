# Qwen3.5-2B Final Redaction Adjudication — Implementation Plan

## 1. Goal

Upgrade the current image-only privacy pipeline so that **Ettin is a candidate detector, not the final redaction authority**.

The new pipeline will use:

- **PaddleOCR** for text detection, recognition, and bounding boxes.
- **Florence-2** for global visual understanding / image description.
- **Ettin-68M Nemotron PII** for PII/identifier candidate detection over OCR text.
- **Deterministic context analysis** for label → value relationships such as `Certificate No: ABC123XY98`.
- **Qwen3.5-2B** as the final multimodal redaction adjudicator when candidate evidence needs semantic/visual resolution.
- **Sharp** for the actual pixel-level redaction.

The key design principle is:

> Qwen decides **what exact text/value should be redacted**; Sharp decides **how to redact the pixels**.

Qwen must never generate or edit the redacted image.

---

## 2. Current Pipeline Baseline

The current `v3(1).mjs` already performs these major stages:

```text
Image
  ↓
PaddleOCR
  ↓
Full OCR text + per-region bboxes
  ↓
Florence-2 caption
  ↓
Ettin NER over full OCR sequence
  ↓
Map Ettin character spans back to OCR regions
  ↓
Redact OCR chunks
  ↓
Sharp pixel redaction
  ↓
Evidence JSON + Florence/UI structure
```

The current code intentionally runs Ettin over the complete OCR sequence so surrounding context is available, then maps detected entity spans back to OCR regions for redaction. The existing implementation also has geometry-based UI structure analysis and direct Sharp masking. See the current file around OCR/NER, image redaction, and evidence construction. 

The current Qwen stage is currently only being prepared with a perception prompt. It is explicitly described as a **screen-perception model rather than a redaction-decision model**, and it receives the Florence caption, already-redacted OCR, dimensions, and UI structure. The new architecture will change this role.

---

## 3. Problem Being Solved

### 3.1 Ettin misses contextual identifiers

A value such as:

```text
Certificate No: ABC123XY98
```

may not look like a conventional PII class to a generic NER model.

The sensitivity comes primarily from the **relationship between the label and its value**.

Examples:

```text
Certificate No: ABC123XY98
Registration No: 24CSE01872
Application ID: APP-2026-92817
Student ID: GCECT24CSE018
Policy Number: PL-1828192
License No: WB-12-AB-9281
Passport No: XH829182
Account No: 1234567890
```

### 3.2 Ettin can create partial/duplicate findings

A test case demonstrated a useful failure mode:

```text
Certificate No: ABC123XY98
```

can produce a correct candidate for the complete value while also producing an additional overlapping candidate such as:

```text
98
```

Therefore final redaction must not blindly accept every Ettin entity independently.

### 3.3 OCR can be imperfect

The system must tolerate variants such as:

```text
Certificate No:
ABC123XY98
```

```text
Certificate Number       ABC123XY98
```

```text
CERTIFICATE
NO. ABC123XY98
```

and OCR errors such as:

```text
Certiflcate N0: ABCl23XY98
```

The image itself must remain available to the adjudication model so visual evidence can resolve ambiguous OCR/context.

---

## 4. Target Architecture

```text
                              ORIGINAL IMAGE
                                    │
                   ┌────────────────┴────────────────┐
                   │                                 │
                   ▼                                 ▼
             PaddleOCR                            Florence-2
           text + bbox + conf                  global description
                   │                                 │
                   ▼                                 │
          OCR reading-order layer                    │
                   │                                 │
          ┌────────┴─────────┐                       │
          │                  │                       │
          ▼                  ▼                       │
      Ettin NER       Deterministic               │
      candidates       context rules              │
          │                  │                       │
          └────────┬─────────┘                       │
                   ▼                                 │
              Candidate Fusion                       │
                   │                                 │
                   ├──────── candidate evidence ─────┤
                   │                                 │
                   ▼                                 ▼
                  ┌──────────────────────────────────┐
                  │            Qwen3.5-2B             │
                  │       final redaction judge       │
                  │                                  │
                  │ image + OCR + Florence + Ettin   │
                  │ + deterministic context          │
                  └────────────────┬─────────────────┘
                                   │
                                   ▼
                         FINAL REDACTION FINDINGS
                                   │
                                   ▼
                         bbox / OCR-region resolver
                                   │
                                   ▼
                                Sharp
                                   │
                                   ▼
                           REDACTED IMAGE
```

---

## 5. Responsibility of Each Component

| Component | Responsibility | Final authority? |
|---|---|---|
| PaddleOCR | Detect/read text and provide coordinates | No |
| OCR ordering | Establish reliable reading sequence | No |
| Deterministic context layer | Detect semantic field/value relationships | Candidate evidence |
| Ettin | Identify likely PII/entity spans | Candidate evidence |
| Candidate fusion | Merge/deduplicate overlapping evidence | No |
| Florence-2 | Global image description | No |
| Qwen3.5-2B | Final semantic + visual redaction decision | **Yes** |
| bbox resolver | Turn chosen text into exact image regions | No |
| Sharp | Irreversible pixel masking | **Execution only** |

---

## 6. Critical Design Decision: Never Rewrite OCR for Ettin

Do **not** inject synthetic tokens such as:

```text
[FIELD_LABEL] Certificate No
[FIELD_VALUE] ABC123XY98
```

into the OCR sequence sent to Ettin.

Why:

1. It changes the natural token distribution seen by Ettin.
2. It can create additional spurious/partial entities.
3. It complicates character-offset → OCR-box mapping.
4. It mixes model input with system-generated annotations.

Instead, keep two representations:

### Original OCR

```js
{
  id: "ocr_7",
  text: "Certificate No: ABC123XY98",
  bbox: [x1, y1, x2, y2],
  confidence: 0.94
}
```

### Parallel semantic metadata

```js
{
  ocr_id: "ocr_7",
  label: "Certificate No",
  value: "ABC123XY98",
  field_type: "CERTIFICATE_NUMBER",
  confidence: 0.98,
  source: "deterministic_context"
}
```

Ettin continues to receive the original OCR text.

Qwen receives **both the original OCR and the structured metadata**.

---

## 7. Phase 1 — OCR Normalization and Reading Order

### Objective

Create a stable spatial representation of OCR without changing the recognized text.

### Tasks

1. Preserve every OCR item and bbox.
2. Normalize whitespace only for comparison; never overwrite raw OCR text.
3. Group regions into approximate visual rows.
4. Sort rows top-to-bottom.
5. Sort items within each row left-to-right.
6. Maintain original OCR IDs.
7. Keep OCR confidence available to later stages.

### Output

```js
{
  id: "ocr_7",
  text: "Certificate No: ABC123XY98",
  bbox: [100, 300, 620, 340],
  confidence: 0.94,
  reading_order: 17
}
```

### Important

Reading order is an aid to semantic processing. It must not alter the original bbox mapping used for final redaction.

---

## 8. Phase 2 — Deterministic Context Analyzer

### Objective

Detect sensitive values using semantic labels and spatial relationships without requiring an ML model to learn every identifier format.

### 8.1 Sensitive-field vocabulary

Start with a configurable dictionary containing groups such as:

```text
Certificate No
Certificate Number
Cert No
Cert Number

Registration No
Registration Number

Application No
Application Number
Application ID

Student ID
Student Number
Roll No
Roll Number
Admission No
Admission Number

Employee ID
Employee Number

Passport No
Passport Number
License No
Licence No

Policy Number
Reference Number
Reference No
Document Number
Document No
Serial Number
Serial No

Date of Birth
DOB

Email
Email Address
Phone
Phone Number
Mobile
Mobile Number

Account Number
Card Number
UPI ID
IFSC
IBAN
```

The list must remain configurable and should not be treated as an exhaustive universal PII taxonomy.

### 8.2 Label normalization

Normalize labels for matching:

- lowercase
- collapse whitespace
- normalize punctuation
- tolerate common OCR punctuation errors
- optionally tolerate a small set of OCR substitutions (`0/O`, `1/I/l`) when matching labels only

Example:

```text
Certificate No:
certificate no
CERTIFICATE N0.
Certificate-No
```

should map to the same normalized concept.

### 8.3 Relationship types

Support at least:

#### Same-line relationship

```text
Certificate No: ABC123XY98
```

#### Label + right-side value

```text
Certificate No        ABC123XY98
```

#### Vertical relationship

```text
Certificate No:
ABC123XY98
```

#### Multi-line label

```text
Certificate
Number: ABC123XY98
```

### 8.4 Candidate value validation

The value does not need to match a strict universal regex.

Use weak shape tests such as:

- contains alphanumeric characters
- not just punctuation
- reasonable length
- does not look like ordinary long prose
- can contain `/`, `-`, `.`, `:`, `_`, etc.

The **label supplies the semantic confidence**; the value-shape test is only a guard against obvious nonsense.

### Output example

```js
{
  source: "deterministic_context",
  ocr_ids: ["ocr_7"],
  label: "Certificate No",
  value: "ABC123XY98",
  field_type: "CERTIFICATE_NUMBER",
  confidence: 0.98,
  reason: "Sensitive identifier value associated with a recognized certificate-number label"
}
```

---

## 9. Phase 3 — Ettin Candidate Detection

Keep the existing full-OCR Ettin inference approach initially.

Ettin should still receive the natural OCR text sequence, because surrounding context is useful.

### Preserve

- tokenizer
- BIO parsing
- offset mapping
- OCR span mapping
- placeholder filtering
- existing model configuration

### Improve later

If long screenshots exceed the practical Ettin input window, introduce overlapping OCR windows rather than simply truncating the screenshot to one sequence.

Example:

```text
Window 1: OCR regions 1–40
Window 2: OCR regions 31–70
Window 3: OCR regions 61–100
```

Then merge entities using the same overlap/deduplication layer.

This is a later optimization; do not combine it with the first Qwen integration unless necessary.

---

## 10. Phase 4 — Candidate Fusion and Deduplication

Before Qwen, produce a unified candidate set.

### Inputs

- Ettin findings
- deterministic semantic findings
- optionally future regex/checksum detectors

### Required behavior

If Ettin returns:

```text
ABC123XY98
```

and:

```text
98
```

and the second finding is fully contained inside the first, the fusion layer must collapse them into one logical candidate unless there is strong contrary evidence.

### Generic containment rule

```text
larger candidate: ABC123XY98
smaller candidate:        98

=> keep larger candidate
=> discard smaller candidate
```

### Preferred fusion record

```js
{
  candidate_id: "cand_012",
  ocr_ids: ["ocr_7"],
  text: "ABC123XY98",
  label_context: "Certificate No",
  candidate_types: [
    "ETTIN_UNIQUE_ID",
    "CERTIFICATE_NUMBER"
  ],
  sources: [
    "ettin",
    "deterministic_context"
  ],
  confidence: 0.99,
  bbox: [100, 300, 620, 340]
}
```

### Candidate fusion must be conservative about destructive merging

Do not merge two adjacent entities solely because they are nearby. Merge when:

- they overlap in character span, or
- they map to the same OCR region and one contains the other, or
- they are clearly the same semantic value based on OCR/context evidence.

---

## 11. Phase 5 — Build Qwen Adjudication Input

Qwen should receive the **original image**, not an already-redacted copy, because it needs to visually inspect ambiguous cases.

Provide these evidence channels:

### A. Original image

The actual screenshot/document image.

### B. Florence description

The current Florence global description.

### C. OCR regions

Each OCR item should include:

```json
{
  "id": "ocr_7",
  "text": "Certificate No: ABC123XY98",
  "bbox": [100, 300, 620, 340],
  "confidence": 0.94
}
```

### D. Ettin candidates

Include:

- entity type
- candidate text
- confidence
- OCR ID(s)
- bbox when available

### E. Deterministic candidates

Include:

- recognized field label
- associated value
- field type
- confidence
- OCR ID(s)

### F. Image dimensions

```json
{
  "width": 1440,
  "height": 900
}
```

---

## 12. Qwen's Exact Job

Qwen is the **final adjudicator**.

It must answer:

> Given the image and all available evidence, which exact visible values are sensitive and must be redacted?

Qwen should **not** be asked to:

- generate a redacted image
- rewrite the screenshot
- describe the whole UI first
- invent missing OCR
- reconstruct hidden text
- make a generic list of possible PII

It should resolve candidate ambiguity and select the final redaction fields.

---

## 13. Qwen Prompt Design

The prompt should be deterministic and strict.

### Core instructions

```text
You are the final privacy redaction adjudicator.

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
```

### Recommended output schema

```json
{
  "redactions": [
    {
      "candidate_id": "cand_012",
      "ocr_ids": ["ocr_7"],
      "text": "ABC123XY98",
      "type": "certificate_number",
      "confidence": 0.99,
      "reason": "Value associated with Certificate No label"
    }
  ],
  "rejected_candidates": [
    {
      "candidate_id": "cand_013",
      "reason": "Partial substring of accepted certificate number"
    }
  ],
  "confidence_notes": "..."
}
```

The exact schema should be kept as small as practical because Qwen is only adjudicating candidate findings.

---

## 14. Qwen Decision Policy

### High-confidence case

```text
Deterministic: strong
Ettin: strong
OCR: strong
Image: confirms
```

Qwen returns the candidate directly.

### Conflicting case

```text
Ettin: says sensitive
Deterministic: says normal
Image: ambiguous
```

Qwen must resolve or reject based on visible/contextual evidence.

### OCR-poor case

```text
OCR: "Certficate N0 ABCl23..."
Image: visibly shows clear certificate-number field
```

Qwen may accept the semantic candidate based on the image.

### False-positive case

```text
Ettin: detects "98"
Deterministic: no sensitive label
Image: shows ordinary sentence ending in 98
```

Qwen should reject it.

---

## 15. Phase 6 — Final Redaction Region Resolution

Qwen output must be mapped back to the original OCR regions.

Preferred resolution order:

1. `ocr_ids` returned by Qwen.
2. Exact text match within OCR region.
3. Case-insensitive text match.
4. Semantic candidate's stored OCR region.
5. Fallback spatial resolution only when necessary.

Do not rely on Qwen-generated coordinates unless the system independently validates them against image bounds and OCR geometry.

### Important principle

Qwen should identify **the field/value**, not become the source of truth for pixel coordinates.

The local OCR/bbox system remains responsible for coordinate mapping.

---

## 16. Partial-Line Redaction

A major improvement should eventually distinguish:

```text
Certificate No: ABC123XY98
```

from:

```text
████████████████████████
```

The desired result is:

```text
Certificate No: ██████████
```

If the OCR package exposes word-level/character-level boxes, use those directly.

If only one line-level bbox is available, add a deterministic character-position estimate as a temporary fallback:

```text
line bbox
   ↓
label character proportion
   ↓
value starting x-position
   ↓
value bbox
```

This should be explicitly marked as an approximation and covered by visual regression tests.

---

## 17. Phase 7 — Sharp Redaction

Keep the current local image redaction implementation.

Sharp should receive only the final Qwen-approved findings after local bbox validation.

Current supported behavior:

```text
REDACTION_STYLE=black
```

or optionally:

```text
REDACTION_STYLE=blur
```

For privacy/security, the black opaque rectangle should remain the default irreversible masking method.

---

## 18. Safety Gates Before Sharp

Before any pixel is masked:

### Gate 1 — valid bbox

- finite numbers
- positive width/height
- inside image bounds

### Gate 2 — valid OCR mapping

The finding must map to an OCR region or independently validated coordinate.

### Gate 3 — text consistency

Where text is available, verify that the requested text is actually present in the mapped region.

### Gate 4 — candidate containment

Remove redundant sub-spans.

### Gate 5 — no label-only redaction

Do not redact:

```text
Certificate No
```

when only its value is sensitive.

### Gate 6 — confidence policy

Define an explicit final confidence threshold. Do not silently inherit Ettin's threshold as the final redaction threshold.

---

## 19. Failure Modes and Expected Behavior

| Failure | Expected behavior |
|---|---|
| Ettin misses certificate number | Deterministic context candidate can rescue it |
| Ettin detects only part of identifier | Qwen should prefer the full semantic value |
| Ettin detects `98` inside `ABC123XY98` | Candidate fusion + Qwen should reject the partial duplicate |
| OCR label slightly garbled | Context normalization + image can resolve it |
| OCR value garbled | Qwen can use image evidence, but must not invent unsupported text |
| Florence misses sensitive field | Not fatal; OCR + Ettin + Qwen still operate |
| Florence hallucinates text | OCR and image evidence take precedence |
| Qwen returns unsupported value | Reject unless it maps to visible OCR/image evidence |
| Qwen returns invalid JSON | Treat as adjudication failure; fail closed according to chosen policy |
| Qwen unavailable | Use configurable fallback policy; do not silently claim Qwen adjudicated |
| No candidates | No redaction unless an independent high-confidence detector exists |
| Ambiguous image | Prefer conservative evidence policy and log uncertainty |

---

## 20. Failure-Closed Policy

The system should distinguish between:

```text
NO SENSITIVE DATA FOUND
```

and:

```text
REDACTION ADJUDICATION FAILED
```

These are not equivalent.

Recommended result state:

```js
{
  status: "ok" | "adjudication_failed" | "ocr_failed" | "qwen_failed",
  redaction_complete: true | false
}
```

For a production privacy product, a configurable **fail-closed** mode should be available so an adjudication failure does not silently appear as a clean/no-PII result.

---

## 21. Logging and Evidence

Add structured logs for every final decision.

Example:

```json
{
  "candidate_id": "cand_012",
  "sources": ["ettin", "deterministic_context"],
  "qwen_decision": "redact",
  "final_type": "certificate_number",
  "text": "ABC123XY98",
  "ocr_ids": ["ocr_7"],
  "confidence": 0.99,
  "reason": "Sensitive value associated with certificate-number label"
}
```

Do not store plaintext sensitive data in persistent logs in a production deployment unless there is a deliberate security/legal reason to do so.

For development, make raw-value logging opt-in behind a debug flag.

---

## 22. Evidence JSON Evolution

Extend the existing evidence structure rather than replacing it.

Recommended top-level shape:

```json
{
  "input_mode": {
    "image": true,
    "dom": false
  },
  "image": {},
  "ocr": {},
  "florence": {},
  "ui_structure": {},
  "ner": {
    "model": "...",
    "findings": []
  },
  "deterministic_context": {
    "findings": []
  },
  "candidate_fusion": {
    "candidates": []
  },
  "qwen_adjudication": {
    "model": "Qwen3.5-2B",
    "status": "ok",
    "redactions": [],
    "rejected_candidates": []
  },
  "image_redaction": {}
}
```

This structure makes every decision auditable.

---

## 23. Qwen Invocation Strategy

### First implementation

Run Qwen once per image when there are candidate findings or when the upstream perception layer explicitly marks the image as ambiguous.

### Later optimization

Add a gate:

```text
No candidates + no semantic ambiguity
        ↓
skip Qwen
```

and:

```text
Strong deterministic + strong Ettin agreement
        ↓
Qwen optional depending on security mode
```

A strict privacy mode can still run Qwen as the final authority for every image.

---

## 24. Florence → Qwen Fallback Strategy

Florence remains the cheap global perception stage.

Use its description to provide initial context.

Call Qwen for enhancement when:

- Florence description is too vague.
- OCR and visual description disagree materially.
- candidate fields are ambiguous.
- OCR is visibly noisy.
- a semantic identifier is suspected from layout/context.
- the screen/document contains structures Florence does not describe reliably.

Do not use Qwen merely to repeat a good Florence result unless the architecture's accuracy mode intentionally requires a final multimodal pass.

---

## 25. Future DOM Architecture

The image path and DOM path should eventually converge at the same adjudication layer.

### DOM path

```text
DOM text/attributes
       ↓
deterministic rules
       ↓
Ettin
       ↓
Qwen adjudication for ambiguous cases
       ↓
DOM redaction/action
```

### Image path

```text
OCR + image
       ↓
deterministic context + Ettin
       ↓
Qwen image adjudication
       ↓
OCR bbox resolution
       ↓
Sharp
```

The final common abstraction should be:

```js
{
  action: "redact",
  type: "certificate_number",
  text: "ABC123XY98",
  confidence: 0.99,
  source: ["ettin", "deterministic", "qwen"]
}
```

The execution adapter then decides whether the action applies to DOM or pixels.

---

## 26. Implementation Order

### Step 1 — Refactor current redaction flow

Change:

```text
Ettin → Sharp
```

to:

```text
Ettin → candidate list
```

Do not change Ettin internals yet.

### Step 2 — Add deterministic context engine

Implement:

```js
extractSensitiveFieldCandidates(ocr)
```

with same-line, right-side, and vertical label/value matching.

### Step 3 — Add fusion layer

Implement:

```js
fuseRedactionCandidates({ ettin, deterministic })
```

with overlap and containment handling.

### Step 4 — Add Qwen input builder

Implement:

```js
buildQwenRedactionEvidence(evidence)
```

### Step 5 — Add Qwen3.5-2B inference

Implement:

```js
loadQwen()
runQwenRedactionAdjudication(input)
```

Keep model loading isolated from the rest of the pipeline.

### Step 6 — Validate Qwen JSON

Add strict schema validation and reject malformed output.

### Step 7 — Resolve final findings to OCR bboxes

Implement:

```js
resolveFinalRedactionRegions(qwenResult, evidence)
```

### Step 8 — Connect Sharp only to final findings

Change:

```js
redactImage(imagePath, nerFindings, outputPath)
```

to effectively operate on:

```js
redactImage(imagePath, finalRedactionFindings, outputPath)
```

### Step 9 — Add regression tests

Do this before further model tuning.

---

## 27. Test Matrix

### Test A — Simple certificate

```text
Certificate No: ABC123XY98
```

Expected:

```text
ABC123XY98 → REDACT
```

Not:

```text
Certificate No → REDACT
98 → separate REDACT
```

### Test B — Vertical layout

```text
Certificate No:
ABC123XY98
```

Expected same result.

### Test C — Spaced identifier

```text
Certificate Number        ABC 123 XY 98
```

Expected value redaction if the image/context makes the field relationship clear.

### Test D — Registration number

```text
Registration No: 24CSE01872
```

Expected full identifier redaction.

### Test E — Normal number

```text
Batch size: 98
```

Expected no redaction solely because `98` is a numeric string.

### Test F — Identifier substring

```text
Certificate No: ABC123XY98
```

If Ettin returns both:

```text
ABC123XY98
98
```

final output must contain only the complete value.

### Test G — Poor OCR label

```text
Certiflcate N0: ABCl23XY98
```

Expected Qwen/context layer to have an opportunity to correct the semantic interpretation from the image.

### Test H — Multiple fields

```text
Name: ...
Certificate No: ...
Date of Birth: ...
Email: ...
```

Expected independent redaction of each sensitive value.

### Test I — False-positive UI labels

```text
Certificate No
Enter certificate number
```

Expected label/instruction text itself not to be redacted unless its content is actually sensitive.

### Test J — Ambiguous value

A value visually associated with a non-sensitive label.

Expected Qwen to reject a weak Ettin-only candidate when image/context contradicts it.

---

## 28. Evaluation Metrics

Track at least:

### Detection recall

Percentage of truly sensitive values that are redacted.

### Precision

Percentage of redacted regions that are genuinely sensitive.

### Over-redaction rate

How often labels, normal numbers, UI text, or non-sensitive substrings are unnecessarily masked.

### Under-redaction rate

How often part of a sensitive value remains visible.

### Region accuracy

Whether the correct pixels are covered rather than merely the correct semantic value being identified.

### Qwen adjudication accuracy

How often Qwen selects the same final redaction decision as a human-labeled ground truth.

### Pipeline latency

Track separately:

- OCR
- Florence
- Ettin
- deterministic context
- Qwen
- Sharp

---

## 29. Model Loading / Runtime Isolation

Do not tightly couple Qwen initialization to OCR, Florence, or Ettin.

Use isolated functions:

```js
async function loadQwen() {}
async function runQwenRedactionAdjudication(...) {}
```

This allows:

- lazy loading
- easy disabling through environment variables
- benchmarking
- replacement of Qwen later
- fallback behavior when the model cannot load

Recommended configuration values:

```text
QWEN_ENABLED=1
QWEN_MODEL=Qwen/Qwen3.5-2B
QWEN_MAX_NEW_TOKENS=...
QWEN_DTYPE=...
QWEN_DEBUG=0
QWEN_REQUIRED=1
```

Exact runtime/model-loading options should be implemented only after confirming the installed Transformers.js/runtime supports the desired Qwen3.5-2B model format.

---

## 30. Prompt/Output Security Requirements

Qwen output is untrusted model output.

Never directly execute or trust arbitrary fields from it.

Validate:

- JSON syntax
- allowed entity types
- candidate IDs
- OCR IDs
- text consistency
- bbox validity if coordinates are ever returned
- confidence range

Reject:

- fabricated OCR IDs
- nonexistent candidate IDs
- text absent from all known evidence
- out-of-bounds coordinates
- unsupported entity types

Qwen should never have direct access to the filesystem, shell, or image-writing operations.

---

## 31. Recommended Module Structure

As the script grows, split responsibilities instead of keeping all logic in one `.mjs` file.

Suggested structure:

```text
perception/
├── ocr.mjs
├── florence.mjs
├── ettin.mjs
├── context-fields.mjs
├── candidate-fusion.mjs
├── qwen.mjs
├── bbox-resolution.mjs
├── redaction.mjs
├── evidence.mjs
└── pipeline.mjs
```

During the first implementation, these can remain in `v3(1).mjs` to minimize refactoring risk. Extract them after behavior is stable.

---

## 32. Final Target Data Flow

The desired runtime sequence is:

```text
1. Load original image
2. Run PaddleOCR
3. Build stable OCR reading order
4. Run Florence global description
5. Run Ettin on original OCR text
6. Run deterministic sensitive-field context analysis
7. Fuse + deduplicate candidates
8. Build multimodal Qwen evidence
9. Run Qwen final redaction adjudication
10. Validate Qwen output
11. Resolve chosen values to original OCR bboxes
12. Apply safety gates
13. Redact original image using Sharp
14. Save evidence JSON
15. Save final redacted image
```

---

## 33. Example End-to-End Result

Input:

```text
Certificate No: ABC123XY98
Name: John Doe
Batch: 98
```

Possible upstream evidence:

```text
Ettin:
ABC123XY98
98
```

Deterministic context:

```text
Certificate No → ABC123XY98
```

Fusion:

```text
candidate_1 = ABC123XY98
candidate_2 = 98 (contained by candidate_1)
```

Qwen sees:

```text
Image
+ OCR
+ Florence
+ candidate_1
+ candidate_2
+ certificate-number semantic context
```

Qwen returns:

```json
{
  "redactions": [
    {
      "candidate_id": "candidate_1",
      "ocr_ids": ["ocr_0"],
      "text": "ABC123XY98",
      "type": "certificate_number",
      "confidence": 0.99,
      "reason": "Sensitive identifier value associated with Certificate No"
    }
  ],
  "rejected_candidates": [
    {
      "candidate_id": "candidate_2",
      "reason": "Partial substring of the accepted certificate number"
    }
  ]
}
```

Sharp then masks the **value region**, not the label.

Final visual result:

```text
Certificate No: ██████████
Name: John Doe
Batch: 98
```

---

## 34. Non-Goals for the First Version

Do not attempt all of these simultaneously:

- full OCR character segmentation
- checksum validation for every national document type
- complex document understanding
- automatic arbitrary bbox prediction from Qwen
- DOM redaction integration
- multiple Qwen passes
- extensive prompt self-reflection
- replacing Florence with Qwen everywhere
- training/fine-tuning Ettin

The first goal is much narrower:

> **Make final image redaction reliable when Ettin produces incomplete, duplicate, or context-blind PII candidates.**

---

## 35. Definition of Done

The first Qwen-integrated version is complete when all of the following are true:

- Ettin no longer directly controls final image redaction.
- Original OCR text is preserved for Ettin.
- Deterministic label/value analysis detects certificate/registration/application/etc. identifiers.
- Overlapping Ettin predictions are fused.
- Qwen receives the original image plus structured evidence.
- Qwen returns strict JSON containing final redaction decisions.
- Qwen cannot invent a redaction target that lacks supporting evidence.
- Final text is resolved back to original OCR regions locally.
- Sharp masks only final approved regions.
- `Certificate No: ABC123XY98` produces one redaction for `ABC123XY98`, not a second `98` redaction.
- Normal values such as `Batch: 98` are not redacted solely because Ettin sees the number.
- Evidence JSON records the complete decision chain.
- Qwen failure is distinguishable from “no PII found”.
- A regression test suite covers the certificate-number failure case.

---

## 36. Immediate Next Implementation

The next code revision should be performed in this exact order:

```text
A. Stop Ettin findings from going directly to Sharp.

B. Add deterministic label/value candidate extraction.

C. Add candidate containment + overlap deduplication.

D. Add Qwen3.5-2B loader/inference wrapper.

E. Add a compact final-redaction JSON prompt.

F. Send:
   original image
   + Florence description
   + original OCR+bboxes
   + Ettin candidates
   + deterministic candidates

G. Validate Qwen output.

H. Resolve final candidates to original OCR bboxes.

I. Send ONLY those final regions to Sharp.

J. Run the certificate-number regression suite.
```

This preserves the strongest parts of the current implementation while moving final redaction authority to a multimodal adjudication stage.
