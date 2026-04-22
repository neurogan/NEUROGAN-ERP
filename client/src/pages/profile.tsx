import { useState } from "react";
import { useLocation } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { KeyRound, LogOut, CheckCircle } from "lucide-react";
import { useAuth, useRotatePassword, useLogout } from "@/lib/auth";
import { useQuery } from "@tanstack/react-query";

interface ProfileData {
  id: string;
  email: string;
  fullName: string;
  title: string | null;
  roles: string[];
  status: "ACTIVE" | "DISABLED";
  passwordChangedAt?: string | null;
}

export default function Profile() {
  const [location, navigate] = useLocation();
  const { user, mustRotatePassword } = useAuth();
  const showRotateForm = location === "/profile/rotate-password" || mustRotatePassword;

  const { data: fullProfile } = useQuery<{ user: ProfileData }>({
    queryKey: ["/api/auth/me"],
    queryFn: async () => {
      const res = await fetch("/api/auth/me", { credentials: "include" });
      if (!res.ok) throw new Error("Not authenticated");
      return res.json() as Promise<{ user: ProfileData }>;
    },
    enabled: !!user,
  });

  const profile = fullProfile?.user;

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <h1 className="text-xl font-semibold">Your profile</h1>

      {/* User info */}
      {profile && (
        <div className="space-y-4 rounded-md border border-border bg-card p-4">
          <ProfileField label="Full name" value={profile.fullName} />
          <ProfileField label="Email" value={profile.email} />
          <ProfileField label="Title" value={profile.title ?? "—"} />
          <ProfileField
            label="Roles"
            value={
              <div className="flex flex-wrap gap-1">
                {profile.roles.length === 0 ? (
                  <span className="text-xs text-muted-foreground">—</span>
                ) : (
                  profile.roles.map((r) => (
                    <Badge key={r} variant={r === "ADMIN" ? "default" : "secondary"}>
                      {r}
                    </Badge>
                  ))
                )}
              </div>
            }
          />
          {profile.passwordChangedAt && (
            <ProfileField
              label="Password last changed"
              value={new Date(profile.passwordChangedAt).toLocaleString("en-US", { timeZone: "America/Los_Angeles" })}
            />
          )}
        </div>
      )}

      {/* Password rotation */}
      {showRotateForm ? (
        <RotatePasswordForm
          mustRotate={mustRotatePassword}
          onSuccess={() => navigate("/profile")}
        />
      ) : (
        <div className="flex items-center justify-between rounded-md border border-border p-4 bg-card">
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">Password</p>
              <p className="text-xs text-muted-foreground">Rotate every 90 days per Part 11 policy</p>
            </div>
          </div>
          <Button size="sm" variant="outline" onClick={() => navigate("/profile/rotate-password")}>
            Rotate password
          </Button>
        </div>
      )}

      {/* Logout */}
      {!showRotateForm && <LogoutSection />}
    </div>
  );
}

function RotatePasswordForm({ mustRotate, onSuccess }: { mustRotate: boolean; onSuccess: () => void }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const rotatePassword = useRotatePassword();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirmPassword) {
      setError("New passwords do not match.");
      return;
    }
    try {
      await rotatePassword.mutateAsync({ currentPassword, newPassword });
      setSuccess(true);
      setTimeout(onSuccess, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to rotate password.");
    }
  };

  return (
    <div className="rounded-md border border-border bg-card p-4">
      <div className="flex items-center gap-2 mb-4">
        <KeyRound className="h-4 w-4 text-muted-foreground" />
        <div>
          <p className="text-sm font-semibold">
            {mustRotate ? "Password rotation required" : "Rotate password"}
          </p>
          {mustRotate && (
            <p className="text-xs text-amber-600 mt-0.5">
              Your password has expired. Please set a new password to continue.
            </p>
          )}
        </div>
      </div>

      {success ? (
        <div className="flex items-center gap-2 text-sm text-green-600">
          <CheckCircle className="h-4 w-4" />
          Password updated successfully.
        </div>
      ) : (
        <form onSubmit={(e) => { void handleSubmit(e); }} className="space-y-3">
          {error && (
            <Alert variant="destructive">
              <AlertDescription className="text-sm">{error}</AlertDescription>
            </Alert>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="currentPw">Current password</Label>
            <Input
              id="currentPw"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
              autoComplete="current-password"
              disabled={rotatePassword.isPending}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="newPw">New password</Label>
            <Input
              id="newPw"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              autoComplete="new-password"
              disabled={rotatePassword.isPending}
            />
            <p className="text-xs text-muted-foreground">
              8+ chars, uppercase, lowercase, digit, symbol
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirmPw">Confirm new password</Label>
            <Input
              id="confirmPw"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              autoComplete="new-password"
              disabled={rotatePassword.isPending}
            />
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={rotatePassword.isPending}>
              {rotatePassword.isPending ? "Updating…" : "Update password"}
            </Button>
            {!mustRotate && (
              <Button
                type="button"
                variant="outline"
                onClick={onSuccess}
                disabled={rotatePassword.isPending}
              >
                Cancel
              </Button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}

function LogoutSection() {
  const logout = useLogout();
  const [, navigate] = useLocation();

  const handleLogout = async () => {
    await logout.mutateAsync();
    navigate("/login");
  };

  return (
    <div className="flex items-center justify-between rounded-md border border-border p-4 bg-card">
      <div className="flex items-center gap-2">
        <LogOut className="h-4 w-4 text-muted-foreground" />
        <div>
          <p className="text-sm font-medium">Sign out</p>
          <p className="text-xs text-muted-foreground">End your current session</p>
        </div>
      </div>
      <Button size="sm" variant="outline" onClick={() => { void handleLogout(); }} disabled={logout.isPending}>
        {logout.isPending ? "Signing out…" : "Sign out"}
      </Button>
    </div>
  );
}

function ProfileField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_1fr] items-start gap-3">
      <div className="text-xs text-muted-foreground pt-0.5">{label}</div>
      <div className="text-sm">{value}</div>
    </div>
  );
}
