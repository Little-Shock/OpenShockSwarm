"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { buildFirstStartJourney } from "@/lib/first-start-journey";
import { usePhaseZeroState } from "@/lib/live-phase0";

export default function HomePage() {
  const router = useRouter();
  const { state, loading } = usePhaseZeroState();

  useEffect(() => {
    if (loading) {
      return;
    }

    if (state.workspace.onboarding.status !== "done") {
      router.replace("/onboarding");
      return;
    }

    const journey = buildFirstStartJourney(state.workspace, state.auth.session);
    router.replace(journey.launchHref);
  }, [loading, router, state.auth.session, state.workspace]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--shock-paper)] px-6 text-[var(--shock-ink)]">
      <div className="rounded-[24px] border border-[rgba(24,20,14,0.14)] bg-white/86 px-6 py-5 shadow-[0_18px_44px_rgba(24,20,14,0.12)] backdrop-blur-xl">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[rgba(24,20,14,0.52)]">OpenShock</p>
        <p className="mt-2 text-sm leading-6 text-[rgba(24,20,14,0.72)]">正在为你打开正确的入口。</p>
      </div>
    </main>
  );
}
