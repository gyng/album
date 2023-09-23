// Vercel has a bug with COEP headers not applying to the sqlite dep,
// Even after setting it in next.config.js
// COEP is needed for search/Workers for SharedArrayBuffer
import { NextResponse, type NextRequest } from "next/server";

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (
    pathname.startsWith("/_next/static/chunks/node_modules_sqlite-wasm-http")
  ) {
    const response = NextResponse.next();

    response.headers.set("Cross-Origin-Embedder-Policy", "require-corp");
    response.headers.set("X-Album-Vercel-Middleware", "1");

    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/_next/static/chunks/:rest*"],
};
