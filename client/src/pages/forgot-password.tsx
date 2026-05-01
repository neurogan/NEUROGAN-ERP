import { useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import neuroganLogo from "@/assets/neurogan-logo.jpg";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [networkError, setNetworkError] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setNetworkError(false);
    setIsPending(true);
    try {
      await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      setSubmitted(true);
    } catch {
      setNetworkError(true);
    } finally {
      setIsPending(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-3">
          <img src={neuroganLogo} alt="Neurogan" className="h-12 w-12 rounded-xl object-cover" />
          <div className="text-center">
            <h1 className="text-xl font-semibold tracking-tight text-foreground">Neurogan ERP</h1>
            <p className="text-sm text-muted-foreground">Reset your password</p>
          </div>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Forgot password</CardTitle>
            <CardDescription className="text-xs">
              {submitted
                ? "Check your inbox."
                : "Enter your email and we'll send a reset link."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {submitted ? (
              <>
                <Alert>
                  <AlertDescription className="text-sm">
                    If that email is registered, a reset link has been sent. Check your inbox.
                  </AlertDescription>
                </Alert>
                <Link href="/login">
                  <Button variant="outline" className="w-full">Back to sign in</Button>
                </Link>
              </>
            ) : (
              <form onSubmit={(e) => { void handleSubmit(e); }} className="space-y-4">
                {networkError && (
                  <Alert variant="destructive">
                    <AlertDescription className="text-sm">
                      Something went wrong — please try again.
                    </AlertDescription>
                  </Alert>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    disabled={isPending}
                    data-testid="input-email"
                  />
                </div>
                <Button type="submit" className="w-full" disabled={isPending} data-testid="button-send-reset-link">
                  {isPending ? "Sending…" : "Send reset link"}
                </Button>
                <div className="text-center">
                  <Link href="/login" className="text-xs text-muted-foreground hover:underline">
                    Back to sign in
                  </Link>
                </div>
              </form>
            )}
          </CardContent>
        </Card>

        <p className="text-center text-[11px] text-muted-foreground">
          21 CFR Part 11 — electronic records system
        </p>
      </div>
    </div>
  );
}
