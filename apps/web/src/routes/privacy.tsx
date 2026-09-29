import { createFileRoute } from "@tanstack/react-router";
import { CONTACT_EMAIL, LegalPage } from "@/components/marketing/MarketingLayout";

export const Route = createFileRoute("/privacy")({
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <LegalPage title="Privacy policy" updated="29 September 2026">
      <p>
        This policy explains what information Fintranzact collects when you
        use our website and apps, how we use it, and the choices you have. By
        using Fintranzact you agree to this policy.
      </p>

      <h2>Information we collect</h2>
      <ul>
        <li><strong>Account details</strong> — your name, email address and/or phone number used to sign in.</li>
        <li><strong>Business data</strong> — information you enter to run your business, such as GSTINs, parties, items, invoices, payments and bank records.</li>
        <li><strong>Usage and device data</strong> — log data such as IP address, browser type and pages visited, used to keep the service secure and working.</li>
      </ul>

      <h2>How we use information</h2>
      <ul>
        <li>To provide, maintain and improve Fintranzact.</li>
        <li>To authenticate you and protect accounts against fraud and abuse.</li>
        <li>To send service messages such as sign-in codes, invitations and important account notices.</li>
        <li>To file or generate documents on your instruction, for example e-invoices and e-way bills through government systems.</li>
      </ul>

      <h2>Sharing</h2>
      <p>
        We do not sell your personal or business data. We share information
        only with service providers who help us run Fintranzact (such as
        hosting, email and SMS delivery), with government portals when you ask
        us to, or when required by law.
      </p>

      <h2>Data retention and export</h2>
      <p>
        We keep your data for as long as your account is active. You can
        export your data at any time from the app, and ask us to delete your
        account and associated data by contacting us.
      </p>

      <h2>Security</h2>
      <p>
        Data is encrypted in transit, access is restricted by role, and we
        follow industry practices to protect your information. No system is
        perfectly secure, so please keep your sign-in details safe.
      </p>

      <h2>Your rights</h2>
      <p>
        Subject to applicable law, including the Digital Personal Data
        Protection Act, 2023, you may request access to, correction of, or
        deletion of your personal data, and withdraw consent where processing
        is based on consent.
      </p>

      <h2>Changes to this policy</h2>
      <p>
        We may update this policy from time to time. We will post the new
        version on this page and update the date above.
      </p>

      <h2>Contact</h2>
      <p>
        For privacy questions or requests, email{" "}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>
    </LegalPage>
  );
}
