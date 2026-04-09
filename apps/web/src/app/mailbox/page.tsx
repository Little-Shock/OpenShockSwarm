import { Suspense } from "react";

import { LiveMailboxPageContent } from "@/components/live-mailbox-views";

export default function MailboxPage() {
  return (
    <Suspense fallback={null}>
      <LiveMailboxPageContent />
    </Suspense>
  );
}
