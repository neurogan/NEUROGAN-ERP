import { useState, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  Search,
  Plus,
  Pencil,
  Trash2,
  FileText,
  Upload,
  Download,
  File,
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatDate } from "@/lib/formatDate";
import { DateInput } from "@/components/ui/date-input";
import { useToast } from "@/hooks/use-toast";
import type { Supplier, SupplierDocument, SupplierQualificationWithDetails } from "@shared/schema";
import PurchaseOrders from "./purchase-orders";

// ─── Helpers ────────────────────────────────────────────────

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileTypeBadgeVariant(fileType: string | null): "default" | "secondary" | "outline" {
  if (!fileType) return "outline";
  if (fileType.includes("pdf")) return "default";
  if (fileType.includes("image")) return "secondary";
  return "outline";
}

function getFileTypeLabel(fileType: string | null): string {
  if (!fileType) return "File";
  if (fileType.includes("pdf")) return "PDF";
  if (fileType.includes("image/png")) return "PNG";
  if (fileType.includes("image/jpeg") || fileType.includes("image/jpg")) return "JPG";
  if (fileType.includes("spreadsheet") || fileType.includes("excel") || fileType.includes("csv")) return "XLS";
  if (fileType.includes("word") || fileType.includes("document")) return "DOC";
  if (fileType.includes("text/plain")) return "TXT";
  return fileType.split("/").pop()?.toUpperCase() ?? "File";
}

// ─── Supplier Form Dialog ───────────────────────────────────

const supplierFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  contactEmail: z.string().email("Invalid email").optional().or(z.literal("")),
  contactPhone: z.string().optional(),
  notes: z.string().optional(),
});

type SupplierFormValues = z.infer<typeof supplierFormSchema>;

function SupplierFormDialog({
  supplier,
  open,
  onOpenChange,
}: {
  supplier?: Supplier;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const isEditing = !!supplier;

  const form = useForm<SupplierFormValues>({
    resolver: zodResolver(supplierFormSchema),
    defaultValues: {
      name: supplier?.name ?? "",
      contactEmail: supplier?.contactEmail ?? "",
      contactPhone: supplier?.contactPhone ?? "",
      notes: supplier?.notes ?? "",
    },
  });

  const mutation = useMutation({
    mutationFn: async (values: SupplierFormValues) => {
      const payload = {
        name: values.name,
        contactEmail: values.contactEmail || null,
        contactPhone: values.contactPhone || null,
        notes: values.notes || null,
      };
      if (isEditing) {
        return apiRequest("PATCH", `/api/suppliers/${supplier.id}`, payload);
      }
      return apiRequest("POST", "/api/suppliers", payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/suppliers"] });
      toast({
        title: isEditing ? "Supplier updated" : "Supplier created",
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
          <DialogTitle>{isEditing ? "Edit Supplier" : "Add Supplier"}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((v) => mutation.mutate(v))}
            className="space-y-4"
            data-testid="form-supplier"
          >
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="e.g. Nutrition Biotech" data-testid="input-supplier-name" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="contactEmail"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input {...field} type="email" placeholder="contact@supplier.com" data-testid="input-supplier-email" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="contactPhone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Phone</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="+1 555-123-4567" data-testid="input-supplier-phone" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      rows={3}
                      placeholder="Optional notes about this supplier"
                      data-testid="input-supplier-notes"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel-supplier">
                Cancel
              </Button>
              <Button type="submit" disabled={mutation.isPending} data-testid="button-submit-supplier">
                {mutation.isPending ? "Saving..." : isEditing ? "Update" : "Create"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Document Upload Drop Zone ──────────────────────────────

function DocumentDropZone({ supplierId }: { supplierId: string }) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          // Remove data URL prefix to get just base64
          const base64Data = result.split(",")[1] || result;
          resolve(base64Data);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      return apiRequest("POST", `/api/suppliers/${supplierId}/documents`, {
        fileName: file.name,
        fileType: file.type,
        fileSize: String(file.size),
        fileData: base64,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/suppliers", supplierId, "documents"] });
      toast({ title: "Document uploaded", description: "File has been uploaded successfully." });
    },
    onError: (error: Error) => {
      toast({ title: "Upload failed", description: error.message, variant: "destructive" });
    },
  });

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files) return;
      Array.from(files).forEach((file) => uploadMutation.mutate(file));
    },
    [uploadMutation]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles]
  );

  return (
    <div
      className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
        isDragging
          ? "border-primary bg-primary/5"
          : "border-muted-foreground/25 hover:border-muted-foreground/50"
      }`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={() => fileInputRef.current?.click()}
      data-testid="dropzone-upload"
    >
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        multiple
        onChange={(e) => handleFiles(e.target.files)}
        data-testid="input-file-upload"
      />
      <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
      <p className="text-sm font-medium text-muted-foreground">
        {uploadMutation.isPending ? "Uploading..." : "Drop files here or click to upload"}
      </p>
      <p className="text-xs text-muted-foreground mt-1">
        PDFs, images, spreadsheets, and documents
      </p>
    </div>
  );
}

// ─── Document List ──────────────────────────────────────────

function DocumentList({ supplierId }: { supplierId: string }) {
  const { toast } = useToast();
  const [deleteTarget, setDeleteTarget] = useState<SupplierDocument | null>(null);

  const { data: documents, isLoading } = useQuery<SupplierDocument[]>({
    queryKey: ["/api/suppliers", supplierId, "documents"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/suppliers/${supplierId}/documents`);
      return res.json();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (docId: string) => {
      return apiRequest("DELETE", `/api/suppliers/${supplierId}/documents/${docId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/suppliers", supplierId, "documents"] });
      toast({ title: "Document deleted" });
      setDeleteTarget(null);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handleDownload = useCallback(async (doc: SupplierDocument) => {
    try {
      const res = await apiRequest("GET", `/api/suppliers/${supplierId}/documents/${doc.id}`);
      const fullDoc = await res.json();
      if (!fullDoc.fileData) {
        toast({ title: "Error", description: "No file data available", variant: "destructive" });
        return;
      }
      const byteChars = atob(fullDoc.fileData);
      const byteNumbers = new Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++) {
        byteNumbers[i] = byteChars.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: fullDoc.fileType || "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fullDoc.fileName;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast({ title: "Download failed", variant: "destructive" });
    }
  }, [supplierId, toast]);

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2].map((i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {documents && documents.length > 0 ? (
        <div className="space-y-1">
          {documents.map((doc) => (
            <div
              key={doc.id}
              className="flex items-center gap-3 px-3 py-2.5 rounded-md border bg-card hover:bg-muted/50 transition-colors group"
              data-testid={`row-document-${doc.id}`}
            >
              <File className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate" data-testid={`text-doc-name-${doc.id}`}>
                  {doc.fileName}
                </p>
                <div className="flex items-center gap-2 mt-0.5">
                  <Badge variant={getFileTypeBadgeVariant(doc.fileType)} className="text-[10px] px-1.5 py-0">
                    {getFileTypeLabel(doc.fileType)}
                  </Badge>
                  <span className="text-[11px] text-muted-foreground">
                    {doc.fileSize ? formatFileSize(Number(doc.fileSize)) : "—"}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {formatDate(doc.uploadedAt)}
                  </span>
                </div>
              </div>
              <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => handleDownload(doc)}
                  data-testid={`button-download-doc-${doc.id}`}
                >
                  <Download className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-destructive hover:text-destructive"
                  onClick={() => setDeleteTarget(doc)}
                  data-testid={`button-delete-doc-${doc.id}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-6 text-sm text-muted-foreground">
          <FileText className="h-8 w-8 mx-auto mb-2 opacity-40" />
          No documents uploaded yet.
        </div>
      )}

      <DocumentDropZone supplierId={supplierId} />

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete document?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{deleteTarget?.fileName}</strong>? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-doc">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete-doc"
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Qualification Dialog ────────────────────────────────────

function QualificationDialog({
  supplierId,
  qualification,
  open,
  onOpenChange,
}: {
  supplierId: string;
  qualification?: SupplierQualificationWithDetails;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const isEditing = !!qualification;

  const [qualificationDate, setQualificationDate] = useState(qualification?.qualificationDate ?? new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState(qualification?.qualificationMethod ?? "");
  const [qualifiedBy, setQualifiedBy] = useState(qualification?.qualifiedBy ?? "");
  const [approvedBy, setApprovedBy] = useState(qualification?.approvedBy ?? "");
  const [frequency, setFrequency] = useState(qualification?.requalificationFrequency ?? "12 months");
  const [nextDue, setNextDue] = useState(qualification?.nextRequalificationDue ?? "");
  const [status, setStatus] = useState(qualification?.status ?? "QUALIFIED");
  const [notes, setNotes] = useState(qualification?.notes ?? "");

  // Auto-calculate next due date when date or frequency changes
  const calcNextDue = useCallback((dateStr: string, freq: string) => {
    if (!dateStr) return "";
    const d = new Date(dateStr);
    const months = parseInt(freq) || 12;
    d.setMonth(d.getMonth() + months);
    return d.toISOString().slice(0, 10);
  }, []);

  const handleDateChange = useCallback((val: string) => {
    setQualificationDate(val);
    setNextDue(calcNextDue(val, frequency));
  }, [frequency, calcNextDue]);

  const handleFrequencyChange = useCallback((val: string) => {
    setFrequency(val);
    setNextDue(calcNextDue(qualificationDate, val));
  }, [qualificationDate, calcNextDue]);

  // Initialize nextDue on mount if empty
  useState(() => {
    if (!nextDue && qualificationDate) {
      setNextDue(calcNextDue(qualificationDate, frequency));
    }
  });

  const mutation = useMutation({
    mutationFn: async () => {
      const payload = {
        supplierId,
        qualificationDate,
        qualificationMethod: method,
        qualifiedBy,
        approvedBy,
        requalificationFrequency: frequency,
        nextRequalificationDue: nextDue,
        lastRequalificationDate: isEditing ? qualificationDate : null,
        status,
        notes: notes || null,
      };
      if (isEditing) {
        return apiRequest("PUT", `/api/supplier-qualifications/${qualification.id}`, payload);
      }
      return apiRequest("POST", "/api/supplier-qualifications", payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/supplier-qualifications"] });
      toast({
        title: isEditing ? "Qualification updated" : "Qualification created",
      });
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit Qualification" : "Start Qualification"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-sm">Qualification Date</Label>
            <DateInput
              value={qualificationDate}
              onChange={handleDateChange}
              className="text-sm"
              data-testid="input-qual-date"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm">Method</Label>
            <Textarea
              placeholder="How was supplier reliability established? (e.g., audit, historical performance, third-party certification)"
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              className="text-sm min-h-[60px]"
              data-testid="input-qual-method"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm">Qualified By</Label>
            <Input
              placeholder="Person who performed qualification"
              value={qualifiedBy}
              onChange={(e) => setQualifiedBy(e.target.value)}
              className="text-sm"
              data-testid="input-qual-qualified-by"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm">Approved By</Label>
            <Input
              placeholder="QC personnel who approved"
              value={approvedBy}
              onChange={(e) => setApprovedBy(e.target.value)}
              className="text-sm"
              data-testid="input-qual-approved-by"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm">Requalification Frequency</Label>
            <Select value={frequency} onValueChange={handleFrequencyChange}>
              <SelectTrigger className="text-sm" data-testid="select-qual-frequency">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="6 months">6 months</SelectItem>
                <SelectItem value="12 months">12 months</SelectItem>
                <SelectItem value="24 months">24 months</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm">Next Requalification Due</Label>
            <DateInput
              value={nextDue}
              onChange={setNextDue}
              className="text-sm"
              data-testid="input-qual-next-due"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm">Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="text-sm" data-testid="select-qual-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="QUALIFIED">Qualified</SelectItem>
                <SelectItem value="PENDING">Pending</SelectItem>
                <SelectItem value="DISQUALIFIED">Disqualified</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm">Notes</Label>
            <Textarea
              placeholder="Optional notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="text-sm min-h-[60px]"
              data-testid="input-qual-notes"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => mutation.mutate()}
              disabled={mutation.isPending || !qualifiedBy.trim() || !approvedBy.trim()}
              data-testid="button-save-qualification"
            >
              {mutation.isPending ? (
                <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Saving...</>
              ) : (
                isEditing ? "Update" : "Create"
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Qualification Status Section ────────────────────────────

function QualificationStatusSection({ supplierId }: { supplierId: string }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingQual, setEditingQual] = useState<SupplierQualificationWithDetails | undefined>();

  const { data: qualifications, isLoading } = useQuery<SupplierQualificationWithDetails[]>({
    queryKey: ["/api/supplier-qualifications", { supplierId }],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/supplier-qualifications?supplierId=${supplierId}`);
      return res.json();
    },
  });

  if (isLoading) {
    return (
      <div>
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-1.5">
          <ShieldCheck className="h-4 w-4 text-muted-foreground" />
          Qualification Status
        </h3>
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  const qual = qualifications && qualifications.length > 0 ? qualifications[0] : null;

  const isOverdue = qual?.nextRequalificationDue
    ? new Date(qual.nextRequalificationDue) < new Date()
    : false;

  const statusBadge = (s: string) => {
    switch (s) {
      case "QUALIFIED":
        return (
          <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 border-0 text-xs" data-testid="badge-qual-status">
            <ShieldCheck className="h-3 w-3 mr-1" />
            Qualified
          </Badge>
        );
      case "PENDING":
        return (
          <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border-0 text-xs" data-testid="badge-qual-status">
            <AlertTriangle className="h-3 w-3 mr-1" />
            Pending
          </Badge>
        );
      case "DISQUALIFIED":
        return (
          <Badge className="bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300 border-0 text-xs" data-testid="badge-qual-status">
            <ShieldAlert className="h-3 w-3 mr-1" />
            Disqualified
          </Badge>
        );
      default:
        return <Badge variant="secondary" className="text-xs">{s}</Badge>;
    }
  };

  return (
    <div>
      <h3 className="text-sm font-semibold mb-3 flex items-center gap-1.5">
        <ShieldCheck className="h-4 w-4 text-muted-foreground" />
        Qualification Status
      </h3>

      {!qual ? (
        <div className="rounded-lg border border-border bg-muted/30 p-4" data-testid="qual-not-qualified">
          <div className="flex items-center justify-between">
            <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border-0 text-xs" data-testid="badge-qual-status">
              <AlertTriangle className="h-3 w-3 mr-1" />
              Not Qualified
            </Badge>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setEditingQual(undefined);
                setDialogOpen(true);
              }}
              data-testid="button-start-qualification"
            >
              <Plus className="h-3.5 w-3.5 mr-1" />
              Start Qualification
            </Button>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3" data-testid="qual-details">
          <div className="flex items-center justify-between">
            {statusBadge(qual.status)}
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setEditingQual(qual);
                setDialogOpen(true);
              }}
              data-testid="button-edit-qualification"
            >
              <Pencil className="h-3.5 w-3.5 mr-1" />
              Edit
            </Button>
          </div>

          {isOverdue && (
            <div className="flex items-center gap-2 rounded-md bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-3 py-2" data-testid="warning-requalification-overdue">
              <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
              <span className="text-xs font-medium text-amber-800 dark:text-amber-300">Requalification overdue</span>
            </div>
          )}

          <div className="grid grid-cols-1 gap-2 text-sm">
            <div>
              <span className="text-xs font-medium text-muted-foreground">Qualification Date</span>
              <p className="text-sm" data-testid="text-qual-date">{qual.qualificationDate ?? "—"}</p>
            </div>
            <div>
              <span className="text-xs font-medium text-muted-foreground">Method</span>
              <p className="text-sm whitespace-pre-wrap" data-testid="text-qual-method">{qual.qualificationMethod ?? "—"}</p>
            </div>
            <div>
              <span className="text-xs font-medium text-muted-foreground">Qualified By</span>
              <p className="text-sm" data-testid="text-qual-qualified-by">{qual.qualifiedBy ?? "—"}</p>
            </div>
            <div>
              <span className="text-xs font-medium text-muted-foreground">Approved By</span>
              <p className="text-sm" data-testid="text-qual-approved-by">{qual.approvedBy ?? "—"}</p>
            </div>
            <div>
              <span className="text-xs font-medium text-muted-foreground">Last Requalification</span>
              <p className="text-sm" data-testid="text-qual-last-requal">{qual.lastRequalificationDate ?? "—"}</p>
            </div>
            <div>
              <span className="text-xs font-medium text-muted-foreground">Next Requalification Due</span>
              <p className={`text-sm ${isOverdue ? "text-amber-600 dark:text-amber-400 font-medium" : ""}`} data-testid="text-qual-next-due">
                {qual.nextRequalificationDue ?? "—"}
              </p>
            </div>
            <div>
              <span className="text-xs font-medium text-muted-foreground">Frequency</span>
              <p className="text-sm" data-testid="text-qual-frequency">{qual.requalificationFrequency ?? "—"}</p>
            </div>
            {qual.notes && (
              <div>
                <span className="text-xs font-medium text-muted-foreground">Notes</span>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap" data-testid="text-qual-notes">{qual.notes}</p>
              </div>
            )}
          </div>
        </div>
      )}

      <QualificationDialog
        key={editingQual?.id ?? "new"}
        supplierId={supplierId}
        qualification={editingQual}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
    </div>
  );
}

// ─── Supplier Detail Panel ──────────────────────────────────

function SupplierDetail({
  supplier,
  onEdit,
  onDelete,
}: {
  supplier: Supplier;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="space-y-6">
      {/* Supplier Info */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold" data-testid="text-supplier-name">{supplier.name}</h2>
          <div className="flex gap-1">
            <Button variant="outline" size="sm" onClick={onEdit} data-testid="button-edit-supplier">
              <Pencil className="h-3.5 w-3.5 mr-1" />
              Edit
            </Button>
            <Button variant="outline" size="sm" onClick={onDelete} className="text-destructive hover:text-destructive" data-testid="button-delete-supplier">
              <Trash2 className="h-3.5 w-3.5 mr-1" />
              Delete
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3">
          <div>
            <p className="text-xs font-medium text-muted-foreground">Email</p>
            <p className="text-sm" data-testid="text-supplier-email">{supplier.contactEmail || "—"}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-muted-foreground">Phone</p>
            <p className="text-sm" data-testid="text-supplier-phone">{supplier.contactPhone || "—"}</p>
          </div>
          {supplier.notes && (
            <div>
              <p className="text-xs font-medium text-muted-foreground">Notes</p>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap" data-testid="text-supplier-notes">{supplier.notes}</p>
            </div>
          )}
          <div>
            <p className="text-xs font-medium text-muted-foreground">Created</p>
            <p className="text-sm text-muted-foreground">
              {formatDate(supplier.createdAt)}
            </p>
          </div>
        </div>
      </div>

      {/* Qualification Status */}
      <QualificationStatusSection supplierId={supplier.id} />

      {/* Documents Section */}
      <div>
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-1.5">
          <FileText className="h-4 w-4 text-muted-foreground" />
          Documents
        </h3>
        <DocumentList supplierId={supplier.id} />
      </div>
    </div>
  );
}

// ─── Suppliers Sub-Tab ──────────────────────────────────────

export function SuppliersContent({ initialSelectedId }: { initialSelectedId?: string | null }) {
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId ?? null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | undefined>();
  const [deleteTarget, setDeleteTarget] = useState<Supplier | null>(null);
  const { toast } = useToast();

  const { data: suppliers, isLoading } = useQuery<Supplier[]>({
    queryKey: ["/api/suppliers"],
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/suppliers/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/suppliers"] });
      toast({
        title: "Supplier deleted",
        description: `${deleteTarget?.name} has been deleted.`,
      });
      setDeleteTarget(null);
      if (selectedId === deleteTarget?.id) {
        setSelectedId(null);
      }
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const filtered = suppliers?.filter((s) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      s.name.toLowerCase().includes(q) ||
      (s.contactEmail?.toLowerCase().includes(q) ?? false)
    );
  });

  const selected = suppliers?.find((s) => s.id === selectedId);

  const handleAdd = () => {
    setEditingSupplier(undefined);
    setDialogOpen(true);
  };

  const handleEdit = (supplier: Supplier) => {
    setEditingSupplier(supplier);
    setDialogOpen(true);
  };

  const handleDelete = (supplier: Supplier) => {
    setDeleteTarget(supplier);
  };

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left panel: supplier list */}
      <div className="w-80 shrink-0 border-r flex flex-col">
        <div className="p-3 space-y-2 border-b">
          <Button size="sm" className="w-full" onClick={handleAdd} data-testid="button-add-supplier">
            <Plus className="h-4 w-4 mr-1" />
            Add Supplier
          </Button>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search suppliers..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 pl-8 text-sm"
              data-testid="input-search-suppliers"
            />
          </div>
        </div>

        <div className="flex-1 overflow-auto">
          {isLoading ? (
            <div className="p-3 space-y-2">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : filtered && filtered.length > 0 ? (
            filtered.map((s) => (
              <button
                key={s.id}
                onClick={() => setSelectedId(s.id)}
                className={`w-full text-left px-3 py-3 border-b transition-colors ${
                  selectedId === s.id
                    ? "bg-primary/5 border-l-2 border-l-primary"
                    : "hover:bg-muted/50 border-l-2 border-l-transparent"
                }`}
                data-testid={`button-select-supplier-${s.id}`}
              >
                <p className="text-sm font-medium truncate">{s.name}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {s.contactEmail || "No email"}
                </p>
              </button>
            ))
          ) : (
            <div className="p-6 text-center text-sm text-muted-foreground">
              {search ? "No suppliers match your search." : "No suppliers yet."}
            </div>
          )}
        </div>
      </div>

      {/* Right panel: detail */}
      <div className="flex-1 overflow-auto p-6">
        {selected ? (
          <SupplierDetail
            key={selected.id}
            supplier={selected}
            onEdit={() => handleEdit(selected)}
            onDelete={() => handleDelete(selected)}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground">
            <FileText className="h-12 w-12 mb-3 opacity-30" />
            <h3 className="text-sm font-medium mb-1">Select a supplier</h3>
            <p className="text-xs text-muted-foreground max-w-[200px]">
              Click on a supplier from the list to view details and documents.
            </p>
          </div>
        )}
      </div>

      {/* Supplier form dialog */}
      <SupplierFormDialog
        key={editingSupplier?.id ?? "new"}
        supplier={editingSupplier}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete supplier?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{deleteTarget?.name}</strong>? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-supplier">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete-supplier"
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
//  MAIN SUPPLIERS TAB PAGE
// ═══════════════════════════════════════════════════════════

type SubTab = "purchase-orders" | "suppliers";

export default function SuppliersTab() {
  // Read URL params for pre-selection (hash routing: /#/suppliers?po=xxx or ?supplier=xxx)
  const searchParams = new URLSearchParams(window.location.hash.split("?")[1] || "");
  const urlPoId = searchParams.get("po");
  const urlSupplierId = searchParams.get("supplier");
  const urlOpenCreate = searchParams.get("openCreate") === "true";
  const urlMaterial = searchParams.get("material");
  const urlTab = searchParams.get("tab");

  const [activeTab, setActiveTab] = useState<SubTab>(
    urlSupplierId ? "suppliers" : urlTab === "purchase-orders" || urlTab === "suppliers" ? urlTab : "purchase-orders"
  );

  return (
    <div className="flex flex-col h-full">
      {/* Top bar */}
      <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
        <h1 className="text-xl font-semibold" data-testid="text-page-title">Suppliers</h1>
      </div>

      {/* Browser-style tabs */}
      <div className="px-6 pt-2 shrink-0 bg-muted/30 border-b">
        <div className="flex gap-0 -mb-px">
          <button
            onClick={() => setActiveTab("purchase-orders")}
            data-testid="tab-purchase-orders"
            className={`px-4 py-2 text-sm font-medium rounded-t-lg border border-b-0 transition-colors ${
              activeTab === "purchase-orders"
                ? "bg-background text-foreground border-border"
                : "bg-muted/50 text-muted-foreground border-transparent hover:text-foreground hover:bg-muted"
            }`}
          >
            Purchase Orders
          </button>
          <button
            onClick={() => setActiveTab("suppliers")}
            data-testid="tab-suppliers"
            className={`px-4 py-2 text-sm font-medium rounded-t-lg border border-b-0 transition-colors ${
              activeTab === "suppliers"
                ? "bg-background text-foreground border-border"
                : "bg-muted/50 text-muted-foreground border-transparent hover:text-foreground hover:bg-muted"
            }`}
          >
            Suppliers
          </button>
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-auto">
        {activeTab === "purchase-orders" && <PurchaseOrders initialSelectedId={urlPoId} initialOpenCreate={urlOpenCreate} initialMaterialId={urlMaterial} />}
        {activeTab === "suppliers" && <SuppliersContent initialSelectedId={urlSupplierId} />}
      </div>
    </div>
  );
}
