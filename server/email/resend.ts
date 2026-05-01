import { Resend } from "resend";

// Send the first-login invite email. Reads env vars at call time so that:
//   - Tests can mock this module without needing the env vars
//   - Missing vars surface as clear errors rather than silent undefined
//
// URL format: ${APP_URL}/#/set-password?token=<raw>&email=<encoded>
// The hash fragment is required by the app's wouter hash-based router.
export async function sendInviteEmail(to: string, rawToken: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const fromAddress = process.env.RESEND_FROM_ADDRESS ?? "noreply@neurogan.com";
  const appUrl = (process.env.APP_URL ?? "http://localhost:5000").replace(/\/$/, "");

  if (!apiKey) {
    throw new Error("RESEND_API_KEY environment variable is not set");
  }

  const inviteUrl = `${appUrl}/#/set-password?token=${rawToken}&email=${encodeURIComponent(to)}`;
  const resend = new Resend(apiKey);

  await resend.emails.send({
    from: fromAddress,
    to,
    subject: "You've been invited to Neurogan ERP",
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <p>You have been invited to access <strong>Neurogan ERP</strong>.</p>
        <p style="margin:24px 0">
          <a href="${inviteUrl}"
             style="background:#000;color:#fff;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;font-size:14px;">
            Set your password
          </a>
        </p>
        <p style="color:#666;font-size:12px;">This link expires in 7 days. If you did not expect this invitation, you can ignore this email.</p>
      </div>
    `,
    text: `You have been invited to Neurogan ERP.\n\nSet your password here:\n${inviteUrl}\n\nThis link expires in 7 days.`,
  });
}
