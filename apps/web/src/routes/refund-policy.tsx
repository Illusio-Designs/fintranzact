import { createFileRoute } from "@tanstack/react-router";
import { CONTACT_EMAIL, LegalPage } from "@/components/marketing/MarketingLayout";

export const Route = createFileRoute("/refund-policy")({
  component: RefundPolicyPage,
});

function RefundPolicyPage() {
  return (
    <LegalPage title="Refund & cancellation policy" updated="29 September 2026">
      <p>
        Fintranzact's Forever Free plan costs nothing, so no payment or refund
        applies to it. This policy covers paid plans.
      </p>

      <h2>Cancellation</h2>
      <p>
        You can cancel a paid plan at any time by contacting us. Your plan
        stays active until the end of the current billing period, after which
        your organization moves to the free plan. Your data is not deleted.
      </p>

      <h2>Refunds</h2>
      <ul>
        <li>If you are charged in error, or charged twice, we will refund the extra amount in full.</li>
        <li>Refund requests for a new paid plan made within 7 days of the first payment are refunded in full.</li>
        <li>Other partial-period refunds are not provided unless required by law or agreed in your contract.</li>
      </ul>

      <h2>How refunds are paid</h2>
      <p>
        Approved refunds go back to the original payment method, normally
        within 5–7 business days of approval, depending on your bank.
      </p>

      <h2>Contact</h2>
      <p>
        To cancel or request a refund, email{" "}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> with your
        organization name and payment details.
      </p>
    </LegalPage>
  );
}
