import type { RuntimeProviderStatus } from "@/lib/phase-zero-types";

type RuntimeProviderHealthLike = Pick<
  RuntimeProviderStatus,
  "id" | "label" | "ready" | "status" | "statusMessage" | "checkedAt"
>;
type RuntimeProviderHealthInput = Partial<RuntimeProviderHealthLike> & {
  label?: string;
};

export function runtimeProviderHealthStatus(provider: RuntimeProviderHealthInput) {
  const status = provider.status?.trim();
  if (status) {
    return status;
  }
  return provider.ready === false ? "degraded" : "ready";
}

export function runtimeProviderHealthLabel(status: string) {
  switch (status) {
    case "ready":
      return "已就绪";
    case "auth_required":
      return "未登录";
    case "unavailable":
      return "未安装";
    case "degraded":
      return "异常";
    default:
      return "待确认";
  }
}

export function runtimeProviderHealthTone(status: string) {
  switch (status) {
    case "ready":
      return "lime";
    case "auth_required":
    case "unavailable":
      return "yellow";
    case "degraded":
      return "pink";
    default:
      return "paper";
  }
}

export function runtimeProviderHealthSummary(provider: RuntimeProviderHealthInput) {
  const message = provider.statusMessage?.trim();
  if (message) {
    return message;
  }

  switch (runtimeProviderHealthStatus(provider)) {
    case "ready":
      return `${provider.label || provider.id || "当前模型服务"}已就绪，可直接发送。`;
    case "auth_required":
      return `${provider.label || provider.id || "当前模型服务"}还没有登录，请先在本机完成登录。`;
    case "unavailable":
      return `${provider.label || provider.id || "当前模型服务"}当前未安装，请先补齐本地 CLI。`;
    case "degraded":
      return `${provider.label || provider.id || "当前模型服务"}最近检查异常，请先处理后再发消息。`;
    default:
      return "当前模型服务状态还没确认。";
  }
}

export function runtimeProviderIsReady(provider: RuntimeProviderHealthInput) {
  return runtimeProviderHealthStatus(provider) === "ready";
}

export function runtimeProviderBlockingReason(providers: RuntimeProviderHealthInput[]) {
  if (providers.length === 0) {
    return "当前运行环境还没有返回可用模型服务。";
  }

  if (providers.some(runtimeProviderIsReady)) {
    return "";
  }

  const authRequired = providers.find((provider) => runtimeProviderHealthStatus(provider) === "auth_required");
  if (authRequired) {
    return "当前运行环境还没有已登录的模型服务，请先到设置页完成登录。";
  }

  const unavailable = providers.find((provider) => runtimeProviderHealthStatus(provider) === "unavailable");
  if (unavailable) {
    return "当前运行环境还没有安装可用模型 CLI，请先补齐本地连接。";
  }

  const degraded = providers.find((provider) => runtimeProviderHealthStatus(provider) === "degraded");
  if (degraded) {
    return "当前运行环境最近一次状态检查异常，请稍后重试或切换模型服务。";
  }

  return "当前运行环境还没有可直接发送的模型服务。";
}
