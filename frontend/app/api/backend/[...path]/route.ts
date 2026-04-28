import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

import { INTERNAL_API_URL } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function buildCookieHeader() {
  return cookies()
    .getAll()
    .map((item) => `${item.name}=${item.value}`)
    .join("; ");
}

async function proxy(request: NextRequest, params: { path: string[] }) {
  const target = (params.path ?? []).join("/");
  const search = request.nextUrl.search || "";
  const headers = new Headers(request.headers);
  headers.set("cookie", request.headers.get("cookie") ?? buildCookieHeader());
  headers.delete("host");

  const requestInit: RequestInit & { duplex?: "half" } = {
    method: request.method,
    headers,
    body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
    cache: "no-store",
    redirect: "manual"
  };
  if (requestInit.body) {
    requestInit.duplex = "half";
  }

  const backendResponse = await fetch(`${INTERNAL_API_URL}/${target}${search}`, requestInit);

  const responseHeaders = new Headers(backendResponse.headers);
  responseHeaders.delete("content-encoding");
  responseHeaders.delete("content-length");
  responseHeaders.delete("transfer-encoding");

  return new NextResponse(backendResponse.body, {
    status: backendResponse.status,
    headers: responseHeaders
  });
}

export async function GET(request: NextRequest, { params }: { params: { path: string[] } }) {
  return proxy(request, params);
}

export async function POST(request: NextRequest, { params }: { params: { path: string[] } }) {
  return proxy(request, params);
}

export async function PUT(request: NextRequest, { params }: { params: { path: string[] } }) {
  return proxy(request, params);
}

export async function PATCH(request: NextRequest, { params }: { params: { path: string[] } }) {
  return proxy(request, params);
}

export async function DELETE(request: NextRequest, { params }: { params: { path: string[] } }) {
  return proxy(request, params);
}
