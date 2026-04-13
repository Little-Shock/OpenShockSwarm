import { PullRequestDetailView } from "@/components/pull-request-detail-view";
import type { PullRequestDetail } from "@/lib/phase-zero-types";

const CONTROL_API_BASE =
  process.env.OPENSHOCK_CONTROL_API_BASE ??
  process.env.NEXT_PUBLIC_OPENSHOCK_API_BASE ??
  "http://127.0.0.1:8080";

export const dynamic = "force-dynamic";

export default async function PullRequestPage({
  params,
}: {
  params: Promise<{ pullRequestId: string }>;
}) {
  const { pullRequestId } = await params;
  const targetURL = new URL(`/v1/pull-requests/${pullRequestId}/detail`, CONTROL_API_BASE);

  let detail: PullRequestDetail | null = null;
  let error: string | null = null;

  try {
    const response = await fetch(targetURL, {
      cache: "no-store",
    });
    const payload = (await response.json()) as PullRequestDetail & { error?: string };
    if (!response.ok) {
      throw new Error(payload.error || `拉取请求详情读取失败：${response.status}`);
    }
    detail = payload;
  } catch (detailError) {
    error = detailError instanceof Error ? detailError.message : "拉取请求详情读取失败";
  }

  return <PullRequestDetailView detail={detail} error={error} />;
}
