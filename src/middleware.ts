import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) => {
          for (const { name, value, options } of cookiesToSet) {
            request.cookies.set(name, value);
            response.cookies.set({ name, value, ...(options as Record<string, unknown>) });
          }
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;

  // Rotas livres
  if (
    path === "/" ||
    path.startsWith("/motorista/login") ||
    path.startsWith("/admin/login") ||
    path.startsWith("/_next") ||
    path.startsWith("/api/health") ||
    path === "/manifest.json" ||
    path === "/sw.js" ||
    path.startsWith("/icons")
  ) {
    return response;
  }

  // Protegidas
  if (path.startsWith("/motorista") && !user) {
    return NextResponse.redirect(new URL("/motorista/login", request.url));
  }

  if (path.startsWith("/admin") && !user) {
    return NextResponse.redirect(new URL("/admin/login", request.url));
  }

  // Validação de role para /admin
  if (path.startsWith("/admin") && user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role, ativo")
      .eq("id", user.id)
      .maybeSingle();

    if (!profile || profile.role !== "admin" || !profile.ativo) {
      await supabase.auth.signOut();
      return NextResponse.redirect(new URL("/admin/login?erro=acesso", request.url));
    }
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
