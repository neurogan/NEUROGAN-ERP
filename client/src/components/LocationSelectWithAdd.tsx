import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Plus, Check, X } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Location } from "@shared/schema";

interface LocationSelectWithAddProps {
  locations: Location[];
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  "data-testid"?: string;
}

export function LocationSelectWithAdd({
  locations,
  value,
  onValueChange,
  placeholder = "Select location...",
  "data-testid": testId,
}: LocationSelectWithAddProps) {
  const [isAdding, setIsAdding] = useState(false);
  const [newLocationName, setNewLocationName] = useState("");
  const { toast } = useToast();

  const createMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await apiRequest("POST", "/api/locations", { name });
      return res.json();
    },
    onSuccess: (location: Location) => {
      queryClient.invalidateQueries({ queryKey: ["/api/locations"] });
      toast({ title: "Location created" });
      onValueChange(location.id);
      setNewLocationName("");
      setIsAdding(false);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  if (isAdding) {
    return (
      <div className="flex items-center gap-1.5">
        <Input
          value={newLocationName}
          onChange={(e) => setNewLocationName(e.target.value)}
          placeholder="New location name"
          className="h-9 text-sm"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter" && newLocationName.trim()) {
              e.preventDefault();
              createMutation.mutate(newLocationName.trim());
            }
            if (e.key === "Escape") {
              setIsAdding(false);
              setNewLocationName("");
            }
          }}
          data-testid={testId ? `${testId}-new-input` : undefined}
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-9 w-9 p-0 shrink-0"
          disabled={!newLocationName.trim() || createMutation.isPending}
          onClick={() => createMutation.mutate(newLocationName.trim())}
          data-testid={testId ? `${testId}-confirm-add` : undefined}
        >
          <Check className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-9 w-9 p-0 shrink-0"
          onClick={() => { setIsAdding(false); setNewLocationName(""); }}
          data-testid={testId ? `${testId}-cancel-add` : undefined}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <Select onValueChange={onValueChange} value={value}>
        <SelectTrigger className="h-9 text-sm" data-testid={testId}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {locations.map((loc) => (
            <SelectItem key={loc.id} value={loc.id}>{loc.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-9 px-2 text-xs shrink-0"
        onClick={() => setIsAdding(true)}
        data-testid={testId ? `${testId}-add-btn` : undefined}
      >
        <Plus className="h-3 w-3 mr-0.5" />
        New
      </Button>
    </div>
  );
}
