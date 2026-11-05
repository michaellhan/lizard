// A table that drops columns on a phone. The cells of those columns take the class `phone-col` (styles/index.css), and
// this says which they are and brings them back, with the table then scrolling sideways, so nothing is out of reach below
// `sm`. At `sm` and up every column shows and this adds nothing. The box that scrolls is the caller's.
import { useState, type ReactNode } from "react";

/** `hidden`: the headers of the `phone-col` columns (none: nothing to say, as a multiway table has none). */
export function PhoneColumns({ hidden, children }: { hidden: readonly string[]; children: ReactNode }) {
  const [all, setAll] = useState(false);
  return (
    <div className="phone-cols space-y-1" data-all={all || undefined}>
      {hidden.length > 0 && (
        <p className="text-xs text-muted sm:hidden">
          {all ? "Every column is shown: scroll the table sideways." : `Hidden at this width: ${hidden.join(", ")}.`}{" "}
          <button type="button" onClick={() => setAll(!all)} className="rounded border border-border px-1.5 py-0.5 text-text hover:bg-surface-2">
            {all ? "Hide them" : "Show them"}
          </button>
        </p>
      )}
      {children}
    </div>
  );
}
