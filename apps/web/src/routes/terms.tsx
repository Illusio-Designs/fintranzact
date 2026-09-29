import { createFileRoute, Link } from "@tanstack/react-router";
import { CONTACT_EMAIL, LegalPage } from "@/components/marketing/MarketingLayout";

export const Route = createFileRoute("/terms")({
  component: TermsPage,
});

function TermsPage() {
  return (
    <LegalPage title="Terms of service" updated="29 September 2026">
      <p>
        These terms govern your use of Fintranzact's website, web app,
        desktop and mobile apps and API (the "Service"). By creating an
        account or using the Service you agree to these terms.
      </p>

      <h2>Your account</h2>
      <ul>
        <li>You must provide accurate information and keep your sign-in details secure.</li>
        <li>You are responsible for activity under your account, including by team members you invite.</li>
        <li>You must be legally able to enter into a contract to use the Service.</li>
      </ul>

      <h2>Your data</h2>
      <p>
        You own the business data you put into Fintranzact. You give us
        permission to store and process it only as needed to provide the
        Service. See our <Link to="/privacy">privacy policy</Link> for details.
      </p>

      <h2>Acceptable use</h2>
      <ul>
        <li>Do not use the Service for unlawful activity, including issuing fake invoices or evading tax.</li>
        <li>Do not attempt to break, overload or gain unauthorised access to the Service.</li>
        <li>Do not resell the Service without our written permission.</li>
      </ul>

      <h2>Tax and compliance</h2>
      <p>
        Fintranzact helps you prepare invoices, returns and other documents,
        but you remain responsible for the accuracy of the information you
        enter and for your filings with tax authorities. The Service is not a
        substitute for professional tax or legal advice.
      </p>

      <h2>Plans and payment</h2>
      <p>
        Some features may require a paid plan. Prices and plan contents are
        shown on our <Link to="/pricing">pricing page</Link> or in your quote.
        Refunds are covered by our <Link to="/refund-policy">refund policy</Link>.
      </p>

      <h2>Availability</h2>
      <p>
        We work to keep the Service available and reliable but do not
        guarantee uninterrupted access. We may change or discontinue features
        with reasonable notice.
      </p>

      <h2>Limitation of liability</h2>
      <p>
        To the extent permitted by law, Fintranzact is not liable for indirect
        or consequential losses, and our total liability is limited to the
        amount you paid us in the twelve months before the claim.
      </p>

      <h2>Termination</h2>
      <p>
        You can stop using the Service at any time. We may suspend or close
        accounts that breach these terms. You can export your data before your
        account is closed.
      </p>

      <h2>Governing law</h2>
      <p>These terms are governed by the laws of India.</p>

      <h2>Contact</h2>
      <p>
        Questions about these terms? Email{" "}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>
    </LegalPage>
  );
}
