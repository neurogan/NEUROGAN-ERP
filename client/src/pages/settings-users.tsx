import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Plus, Copy, ShieldAlert, UserX, UserCheck, KeyRound } from "lucide-react";

// F-01 settings/users admin page. Reads from GET /api/users and exercises
// POST /api/users, PATCH /api/users/:id/status, PATCH /api/users/:id/roles.
// Authentication is F-02's responsibility — until that ships, any fetch here
// returns 401. The page shows a friendly "Sign-in required" shell in that
// case rather than a raw error.

// All six spec roles. Checkbox layout is simpler than a multi-select while
// the role set is small; revisit if the set grows.
const ALL_ROLES = ["ADMIN", "QA", "PRODUCTION", "WAREHOUSE", "LAB_TECH", "VIEWER"] as const;
type Role = (typeof ALL_ROLES)[number];

interface UserRow {
  id: string;
  email: string;
  fullName: string;
  title: string | null;
  status: "ACTIVE" | "DISABLED";
  roles: Role[];
  // Admin-only fields — present when the viewer is ADMIN, absent otherwise.
  passwordChangedAt?: string | null;
  lockedUntil?: string | null;
  failedLoginCount?: number | null;
  createdAt: string;
}

const createUserSchema = z.object({
  email: z.string().email().trim().toLowerCase(),
  fullName: z.string().min(1, "Full name is required").trim(),
  title: z.string().trim().optional(),
  roles: z.array(z.enum(ALL_ROLES)).min(1, "Select at least one role"),
});

type CreateUserForm = z.infer<typeof createUserSchema>;

function RoleBadges({ roles }: { roles: Role[] }) {
  if (roles.length === 0) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {roles.map((r) => (
        <Badge key={r} variant={r === "ADMIN" ? "default" : "secondary"} className="text-xs">
          {r}
        </Badge>
      ))}
    </div>
  );
}

function StatusBadge({ status }: { status: "ACTIVE" | "DISABLED" }) {
  return (
    <Badge
      variant={status === "ACTIVE" ? "default" : "outline"}
      className={`text-xs ${
        status === "DISABLED" ? "border-destructive text-destructive" : ""
      }`}
    >
      {status}
    </Badge>
  );
}

export default function SettingsUsers() {
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [tempPassword, setTempPassword] = useState<{ user: UserRow; password: string } | null>(
    null,
  );
  const [editingUser, setEditingUser] = useState<UserRow | null>(null);
  const [confirmDisable, setConfirmDisable] = useState<UserRow | null>(null);

  const {
    data: users,
    isLoading,
    isError,
    error,
  } = useQuery<UserRow[]>({
    queryKey: ["/api/users"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/users");
      return res.json();
    },
  });

  // ─── Create ───
  const createForm = useForm<CreateUserForm>({
    resolver: zodResolver(createUserSchema),
    defaultValues: { email: "", fullName: "", title: "", roles: [] },
  });
  const createMutation = useMutation({
    mutationFn: async (data: CreateUserForm) => {
      const res = await apiRequest("POST", "/api/users", data);
      return res.json() as Promise<{ user: UserRow; temporaryPassword: string }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      setTempPassword({ user: data.user, password: data.temporaryPassword });
      setCreateOpen(false);
      createForm.reset();
    },
    onError: (err: Error) => {
      toast({ title: "Could not create user", description: err.message, variant: "destructive" });
    },
  });

  // ─── Toggle status ───
  const toggleStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "ACTIVE" | "DISABLED" }) => {
      const res = await apiRequest("PATCH", `/api/users/${id}/status`, { status });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      setConfirmDisable(null);
    },
    onError: (err: Error) => {
      toast({ title: "Could not update status", description: err.message, variant: "destructive" });
    },
  });

  // ─── Edit roles ───
  const editRolesMutation = useMutation({
    mutationFn: async ({
      id,
      add,
      remove,
    }: {
      id: string;
      add: Role[];
      remove: Role[];
    }) => {
      const res = await apiRequest("PATCH", `/api/users/${id}/roles`, { add, remove });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      setEditingUser(null);
    },
    onError: (err: Error) => {
      toast({ title: "Could not update roles", description: err.message, variant: "destructive" });
    },
  });

  const copyTempPassword = async () => {
    if (!tempPassword) return;
    await navigator.clipboard.writeText(tempPassword.password);
    toast({ title: "Copied", description: "Temporary password copied to clipboard." });
  };

  // ─── Render ───

  if (isError) {
    const msg = (error as Error | undefined)?.message ?? "";
    // F-02 will land real auth; until then /api/users returns 401 for
    // unauthenticated requests. Show a friendly placeholder instead of a
    // raw error.
    const isAuthError = msg.includes("401") || msg.toLowerCase().includes("unauth");
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <div className="flex items-center gap-2 mb-4">
          <ShieldAlert className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-xl font-semibold">User management</h1>
        </div>
        <div className="rounded-md border border-border p-6 bg-muted/40">
          {isAuthError ? (
            <>
              <p className="text-sm font-medium">Sign-in required</p>
              <p className="text-xs text-muted-foreground mt-1">
                This page requires authentication. The login flow ships with ticket F-02.
              </p>
            </>
          ) : (
            <>
              <p className="text-sm font-medium">Could not load users</p>
              <p className="text-xs text-muted-foreground mt-1">{msg}</p>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-semibold">User management</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Administer users and their roles. ADMIN only. 21 CFR Part 11 §11.10(d)/(g).
          </p>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)} data-testid="button-create-user">
          <Plus className="h-3.5 w-3.5 mr-1.5" /> Create user
        </Button>
      </div>

      <div className="rounded-md border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Title</TableHead>
              <TableHead>Roles</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 6 }).map((_, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : users && users.length > 0 ? (
              users.map((u) => (
                <TableRow key={u.id} data-testid={`row-user-${u.id}`}>
                  <TableCell className="font-medium">{u.fullName}</TableCell>
                  <TableCell className="text-sm">{u.email}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{u.title ?? "—"}</TableCell>
                  <TableCell>
                    <RoleBadges roles={u.roles} />
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={u.status} />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setEditingUser(u)}
                        data-testid={`button-edit-roles-${u.id}`}
                      >
                        <KeyRound className="h-3.5 w-3.5 mr-1" /> Roles
                      </Button>
                      {u.status === "ACTIVE" ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setConfirmDisable(u)}
                          data-testid={`button-disable-${u.id}`}
                        >
                          <UserX className="h-3.5 w-3.5 mr-1" /> Disable
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            toggleStatusMutation.mutate({ id: u.id, status: "ACTIVE" })
                          }
                          data-testid={`button-enable-${u.id}`}
                        >
                          <UserCheck className="h-3.5 w-3.5 mr-1" /> Enable
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-8">
                  No users yet. Click "Create user" to add the first one.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Create user</DialogTitle>
            <DialogDescription className="text-xs">
              A one-time temporary password is generated and shown once. The user must rotate it on
              first login (F-02).
            </DialogDescription>
          </DialogHeader>

          <Form {...createForm}>
            <form
              onSubmit={createForm.handleSubmit((v) => createMutation.mutate(v))}
              className="space-y-3"
            >
              <FormField
                control={createForm.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input placeholder="user@neurogan.com" {...field} data-testid="input-email" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={createForm.control}
                name="fullName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Full name</FormLabel>
                    <FormControl>
                      <Input placeholder="Jane Doe" {...field} data-testid="input-fullname" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={createForm.control}
                name="title"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Title (optional)</FormLabel>
                    <FormControl>
                      <Input placeholder="QC / PCQI" {...field} data-testid="input-title" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={createForm.control}
                name="roles"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Roles</FormLabel>
                    <div className="grid grid-cols-2 gap-2 pt-1">
                      {ALL_ROLES.map((r) => {
                        const checked = field.value.includes(r);
                        return (
                          <label
                            key={r}
                            className="flex items-center gap-2 text-sm cursor-pointer"
                          >
                            <Checkbox
                              checked={checked}
                              onCheckedChange={(c) => {
                                if (c) field.onChange([...field.value, r]);
                                else field.onChange(field.value.filter((x) => x !== r));
                              }}
                              data-testid={`checkbox-role-${r}`}
                            />
                            <span>{r}</span>
                          </label>
                        );
                      })}
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setCreateOpen(false)}
                  disabled={createMutation.isPending}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={createMutation.isPending}
                  data-testid="button-submit-create"
                >
                  {createMutation.isPending ? "Creating..." : "Create user"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* One-time temp-password display */}
      <Dialog
        open={tempPassword !== null}
        onOpenChange={(o) => {
          if (!o) setTempPassword(null);
        }}
      >
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>User created</DialogTitle>
            <DialogDescription className="text-xs">
              Copy the temporary password now — it will not be shown again. The user will be
              required to rotate it on first login.
            </DialogDescription>
          </DialogHeader>

          {tempPassword && (
            <div className="space-y-3">
              <div>
                <Label className="text-xs">Email</Label>
                <div className="text-sm font-medium">{tempPassword.user.email}</div>
              </div>
              <div>
                <Label className="text-xs">Temporary password</Label>
                <div className="flex items-center gap-2 mt-1">
                  <code className="flex-1 rounded-md border border-border bg-muted px-3 py-2 text-sm font-mono break-all">
                    {tempPassword.password}
                  </code>
                  <Button size="sm" variant="outline" onClick={copyTempPassword}>
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button onClick={() => setTempPassword(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit roles dialog */}
      <Dialog
        open={editingUser !== null}
        onOpenChange={(o) => {
          if (!o) setEditingUser(null);
        }}
      >
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Edit roles</DialogTitle>
            <DialogDescription className="text-xs">
              {editingUser ? `${editingUser.fullName} (${editingUser.email})` : ""}
            </DialogDescription>
          </DialogHeader>

          {editingUser && (
            <EditRolesDialog
              user={editingUser}
              onSubmit={(add, remove) =>
                editRolesMutation.mutate({ id: editingUser.id, add, remove })
              }
              onCancel={() => setEditingUser(null)}
              pending={editRolesMutation.isPending}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Confirm disable */}
      <AlertDialog
        open={confirmDisable !== null}
        onOpenChange={(o) => {
          if (!o) setConfirmDisable(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disable user?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDisable && (
                <>
                  <span className="font-medium">{confirmDisable.fullName}</span> will be unable to
                  sign in. The account is kept for audit-trail retention (21 CFR §111.180). You can
                  re-enable later.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                confirmDisable &&
                toggleStatusMutation.mutate({ id: confirmDisable.id, status: "DISABLED" })
              }
              disabled={toggleStatusMutation.isPending}
            >
              Disable
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function EditRolesDialog({
  user,
  onSubmit,
  onCancel,
  pending,
}: {
  user: UserRow;
  onSubmit: (add: Role[], remove: Role[]) => void;
  onCancel: () => void;
  pending: boolean;
}) {
  const [selected, setSelected] = useState<Role[]>(user.roles);

  const toggle = (role: Role, checked: boolean) => {
    setSelected((prev) =>
      checked ? [...new Set([...prev, role])] : prev.filter((r) => r !== role),
    );
  };

  const apply = () => {
    const currentSet = new Set(user.roles);
    const nextSet = new Set(selected);
    const add = [...nextSet].filter((r) => !currentSet.has(r));
    const remove = [...currentSet].filter((r) => !nextSet.has(r));
    onSubmit(add, remove);
  };

  const dirty =
    selected.length !== user.roles.length ||
    selected.some((r) => !user.roles.includes(r)) ||
    user.roles.some((r) => !selected.includes(r));

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        {ALL_ROLES.map((r) => (
          <label key={r} className="flex items-center gap-2 text-sm cursor-pointer">
            <Checkbox
              checked={selected.includes(r)}
              onCheckedChange={(c) => toggle(r, !!c)}
              data-testid={`checkbox-edit-role-${r}`}
            />
            <span>{r}</span>
          </label>
        ))}
      </div>
      <DialogFooter>
        <Button variant="outline" type="button" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button onClick={apply} disabled={!dirty || pending} data-testid="button-save-roles">
          {pending ? "Saving..." : "Save roles"}
        </Button>
      </DialogFooter>
    </div>
  );
}
