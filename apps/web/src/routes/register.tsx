import { createFileRoute } from "@tanstack/react-router";
import { AuthScreen, validateAuthSearch } from "@/components/auth/AuthScreen";

export const Route = createFileRoute("/register")({
  validateSearch: validateAuthSearch,
  component: RegisterPage,
});

function RegisterPage() {
  return <AuthScreen mode="register" search={Route.useSearch()} />;
}
