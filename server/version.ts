import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

// IQ (Installation Qualification) traceability per first-session.md §3 and
// FDA/validation-scaffold.md. Exposes the running code's identity so an
// auditor (or the release log) can confirm "the deployed build is exactly the
// commit we expect." Required for GAMP 5 Cat 5 IQ records.

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function readPackageVersion(): string {
  try {
    // dev: server/ next to package.json at repo root
    // prod: dist/ has no package.json, so fall through to "unknown"
    const pkgPath = resolve(__dirname, "../package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    return typeof pkg.version === "string" ? pkg.version : "unknown";
  } catch {
    return "unknown";
  }
}

function readCommitSha(): string {
  // Railway injects RAILWAY_GIT_COMMIT_SHA on every deploy.
  // COMMIT_SHA is a generic fallback that CI / local Docker builds can set.
  return (
    process.env.RAILWAY_GIT_COMMIT_SHA ??
    process.env.COMMIT_SHA ??
    process.env.GITHUB_SHA ??
    "unknown"
  );
}

function readDeployEnvironment(): string {
  // RAILWAY_ENVIRONMENT: "staging" | "production" on Railway; undefined
  // locally. Helpful in /api/health to confirm you're looking at the right
  // env during ceremonies.
  return process.env.RAILWAY_ENVIRONMENT ?? process.env.NODE_ENV ?? "unknown";
}

export const versionInfo = Object.freeze({
  version: readPackageVersion(),
  commitSha: readCommitSha(),
  commitShaShort: readCommitSha().slice(0, 7),
  environment: readDeployEnvironment(),
  nodeVersion: process.version,
  startedAt: new Date().toISOString(),
} as const);

export type VersionInfo = typeof versionInfo;
