# SIH 2026 — PS 26171 — FINAL MERGED Improvement Plan
### Team Cosmic Crux | On-device Visual Perception for Light-weight Browser Agents
### Sources merged: Claude review + ChatGPT review + Perplexity review — deduplicated, nothing dropped

**PS evaluation weights (what judges actually score against):**

| Metric | Weight |
|---|---:|
| Accuracy of visual context from screen | 25% |
| Precision & Recall for PII detection | 20% |
| Precision of redaction | 20% |
| Client-side resource utilization | 20% |
| End-to-end latency | 15% |

All three reviews independently converged on the same root diagnosis: **the deck explains the architecture well but proves nothing with numbers.** Since the PS's rubric is 100% numeric, this is the single highest-leverage fix available. Everything below is organized slide-wise (matching your actual 6-slide deck), then overall/cross-cutting, then new material to add.

---

## Slide 1 — Title Slide

- **Fix layout overlap**: "Smart Automation" (Theme line) currently overlaps "PS Category" below it. Fix spacing — this is the first thing judges see. *(Claude)*
- **Enter a real Team ID** — "NA" reads as unregistered/incomplete. *(Claude)*
- **Add a one-line value proposition/tagline** under the title, e.g. *"A browser agent that understands screens locally and shares only sanitized context."* Helps judges grasp your edge in 5 seconds. *(Claude + Perplexity — both flagged this independently)*

---

## Slide 2 — Solution Introduction (Problem Overview + Problem Solution)

- **Explicitly name the model class the PS asks for.** The PS requires "a local Vision Transformer (ViT) or equivalent computer vision model." You use Florence-2-base but never state it's a transformer-based vision-language model. Add: *"Florence-2-base (transformer-based vision-language model, ViT-equivalent)"* so judges can literally tick the PS requirement. *(Claude)*
- **Compress Problem Overview to 3 tight bullets** and add one small visual: "raw screen → cloud = privacy risk." Currently explained well in text but a graphic makes it instantly scannable. *(Perplexity)*
- **Add a mini evidence strip under each pipeline module** in Problem Solution: "tested on X pages," "avg OCR time: X ms," "NER F1/precision: X%," "redaction preserved DOM structure in Y% of cases." Without numbers this section reads as conceptual rather than proven — this is your best slide, so proving it pays off most. *(Perplexity)*
- **Add at least one labeled target/projected metric** if you don't have measured numbers yet (e.g., "Target: <300ms local perception latency") — clearly marked as a target, not a measured result. *(Claude)*

---

## Slide 3 — Technical Approach (Architecture Flow + Methodology + Tech Stack)

### Critical fix — do this first
- **"Ettin-60B NER" in the Architecture Flow diagram is wrong** — every other slide correctly says Ettin-**68M**. A 60B model directly contradicts your "lightweight, on-device" pitch. This is the single most damaging inconsistency in the deck for a technical judge. *(Claude)*

### Coverage gaps vs. the PS text
- **Add explicit face/visual redaction.** The PS's own lead example of sensitive content is "blurring faces." Your current pipeline (DOM values, OCR text, bounding-box masking) reads as text/PII-centric. Add a visible step — even a lightweight on-device face detector, or Florence-2 region grounding applied to face regions. *(Claude, reinforced by Perplexity's "include a face case if your system supports it" under demo evidence)*
- **State your Firefox position clearly, once** — right now it only appears as an unresolved risk on Slide 4. Either show a concrete plan/timeline or justify a deliberate Chrome-first phased strategy. *(Claude + Perplexity both flagged; Perplexity additionally recommends a dedicated Browser Compatibility slide — see "New Slides" below)*

### Architecture Flow specifics
- **Label the trust boundary explicitly**: exact data types crossing it, and what happens if the server is unreachable (local fallback behavior). Privacy-focused judges care about the exact data movement, not just arrows. *(Perplexity)*

### Methodology (the 6-step flow)
- **Add an input/output line under each step**, e.g. "DOM + screenshot in → masked JSON + redacted image out." This demonstrates system-engineering maturity, not just concept. *(Perplexity)*

### Tech Stack
- **Split the stack into 3 labeled columns**: on-device / server-side / security-validation. Lets judges instantly see what runs where. *(Perplexity)*

### Metrics (ties directly to the PS rubric)
- **Add a Performance & Evaluation table** — measured from your actual working prototype, not invented:

| Metric | Our Result | Test Setup |
|---|---:|---|
| Visual Context Accuracy | XX% | XX browser pages |
| PII Precision | XX% | XX PII samples |
| PII Recall | XX% | XX PII samples |
| Redaction Precision | XX% | XX redaction cases |
| Peak RAM | XX MB/GB | Chrome + extension |
| CPU Usage | XX% | During inference |
| GPU/WebGPU Usage | XX | WebGPU device |
| WASM Fallback Latency | XX ms | WebGPU unavailable |
| Local Perception Latency | XX ms | Warm run |
| PII Detection Latency | XX ms | Warm run |
| Local Reasoning Latency | XX ms | Ambiguous cases only |
| Redaction Latency | XX ms | DOM + image |
| Server Round Trip | XX ms | Sanitized request |
| End-to-End Latency | XX ms / s | Complete task |

*(ChatGPT — most detailed version of this table; Claude and Perplexity both independently recommended a metrics table, so this is a 3/3 consensus item — treat as top priority)*

- **Priority sub-task: Visual Context Accuracy methodology** (25% of total score, the single largest weight). Build a small ground-truth test set of browser pages covering headings, buttons, forms, tables, images, text-rendered-in-images, input fields, labels, links, and dynamic UI elements. Measure your extracted elements against ground truth (precision/recall/IoU-style comparison) and report the number. This is the highest-weighted metric in the entire PS and currently has zero quantitative backing anywhere in the deck. *(ChatGPT)*

---

## Slide 4 — Feasibility and Viability

- **Reduce text density**: convert the Challenges/Strategies section into a clean 3-column table — Risk / Impact / Mitigation — for faster judge scanning. *(Perplexity)*
- **Technical Feasibility**: add a tested hardware profile — RAM, browser version, WebGPU vs. WASM used — otherwise judges may doubt the "lightweight" claim is real. *(Perplexity)*
- **Economic Feasibility**: add one comparison row — raw-cloud pipeline vs. your sanitized-hybrid pipeline — across server cost, privacy risk, and scalability. Makes the business case concrete rather than asserted. *(Perplexity; complements Claude's suggestion to add an indicative cost figure — merge both: use the comparison row format, populate with real/estimated numbers)*
- **Legal & Compliance**: name the specific regulation you're aligned with — India's **Digital Personal Data Protection (DPDP) Act, 2023** — since this is an Indian government (ISRO) hackathon. Naming a specific law is stronger than generic "privacy-regulation needs" language. *(Claude)*
- **Add one highlighted compliance one-liner**: *"No raw screenshots, DOM, or PII ever leave the device."* Put it in a visually distinct box so it's the one line judges remember. *(Perplexity)*
- **Operational/Security feasibility**: add one concrete demo scenario showing a blocked destructive action or blocked unsafe instruction — turns your "fail-closed self-audit" claim into visible evidence instead of an assertion. *(Perplexity)*

---

## Slide 5 — Impact and Benefits (+ Unique Features)

- **Fix the "Full Audit Trail" label overlap** with the "BENEFITS" header — tighten vertical spacing. *(Claude)*
- **Tie every benefit explicitly to the PS's own scoring language** — privacy, speed, resource use, action reliability — rather than generic benefit statements. Judges score higher when your claims mirror their rubric's vocabulary. *(Perplexity)*
- **Strengthen the competitor comparison table** two ways:
  1. Add a small source note (e.g., "based on public GitHub READMEs / model cards as of [date]") so it reads as researched, not asserted. *(Claude)*
  2. Consider conceding one honest limitation relative to a competitor — a single honest concession makes the rest of the table far more credible to a skeptical judge. *(Claude)*
  3. Alternatively/additionally, reframe your row labels as sharp differentiators with a "why competitors don't have this" one-liner (e.g., tiered PII detection, deterministic redaction, local action validator, server-sees-only-sanitized-context) — positive framing that works alongside the concession approach. *(Perplexity)*
- **Surface concrete numbers you already have** — e.g., Ettin-68M's "55 PII entity types" — pull that stat onto this slide too, since it's a strong, real, citable number. *(Claude)*

---

## Slide 6 — Research and References

- **Rebuild the layout — this slide currently has the worst visual defects in the deck**: overlapping text renders "Official" as "efficial," the Ettin-68M description collides with its own hyperlink, and the OpenRedaction description collides with its icon label ("rlmdaction" instead of "redaction"). Increase text-box heights/spacing per card and re-render to verify every card individually. *(Claude)*
- **Reduce link clutter**: move full broken-looking split URLs into a smaller, consistent footer style rather than inline in the card body — currently distracts from professionalism. *(Perplexity)*
- **Fix model-name inconsistency**: the deck says **"Qwen 2B"** in some places and **"Qwen3.5-2B"** in others. If these refer to the same model, standardize the name everywhere. If they're deliberately different (e.g., different versions for different roles), state that explicitly — otherwise it reads as an error. *(Perplexity — this is a separate, additional consistency issue from the Ettin-60B/68M error Claude flagged on Slide 3; both need fixing, they are not the same typo)*
- The underlying content/sources here are all real and verifiable (Transformers.js Chrome Extension, PaddleOCR.js, Ettin-68M-Nemotron-PII, Qwen3.5-2B, MCP spec, PrivacyLens, safeclipper) — don't change the substance, only the layout and naming consistency. *(Claude)*

---

## New Slides Worth Adding

These were recommended (by ChatGPT and/or Perplexity) as slides that don't currently exist in your deck but would directly target the PS's numeric rubric:

1. **Evaluation Metrics slide** — a dedicated slide with the Performance & Evaluation table from Slide 3 above, given full-slide space instead of being a callout. *(ChatGPT + Perplexity, 2/3 consensus)*
2. **Demo Proof slide** — before-redaction screenshot, after-redaction screenshot, a sanitized payload snippet, the action command returned by the server, and the local validator's result on that action. This is the single most persuasive addition available: architecture claims become visible proof. *(Perplexity)*
3. **Browser Compatibility slide** — Chrome tested version, Firefox current status (explicitly, not buried as a risk), WebGPU available/unavailable behavior, WASM fallback summary. *(Perplexity)*
4. **Failure Cases slide** — missed unusual PII formats, over-redaction cases, slow-page handling, hidden-page prompt injection attempts, unsupported environments, and your mitigation for each. Makes the team look honest and technically mature — judges trust teams that show they've stress-tested their own system. *(Perplexity)*

If slide count is constrained by the SIH template, prioritize #1 and #2 — they cover the highest-weighted, currently-completely-missing parts of the rubric (accuracy, precision/recall, redaction precision — 65% of total PS score).

---

## Overall / Cross-Cutting Fixes (apply across the whole deck)

1. **Add numbers everywhere the PS scores numerically** — model timings, full pipeline latency, detection accuracy, redaction precision, memory, CPU, test-set size. This is the #1 fix identified independently by all three reviews. *(Claude + ChatGPT + Perplexity — 3/3 consensus, highest priority item in this entire document)*
2. **Do not invent numbers** — measure them from the actual working prototype. If you don't have a number yet, label it clearly as "Target" or "Projected," never present an estimate as a measured result. *(ChatGPT)*
3. **Fix both model-naming inconsistencies**: Ettin-60B → 68M (Slide 3) and Qwen 2B vs. Qwen3.5-2B (Slide 6, and check Slides 2–3 too) — these are two separate errors, not the same one; fix both, then re-check every slide once more for any other name/number drift. *(Claude + Perplexity)*
4. **Add face/visual-PII redaction explicitly** somewhere in the pipeline — it's a named example in the PS text itself and currently reads as a gap. *(Claude, reinforced by Perplexity's before/after-with-face-case suggestion)*
5. **Resolve the Firefox question with a clear, single statement** rather than leaving it only as an "untested risk" — either commit to a timeline or explicitly justify Chrome-first as a phased strategy. Also generally: **remove or soften any other claim that isn't fully proven yet**, especially around "lightweight" and cross-device performance, until you have the numbers to back it. *(Claude + Perplexity)*
6. **Add 1–2 UI mockup/wireframe images** (side panel, Privacy/Security Logs dashboard, Approve/Deny confirm flow) if a live demo isn't ready — visual mockups make the "working prototype" claim far more tangible than text alone, and directly support the Demo Proof slide above. *(Claude)*
7. **Full visual QA pass**: re-render every slide to an image (not just re-reading the text/outline) after every edit — the overlap defects on Slides 1 and 6 were invisible from the text alone and only showed up when actually viewing the rendered slide. *(Claude)*
8. **Reduce text density deck-wide where possible** — convert dense paragraph/bullet blocks into small tables (metric tables, risk/impact/mitigation tables, stack columns) so judges can scan faster under time pressure. *(Perplexity)*

---

## Priority Order (highest score-per-effort first)

1. Add the Performance & Evaluation metrics table (Slide 3 or new dedicated slide) — highest-weighted, currently fully missing, flagged by all three reviews
2. Fix Ettin-60B → 68M typo (Slide 3) — 5-minute fix, high damage if left
3. Fix Qwen 2B vs. Qwen3.5-2B naming inconsistency (Slide 6 + wherever else it appears)
4. Rebuild Slide 6 layout (worst visual defect in the deck)
5. Fix Slide 1 title overlap + enter real Team ID
6. Add a Demo Proof slide/section (before/after redaction, sanitized payload, action + validator result) — second-highest persuasive value after the metrics table
7. Add explicit face-redaction step + resolve Firefox statement clearly (closes the two direct PS-text gaps)
8. Add Browser Compatibility and/or Failure Cases slides if slide budget allows
9. Polish: Slide 5 competitor table framing + spacing, Slide 4 risk table conversion, Tech Stack column split, per-module evidence strips on Slide 2

---

## Expected Score Impact (from Perplexity's estimate, consistent with all three reviews' emphasis)

| Area improved | Likely gain |
|---|---:|
| Add measured PII detection + redaction metrics | +4 to +6 |
| Add latency and resource-usage tables | +3 to +5 |
| Add before/after privacy demo evidence | +2 to +4 |
| Clarify browser support + fix model-name consistency | +1 to +2 |
| Reduce text density / improve scanability | +1 to +2 |

Starting from the current estimated **77/100**, fully implementing the items above — especially the metrics table and demo proof, which require an actual working/measurable prototype rather than slide edits — can realistically move the deck into the **86–92/100** range for the PPT round, assuming the underlying prototype genuinely supports the numbers shown.
