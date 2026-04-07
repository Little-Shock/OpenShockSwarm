import { NextRequest, NextResponse } from "next/server";

const CONTROL_API_BASE =
  process.env.OPENSHOCK_CONTROL_API_BASE ??
  process.env.NEXT_PUBLIC_OPENSHOCK_API_BASE ??
  "http://127.0.0.1:8080";

export const dynamic = "force-dynamic";

function buildTargetURL(request: NextRequest, path: string[]) {
  const normalizedBase = CONTROL_API_BASE.endsWith("/")
    ? CONTROL_API_BASE.slice(0, -1)
    : CONTROL_API_BASE;
  const url = new URL(`${normalizedBase}/${path.join("/")}`);

  request.nextUrl.searchParams.forEach((value, key) => {
    url.searchParams.set(key, value);
  });

  return url;
}

async function proxy(request: NextRequest, path: string[]) {
  const targetURL = buildTargetURL(request, path);
  const headers = new Headers(request.headers);
  headers.delete("host");

  const init: RequestInit = {
    method: request.method,
    headers,
    redirect: "manual",
    cache: "no-store",
  };

  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = await request.arrayBuffer();
  }

  const response = await fetch(targetURL, init);
  const responseHeaders = new Headers(response.headers);

  return new NextResponse(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  return proxy(request, path);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  return proxy(request, path);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  return proxy(request, path);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  return proxy(request, path);
}

export async function OPTIONS(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  return proxy(request, path);
}
