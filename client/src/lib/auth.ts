import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  roles: string[];
  status: "ACTIVE" | "DISABLED";
  mustRotatePassword: boolean;
}

interface MeResponse {
  user: AuthUser;
  roles: string[];
  mustRotatePassword: boolean;
}

async function fetchMe(): Promise<MeResponse | null> {
  const res = await fetch("/api/auth/me", { credentials: "include" });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`/api/auth/me returned ${res.status}`);
  return res.json() as Promise<MeResponse>;
}

export function useAuth() {
  const { data, isLoading } = useQuery({
    queryKey: ["auth", "me"],
    queryFn: fetchMe,
    retry: false,
    staleTime: 60_000,
  });

  return {
    user: data?.user ?? null,
    mustRotatePassword: data?.mustRotatePassword ?? false,
    isLoading,
    isAuthenticated: data?.user !== null && data?.user !== undefined,
  };
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (credentials: { email: string; password: string }) => {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(credentials),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: { code?: string; message?: string } };
        const code = body?.error?.code ?? "UNKNOWN";
        const message = body?.error?.message ?? "Login failed";
        const err = new Error(message) as Error & { code: string; status: number };
        err.code = code;
        err.status = res.status;
        throw err;
      }
      return res.json() as Promise<{ user: AuthUser & { mustRotatePassword: boolean } }>;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["auth", "me"] });
    },
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    },
    onSuccess: () => {
      qc.clear();
    },
  });
}

export function useRotatePassword() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { currentPassword: string; newPassword: string }) => {
      const res = await fetch("/api/auth/rotate-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: { message?: string; details?: unknown } };
        throw new Error(data?.error?.message ?? "Failed to rotate password");
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["auth", "me"] });
    },
  });
}
