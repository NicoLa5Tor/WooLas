import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const publicPaths = ["/login"];
  const isPublic = publicPaths.some((path) => pathname === path || pathname.startsWith("/_next") || pathname.startsWith("/favicon"));

  const token = request.cookies.get("access_token");
  if (!token && !isPublic) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"]
};
