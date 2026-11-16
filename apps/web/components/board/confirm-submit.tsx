"use client";

import { Button, SlowNote } from "@injurysub/ui";
import { useFormStatus } from "react-dom";

// Confirm's one primary action. Once tapped it says ESPN is being checked and can't be tapped
// again (one request however many taps), and after about 3 seconds how long it can take.
export function ConfirmSubmit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <>
      <Button
        type="submit"
        variant="primary"
        className="btn-l"
        aria-busy={pending || undefined}
        disabled={pending}
        busyLabel={pending ? "Checking ESPN…" : undefined}
      >
        {label}
      </Button>
      {pending && (
        <div className="slow-later">
          <SlowNote>Up to 12 seconds a step.</SlowNote>
        </div>
      )}
    </>
  );
}
