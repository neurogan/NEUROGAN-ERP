import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface Lab {
  id: string;
  name: string;
  address: string | null;
  type: "IN_HOUSE" | "THIRD_PARTY";
  isActive: boolean;
  createdAt: string;
}

export function LabsSettings() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: labs = [], isLoading, isError } = useQuery<Lab[]>({ queryKey: ["/api/labs"] });

  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [type, setType] = useState<"IN_HOUSE" | "THIRD_PARTY">("THIRD_PARTY");
  const [patchingId, setPatchingId] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: (data: { name: string; address: string | null; type: string }) =>
      apiRequest("POST", "/api/labs", data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/labs"] });
      setName("");
      setAddress("");
      setType("THIRD_PARTY");
      toast({ title: "Lab added" });
    },
    onError: (err: Error) => toast({ title: "Failed to add lab", description: err.message, variant: "destructive" }),
  });

  const patchMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Omit<Partial<Lab>, "id" | "createdAt"> }) => {
      setPatchingId(id);
      return apiRequest("PATCH", `/api/labs/${id}`, data);
    },
    onSettled: () => setPatchingId(null),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/labs"] });
      toast({ title: "Lab updated" });
    },
    onError: (err: Error) => toast({ title: "Failed to update lab", description: err.message, variant: "destructive" }),
  });

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (isError) return (
    <div className="p-6 text-sm text-destructive">Could not load labs. Refresh to try again.</div>
  );

  return (
    <div className="p-6 max-w-2xl space-y-6">
      <div>
        <h2 className="text-base font-semibold mb-1">Testing Labs</h2>
        <p className="text-sm text-muted-foreground">Approved labs for COA testing. COA documents must reference a lab from this list.</p>
      </div>

      <div className="border rounded-lg overflow-hidden">
        {labs.map((lab) => (
          <div key={lab.id} className="flex items-center justify-between px-4 py-3 border-b last:border-b-0">
            <div>
              <div className="text-sm font-medium flex items-center gap-2">
                {lab.name}
                <Badge variant={lab.type === "IN_HOUSE" ? "default" : "secondary"} className="text-[10px]">
                  {lab.type === "IN_HOUSE" ? "In-House" : "Third Party"}
                </Badge>
                {!lab.isActive && <Badge variant="outline" className="text-[10px] text-muted-foreground">Inactive</Badge>}
              </div>
              {lab.address && <div className="text-xs text-muted-foreground mt-0.5">{lab.address}</div>}
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="text-xs"
              onClick={() => patchMutation.mutate({ id: lab.id, data: { isActive: !lab.isActive } })}
              disabled={patchingId === lab.id}
            >
              {lab.isActive ? "Deactivate" : "Reactivate"}
            </Button>
          </div>
        ))}
        {labs.length === 0 && (
          <div className="p-4 text-sm text-muted-foreground text-center">No labs configured.</div>
        )}
      </div>

      <div className="border rounded-lg p-4 space-y-3">
        <h3 className="text-sm font-medium">Add lab</h3>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Label htmlFor="lab-name" className="text-xs">Name</Label>
            <Input id="lab-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Lab name" className="mt-1 h-8 text-sm" />
          </div>
          <div className="col-span-2">
            <Label htmlFor="lab-address" className="text-xs">Address</Label>
            <Input id="lab-address" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Address" className="mt-1 h-8 text-sm" />
          </div>
          <div>
            <Label className="text-xs">Type</Label>
            <Select value={type} onValueChange={(v) => setType(v as "IN_HOUSE" | "THIRD_PARTY")}>
              <SelectTrigger className="mt-1 h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="IN_HOUSE">In-House</SelectItem>
                <SelectItem value="THIRD_PARTY">Third Party</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <Button
          size="sm"
          onClick={() => createMutation.mutate({ name: name.trim(), address: address.trim() || null, type })}
          disabled={!name.trim() || createMutation.isPending}
        >
          Add lab
        </Button>
      </div>
    </div>
  );
}
