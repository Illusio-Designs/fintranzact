import { createFileRoute, redirect } from "@tanstack/react-router";
import { AuthScreen, validateAuthSearch, type AuthSearch } from "@/components/auth/AuthScreen";

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>): AuthSearch & { mode?: string } => ({
    ...validateAuthSearch(search),
    ...(typeof search.mode === "string" ? { mode: search.mode } : {}),
  }),
  // Old links used /login?mode=register for sign-up; that page is /register now.
  beforeLoad: ({ search }) => {
    if (search.mode === "register") {
      const { mode: _mode, ...rest } = search;
      throw redirect({ to: "/register", search: rest, replace: true });
    }
  },
  component: LoginPage,
});

function LoginPage() {
  const { mode: _mode, ...search } = Route.useSearch();
  return <AuthScreen mode="login" search={search} />;
}
