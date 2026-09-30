import { createFileRoute, Link } from "@tanstack/react-router";
import {
  CONTACT_EMAIL,
  GrievanceOfficerSection,
  LegalPage,
  RegisteredOffice,
} from "@/components/marketing/MarketingLayout";
import { LEGAL_ENTITY_NAME, LEGAL_LAST_UPDATED, PAYMENT_PROCESSOR } from "@/lib/legal";

export const Route = createFileRoute("/privacy")({
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy policy"
      updated={LEGAL_LAST_UPDATED}
      description="How Finvera Solutions LLP collects, uses and protects your data in Fintranzact, your rights under the DPDP Act, 2023 and how to reach our Grievance Officer."
    >
      <p>
        This policy explains what information Fintranzact collects when you
        use our website and apps, how we use it, and the choices you have. By
        using Fintranzact you agree to this policy.
      </p>

      <h2>Who we are</h2>
      <p>
        Fintranzact is a product operated by {LEGAL_ENTITY_NAME} ("we", "us",
        "our"). {LEGAL_ENTITY_NAME} decides how and why the personal data
        described in this policy is processed, so it is the data fiduciary for
        that data under the Digital Personal Data Protection Act, 2023. Our
        registered office is:
      </p>
      <RegisteredOffice />

      <h2>Information we collect</h2>
      <ul>
        <li><strong>Account details</strong> — your name, email address and/or phone number used to sign in.</li>
        <li><strong>Business data</strong> — information you enter to run your business, such as GSTINs, parties, items, invoices, payments and bank records.</li>
        <li><strong>Billing details</strong> — if you buy a paid plan, the plan, amount, date and payment status, and the payment reference we get back from {PAYMENT_PROCESSOR.name}.</li>
        <li><strong>Usage and device data</strong> — log data such as IP address, browser type and pages visited, used to keep the service secure and working.</li>
      </ul>

      <h2>How we use information</h2>
      <ul>
        <li>To provide, maintain and improve Fintranzact.</li>
        <li>To authenticate you and protect accounts against fraud and abuse.</li>
        <li>To send service messages such as sign-in codes, invitations and important account notices.</li>
        <li>To file or generate documents on your instruction, for example e-invoices and e-way bills through government systems.</li>
        <li>To bill you for a paid plan and to process any refund.</li>
      </ul>

      <h2>Sharing</h2>
      <p>
        We do not sell your personal or business data. We share information
        only with service providers who help us run Fintranzact (such as
        hosting, email and SMS delivery, and our payment gateway), with
        government portals when you ask us to, or when required by law.
      </p>

      <h2>Payments</h2>
      <p>
        Subscription payments are processed by {PAYMENT_PROCESSOR.name}
        {" "}({PAYMENT_PROCESSOR.legalName}). You enter your card, UPI or bank
        details on {PAYMENT_PROCESSOR.name}'s secure checkout, and
        Fintranzact does not store your full card number, UPI details or bank
        account details. We only keep what we need to record the payment,
        such as the amount, date, status and payment reference.
        {" "}{PAYMENT_PROCESSOR.name}'s own terms and privacy policy apply to
        the payment information it handles.
      </p>

      <h2>Data retention and export</h2>
      <p>
        We keep your data for as long as your account is active. You can
        export your data at any time from the app, and ask us to delete your
        account and associated data by contacting us. We may keep billing
        records for as long as tax and accounting laws require.
      </p>

      <h2>Security</h2>
      <p>
        Data is encrypted in transit, access is restricted by role, and we
        follow industry practices to protect your information. No system is
        perfectly secure, so please keep your sign-in details safe. Read more
        on our <Link to="/security">security page</Link>.
      </p>

      <h2>Your rights</h2>
      <p>
        Subject to applicable law, including the Digital Personal Data
        Protection Act, 2023, you can:
      </p>
      <ul>
        <li>ask for a summary of the personal data we hold about you and how we use it;</li>
        <li>ask us to correct, complete, update or delete your personal data;</li>
        <li>withdraw consent where we rely on your consent, without affecting what was done before;</li>
        <li>nominate someone to exercise these rights for you if you die or become unable to; and</li>
        <li>raise a complaint with our Grievance Officer (details below).</li>
      </ul>
      <p>
        To use any of these rights, email{" "}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> or contact our
        Grievance Officer. If you are not satisfied with how we handle your
        complaint, you can then approach the Data Protection Board of India.
      </p>

      <GrievanceOfficerSection>
        <p>
          If you have a concern or complaint about how {LEGAL_ENTITY_NAME}
          {" "}handles your personal data, or about anything else on
          Fintranzact, you can write to or call our Grievance Officer,
          appointed under the Information Technology Act, 2000, the
          Information Technology (Intermediary Guidelines and Digital Media
          Ethics Code) Rules, 2021 and the Digital Personal Data Protection
          Act, 2023. They can also answer your questions about how we process
          your personal data.
        </p>
      </GrievanceOfficerSection>

      <h2>Changes to this policy</h2>
      <p>
        We may update this policy from time to time. We will post the new
        version on this page and update the date above.
      </p>

      <h2>Contact</h2>
      <p>
        For privacy questions or requests, email{" "}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>, or use the
        Grievance Officer details above. You can find all the ways to reach
        us on our <Link to="/contact">contact page</Link>.
      </p>
    </LegalPage>
  );
}
