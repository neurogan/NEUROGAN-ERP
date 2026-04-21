# first-session.md — How to start building NEUROGAN-ERP with Claude Code

**Purpose.** This file is the playbook for kicking off ERP build work in Claude Code. Read it before opening the first session. It captures everything I (Frederik) need to remember that Claude Code will not figure out on its own.

Companions (all must be present):
- `AGENTS.md` (at repo root **and** in `FDA/`)
- `FDA/neurogan-erp-build-spec.md`
- `FDA/validation-scaffold.md`
- `FDA/seed-fixtures-plan.md`
- `FDA/Response Package - FDA Form 483.md`
- `FDA/erp-gap-analysis-and-roadmap.md`

**Date drafted:** 2026-04-21. If you are reading this more than a week after this date, sanity-check the file list above against what's in the repo.

---

## 1. Before Claude Code touches anything

Do these in this order. Every one of them is cheap now and expensive later.

**1.1 Move the `FDA/` folder into the repo.** Right now it lives on my Desktop. The build spec, scaffold, seed plan, and this file reference each other by relative path. They must travel with the code or Claude Code will not have them in context. Commit the folder at the repo root as `FDA/`.

**1.2 Put `AGENTS.md` at the repo root as well.** Claude Code reads `AGENTS.md` from the root automatically. The copy inside `FDA/` is the archival copy; the copy at the root is the live one. Keep them identical. A short pre-commit check can enforce this later.

**1.3 Confirm Railway staging is reachable.** The paper-parallel rule (D-05) and the signature ceremony (F-04) both assume a staging environment where Carrie can actually sign. If there is no staging URL to hand her, pause and set one up before F-04.

**1.4 Confirm Carrie has a real, seeded account.** Email: `carrie.treat@neurogan.com`. Roles: `QA` and `ADMIN`. She needs to have rotated her temporary password at least once. Without that, F-04 cannot be operationally qualified.

**1.5 Confirm `main` is branch-protected.** Require PR review and green CI. If anyone can push directly to main, the regulated-code Definition of Done becomes optional in practice.

**1.6 Confirm the four env vars exist** (`DATABASE_URL`, `SESSION_SECRET`, `NODE_ENV`, `APP_ORIGIN`) in Railway. The `SESSION_SECRET` must be at least 64 hex characters. Never paste env values into Claude Code sessions.

---

## 2. First Claude Code session — reconnaissance, not editing

Paste this as the first message in the first Claude Code session. It produces a report, not a diff.

> Read `AGENTS.md` at the repo root. Then read `FDA/neurogan-erp-build-spec.md` sections 0 through 3, and `FDA/erp-gap-analysis-and-roadmap.md` sections 2 and 4.
>
> Do a read-only reconnaissance pass of the repo. Produce a short report covering:
>
> 1. Does the file inventory in roadmap §2 still match the current `main`? List any added, removed, or moved files.
> 2. Does `shared/schema.ts` still contain the tables described in roadmap §2? List any new tables, renamed tables, or column changes.
> 3. Is `runMigrations()` still called from `server/index.ts` (or anywhere else on boot)? Quote the line if yes.
> 4. Which route handlers currently accept identity from the request body? Scan for any of: `reviewedBy`, `performedBy`, `verifiedBy`, `weighedBy`, `weightVerifiedBy`, `addedBy`, `qcReviewedBy`, `approvedBy`. List file + line.
> 5. Is there a `CODEOWNERS` file? Is there a `.github/workflows/` directory with CI defined?
> 6. Is there any existing auth middleware? Quote the lines that gate or do not gate regulated routes.
>
> Do NOT edit anything. Do NOT start any ticket. Deliver the report, then stop.

Review the report. If the roadmap has drifted materially, update `FDA/erp-gap-analysis-and-roadmap.md` before F-01 depends on anything stale.

---

## 3. First ticket — F-00, and only F-00

Paste this as the second message, in the same session or a new one.

> Execute ticket F-00 from `FDA/neurogan-erp-build-spec.md` §4.0. One PR, scoped tightly:
>
> - Commit `AGENTS.md` to the repo root. The file is in `FDA/AGENTS.md`; copy it to the root and keep both in sync.
> - Set up CI in `.github/workflows/` with jobs: `lint`, `typecheck`, `unit` (Vitest), `integration` (Supertest against a disposable Postgres service in the workflow).
> - Add `CODEOWNERS` covering `shared/schema.ts`, `server/db-storage.ts`, `server/auth/*`, `server/audit/*`, `server/state/*`. Owner: me (use my GitHub handle).
> - Remove `runMigrations()` from `server/index.ts` if the reconnaissance report found it. Migrations run only via `pnpm migrate:up` from this PR onward.
> - Add the `pnpm` scripts listed in `AGENTS.md` §3 to `package.json`. Stub scripts whose implementation belongs to later tickets (e.g. `seed:test` can log "not yet implemented" until F-09 lands).
> - Fill out the regulated-code Definition of Done in the PR description (spec §3). Every box must be real. For boxes that do not apply to F-00 (e.g. "state transitions via storage-layer guard"), mark "N/A — not yet introduced" rather than leaving blank.
> - Add a `FDA/UI-LANE.md` section or appendix (see §6 of this file) carving out the presentation-only PR lane.
>
> Do not start F-01. Open the PR and stop.

Review the PR line by line. Fill the DoD yourself; do not let Claude Code auto-check boxes. If F-00 lands with half-filled DoD, every subsequent PR will skip the checklist. **The first PR sets the tone.**

---

## 4. Recurring session opener — reuse every session

Save this. Paste it at the start of every subsequent Claude Code session, replacing `<TICKET>` with the ID (e.g. `F-01`, `R-01-03`).

> Read `AGENTS.md` at the repo root. Read the ticket `<TICKET>` in `FDA/neurogan-erp-build-spec.md`.
>
> Before you edit anything:
> 1. Confirm every precondition listed in the ticket is merged to `main`. If any is not, stop and tell me.
> 2. List the files you plan to touch. If the list is surprising or spans beyond the ticket scope, stop and ask before proceeding.
> 3. Confirm you will append URS / FRS / DS / OQ entries to `FDA/validation-scaffold.md` as part of this PR.
> 4. Confirm the PR will include the regulated-code DoD checklist from spec §3, filled out honestly.
>
> Then execute the ticket end-to-end: schema → storage → API → UI → tests → validation artifacts. One ticket, one branch, one PR. When the PR is ready, stop — do not start the next ticket.

---

## 5. Rules that must not bend

These are the ones I will be tempted to skip at 9 PM. Do not.

1. **Order is F-00 → F-10 → R-01 → R-02 → ….** This is a dependency graph, not a preference. A UI built before F-02 has no auth to gate it. A state transition before F-05 is a raw `UPDATE` pretending to be a transition. Do not leapfrog.

2. **One ticket, one branch, one PR.** If Claude Code bundles two tickets, reject the diff and ask for a split.

3. **No UI work before F-02 merges.** Login, signature ceremony, protected routes — all need session auth and password policy first.

4. **Validation scaffold is updated in the same PR as the ticket.** Not "next sprint," not "in a batch later." If the PR does not touch `FDA/validation-scaffold.md`, it should not merge — unless it is a presentation-only PR (see §6).

5. **If Claude Code takes a regulated-code shortcut, reject it.** Shortcuts to auto-reject: accepting identity from the request body, mutating an APPROVED / RELEASED / SUBMITTED record, skipping an `audit_trail` row, bypassing the transition guard with raw SQL, rolling its own password hashing, treating the session cookie as a signature, running migrations on boot, introducing `any`, deleting data in a migration. Point at `AGENTS.md` §4.4 and ask for a revision.

6. **Every PR description includes which 483 observation(s) the ticket closes or partially closes.** If a PR does not map to an observation, it is not a Release 1 ticket. Question its existence.

7. **Two reviewers on regulated paths.** `shared/schema.ts`, `server/db-storage.ts`, `server/auth/*`, `server/audit/*`, `server/state/*`. `CODEOWNERS` enforces it; do not waive it.

8. **The 1 AM test.** If you are about to merge at 1 AM and the DoD has an unchecked box, **do not merge.** Park the PR and merge in the morning after filling the box honestly. Every regulated-software disaster starts with "it was late and we just wanted to ship."

---

## 6. The presentation-only PR lane

The full regulated-code DoD is correct for any ticket that touches schema, storage, a regulated endpoint, or a state machine. A copy tweak, button restyle, or layout adjustment does not need "state-machine unit tests for all legal and illegal edges."

Add this carve-out to `AGENTS.md` on the F-00 PR:

> **Presentation-only PRs** (changes that touch no route handler, no schema, no storage-layer module, no state machine, no middleware, no migration) may skip:
> - state-machine unit tests
> - integration-test 401 / 403 / 409 / 422 / audit-row suite
> - migration review
> - validation-scaffold entries
>
> They must still include:
> - ESLint clean, `--max-warnings 0`
> - `tsc --noEmit` clean
> - no `any`
> - all existing tests passing
> - a PR description that explicitly states "no regulated paths touched" and lists the files changed
>
> If any file covered by `CODEOWNERS` is in the diff, the PR is not presentation-only. Default back to the full DoD.

Without this carve-out, every UntitledUI refresh will drag 15 checkboxes behind it or (worse) Claude Code will start auto-ticking boxes that do not apply.

---

## 7. Superhuman and UntitledUI — how to use them without making a mess

Neither tool earns its keep before R-01 ships UI. First real UI ticket is likely `R-01-01` (approved-materials registry page) or `R-01-03` (specifications editor). When that lands:

- **Use them inside a ticket, not between tickets.** Do not schedule a standalone "UI refresh" PR that spans modules. It forks history, it conflicts with every concurrent module PR, and the review surface is enormous.
- **When pulling an UntitledUI component, confirm it is a drop-in** (e.g. shadcn-compatible) or wrap it in a local `components/ui/…` component. Do not add UntitledUI as a dependency that half the codebase gradually references. One component system, not two.
- **Accessibility is not optional.** UntitledUI components are usually WCAG-clean out of the box, but confirm. The audit-trail review page and the signature ceremony dialog will both be under regulator scrutiny; keyboard nav and screen-reader labels must work.
- **Superhuman is for PR formatting and commit hygiene**, not for generating code in regulated paths. Let it clean up your PR descriptions; do not let it autogenerate schema migrations.

---

## 8. Signals something is going wrong

If you see any of these, stop and step back:

- A single PR has more than ~400 lines of diff.
- Claude Code writes tests *after* the implementation because "I'll add them at the end."
- A ticket's DoD is being filled with "N/A" on boxes that clearly apply.
- A "small fix" PR modifies `shared/schema.ts` or `server/db-storage.ts` without two reviewers.
- The branch name does not match `ticket/<id>-<slug>`.
- `FDA/validation-scaffold.md` has not been touched across three merged PRs in a row.
- Claude Code says "I'll park this for later" more than once per session.
- A PR merges without running CI green.
- A migration deletes or renames a column without a preserving step.

All of these mean a ticket has grown beyond scope, or the pattern is slipping. Intervene before the next commit.

---

## 9. When Claude Code should ask, vs. when it should proceed

**Ask first when:**
- The ticket text does not match reality (file moved, column renamed, table dropped).
- A precondition ticket is not merged.
- The ticket requires editing a file outside its stated scope.
- A migration would delete or rename existing data.
- A state transition would make an illegal ceremony possible.
- The test harness for this ticket does not exist yet (e.g. no disposable Postgres).
- A third-party dependency needs to be added.

**Proceed without asking when:**
- The spec is unambiguous and preconditions are met.
- Edits stay inside the stated file list.
- Tests are being written as described in the ticket.
- Validation scaffold is being appended (not rewriting prior entries).
- Existing seed fixtures are being extended in the way the seed plan describes.

---

## 10. A note on the Perplexity-built code

The existing repo was built by Perplexity Computer in a prior phase. Treat it as legacy: every file is read with suspicion, not reverence. Ticket F-06 ("Remove body-supplied identity") is partly a *grep audit* against the existing surface. Have Claude Code produce the audit list as the *first artifact* of F-06 before it writes any replacement code — that way the blast radius is visible before the diff starts.

The roadmap inventory in `FDA/erp-gap-analysis-and-roadmap.md` §2 was captured from the repo a few days ago. Some drift is possible. The reconnaissance pass in §2 of this file will catch it.

---

## 11. If you only remember five things

1. **Move `FDA/` into the repo and put `AGENTS.md` at the root before opening Claude Code.**
2. **First session is reconnaissance. Do not let Claude Code edit anything on turn one.**
3. **F-00 is the trust-setting PR. Fill the DoD honestly or everything downstream cuts corners.**
4. **No UI before F-02. No module before F-10. No ticket skips the validation scaffold.**
5. **When tired, do not merge. Come back in the morning.**

Good luck. The 483 does not close itself, but it does close.

— Frederik, 2026-04-21
