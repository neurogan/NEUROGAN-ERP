import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { UserCircle2, ChevronDown } from "lucide-react";

interface QmsUser {
  id: string;
  name: string;
  email: string;
  role: string;
}

const STORAGE_KEY = "qms_active_user_id";

export function useQmsUser() {
  const [activeUserId, setActiveUserId] = useState<string | null>(() =>
    localStorage.getItem(STORAGE_KEY)
  );

  const { data: users = [] } = useQuery<QmsUser[]>({
    queryKey: ["/api/auth/users"],
    staleTime: 5 * 60 * 1000,
  });

  const activeUser = users.find(u => u.id === activeUserId) ?? null;

  const setActiveUser = (id: string) => {
    localStorage.setItem(STORAGE_KEY, id);
    setActiveUserId(id);
  };

  return { users, activeUser, activeUserId, setActiveUser };
}

export function QmsUserSelector() {
  const { users, activeUser, setActiveUser } = useQmsUser();
  const [open, setOpen] = useState(false);

  // Auto-select first user on mount if none selected
  useEffect(() => {
    if (!activeUser && users.length > 0) {
      setActiveUser(users[0].id);
    }
  }, [users, activeUser]);

  if (users.length === 0) return null;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs transition-colors hover:bg-muted text-muted-foreground hover:text-foreground border border-border"
        data-testid="qms-user-selector"
      >
        <UserCircle2 className="h-3.5 w-3.5" />
        <span className="max-w-[120px] truncate">{activeUser?.name ?? "Select user"}</span>
        <ChevronDown className="h-3 w-3" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-50 w-56 rounded-lg border border-border bg-card shadow-lg py-1">
            <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              QMS Active User
            </div>
            {users.map(u => (
              <button
                key={u.id}
                onClick={() => { setActiveUser(u.id); setOpen(false); }}
                className={`w-full flex items-start gap-2 px-3 py-2 text-left hover:bg-muted transition-colors ${
                  activeUser?.id === u.id ? "bg-muted/60" : ""
                }`}
              >
                <UserCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
                <div>
                  <div className="text-xs font-medium text-foreground">{u.name}</div>
                  <div className="text-[10px] text-muted-foreground">{u.role.replace(/_/g, " ")}</div>
                </div>
              </button>
            ))}
            <div className="mx-3 mt-1.5 mb-1 border-t border-border pt-1.5 text-[10px] text-amber-600 dark:text-amber-400">
              ⚠ Demo only — not Part 11 compliant
            </div>
          </div>
        </>
      )}
    </div>
  );
}
