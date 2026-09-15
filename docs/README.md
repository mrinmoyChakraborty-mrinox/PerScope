# PerScope Team Docs — Deployable Site

This `docs/` folder **is itself a Vercel-deployable Next.js site**. It renders all team markdown (`docs/*.md`, `docs/tasks/*.md`) plus the changelog at one shareable URL.

## Deploy to Vercel (2 clicks)

1. **Vercel → Add New Project → Import** `mrinmoyChakraborty-mrinox/PerScope`
2. Set **Root Directory** to `docs` (Framework preset: Next.js — auto-detected via `docs/package.json` + `docs/vercel.json`)
3. Deploy — URL `https://perscope-docs.vercel.app` (or your project name) now shows Overview → Docs → Tasks → Changelog.

**Local dev:**
```bash
cd docs
npm install
npm run dev  # http://localhost:3000
```

## How the team documents while testing/reshaping

- **Edit docs:** change `docs/architecture.md`, `build-order.md`, `security-model.md`, `limitations.md`, or any `docs/tasks/*.md` — pages update on next deploy.
- **Log changelog:** edit `docs/CHANGELOG.md` — copy the template at the top:
  ```markdown
  ## YYYY-MM-DD — Area — Author
  - **Change:** ...
  - **Why:** ...
  - **Impact:** ...
  - **Follow-up:** ...
  ```
  Put newest entries at the top. Push to `main` → Vercel redeploys automatically.

- **Add a new doc:** create `docs/my-doc.md`, then add an entry to `docs/lib/docs.ts:DOC_ENTRIES`:
  ```ts
  { slug: "my-doc", file: "my-doc.md", title: "My Doc", group: "Core" }
  ```
  It appears at `/docs/my-doc`.

## Structure

```
docs/
  package.json          # Next.js site (not the root perscope package.json)
  vercel.json           # {framework: nextjs, regions: [bom1]}
  app/
    layout.tsx          # header/nav (Overview, Docs, Tasks, Changelog)
    page.tsx            # landing with cards
    globals.css         # Tailwind + prose
    docs/[...slug]/page.tsx  # renders any markdown via react-markdown
    docs/page.tsx       # index of all docs
    tasks/page.tsx      # Person 1–6 grid
    changelog/page.tsx  # renders CHANGELOG.md
  lib/docs.ts           # DOC_ENTRIES + getDoc()
  CHANGELOG.md          # team running log (edit this while testing)
  architecture.md, tool-schema.md, build-order.md, security-model.md, limitations.md
  tasks/                # 01-lead … 06-research-qa
```

## Shareable link

Give judges `https://<your-vercel-project>.vercel.app` — they can follow **all docs + tasks + changelog** live as you reshape architecture.

## Notes

- Root docs (`docs/*.md`) are the **source of truth** — the site just renders them, does not duplicate them.
- Tailwind is configured in `docs/tailwind.config.js` (content: `app/**/*`).
- `vercel.json` pins region `bom1` (Mumbai) for SIH — change if needed.
