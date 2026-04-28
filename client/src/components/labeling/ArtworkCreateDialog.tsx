import { useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Product } from "@shared/schema";

const artworkCreateSchema = z.object({
  productId: z.string().min(1, "Product is required"),
  version: z.string().trim().min(1, "Version is required"),
  variableDataLotNumber: z.boolean(),
  variableDataExpirationDate: z.boolean(),
});

type ArtworkCreateForm = z.infer<typeof artworkCreateSchema>;

const FORM_DEFAULTS: ArtworkCreateForm = {
  productId: "",
  version: "",
  variableDataLotNumber: false,
  variableDataExpirationDate: false,
};

export interface ArtworkCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

export function ArtworkCreateDialog({
  open,
  onOpenChange,
  onCreated,
}: ArtworkCreateDialogProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const { data: products } = useQuery<Product[]>({
    queryKey: ["/api/products"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/products");
      return res.json();
    },
  });

  const form = useForm<ArtworkCreateForm>({
    resolver: zodResolver(artworkCreateSchema),
    mode: "onChange",
    defaultValues: FORM_DEFAULTS,
  });

  const createMutation = useMutation({
    mutationFn: async (data: ArtworkCreateForm) => {
      if (!selectedFile) throw new Error("Please select an artwork file.");
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          resolve(result.split(",")[1] || result);
        };
        reader.onerror = () => reject(new Error("Failed to read file"));
        reader.readAsDataURL(selectedFile);
      });
      const res = await apiRequest("POST", "/api/label-artwork", {
        productId: data.productId,
        version: data.version.trim(),
        artworkFileName: selectedFile.name,
        artworkFileData: base64,
        artworkMimeType: selectedFile.type || "application/octet-stream",
        variableDataSpec: {
          lotNumber: data.variableDataLotNumber,
          expirationDate: data.variableDataExpirationDate,
        },
      });
      return res.json() as Promise<{ id: string; version: string }>;
    },
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["/api/label-artwork"] });
      toast({
        title: "Artwork created",
        description: `Version ${created.version} — DRAFT. Approve to activate.`,
      });
      handleReset();
      onCreated();
      onOpenChange(false);
    },
    onError: (err: Error) => {
      const msg = err.message ?? "";
      if (msg.includes("DUPLICATE")) {
        setSubmitError("This product/version combination already exists.");
      } else {
        setSubmitError(msg || "Failed to create artwork.");
      }
    },
  });

  function handleReset() {
    form.reset(FORM_DEFAULTS);
    setSelectedFile(null);
    setFileError(null);
    setSubmitError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setFileError(null);
    if (!file) {
      setSelectedFile(null);
      return;
    }
    const allowed = ["image/png", "image/jpeg", "image/svg+xml", "application/pdf"];
    if (!allowed.includes(file.type)) {
      setFileError("Allowed: PNG, JPEG, SVG, PDF");
      setSelectedFile(null);
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setFileError("File must be 10 MB or smaller.");
      setSelectedFile(null);
      return;
    }
    setSelectedFile(file);
  }

  function handleOpenChange(next: boolean) {
    if (!next) handleReset();
    onOpenChange(next);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>New Label Artwork</DialogTitle>
          <DialogDescription className="text-xs">
            Upload a label artwork file. It will be created in DRAFT status and requires approval (F-04) before it can be issued.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((v) => createMutation.mutate(v))}
            className="space-y-3"
            data-testid="form-create-artwork"
          >
            <FormField
              control={form.control}
              name="productId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Product</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger data-testid="select-artwork-product">
                        <SelectValue placeholder="Select a product…" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {(products ?? []).map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name} ({p.sku})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="version"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Version</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="v1.0"
                      {...field}
                      data-testid="input-artwork-version"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {/* File upload */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                Artwork file <span className="text-destructive">*</span>
              </label>
              <Input
                ref={fileInputRef}
                type="file"
                accept=".png,.jpg,.jpeg,.svg,.pdf"
                onChange={handleFileChange}
                data-testid="input-artwork-file"
                className="cursor-pointer"
              />
              {selectedFile && (
                <p className="text-xs text-muted-foreground">{selectedFile.name} ({Math.round(selectedFile.size / 1024)} KB)</p>
              )}
              {fileError && (
                <p className="text-xs text-destructive" data-testid="text-file-error">{fileError}</p>
              )}
            </div>
            {/* Variable data spec */}
            <div className="space-y-2">
              <p className="text-sm font-medium leading-none">Variable data fields</p>
              <FormField
                control={form.control}
                name="variableDataLotNumber"
                render={({ field }) => (
                  <FormItem className="flex items-center gap-2 space-y-0">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        data-testid="checkbox-lot-number"
                      />
                    </FormControl>
                    <FormLabel className="font-normal">Lot number</FormLabel>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="variableDataExpirationDate"
                render={({ field }) => (
                  <FormItem className="flex items-center gap-2 space-y-0">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        data-testid="checkbox-expiration-date"
                      />
                    </FormControl>
                    <FormLabel className="font-normal">Expiration date</FormLabel>
                  </FormItem>
                )}
              />
            </div>
            {submitError && (
              <div
                className="rounded-md border border-destructive/50 bg-destructive/10 p-2 text-sm text-destructive"
                data-testid="text-artwork-create-error"
              >
                {submitError}
              </div>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => handleOpenChange(false)}
                disabled={createMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={
                  createMutation.isPending ||
                  !form.formState.isValid ||
                  !selectedFile
                }
                data-testid="button-submit-artwork"
              >
                {createMutation.isPending ? "Creating…" : "Create artwork"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
