import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { AppError } from "./errors";

// Shared error middleware used by both the production server (server/index.ts)
// and the integration-test harness (server/__tests__/helpers/test-app.ts).
// Renders three cases:
//
//   1. AppError  → { error: { code, message, details? } } with the error's status.
//   2. ZodError  → 422 with VALIDATION_FAILED + the parsed issues.
//   3. Anything else → legacy { message } shape for pre-F-01 clients that still
//      read err.message; 500 default.
//
// See spec §2.2 for the structured error contract.
export const errorMiddleware: ErrorRequestHandler = (err, _req, res, next) => {
  if (res.headersSent) return next(err);

  if (err instanceof AppError) {
    if (err.status >= 500) console.error("[error]", err.code, err.message, err);
    return res.status(err.status).json({
      error: {
        code: err.code,
        message: err.message,
        ...(err.details ? { details: err.details } : {}),
      },
    });
  }

  if (err instanceof ZodError) {
    return res.status(422).json({
      error: {
        code: "VALIDATION_FAILED",
        message: err.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join("; "),
        details: { issues: err.errors },
      },
    });
  }

  const e = err as { status?: number; statusCode?: number; message?: string } | undefined;
  const status = e?.status ?? e?.statusCode ?? 500;
  const message = e?.message ?? "Internal Server Error";
  console.error("Internal Server Error:", err);
  return res.status(status).json({ message });
};
