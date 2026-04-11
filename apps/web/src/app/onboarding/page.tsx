import { OnboardingExperience } from "@/components/onboarding-wizard";
import { LiveRuntimeProvider } from "@/lib/live-runtime";

export default function OnboardingPage() {
  return (
    <LiveRuntimeProvider>
      <OnboardingExperience />
    </LiveRuntimeProvider>
  );
}
