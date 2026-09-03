import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

function safeNextPath(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/dashboard";
  return value;
}

function redirectWithCookies(url: URL, source: NextResponse) {
  const redirect = NextResponse.redirect(url);
  source.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
  return redirect;
}

export async function middleware(request: NextRequest) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
    return NextResponse.next();
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  // Refresh the Supabase session on normal page visits so people stay signed in
  // across browser restarts until they explicitly log out or the refresh session expires.
  const { data } = await supabase.auth.getUser();
  const pathname = request.nextUrl.pathname;
  const protectedRoute = pathname.startsWith("/dashboard") || pathname.startsWith("/room") || pathname.startsWith("/account");

  if (protectedRoute && !data.user) {
    const url = request.nextUrl.clone();
    const requestedPath = `${pathname}${request.nextUrl.search}`;
    url.pathname = "/auth";
    url.search = "";
    url.searchParams.set("next", requestedPath);
    return redirectWithCookies(url, response);
  }

  if (data.user && pathname === "/auth") {
    const url = request.nextUrl.clone();
    const nextPath = safeNextPath(request.nextUrl.searchParams.get("next"));
    url.pathname = nextPath.split("?")[0];
    url.search = nextPath.includes("?") ? `?${nextPath.split("?").slice(1).join("?")}` : "";
    return redirectWithCookies(url, response);
  }

  if (data.user && pathname === "/") {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return redirectWithCookies(url, response);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
