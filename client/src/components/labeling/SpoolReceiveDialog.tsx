import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { SignatureCeremony } from "@/components/SignatureCeremony";

const spoolReceiveSchema = z.object({
  spoolNumber: z.string().trim().min(1, "Spool number is required"),
  qtyInitial: z.coerce.number().int().min(1, "Quantity must be at least 1"),
  locationId: z.string().trim().optional(),
});

type SpoolReceiveForm = z.infer<typeof spoolReceiveSchema>;

export interface SpoolReceiveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  artworkId: string;
  onReceived: () => void;
}

export function SpoolReceiveDialog({
  open,
  onOpenChange,
  artworkId,
  onReceived,
}: SpoolReceiveDialogProps) {
  const { toast } = useToast();
  const [sigOpen, setSigOpen] = useState(false);
  const [pendingData, setPendingData] = useState<SpoolReceiveForm | null>(null);

  const form = useForm<SpoolReceiveForm>({
    resolver: zodResolver(spoolReceiveSchema),
    defaultValues: { spoolNumber: "", qtyInitial: 100, locationId: "" },
  });

  const receiveMutation = useMutation({
    mutationFn: async ({ data, password }: { data: SpoolReceiveForm; password: string }) => {
      const res = await apiRequest("POST", "/api/label-spools", {
        artworkId,
        spoolNumber: data.spoolNumber,
        qtyInitial: data.qtyInitial,
        locationId: data.locationId || undefined,
        password,
      });
      if (!res.ok) {
        const body = await res.json() as { message?: string; error?: { message?: string } };
        throw new Error(body.message ?? body.error?.message ?? "Failed to receive spool");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/label-spools"] });
      toast({ title: "Spool received", description: `${form.getValues("spoolNumber")} is now ACTIVE.` });
      handleReset();
      onReceived();
      onOpenChange(false);
    },
  });

  function handleReset() {
    form.reset({ spoolNumber: "", qtyInitial: 100, locationId: "" });
    setPendingData(null);
    setSigOpen(false);
  }

  function onFormSubmit(data: SpoolReceiveForm) {
    setPendingData(data);
    setSigOpen(true);
  }

  async function onSign(password: string) {
    if (!pendingData) return;
    await receiveMutation.mutateAsync({ data: pendingData, password });
  }

  return (
    <>
      <Dialog open={open && !sigOpen} onOpenChange={(next) => { if (!next) handleReset(); onOpenChange(next); }}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>Receive Label Spool</DialogTitle>
            <DialogDescription className="text-xs">
              Register a new spool into the label cage. Requires electronic signature (F-04).
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onFormSubmit)} className="space-y-3" data-testid="form-receive-spool">
              <FormField
                control={form.control}
                name="spoolNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Spool number</FormLabel>
                    <FormControl>
                      <Input placeholder="SPL-2024-001" {...field} data-testid="input-spool-number" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="qtyInitial"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Initial quantity (labels)</FormLabel>
                    <FormControl>
                      <Input type="number" min={1} {...field} data-testid="input-spool-qty" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="locationId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Location <span className="text-xs text-muted-foreground">(optional)</span></FormLabel>
                    <FormControl>
                      <Input placeholder="Label cage A" {...field} data-testid="input-spool-location" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => { handleReset(); onOpenChange(false); }}>
                  Cancel
                </Button>
                <Button type="submit" disabled={!form.formState.isValid} data-testid="button-spool-next">
                  Sign &amp; receive
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <SignatureCeremony
        open={sigOpen}
        onOpenChange={(next) => { if (!next) { setSigOpen(false); } else { setSigOpen(true); } }}
        entityDescription={`spool ${pendingData?.spoolNumber ?? ""}`}
        meaning="LABEL_SPOOL_RECEIVED"
        onSign={onSign}
        isPending={receiveMutation.isPending}
      />
    </>
  );
}
