import { Suspense } from "react";

import { StitchInboxView } from "@/components/stitch-board-inbox-views";

export default function InboxPage() {
  return (
    <Suspense fallback={null}>
      <StitchInboxView />
    </Suspense>
  );
}
