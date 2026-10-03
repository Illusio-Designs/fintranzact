import { createFileRoute } from "@tanstack/react-router";
import { CONTACT_EMAIL, EmailText, LegalPage, RegisteredOffice } from "@/components/marketing/MarketingLayout";
import {
  LEGAL_EMAIL,
  LEGAL_ENTITY_NAME,
  LEGAL_LAST_UPDATED,
  LEGAL_PHONE,
  LEGAL_PHONE_HREF,
  PAYMENT_PROCESSOR,
  REFUND_CREDIT_TIME,
} from "@/lib/legal";

export const Route = createFileRoute("/refund-policy")({
  component: RefundPolicyPage,
});

function RefundPolicyPage() {
  return (
    <LegalPage
      title="Refund & cancellation policy"
      updated={LEGAL_LAST_UPDATED}
      description="How to cancel a paid Fintranzact plan, when Finvera Solutions LLP gives refunds, and how refunds go back through Razorpay to your original payment method."
    >
      <p>
        Fintranzact is operated by {LEGAL_ENTITY_NAME} ("we", "us"), which
        sells Fintranzact's paid plans and handles cancellations and refunds
        under this policy. The 14-day free trial costs nothing, so no payment
        or refund applies to it. This policy covers paid plans.
      </p>

      <h2>Cancellation</h2>
      <p>
        You can cancel a paid plan at any time by contacting us. Your plan
        stays active until the end of the current billing period, after which
        your organization becomes read-only until you choose a plan again. Your data is not deleted.
      </p>

      <h2>Refunds</h2>
      <ul>
        <li>If you are charged in error, or charged twice, we will refund the extra amount in full.</li>
        <li>Refund requests for a new paid plan made within 7 days of the first payment are refunded in full.</li>
        <li>Other partial-period refunds are not provided unless required by law or agreed in your contract.</li>
      </ul>

      <h2>How refunds are paid</h2>
      <p>
        Payments for paid plans are processed by {PAYMENT_PROCESSOR.name}
        {" "}({PAYMENT_PROCESSOR.legalName}), and Fintranzact does not store
        your full card, UPI or bank details. An approved refund is sent back
        through {PAYMENT_PROCESSOR.name} to the card, UPI account or bank
        account you paid with. It normally reaches you within
        {" "}{REFUND_CREDIT_TIME} of approval; the exact time depends on your
        bank or card issuer.
      </p>

      <h2>Contact</h2>
      <p>
        To cancel or request a refund, email{" "}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> with your
        organization name and the date and amount of the payment. Please
        never send card numbers or UPI PINs by email. You can also reach
        {" "}{LEGAL_ENTITY_NAME} at{" "}
        <a href={`mailto:${LEGAL_EMAIL}`}><EmailText email={LEGAL_EMAIL} /></a>
        {" "}or <a href={LEGAL_PHONE_HREF}>{LEGAL_PHONE}</a>, or write to our
        registered office:
      </p>
      <RegisteredOffice />
    </LegalPage>
  );
}
