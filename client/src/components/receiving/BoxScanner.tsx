import { useState, useEffect, useRef } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Camera, QrCode, Loader2 } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  onScan: (label: string) => void;
  error?: string;
  isPending?: boolean;
}

// BarcodeDetector is available in Safari 17+ (iPad A16) and Chrome 88+.
declare class BarcodeDetector {
  static getSupportedFormats(): Promise<string[]>;
  constructor(opts: { formats: string[] });
  detect(image: ImageBitmapSource): Promise<{ rawValue: string; format: string }[]>;
}

export function BoxScanner({ open, onOpenChange, title, onScan, error, isPending }: Props) {
  const [mode, setMode] = useState<"camera" | "text">("camera");
  const [textValue, setTextValue] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number>(0);

  useEffect(() => {
    if (!open) return;
    setTextValue("");

    const tryCamera = async () => {
      if (typeof BarcodeDetector === "undefined") {
        setMode("text");
        return;
      }
      try {
        const formats = await BarcodeDetector.getSupportedFormats();
        if (!formats.includes("qr_code")) {
          setMode("text");
          return;
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
        streamRef.current = stream;
        setMode("camera");
      } catch {
        setMode("text");
      }
    };

    tryCamera();
  }, [open]);

  useEffect(() => {
    if (mode !== "camera" || !open) return;
    const video = videoRef.current;
    if (!video || !streamRef.current) return;

    video.srcObject = streamRef.current;
    video.play().catch(() => setMode("text"));

    const detector = new BarcodeDetector({ formats: ["qr_code"] });

    const scan = async () => {
      if (video.readyState >= 2) {
        try {
          const barcodes = await detector.detect(video);
          if (barcodes.length > 0 && barcodes[0]) {
            stopCamera();
            onScan(barcodes[0].rawValue);
            onOpenChange(false);
            return;
          }
        } catch {
          // transient detection errors — keep scanning
        }
      }
      animFrameRef.current = requestAnimationFrame(scan);
    };

    animFrameRef.current = requestAnimationFrame(scan);
    return stopCamera;
  }, [mode, open]);

  useEffect(() => {
    if (!open) stopCamera();
  }, [open]);

  function stopCamera() {
    cancelAnimationFrame(animFrameRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  function handleTextSubmit() {
    const label = textValue.trim();
    if (!label) return;
    onScan(label);
    setTextValue("");
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="h-[85vh] flex flex-col">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <QrCode className="h-5 w-5" />
            {title}
          </SheetTitle>
        </SheetHeader>

        <div className="flex-1 flex flex-col items-center justify-center gap-4 p-4">
          {mode === "camera" ? (
            <>
              <div className="relative w-full max-w-sm aspect-square rounded-lg overflow-hidden border-2 border-primary/40 bg-black">
                <video
                  ref={videoRef}
                  className="w-full h-full object-cover"
                  playsInline
                  muted
                />
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="w-48 h-48 border-2 border-white/70 rounded-md" />
                </div>
              </div>
              <p className="text-sm text-muted-foreground text-center">
                Point the camera at the QR code on the box label
              </p>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => { stopCamera(); setMode("text"); }}
              >
                Enter label manually instead
              </Button>
            </>
          ) : (
            <>
              <Camera className="h-12 w-12 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground text-center">
                Camera not available — enter the box label manually
              </p>
              <div className="w-full max-w-sm space-y-2">
                <Label className="text-sm">Box Label</Label>
                <Input
                  autoFocus
                  value={textValue}
                  onChange={(e) => setTextValue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleTextSubmit(); }}
                  placeholder="e.g. RCV-20260505-001-BOX-01"
                  className="font-mono"
                  data-testid="input-box-label-fallback"
                />
              </div>
              <Button
                onClick={handleTextSubmit}
                disabled={!textValue.trim() || isPending}
                className="w-full max-w-sm"
                data-testid="button-submit-box-label"
              >
                {isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : null}
                Submit
              </Button>
            </>
          )}

          {error && (
            <p className="text-sm text-destructive text-center" data-testid="text-scanner-error">
              {error}
            </p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
