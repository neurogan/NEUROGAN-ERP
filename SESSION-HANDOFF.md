# NEUROGAN-ERP Session Handoff

All session handoff summaries are recorded below in reverse chronological order.

---

## 2026-04-21 — eQMS Layer Build + Staging Deployment

### Current State

- **Active branch:** `dev` (deployed to Railway staging)
- **Latest commit:** `3ae90b2` — `fix(storage): remove duplicate product declaration in getAvailableStock`
- **Railway staging:** Running successfully on port 8080, all migrations applied (ERP + QMS tables + seed data)
- **Production branch:** `main` — does not yet have the QMS work

### What Was Built This Session

1. **eQMS (electronic Quality Management System) layer** — full scaffold with real database tables, API routes, and UI pages:
   - QMS Dashboard with pending releases, open CAPAs, open complaints, training gaps
   - QC Lot Release Queue
   - CAPA Tracker (9 seed CAPAs mapped to FDA observations)
   - Complaints page with status workflow (open -> under_investigation -> pending_qc_review -> closed)
   - Audit Log page with before/after JSON diff, actor + table filters
   - 21 CFR Part 11 compliance banner (amber for demo PIN note, red for OAuth/TOTP TODO)

2. **UntitledUI integration** — Tailwind v4, React 19, React Aria Components

3. **Railway deployment fixes:**
   - Pinned Node 20 in `nixpacks.toml` (tailwindcss/oxide requires >= 20)
   - Added `--legacy-peer-deps` for React 19 compatibility
   - Fixed duplicate `const product` declaration that broke esbuild

### Open Work / Next Steps

| Priority | Item | Details |
|----------|------|---------|
| High | **21 CFR Part 11 auth** | Replace demo PIN login with Google OAuth + TOTP 2FA. Compliance banner explicitly flags this as required before FDA inspection use (§11.200(a)(1) two-component e-signature) |
| High | **Merge `dev` to `main`** | All QMS work is on `dev`; `main` is behind. Production environment deploys from `main` |
| Medium | **Node version bump** | Pinned at `v20.18.1` but `vite@7.3.1` requires `^20.19.0 \|\| >=22.12.0`. Works now but may break on future Vite updates. Update in `nixpacks.toml` |
| Medium | **Bundle size** | JS bundle is 918 kB (Vite warns at 500 kB). Needs dynamic `import()` code-splitting, especially for QMS pages |
| Medium | **npm audit** | 5 high-severity vulnerabilities flagged during build |
| Low | **Empty core data** | Products, locations, inventory, batches, POs all return empty. Seed data or onboarding flow needed for demo/staging |

### Key Files

- `server/` — Express API server, built with esbuild to `dist/index.cjs`
- `client/` — React 19 + Vite frontend
- `shared/` — Shared types/schema
- `nixpacks.toml` — Railway build config (Node 20, `--legacy-peer-deps`)
- `railway.json` — Railway service config (build + deploy commands)

### Deployment Info

- **Project:** neurogan-erp (Railway ID: `ad650608-e312-47c4-947f-93c4baee9e66`)
- **Environments:** staging, production
- **Services:** NEUROGAN-ERP, Postgres, P-L-Dashboard
- **Build:** Nixpacks (Node 20) -> `npm run build` -> `npm start`
- **Restart policy:** ON_FAILURE (max 3 retries)

### Branches

| Branch | Status |
|--------|--------|
| `dev` | Active development, deployed to staging |
| `main` | Production branch, behind `dev` |
| `eQMS-Layer` | Merged into `dev`, can be cleaned up |
| `claude/create-eqms-layer-QbOLi` | Remote only, can be cleaned up |
