import { Input } from "@/components/ui/input";
import { forwardRef } from "react";

/**
 * Date input that forces MM/DD/YYYY display format regardless of browser locale.
 * Uses lang="en-US" to override the native date picker format.
 */
const DateInput = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  (props, ref) => {
    return (
      <Input
        {...props}
        ref={ref}
        type="date"
        lang="en-US"
      />
    );
  }
);
DateInput.displayName = "DateInput";

export { DateInput };
