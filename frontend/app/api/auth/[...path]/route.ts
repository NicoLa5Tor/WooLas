import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

import { INTERNAL_API_URL } from "@/lib/api";

export async function POST(request: NextRequest, { params }: { params: { path: string[] } }) {
  const segments = params.path ?? [];
  const target = segments.join("/") || "login";
  const body = await request.json().catch(() => ({}));

  const backendResponse = await fetch(`${INTERNAL_API_URL}/api/auth/${target}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: request.headers.get("cookie") ?? "" },
    body: JSON.stringify(target === "login" ? { username: body.username, password: body.password } : {})
  });

  const payload = await backendResponse.json();
  const response = NextResponse.json(payload, { status: backendResponse.status });
  const setCookie = backendResponse.headers.get("set-cookie");
  if (setCookie) {
    response.headers.set("set-cookie", setCookie);
  }
  return response;
}

export async function GET(_: NextRequest, { params }: { params: { path: string[] } }) {
  const target = (params.path ?? []).join("/");
  const cookieStore = cookies();
  const cookieHeader = cookieStore
    .getAll()
    .map((item) => `${item.name}=${item.value}`)
    .join("; ");

  const backendResponse = await fetch(`${INTERNAL_API_URL}/api/auth/${target}`, {
    headers: { cookie: cookieHeader },
    cache: "no-store"
  });
  const payload = await backendResponse.json();
  return NextResponse.json(payload, { status: backendResponse.status });
}
