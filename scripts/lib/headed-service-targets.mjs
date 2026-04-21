function normalizeURL(value) {
  return value.trim().replace(/\/+$/, "");
}

function isLoopbackURL(value) {
  try {
    const { hostname } = new URL(value);
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
  } catch {
    return false;
  }
}

function ensureNoProxyForLoopback(urls) {
  if (!urls.some((url) => url && isLoopbackURL(url))) {
    return;
  }

  const entries = new Set(
    `${process.env.NO_PROXY || process.env.no_proxy || ""}`
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
  );
  for (const host of ["localhost", "127.0.0.1", "::1"]) {
    entries.add(host);
  }

  const value = [...entries].join(",");
  process.env.NO_PROXY = value;
  process.env.no_proxy = value;
}

export function resolveProvidedServiceTargets(args, { requireServerURL = false } = {}) {
  let webURL = "";
  let serverURL = "";
  let daemonURL = "";

  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--web-url") {
      webURL = args[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (args[index] === "--server-url") {
      serverURL = args[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (args[index] === "--daemon-url") {
      daemonURL = args[index + 1] ?? "";
      index += 1;
    }
  }

  webURL = normalizeURL(webURL || process.env.OPENSHOCK_E2E_WEB_URL || "");
  serverURL = normalizeURL(serverURL || process.env.OPENSHOCK_E2E_SERVER_URL || "");
  daemonURL = normalizeURL(daemonURL || process.env.OPENSHOCK_E2E_DAEMON_URL || "");

  if (!webURL && !serverURL) {
    return null;
  }

  if (!webURL) {
    throw new Error("external headed mode requires --web-url or OPENSHOCK_E2E_WEB_URL");
  }

  if (requireServerURL && !serverURL) {
    throw new Error("external headed mode requires --server-url or OPENSHOCK_E2E_SERVER_URL");
  }

  ensureNoProxyForLoopback([webURL, serverURL, daemonURL]);

  return {
    webURL,
    serverURL,
    daemonURL,
  };
}
