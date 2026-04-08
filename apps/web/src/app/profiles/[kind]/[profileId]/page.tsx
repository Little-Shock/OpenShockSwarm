import { notFound } from "next/navigation";

import { LiveProfilePageContent } from "@/components/live-profile-views";
import { isProfileKind } from "@/lib/profile-surface";

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ kind: string; profileId: string }>;
}) {
  const { kind, profileId } = await params;
  if (!isProfileKind(kind)) {
    notFound();
  }
  return <LiveProfilePageContent kind={kind} profileId={profileId} />;
}
