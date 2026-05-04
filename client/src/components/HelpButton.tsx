import { HelpCircle } from "lucide-react";
import { useLocation } from "wouter";
import { startTour } from "@/tours";
import { useToast } from "@/hooks/use-toast";

export function HelpButton() {
  const [location] = useLocation();
  const { toast } = useToast();

  function handleClick() {
    const started = startTour(location);
    if (!started) {
      toast({ title: "No tour available for this page yet." });
    }
  }

  return (
    <button
      onClick={handleClick}
      className="flex items-center justify-center h-8 w-8 rounded-full border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
      title="Page tour"
      data-testid="nav-help"
    >
      <HelpCircle className="h-4 w-4" />
      <span className="sr-only">Help tour</span>
    </button>
  );
}
