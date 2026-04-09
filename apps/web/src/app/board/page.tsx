import { Suspense } from "react";

import { StitchBoardView } from "@/components/stitch-board-inbox-views";

export default function BoardPage() {
  return (
    <Suspense fallback={null}>
      <StitchBoardView />
    </Suspense>
  );
}
