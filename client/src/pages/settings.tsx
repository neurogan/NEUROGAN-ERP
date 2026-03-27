import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Switch as SwitchUI } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useState, useEffect } from "react";
import { Save, Building2, AlertTriangle, Hash, Tag, Plus, Pencil, Trash2 } from "lucide-react";
import type { Location } from "@shared/schema";

// ─── Types ──────────────────────────────────────────────────

interface AppSettings {
  id: string;
  companyName: string;
  defaultUom: string;
  lowStockThreshold: string;
  dateFormat: string;
  autoGenerateBatchNumbers: string;
  batchNumberPrefix: string;
  autoGenerateLotNumbers: string;
  lotNumberPrefix: string;
  skuPrefixRawMaterial: string;
  skuPrefixFinishedGood: string;
  updatedAt: string;
}

// ─── Settings Sub-Tab ───────────────────────────────────────

function SettingsContent() {
  const { toast } = useToast();
  const { data: settings, isLoading } = useQuery<AppSettings>({
    queryKey: ["/api/settings"],
  });

  const [form, setForm] = useState<Partial<AppSettings>>({});
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    if (settings) {
      setForm({
        companyName: settings.companyName,
        defaultUom: settings.defaultUom,
        lowStockThreshold: settings.lowStockThreshold,
        dateFormat: settings.dateFormat,
        autoGenerateBatchNumbers: settings.autoGenerateBatchNumbers,
        batchNumberPrefix: settings.batchNumberPrefix,
        autoGenerateLotNumbers: settings.autoGenerateLotNumbers,
        lotNumberPrefix: settings.lotNumberPrefix,
        skuPrefixRawMaterial: settings.skuPrefixRawMaterial,
        skuPrefixFinishedGood: settings.skuPrefixFinishedGood,
      });
      setHasChanges(false);
    }
  }, [settings]);

  const updateField = (field: string, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }));
    setHasChanges(true);
  };

  const saveMutation = useMutation({
    mutationFn: async (data: Partial<AppSettings>) => {
      const res = await apiRequest("PATCH", "/api/settings", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      setHasChanges(false);
      toast({
        title: "Settings saved",
        description: "Your changes have been applied.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to save settings.",
        variant: "destructive",
      });
    },
  });

  const handleSave = () => {
    saveMutation.mutate(form);
  };

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {[1, 2, 3].map(i => (
            <Card key={i}>
              <CardHeader><Skeleton className="h-5 w-40" /></CardHeader>
              <CardContent><Skeleton className="h-24 w-full" /></CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-end">
        <Button
          onClick={handleSave}
          disabled={!hasChanges || saveMutation.isPending}
          size="sm"
          data-testid="button-save-settings"
        >
          <Save className="h-4 w-4 mr-1.5" />
          {saveMutation.isPending ? "Saving..." : "Save Changes"}
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* General */}
        <Card data-testid="card-settings-general">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Building2 className="h-4 w-4 text-muted-foreground" />
              General
            </CardTitle>
            <CardDescription className="text-xs">Company-wide defaults</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="companyName" className="text-xs font-medium">Company Name</Label>
              <Input
                id="companyName"
                value={form.companyName ?? ""}
                onChange={e => updateField("companyName", e.target.value)}
                className="h-9"
                data-testid="input-company-name"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dateFormat" className="text-xs font-medium">Date Format</Label>
              <Select value={form.dateFormat ?? "MM/DD/YYYY"} onValueChange={v => updateField("dateFormat", v)}>
                <SelectTrigger className="h-9" data-testid="select-date-format">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="MM/DD/YYYY">MM/DD/YYYY</SelectItem>
                  <SelectItem value="DD/MM/YYYY">DD/MM/YYYY</SelectItem>
                  <SelectItem value="YYYY-MM-DD">YYYY-MM-DD</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="defaultUom" className="text-xs font-medium">Default Unit of Measure</Label>
              <Select value={form.defaultUom ?? "g"} onValueChange={v => updateField("defaultUom", v)}>
                <SelectTrigger className="h-9" data-testid="select-default-uom">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="g">Grams (g)</SelectItem>
                  <SelectItem value="mg">Milligrams (mg)</SelectItem>
                  <SelectItem value="L">Liters (L)</SelectItem>
                  <SelectItem value="mL">Milliliters (mL)</SelectItem>
                  <SelectItem value="gal">Gallons (gal)</SelectItem>
                  <SelectItem value="lb">Pounds (lb)</SelectItem>
                  <SelectItem value="oz">Ounces (oz)</SelectItem>
                  <SelectItem value="pcs">Pieces (pcs)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Alerts & Thresholds */}
        <Card data-testid="card-settings-alerts">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              Alerts &amp; Thresholds
            </CardTitle>
            <CardDescription className="text-xs">Configure when stock alerts trigger</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="lowStockThreshold" className="text-xs font-medium">Low Stock Threshold (universal)</Label>
              <p className="text-[11px] text-muted-foreground">
                Items with stock below this number will appear as low stock alerts on the dashboard. Applies to all materials and products regardless of unit.
              </p>
              <Input
                id="lowStockThreshold"
                type="number"
                min="0"
                step="0.1"
                value={form.lowStockThreshold ?? "1"}
                onChange={e => updateField("lowStockThreshold", e.target.value)}
                className="h-9 w-32"
                data-testid="input-low-stock-threshold"
              />
            </div>
            <Separator />
            <p className="text-[11px] text-muted-foreground italic">
              Per-material and per-category thresholds coming soon. This will enable dynamic reorder points for purchasing planning.
            </p>
          </CardContent>
        </Card>

        {/* Numbering */}
        <Card data-testid="card-settings-numbering">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Hash className="h-4 w-4 text-muted-foreground" />
              Auto-Numbering
            </CardTitle>
            <CardDescription className="text-xs">Batch and lot number generation</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Auto-generate Batch Numbers</p>
                <p className="text-[11px] text-muted-foreground">Sequential batch numbers (e.g. BATCH-001)</p>
              </div>
              <SwitchUI
                checked={form.autoGenerateBatchNumbers === "true"}
                onCheckedChange={v => updateField("autoGenerateBatchNumbers", v ? "true" : "false")}
                data-testid="switch-auto-batch"
              />
            </div>
            {form.autoGenerateBatchNumbers === "true" && (
              <div className="space-y-1.5 pl-1">
                <Label htmlFor="batchNumberPrefix" className="text-xs font-medium">Batch Number Prefix</Label>
                <Input
                  id="batchNumberPrefix"
                  value={form.batchNumberPrefix ?? "BATCH"}
                  onChange={e => updateField("batchNumberPrefix", e.target.value.toUpperCase())}
                  className="h-9 w-40 font-mono"
                  data-testid="input-batch-prefix"
                />
                <p className="text-[10px] text-muted-foreground">Preview: {form.batchNumberPrefix ?? "BATCH"}-001</p>
              </div>
            )}

            <Separator />

            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Auto-generate Output Lot Numbers</p>
                <p className="text-[11px] text-muted-foreground">Sequential lot numbers for production output (e.g. LOT-001)</p>
              </div>
              <SwitchUI
                checked={form.autoGenerateLotNumbers === "true"}
                onCheckedChange={v => updateField("autoGenerateLotNumbers", v ? "true" : "false")}
                data-testid="switch-auto-lot"
              />
            </div>
            {form.autoGenerateLotNumbers === "true" && (
              <div className="space-y-1.5 pl-1">
                <Label htmlFor="lotNumberPrefix" className="text-xs font-medium">Lot Number Prefix</Label>
                <Input
                  id="lotNumberPrefix"
                  value={form.lotNumberPrefix ?? "LOT"}
                  onChange={e => updateField("lotNumberPrefix", e.target.value.toUpperCase())}
                  className="h-9 w-40 font-mono"
                  data-testid="input-lot-prefix"
                />
                <p className="text-[10px] text-muted-foreground">Preview: {form.lotNumberPrefix ?? "LOT"}-001</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* SKU Prefixes */}
        <Card data-testid="card-settings-sku">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Tag className="h-4 w-4 text-muted-foreground" />
              SKU Prefixes
            </CardTitle>
            <CardDescription className="text-xs">Auto-generated SKU format: PREFIX-XXXXX</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="skuPrefixRawMaterial" className="text-xs font-medium">Raw Material Prefix</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="skuPrefixRawMaterial"
                  value={form.skuPrefixRawMaterial ?? "RA"}
                  onChange={e => updateField("skuPrefixRawMaterial", e.target.value.toUpperCase())}
                  className="h-9 w-24 font-mono"
                  data-testid="input-sku-prefix-raw"
                />
                <span className="text-xs text-muted-foreground font-mono">-XXXXX</span>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="skuPrefixFinishedGood" className="text-xs font-medium">Finished Good Prefix</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="skuPrefixFinishedGood"
                  value={form.skuPrefixFinishedGood ?? "US"}
                  onChange={e => updateField("skuPrefixFinishedGood", e.target.value.toUpperCase())}
                  className="h-9 w-24 font-mono"
                  data-testid="input-sku-prefix-fg"
                />
                <span className="text-xs text-muted-foreground font-mono">-XXXXX</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ─── Location Form Dialog ───────────────────────────────────

const locationFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional().nullable(),
});

type LocationFormValues = z.infer<typeof locationFormSchema>;

function LocationFormDialog({
  location,
  open,
  onOpenChange,
}: {
  location?: Location;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const isEditing = !!location;

  const form = useForm<LocationFormValues>({
    resolver: zodResolver(locationFormSchema),
    defaultValues: {
      name: location?.name ?? "",
      description: location?.description ?? "",
    },
  });

  const mutation = useMutation({
    mutationFn: async (values: LocationFormValues) => {
      const payload = {
        ...values,
        description: values.description || null,
      };
      if (isEditing) {
        return apiRequest("PATCH", `/api/locations/${location.id}`, payload);
      }
      return apiRequest("POST", "/api/locations", payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/locations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      toast({
        title: isEditing ? "Location updated" : "Location created",
        description: `${form.getValues("name")} has been ${isEditing ? "updated" : "created"}.`,
      });
      onOpenChange(false);
      form.reset();
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit Location" : "Add Location"}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((v) => mutation.mutate(v))}
            className="space-y-4"
            data-testid="form-location"
          >
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="e.g. Room 2 Fridge" data-testid="input-location-name" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      value={field.value ?? ""}
                      rows={3}
                      placeholder="Optional description"
                      data-testid="input-location-description"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel">
                Cancel
              </Button>
              <Button type="submit" disabled={mutation.isPending} data-testid="button-submit-location">
                {mutation.isPending ? "Saving..." : isEditing ? "Update" : "Create"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Locations Sub-Tab ──────────────────────────────────────

function LocationsContent() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingLocation, setEditingLocation] = useState<Location | undefined>();
  const [deleteTarget, setDeleteTarget] = useState<Location | null>(null);
  const { toast } = useToast();

  const { data, isLoading } = useQuery<Location[]>({
    queryKey: ["/api/locations"],
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/locations/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/locations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      toast({
        title: "Location deleted",
        description: `${deleteTarget?.name} has been deleted.`,
      });
      setDeleteTarget(null);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleEdit = (location: Location) => {
    setEditingLocation(location);
    setDialogOpen(true);
  };

  const handleAdd = () => {
    setEditingLocation(undefined);
    setDialogOpen(true);
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-end">
        <Button size="sm" onClick={handleAdd} data-testid="button-add-location">
          <Plus className="h-4 w-4 mr-1" />
          Add Location
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-2">
              {[1, 2].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Name</TableHead>
                  <TableHead className="text-xs">Description</TableHead>
                  <TableHead className="text-xs w-24">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(!data || data.length === 0) ? (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center text-sm text-muted-foreground py-8">
                      No locations found.
                    </TableCell>
                  </TableRow>
                ) : (
                  data.map((loc) => (
                    <TableRow key={loc.id} data-testid={`row-location-${loc.id}`}>
                      <TableCell className="text-sm font-medium">{loc.name}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {loc.description ?? "—"}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => handleEdit(loc)}
                            data-testid={`button-edit-location-${loc.id}`}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive hover:text-destructive"
                            onClick={() => setDeleteTarget(loc)}
                            data-testid={`button-delete-location-${loc.id}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <LocationFormDialog
        key={editingLocation?.id ?? "new"}
        location={editingLocation}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete location?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{deleteTarget?.name}</strong>? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-location">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete-location"
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
//  MAIN SETTINGS PAGE
// ═══════════════════════════════════════════════════════════

type SettingsTab = "settings" | "locations";

export default function Settings() {
  const [activeTab, setActiveTab] = useState<SettingsTab>("settings");

  return (
    <div className="flex flex-col h-full">
      {/* Top bar */}
      <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
        <h1 className="text-xl font-semibold" data-testid="text-page-title">Settings</h1>
      </div>

      {/* Browser-style tabs */}
      <div className="px-6 pt-2 shrink-0 bg-muted/30 border-b">
        <div className="flex gap-0 -mb-px">
          <button
            onClick={() => setActiveTab("settings")}
            data-testid="tab-settings"
            className={`px-4 py-2 text-sm font-medium rounded-t-lg border border-b-0 transition-colors ${
              activeTab === "settings"
                ? "bg-background text-foreground border-border"
                : "bg-muted/50 text-muted-foreground border-transparent hover:text-foreground hover:bg-muted"
            }`}
          >
            Settings
          </button>
          <button
            onClick={() => setActiveTab("locations")}
            data-testid="tab-locations"
            className={`px-4 py-2 text-sm font-medium rounded-t-lg border border-b-0 transition-colors ${
              activeTab === "locations"
                ? "bg-background text-foreground border-border"
                : "bg-muted/50 text-muted-foreground border-transparent hover:text-foreground hover:bg-muted"
            }`}
          >
            Locations
          </button>
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-auto">
        {activeTab === "settings" && <SettingsContent />}
        {activeTab === "locations" && <LocationsContent />}
      </div>
    </div>
  );
}
