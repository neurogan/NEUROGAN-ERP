import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import neuroganLogo from "@/assets/neurogan-logo.jpg";

export default function SetPassword() {
  const [, navigate] = useLocation();
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [violations, setViolations] = useState<string[]>([]);
  const [invalidToken, setInvalidToken] = useState(false);

  // Parse token + email from hash-based query params: /#/set-password?token=xxx&email=yyy
  const params = new URLSearchParams(window.location.hash.split("?")[1] ?? "");
  const token = params.get("token");
  const email = params.get("email");

  useEffect(() => {
    if (!token || !email) {
      navigate("/login");
    }
  }, [token, email, navigate]);

  // Don't render the form if params are missing (we'll redirect)
  if (!token || !email) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setViolations([]);

    if (newPassword !== confirmPassword) {
      setErrorMessage("Passwords do not match.");
      return;
    }

    setIsPending(true);
    try {
      const res = await fetch("/api/auth/accept-invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, email, password: newPassword }),
      });

      if (res.ok) {
        navigate("/login");
        return;
      }

      const body = (await res.json()) as {
        error?: { code?: string; message?: string; details?: { violations?: string[] } };
      };
      const code = body?.error?.code;

      if (code === "INVITE_INVALID") {
        setInvalidToken(true);
        return;
      }

      if (code === "VALIDATION_FAILED") {
        const v = body?.error?.details?.violations ?? [];
        if (v.length > 0) {
          setViolations(v);
        } else {
          setErrorMessage(body?.error?.message ?? "Password does not meet requirements.");
        }
        return;
      }

      setErrorMessage(body?.error?.message ?? "An unexpected error occurred. Please try again.");
    } catch {
      setErrorMessage("Network error — please check your connection and try again.");
    } finally {
      setIsPending(false);
    }
  };

  if (invalidToken) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="w-full max-w-sm space-y-6">
          <div className="flex flex-col items-center gap-3">
            <img src={neuroganLogo} alt="Neurogan" className="h-12 w-12 rounded-xl object-cover" />
            <div className="text-center">
              <h1 className="text-xl font-semibold tracking-tight text-foreground">Neurogan ERP</h1>
            </div>
          </div>

          <Card data-testid="set-password-invalid-token">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Invite link invalid</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Alert variant="destructive">
                <AlertDescription className="text-sm">
                  This invite link has expired or is invalid. Ask your admin to resend the invite.
                </AlertDescription>
              </Alert>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => navigate("/login")}
              >
                Go to sign in
              </Button>
            </CardContent>
          </Card>

          <p className="text-center text-[11px] text-muted-foreground">
            21 CFR Part 11 — electronic records system
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-3">
          <img src={neuroganLogo} alt="Neurogan" className="h-12 w-12 rounded-xl object-cover" />
          <div className="text-center">
            <h1 className="text-xl font-semibold tracking-tight text-foreground">Neurogan ERP</h1>
            <p className="text-sm text-muted-foreground">Set your password to activate your account</p>
          </div>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Set password</CardTitle>
            <CardDescription className="text-xs">
              Setting password for <span className="font-medium">{email}</span>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={(e) => { void handleSubmit(e); }} className="space-y-4">
              {errorMessage && (
                <Alert variant="destructive">
                  <AlertDescription className="text-sm">{errorMessage}</AlertDescription>
                </Alert>
              )}
              {violations.length > 0 && (
                <Alert variant="destructive">
                  <AlertDescription className="text-sm">
                    <ul className="list-disc pl-4 space-y-0.5">
                      {violations.map((v, i) => (
                        <li key={i}>{v}</li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="new-password">New password</Label>
                <Input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  disabled={isPending}
                  data-testid="input-new-password"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="confirm-password">Confirm password</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  disabled={isPending}
                  data-testid="input-confirm-password"
                />
              </div>
              <Button type="submit" className="w-full" disabled={isPending} data-testid="button-set-password">
                {isPending ? "Setting password…" : "Set password"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="text-center text-[11px] text-muted-foreground">
          21 CFR Part 11 — electronic records system
        </p>
      </div>
    </div>
  );
}
