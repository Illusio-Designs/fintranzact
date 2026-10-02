import { Link } from "@tanstack/react-router";
import { MarketingLayout } from "@/components/marketing/MarketingLayout";

/** Shown for any URL that matches no page, signed in or not. */
export function NotFoundPage() {
  return (
    <MarketingLayout title="Page not found" description="The page you are looking for does not exist or has moved.">
      <section className="mx-auto flex max-w-xl flex-col items-center px-4 py-24 text-center">
        <p className="text-sm font-bold uppercase tracking-[0.12em] text-brand-600 dark:text-brand-300">Error 404</p>
        <h1 className="mt-3 font-display text-4xl font-extrabold tracking-tight text-text-primary">Page not found</h1>
        <p className="mt-3 text-base text-text-tertiary">
          The page you are looking for does not exist or has moved. Check the address, or head back to the home page.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link to="/" className="btn-primary px-5 py-2.5">
            Go to home
          </Link>
          <Link to="/contact" className="btn-secondary px-5 py-2.5">
            Contact us
          </Link>
        </div>
      </section>
    </MarketingLayout>
  );
}
