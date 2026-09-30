import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { InputField } from "@/components/ui/FormField";
import { Combobox } from "@/components/ui/Combobox";
import { COUNTRIES } from "@/components/ui/PhoneInput";
import { Listbox } from "@/components/ui/Listbox";
import { Select } from "@/components/ui/Select";
import { toast } from "@/hooks/useToast";
import { GstinInput } from "./GstinInput";
import { PanInput } from "./PanInput";
import { PincodeInput } from "./PincodeInput";
import { INDIAN_STATES } from "@/lib/indian-states";
import { LogoUploader, type PendingImage } from "./LogoUploader";

import { PhoneInput } from "@/components/ui/PhoneInput";
import { Icon } from "@/components/ui/Icon";
import { Logo } from "@/components/ui/Logo";
import { cn } from "@/lib/utils";
import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  InformationCircleIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
const GST_REG_OPTIONS = [
  { value: "unregistered", label: "Not GST Registered" },
  { value: "regular", label: "GST Regular" },
  { value: "composition", label: "GST Composition Scheme" },
];

const BUSINESS_TYPE_OPTIONS = [
  { value: "proprietorship", label: "Proprietorship" },
  { value: "partnership", label: "Partnership" },
  { value: "llp", label: "Limited Liability Partnership (LLP)" },
  { value: "private_limited", label: "Private Limited Company" },
  { value: "public_limited", label: "Public Limited Company" },
  { value: "one_person_company", label: "One Person Company (OPC)" },
  { value: "huf", label: "HUF" },
  { value: "trust", label: "Trust" },
  { value: "society", label: "Society" },
  { value: "other", label: "Other" },
];

export interface BusinessStepValues {
  name: string;
  legalName: string;
  businessType: string;

  phone: string;
  email: string;
  address: string;
  addressLine1: string;
  addressLine2: string;
  landmark: string;
  countryOfOperations: string;
  financialYearStartDate: string;
  city: string;
  stateName: string;
  stateCode: string;
  pincode: string;

  currency: string;
  invoicePrefix: string;
  paymentPrefix: string;
  quotationPrefix: string;
  creditNotePrefix: string;
  deliveryChallanPrefix: string;
  proformaPrefix: string;
  defaultRoundOff: boolean;
  defaultTermsAndConditions: string;

  gstRegType: string;
  gstin: string;
  pan: string;
  tan: string;
  cin: string;
  llpin: string;
  udyamNumber: string;
  iecCode: string;
  lutArn: string;
  eInvoiceEnabled: boolean;
  eWayBillEnabled: boolean;
  assesseeOfOtherTerritory: boolean;
  gstReturnPeriodicity: string;
  eWayBillThreshold: number | null;

  deductorType: string;
  responsiblePersonName: string;
  responsiblePersonPan: string;
  responsiblePersonDesignation: string;
}

export function validateBusinessStep(
  step: number,
  values: BusinessStepValues,
) {
  const errors: Record<string, string> = {};

  const panPattern = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
  const gstinPattern =
    /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

  switch (step) {
    case 0:
      if (!values.name.trim()) {
        errors.name = "Business name is required";
      }

      if (!values.phone.trim()) {
        errors.phone = "Phone number is required";
      }

      if (
        values.email.trim() &&
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)
      ) {
        errors.email = "Enter a valid email address";
      }

      if (!values.address.trim()) {
        errors.address = "Address is required";
      }

      if (!values.pincode.trim()) {
        errors.pincode = "Pincode is required";
      }

      if (!values.city.trim()) {
        errors.city = "City is required";
      }

      if (!values.stateName.trim()) {
        errors.stateName = "State is required";
      }

      break;

    case 1:
      if (values.gstRegType !== "unregistered") {
        if (!values.gstin.trim()) {
          errors.gstin = "GSTIN is required for GST-registered businesses";
        } else if (!gstinPattern.test(values.gstin)) {
          errors.gstin = "Invalid GSTIN format";
        }
      }

      // PAN sits with GSTIN on this step — the GSTIN embeds it.
      if (!values.pan.trim()) {
        errors.pan = "PAN is required";
      } else if (!panPattern.test(values.pan)) {
        errors.pan = "Invalid PAN format";
      }
      break;

    case 2:
      if (
        values.tan.trim() &&
        values.responsiblePersonPan.trim() &&
        !panPattern.test(values.responsiblePersonPan)
      ) {
        errors.responsiblePersonPan = "Invalid PAN format";
      }
      break;

    default:
      break;
  }

  return errors;
}

interface BusinessTabProps {
  biz: any;
}

export function BusinessTab({ biz }: BusinessTabProps) {
  const [editing, setEditing] = useState(false);

  return (
    <div className="space-y-6">
      {editing ? (
        <BusinessForm existing={biz} onDone={() => setEditing(false)} />
      ) : (
        <BusinessCard biz={biz} onEdit={() => setEditing(true)} />
      )}

      <LogoUploader
        businessId={biz.id}
        logoUpdatedAt={biz.logoUpdatedAt}
        hasLogo={!!biz.logoMimeType}
      />
    </div>
  );
}

function BusinessCard({
  biz,
  onEdit,
}: {
  biz: any;
  onEdit: () => void;
}) {
  const fields: [string, string | undefined | null][] = [
    ["Business Type", biz.businessType],
    ["Legal Name", biz.legalName],
    ["GSTIN", biz.gstin],
    ["PAN", biz.pan],
    ["TAN", biz.tan],
    ["CIN", biz.cin],
    ["LLPIN", biz.llpin],
    ["Udyam Number", biz.udyamNumber],
    ["IEC Code", biz.iecCode],
    ["LUT ARN", biz.lutArn],
    ["Phone", biz.phone],
    ["Email", biz.email],
    ["Address", biz.address],
    ["City", biz.city],
    ["State", biz.state],
    ["Pincode", biz.pincode],
    ["Currency", biz.currency],
  ];

  return (
    <div className="card p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold text-text-primary">
          {biz.name}
        </h3>

        <button className="btn-secondary" onClick={onEdit}>
          Edit
        </button>
      </div>

      <div className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
        {fields.map(([label, value]) => (
          <div key={label}>
            <span className="text-xs text-text-tertiary">{label}</span>

            <p
              className={
                value ? "text-text-primary" : "text-text-tertiary"
              }
            >
              {value || "—"}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Short descriptions shown in the onboarding stepper, one per wizard step. */
const WIZARD_STEP_HINTS: Array<{ sub: string; intro: string }> = [
  { sub: "Name, contact and address", intro: "The basics that appear on your invoices." },
  { sub: "GSTIN and filing", intro: "Add your GST registration and how you file returns." },
  { sub: "TAN and TDS", intro: "TAN and TDS details if you deduct tax at source." },
  { sub: "Prefixes, logo and signature", intro: "How your documents are numbered and branded. You can change all of it later." },
  { sub: "Check and confirm", intro: "Make sure everything looks right before we create your business." },
];

export function BusinessForm({
  existing,
  onDone,
  onboardingMode = false,
}: {
  existing?: any;
  onDone: (name?: string) => void;
  onboardingMode?: boolean;
}) {
  // ------------------------------------------------------------
  // General business details
  // ------------------------------------------------------------

  const [name, setName] = useState(existing?.name || "");
  const [legalName, setLegalName] = useState(existing?.legalName || "");
  const [businessType, setBusinessType] = useState(
    existing?.businessType || "proprietorship",
  );

  const [phone, setPhone] = useState(existing?.phone || "");
  const [email, setEmail] = useState(existing?.email || "");
  const [addressLine1, setAddressLine1] = useState(
    existing?.addressLine1 || existing?.address || "",
  );
  const [addressLine2, setAddressLine2] = useState(
    existing?.addressLine2 || "",
  );
  const [landmark, setLandmark] = useState(existing?.landmark || "");

  const [city, setCity] = useState(existing?.city || "");
  const [stateName, setStateName] = useState(existing?.state || "");
  const [stateCode, setStateCode] = useState(existing?.stateCode || "");
  const [pincode, setPincode] = useState(existing?.pincode || "");

  const [countryOfOperations, setCountryOfOperations] = useState(
    existing?.countryOfOperations || "India",
  );

  const [financialYearStartDate, setFinancialYearStartDate] = useState(
    existing?.financialYearStartDate || "",
  );

  const [currency, setCurrency] = useState(existing?.currency || "INR");

  const [invoicePrefix, setInvoicePrefix] = useState(
    existing?.invoicePrefix || "INV",
  );
  const [paymentPrefix, setPaymentPrefix] = useState(
    existing?.paymentPrefix || "PAY",
  );
  const [quotationPrefix, setQuotationPrefix] = useState(
    existing?.quotationPrefix || "QTN",
  );
  const [creditNotePrefix, setCreditNotePrefix] = useState(
    existing?.creditNotePrefix || "CN",
  );
  const [deliveryChallanPrefix, setDeliveryChallanPrefix] = useState(
    existing?.deliveryChallanPrefix || "DC",
  );
  const [proformaPrefix, setProformaPrefix] = useState(
    existing?.proformaPrefix || "PI",
  );
  const [debitNotePrefix, setDebitNotePrefix] = useState(
    existing?.debitNotePrefix || "DN",
  );
  const [salesReturnPrefix, setSalesReturnPrefix] = useState(
    existing?.salesReturnPrefix || "SR",
  );
  const [purchaseReturnPrefix, setPurchaseReturnPrefix] = useState(
    existing?.purchaseReturnPrefix || "PR",
  );
  const [salesOrderPrefix, setSalesOrderPrefix] = useState(
    existing?.salesOrderPrefix || "SO",
  );
  const [purchaseOrderPrefix, setPurchaseOrderPrefix] = useState(
    existing?.purchaseOrderPrefix || "PO",
  );
  const [goodsReceiptNotePrefix, setGoodsReceiptNotePrefix] = useState(
    existing?.goodsReceiptNotePrefix || "GRN",
  );
  const [annualTurnover, setAnnualTurnover] = useState(
    existing?.annualTurnover != null ? String(existing.annualTurnover) : "",
  );

  const [defaultRoundOff, setDefaultRoundOff] = useState(
    existing?.defaultRoundOff ?? true,
  );

  const [defaultTermsAndConditions, setDefaultTermsAndConditions] =
    useState(existing?.defaultTermsAndConditions || "");

  // ------------------------------------------------------------
  // Statutory details
  // ------------------------------------------------------------

  const [gstRegType, setGstRegType] = useState(
    existing?.gstRegistrationType || "unregistered",
  );

  const [gstin, setGstin] = useState(existing?.gstin || "");
  const [pan, setPan] = useState(existing?.pan || "");
  // PAN last auto-filled from the GSTIN — lets a corrected GSTIN update the
  // PAN again without overwriting a PAN the user typed by hand.
  const [autoPan, setAutoPan] = useState<string | null>(null);
  const [tan, setTan] = useState(existing?.tan || "");
  const [cin, setCin] = useState(existing?.cin || "");
  const [llpin, setLlpin] = useState(existing?.llpin || "");
  const [udyamNumber, setUdyamNumber] = useState(
    existing?.udyamNumber || "",
  );
  const [iecCode, setIecCode] = useState(existing?.iecCode || "");
  const [lutArn, setLutArn] = useState(existing?.lutArn || "");

  const [eInvoiceEnabled, setEInvoiceEnabled] = useState(
    existing?.eInvoiceEnabled ?? false,
  );

  const [eWayBillEnabled, setEWayBillEnabled] = useState(
    existing?.eWayBillEnabled ?? false,
  );

  // Compliance portal logins. Stored in e_invoice_configs / eway_bill_configs,
  // never sent back to the client, so these always start blank — leaving them
  // blank on an edit keeps whatever is already saved.
  // Logo and signature picked during creation. There is no business id to
  // upload against yet, so they ride along in state and get sent the moment
  // the create mutation returns one.
  const [pendingLogo, setPendingLogo] = useState<PendingImage | null>(null);
  const [pendingSignature, setPendingSignature] = useState<PendingImage | null>(null);

  const [eInvoiceUsername, setEInvoiceUsername] = useState("");
  const [eInvoicePassword, setEInvoicePassword] = useState("");
  const [eWayBillUsername, setEWayBillUsername] = useState("");
  const [eWayBillPassword, setEWayBillPassword] = useState("");

  const [assesseeOfOtherTerritory, setAssesseeOfOtherTerritory] =
    useState(existing?.assesseeOfOtherTerritory ?? false);

  const [gstReturnPeriodicity, setGstReturnPeriodicity] = useState<
    "monthly" | "quarterly"
  >(existing?.gstReturnPeriodicity ?? "monthly");

  const [eWayBillThreshold, setEWayBillThreshold] = useState(
    existing?.eWayBillThreshold != null
      ? String(existing.eWayBillThreshold)
      : "",
  );

  const [deductorType, setDeductorType] = useState(
    existing?.deductorType || "",
  );
  const [responsiblePersonName, setResponsiblePersonName] = useState(
    existing?.responsiblePersonName || "",
  );
  const [responsiblePersonPan, setResponsiblePersonPan] = useState(
    existing?.responsiblePersonPan || "",
  );
  const [responsiblePersonDesignation, setResponsiblePersonDesignation] =
    useState(existing?.responsiblePersonDesignation || "");
  // Deductor type and responsible person only apply to TDS deductors (TAN holders).
  const hasTan = tan.trim() !== "";

  const [currentStep, setCurrentStep] = useState(0);
  // Furthest step reached, so finished steps can be revisited from the step list.
  const [maxStep, setMaxStep] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const utils = trpc.useUtils();

  const stateOptions = INDIAN_STATES.map((s) => ({
    value: s.name,
    label: s.name,
  }));

  const countryOptions = COUNTRIES.map((c) => ({
    value: c.name,
    label: c.name,
  }));

  const wizardSteps = [
    "Business details",
    "GST details",
    "Corporate Tax details",
    "Documents & branding",
    "Review & create",
  ];

  const uploadLogoMutation = trpc.business.uploadLogo.useMutation();
  const uploadSignatureMutation = trpc.business.uploadSignature.useMutation();

  const createMutation = trpc.business.create.useMutation({
    onSuccess: async (biz) => {
      // Branding images were picked before the row existed; send them now.
      // Failures here must not undo a successful creation, so they only warn.
      try {
        if (pendingLogo) {
          await uploadLogoMutation.mutateAsync({ id: biz.id, data: pendingLogo });
        }
        if (pendingSignature) {
          await uploadSignatureMutation.mutateAsync({ id: biz.id, data: pendingSignature });
        }
      } catch (err) {
        toast.error(
          "Business created, but the logo or signature did not upload",
          err instanceof Error ? err.message : "Add it later from Settings.",
        );
      }

      toast.success("Business created successfully");
      utils.business.list.invalidate();
      onDone(name);
    },
    onError: (err) => {
      toast.error("Failed to create business", err.message);
    },
  });

  const updateMutation = trpc.business.update.useMutation({
    onSuccess: () => {
      toast.success("Business updated successfully");
      utils.business.list.invalidate();
      onDone(name);
    },
    onError: (err) => {
      toast.error("Failed to update business", err.message);
    },
  });

  const isPending =
    createMutation.isPending || updateMutation.isPending;

  const isCompanyType = [
    "private_limited",
    "public_limited",
    "one_person_company",
  ].includes(businessType);

  const isLlp = businessType === "llp";

  // Document defaults (prefixes, round-off, standard T&C). During onboarding
  // these get their own step just before the review. In edit mode the wizard
  // never advances past step 0, so they render there instead.
  const documentDefaultsSection = (
    <>
      <div>
        <h3 className="text-sm font-semibold text-text-primary">
          Document defaults
        </h3>

        <p className="text-xs text-text-tertiary mt-1 mb-4">
          These prefixes are used as defaults when creating documents.
        </p>

        <div className="grid grid-cols-2 gap-4">
          <InputField
            label="Invoice Prefix"
            value={invoicePrefix}
            onChange={(e) => setInvoicePrefix(e.target.value)}
          />

          <InputField
            label="Payment Prefix"
            value={paymentPrefix}
            onChange={(e) => setPaymentPrefix(e.target.value)}
          />

          <InputField
            label="Quotation Prefix"
            value={quotationPrefix}
            onChange={(e) => setQuotationPrefix(e.target.value)}
          />

          <InputField
            label="Credit Note Prefix"
            value={creditNotePrefix}
            onChange={(e) => setCreditNotePrefix(e.target.value)}
          />

          <InputField
            label="Delivery Challan Prefix"
            value={deliveryChallanPrefix}
            onChange={(e) =>
              setDeliveryChallanPrefix(e.target.value)
            }
          />

          <InputField
            label="Proforma Invoice Prefix"
            value={proformaPrefix}
            onChange={(e) => setProformaPrefix(e.target.value)}
          />

          <InputField
            label="Debit Note Prefix"
            value={debitNotePrefix}
            onChange={(e) => setDebitNotePrefix(e.target.value)}
          />

          <InputField
            label="Sales Return Prefix"
            value={salesReturnPrefix}
            onChange={(e) => setSalesReturnPrefix(e.target.value)}
          />

          <InputField
            label="Purchase Return Prefix"
            value={purchaseReturnPrefix}
            onChange={(e) => setPurchaseReturnPrefix(e.target.value)}
          />

          <InputField
            label="Sales Order Prefix"
            value={salesOrderPrefix}
            onChange={(e) => setSalesOrderPrefix(e.target.value)}
          />

          <InputField
            label="Purchase Order Prefix"
            value={purchaseOrderPrefix}
            onChange={(e) => setPurchaseOrderPrefix(e.target.value)}
          />

          <InputField
            label="Goods Receipt Note Prefix"
            value={goodsReceiptNotePrefix}
            onChange={(e) => setGoodsReceiptNotePrefix(e.target.value)}
          />
        </div>
      </div>

      <div className="rounded-xl border border-border-light p-4">
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            role="switch"
            checked={defaultRoundOff}
            onChange={(e) => setDefaultRoundOff(e.target.checked)}
            className="switch"
          />

          <div>
            <p className="text-sm font-medium text-text-primary">
              Enable default round-off
            </p>

            <p className="text-xs text-text-tertiary">
              Apply round-off by default on supported documents.
            </p>
          </div>
        </label>
      </div>

      <div>
        <label className="block text-xs font-medium text-text-secondary mb-2">
          Default Terms & Conditions
        </label>

        <textarea
          value={defaultTermsAndConditions}
          onChange={(e) =>
            setDefaultTermsAndConditions(e.target.value)
          }
          rows={4}
          maxLength={2000}
          className="input w-full resize-y"
          placeholder="Enter default terms and conditions..."
        />
      </div>
    </>
  );

  const stepContent = (() => {
    switch (currentStep) {
      // ==========================================================
      // STEP 1 — BUSINESS DETAILS
      // ==========================================================
      case 0:
        return (
          <div className="space-y-6">
            <div>
              <h3 className="text-sm font-semibold text-text-primary">
                Business information
              </h3>
              <p className="text-xs text-text-tertiary mt-1">
                Enter the general information used across your business.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <InputField
                label="Business Name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                error={errors.name}
                autoFocus
              />

              <InputField
                label="Legal Name"
                value={legalName}
                onChange={(e) => setLegalName(e.target.value)}
              />

              <Listbox
                label="Business Type"
                value={businessType}
                onChange={setBusinessType}
                options={BUSINESS_TYPE_OPTIONS}
              />

              <PhoneInput
                label="Phone"
                value={phone}
                onChange={setPhone}
                required
                error={errors.phone}
              />

              <InputField
                label="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                type="email"
                error={errors.email}
              />

              <InputField
                label="Currency"
                value={currency}
                onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                maxLength={3}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <InputField
                label="Address Line 1"
                value={addressLine1}
                onChange={(e) => setAddressLine1(e.target.value)}
                required
                error={errors.address}
              />

              <InputField
                label="Address Line 2"
                value={addressLine2}
                onChange={(e) => setAddressLine2(e.target.value)}
              />

              <InputField
                label="Landmark"
                value={landmark}
                onChange={(e) => setLandmark(e.target.value)}
              />

              {/* Pincode pairs with Landmark to close out the address block.
                  Entering it looks up and fills City, State and Country on the
                  row below, so those are usually confirmations rather than
                  data entry. All of them stay editable. */}
              <PincodeInput
                value={pincode}
                onChange={setPincode}
                currentCity={city}
                currentState={stateName}
                onCityStateResolved={(resolvedCity, resolvedState) => {
                  if (!city.trim()) setCity(resolvedCity);
                  if (!stateName.trim()) setStateName(resolvedState);
                  // A resolved Indian PIN implies the country too.
                  if (!countryOfOperations.trim()) {
                    setCountryOfOperations("India");
                  }
                }}
                error={errors.pincode}
              />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <InputField
                label="City"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                required
                error={errors.city}
              />

              <Combobox
                label="State"
                value={stateName}
                onChange={setStateName}
                options={stateOptions}
                placeholder="Select state..."
                required
                error={errors.stateName}
              />

              <Combobox
                label="Country"
                value={countryOfOperations}
                onChange={setCountryOfOperations}
                options={countryOptions}
                placeholder="Select country..."
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <InputField
                label="Financial Year Start Date"
                value={financialYearStartDate}
                onChange={(e) => setFinancialYearStartDate(e.target.value)}
                type="date"
              />

              <InputField
                label="Annual Turnover (₹)"
                value={annualTurnover}
                onChange={(e) =>
                  setAnnualTurnover(e.target.value.replace(/[^0-9.]/g, ""))
                }
                inputMode="decimal"
                placeholder="Used for HSN and e-invoicing rules"
              />
            </div>

            {!onboardingMode && documentDefaultsSection}
          </div>
        );

      // ==========================================================
      // STEP 2 — STATUTORY DETAILS
      // ==========================================================
      case 1:
        return (
          <div className="space-y-6">
            <div>
              <h3 className="text-sm font-semibold text-text-primary">
                Statutory & compliance details
              </h3>

              <p className="text-xs text-text-tertiary mt-1">
                Add applicable tax and registration information.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">

              <Listbox
                label="GST Registration"
                value={gstRegType}
                onChange={(value) => {
                  setGstRegType(value);

                  if (value !== "regular") {
                    setEInvoiceEnabled(false);
                  }
                }}
                options={GST_REG_OPTIONS}
              />

              {gstRegType !== "unregistered" && (
                <GstinInput
                  value={gstin}
                  onChange={(val) => {
                    setGstin(val);

                    if (val.length === 15) {
                      setStateCode(val.slice(0, 2));
                    }
                  }}
                  onPanDetected={(detectedPan) => {
                    if (!pan || pan === autoPan) {
                      setPan(detectedPan);
                      setAutoPan(detectedPan);
                    }
                  }}
                  error={errors.gstin}
                />
              )}

              <PanInput
                value={pan}
                onChange={setPan}
                error={errors.pan}
              />

            </div>


            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-text-primary">
                GST configuration
              </h3>

              <label className="flex items-center justify-between rounded-xl border border-border-light p-4 cursor-pointer">
                <div>
                  <p className="text-sm font-medium text-text-primary">
                    Assessee of Other Territory
                  </p>
                  <p className="text-xs text-text-tertiary mt-1">
                    For businesses operating offshore — beyond India&apos;s
                    territorial waters, on the continental shelf or in the
                    exclusive economic zone. Sets the GST state code to 97
                    (Other Territory), so every supply is treated as
                    inter-state and charged IGST.
                  </p>
                </div>
                <input
                  type="checkbox"
                  role="switch"
                  checked={assesseeOfOtherTerritory}
                  onChange={(e) => {
                    const on = e.target.checked;
                    setAssesseeOfOtherTerritory(on);

                    // The flag IS the state code: an Other Territory assessee
                    // is registered under 97, which is what the invoice engine
                    // compares against to pick IGST vs CGST+SGST.
                    if (on) {
                      setStateName("Other Territory");
                      setStateCode("97");
                    } else if (stateCode === "97") {
                      setStateName("");
                      setStateCode("");
                    }
                  }}
                  className="switch"
                />
              </label>

              <div className="space-y-1.5">
                <label className="text-sm font-medium text-text-primary">
                  GST Return Periodicity
                </label>
                <Select
                  value={gstReturnPeriodicity}
                  onChange={(e) =>
                    setGstReturnPeriodicity(
                      e.target.value as "monthly" | "quarterly",
                    )
                  }
                  className="w-full rounded-xl border border-border-light bg-surface px-3 py-2 text-sm text-text-primary"
                >
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly (QRMP)</option>
                </Select>
              </div>
            </div>

            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-text-primary">
                Compliance features
              </h3>

              <label
                className={`flex items-center justify-between rounded-xl border border-border-light p-4 ${gstRegType === "regular"
                  ? "cursor-pointer"
                  : "cursor-not-allowed opacity-60"
                  }`}
              >
                <div>
                  <p className="text-sm font-medium text-text-primary">
                    Enable e-Invoice
                  </p>

                  <p className="text-xs text-text-tertiary mt-1">
                    {gstRegType === "regular"
                      ? "Generate IRN and signed QR codes through the IRP. Mandatory above ₹5 crore annual turnover. IRP credentials are added later in Settings → e-Invoicing."
                      : "Available only when GST Registration is set to Regular."}
                  </p>
                </div>

                <input
                  type="checkbox"
                  role="switch"
                  checked={gstRegType === "regular" && eInvoiceEnabled}
                  disabled={gstRegType !== "regular"}
                  onChange={(e) => setEInvoiceEnabled(e.target.checked)}
                  className="switch disabled:cursor-not-allowed disabled:opacity-50"
                />
              </label>

              {eInvoiceEnabled && (
                <div className="rounded-xl border border-border-light border-t-0 rounded-t-none -mt-3 p-4 pt-5 space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <InputField
                      label="Portal ID"
                      value={eInvoiceUsername}
                      onChange={(e) => setEInvoiceUsername(e.target.value)}
                      placeholder="API user ID"
                      autoComplete="off"
                    />

                    <InputField
                      label="Portal Password"
                      value={eInvoicePassword}
                      onChange={(e) => setEInvoicePassword(e.target.value)}
                      type="password"
                      placeholder={existing ? "Leave blank to keep current" : "API password"}
                      autoComplete="new-password"
                    />
                  </div>

                  <p className="text-xs text-text-tertiary">
                    The API user you created on the e-Invoice (IRP) portal for this GSTIN. Stored encrypted; the GSP client key is configured on the server.
                  </p>
                </div>
              )}

              <label className="flex items-center justify-between rounded-xl border border-border-light p-4 cursor-pointer">
                <div>
                  <p className="text-sm font-medium text-text-primary">
                    Enable E-Way Bill
                  </p>

                  <p className="text-xs text-text-tertiary mt-1">
                    Generate E-Way Bills for goods movement. Required on
                    consignments above ₹50,000.
                  </p>
                </div>

                <input
                  type="checkbox"
                  role="switch"
                  checked={eWayBillEnabled}
                  onChange={(e) =>
                    setEWayBillEnabled(e.target.checked)
                  }
                  className="switch"
                />
              </label>

              {eWayBillEnabled && (
                <div className="rounded-xl border border-border-light border-t-0 rounded-t-none -mt-3 p-4 pt-5 space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <InputField
                      label="Portal ID"
                      value={eWayBillUsername}
                      onChange={(e) => setEWayBillUsername(e.target.value)}
                      placeholder="API user ID"
                      autoComplete="off"
                    />

                    <InputField
                      label="Portal Password"
                      value={eWayBillPassword}
                      onChange={(e) => setEWayBillPassword(e.target.value)}
                      type="password"
                      placeholder={existing ? "Leave blank to keep current" : "API password"}
                      autoComplete="new-password"
                    />
                  </div>

                  <p className="text-xs text-text-tertiary">
                    The API user you created on the NIC E-Way Bill portal for
                    this GSTIN. Stored encrypted; the GSP client key is
                    configured on the server.
                  </p>

                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-text-primary">
                      E-Way Bill Threshold (₹)
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={eWayBillThreshold}
                      onChange={(e) => setEWayBillThreshold(e.target.value)}
                      placeholder="50000"
                      className="w-full rounded-xl border border-border-light bg-surface px-3 py-2 text-sm text-text-primary"
                    />
                    <p className="text-xs text-text-tertiary">
                      Consignment value at which an E-Way Bill becomes
                      required. Leave blank to use the statutory ₹50,000.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        );


      // ==========================================================
      // STEP 3 — CORPORATE TAX DETAILS
      // ==========================================================
      case 2:
        return (
          <div className="space-y-6">
            <div>
              <h3 className="text-sm font-semibold text-text-primary">
                Corporate Tax Details
              </h3>
              <p className="text-xs text-text-tertiary mt-1">
                Add tax deduction and corporate registration details.
              </p>
            </div>

            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-text-primary">
                Tax identification
              </h3>

              <div className="grid grid-cols-1 gap-4">
                <InputField
                  label="TAN"
                  value={tan}
                  onChange={(e) =>
                    setTan(e.target.value.toUpperCase())
                  }
                  maxLength={10}
                  placeholder="Optional — only if you deduct TDS"
                />

                {hasTan && (
                  <InputField
                    label="Deductor Type"
                    value={deductorType}
                    onChange={(e) => setDeductorType(e.target.value)}
                    placeholder="Enter deductor type"
                  />
                )}
              </div>
            </div>

            {hasTan && (
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-text-primary">
                  Responsible person
                </h3>

                <div className="grid grid-cols-2 gap-4">
                  <InputField
                    label="Responsible Person Name"
                    value={responsiblePersonName}
                    onChange={(e) =>
                      setResponsiblePersonName(e.target.value)
                    }
                  />

                  <PanInput
                    value={responsiblePersonPan}
                    onChange={setResponsiblePersonPan}
                    error={errors.responsiblePersonPan}
                  />

                  <InputField
                    label="Designation"
                    value={responsiblePersonDesignation}
                    onChange={(e) =>
                      setResponsiblePersonDesignation(e.target.value)
                    }
                  />
                </div>
              </div>
            )}

            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-text-primary">
                Corporate registrations
              </h3>

              <div className="grid grid-cols-2 gap-4">
                {isCompanyType && (
                  <InputField
                    label="CIN"
                    value={cin}
                    onChange={(e) =>
                      setCin(e.target.value.toUpperCase())
                    }
                    maxLength={21}
                  />
                )}

                {isLlp && (
                  <InputField
                    label="LLPIN"
                    value={llpin}
                    onChange={(e) =>
                      setLlpin(e.target.value.toUpperCase())
                    }
                    maxLength={8}
                  />
                )}

                <InputField
                  label="Udyam Registration Number"
                  value={udyamNumber}
                  onChange={(e) =>
                    setUdyamNumber(e.target.value.toUpperCase())
                  }
                />

                <InputField
                  label="IEC Code"
                  value={iecCode}
                  onChange={(e) =>
                    setIecCode(e.target.value.toUpperCase())
                  }
                  maxLength={10}
                />

                <InputField
                  label="LUT ARN"
                  value={lutArn}
                  onChange={(e) =>
                    setLutArn(e.target.value.toUpperCase())
                  }
                />
              </div>
            </div>
          </div>
        );

      // ==========================================================
      // STEP 4 — DOCUMENTS & BRANDING
      // ==========================================================
      case 3:
        return (
          <div className="space-y-6">
            <div>
              <h3 className="text-sm font-semibold text-text-primary">
                Documents &amp; branding
              </h3>

              <p className="text-xs text-text-tertiary mt-1">
                How every document this business issues is numbered and
                branded. All of it stays editable from Settings.
              </p>
            </div>

            {documentDefaultsSection}

            {/* During creation there is no business id yet, so these run in
                deferred mode: the picked image is held here and uploaded as
                soon as the business row exists. */}
            <LogoUploader
              kind="logo"
              businessId={existing?.id}
              logoUpdatedAt={existing?.logoUpdatedAt}
              hasLogo={!!existing?.logoMimeType}
              pending={pendingLogo}
              onPendingChange={setPendingLogo}
            />

            <LogoUploader
              kind="signature"
              businessId={existing?.id}
              logoUpdatedAt={existing?.signatureUpdatedAt}
              hasLogo={!!existing?.signatureMimeType}
              pending={pendingSignature}
              onPendingChange={setPendingSignature}
            />
          </div>
        );

      // ==========================================================
      // STEP 5 — REVIEW
      // ==========================================================
      default:
        return (
          <div className="space-y-4 text-sm text-text-secondary">
            <div className="rounded-xl border border-border-light bg-surface-2 p-4">
              <p className="font-medium text-text-primary mb-3">
                Business details
              </p>

              <ul className="space-y-2">
                <li>
                  <span className="text-text-tertiary">Name:</span>{" "}
                  {name || "—"}
                </li>

                <li>
                  <span className="text-text-tertiary">
                    Legal name:
                  </span>{" "}
                  {legalName || "—"}
                </li>

                <li>
                  <span className="text-text-tertiary">
                    Business type:
                  </span>{" "}
                  {BUSINESS_TYPE_OPTIONS.find(
                    (item) => item.value === businessType,
                  )?.label || businessType}
                </li>

                <li>
                  <span className="text-text-tertiary">Phone:</span>{" "}
                  {phone || "—"}
                </li>

                <li>
                  <span className="text-text-tertiary">Email:</span>{" "}
                  {email || "—"}
                </li>

                <li>
                  <span className="text-text-tertiary">Address Line 1:</span>{" "}
                  {addressLine1 || "—"}
                </li>
                <li>
                  <span className="text-text-tertiary">Address Line 2:</span>{" "}
                  {addressLine2 || "—"}
                </li>
                <li>
                  <span className="text-text-tertiary">Landmark:</span>{" "}
                  {landmark || "—"}
                </li>
                <li>
                  <span className="text-text-tertiary">Location:</span>{" "}
                  {city || "—"}, {stateName || "—"} {pincode || ""}
                </li>
                <li>
                  <span className="text-text-tertiary">
                    Country of Operations:
                  </span>{" "}
                  {countryOfOperations || "—"}
                </li>
                <li>
                  <span className="text-text-tertiary">
                    Financial Year Start Date:
                  </span>{" "}
                  {financialYearStartDate || "—"}
                </li>

                <li>
                  <span className="text-text-tertiary">
                    Annual Turnover:
                  </span>{" "}
                  {annualTurnover ? `₹${annualTurnover}` : "—"}
                </li>

                <li>
                  <span className="text-text-tertiary">Currency:</span>{" "}
                  {currency || "—"}
                </li>
              </ul>
            </div>

            <div className="rounded-xl border border-border-light bg-surface-2 p-4">
              <p className="font-medium text-text-primary mb-3">
                Statutory details
              </p>

              <ul className="space-y-2">
                <li>
                  <span className="text-text-tertiary">PAN:</span>{" "}
                  {pan || "—"}
                </li>

                <li>
                  <span className="text-text-tertiary">GST:</span>{" "}
                  {gstRegType === "unregistered"
                    ? "Not registered"
                    : gstin || "—"}
                </li>

                <li>
                  <span className="text-text-tertiary">
                    GST Registration:
                  </span>{" "}
                  {GST_REG_OPTIONS.find(
                    (option) => option.value === gstRegType
                  )?.label ?? "Not GST Registered"}
                </li>

                <li>
                  <span className="text-text-tertiary">TAN:</span>{" "}
                  {tan || "—"}
                </li>

                {isCompanyType && (
                  <li>
                    <span className="text-text-tertiary">CIN:</span>{" "}
                    {cin || "—"}
                  </li>
                )}

                {isLlp && (
                  <li>
                    <span className="text-text-tertiary">LLPIN:</span>{" "}
                    {llpin || "—"}
                  </li>
                )}

                <li>
                  <span className="text-text-tertiary">
                    Udyam Number:
                  </span>{" "}
                  {udyamNumber || "—"}
                </li>

                <li>
                  <span className="text-text-tertiary">IEC:</span>{" "}
                  {iecCode || "—"}
                </li>

                <li>
                  <span className="text-text-tertiary">LUT ARN:</span>{" "}
                  {lutArn || "—"}
                </li>

                <li>
                  <span className="text-text-tertiary">
                    e-Invoice:
                  </span>{" "}
                  {eInvoiceEnabled ? "Enabled" : "Disabled"}
                </li>

                <li>
                  <span className="text-text-tertiary">
                    E-Way Bill:
                  </span>{" "}
                  {eWayBillEnabled ? "Enabled" : "Disabled"}
                </li>


                <li>
                  <span className="text-text-tertiary">
                    Other Territory:
                  </span>{" "}
                  {assesseeOfOtherTerritory ? "Yes" : "No"}
                </li>

                <li>
                  <span className="text-text-tertiary">
                    Return Periodicity:
                  </span>{" "}
                  {gstReturnPeriodicity === "monthly"
                    ? "Monthly"
                    : "Quarterly (QRMP)"}
                </li>

                <li>
                  <span className="text-text-tertiary">
                    E-Way Bill Threshold:
                  </span>{" "}
                  {eWayBillThreshold.trim()
                    ? `₹${Number(eWayBillThreshold).toLocaleString("en-IN")}`
                    : "Not set"}
                </li>
              </ul>
            </div>

            <div className="rounded-xl border border-border-light bg-surface-2 p-4">
              <p className="font-medium text-text-primary mb-3">
                Documents &amp; branding
              </p>

              <ul className="space-y-2">
                <li>Invoice: {invoicePrefix}</li>
                <li>Payment: {paymentPrefix}</li>
                <li>Quotation: {quotationPrefix}</li>
                <li>Credit Note: {creditNotePrefix}</li>
                <li>Delivery Challan: {deliveryChallanPrefix}</li>
                <li>Proforma: {proformaPrefix}</li>
                <li>Debit Note: {debitNotePrefix}</li>
                <li>Sales Return: {salesReturnPrefix}</li>
                <li>Purchase Return: {purchaseReturnPrefix}</li>
                <li>Sales Order: {salesOrderPrefix}</li>
                <li>Purchase Order: {purchaseOrderPrefix}</li>
                <li>Goods Receipt Note: {goodsReceiptNotePrefix}</li>
                <li>
                  Round-off: {defaultRoundOff ? "Enabled" : "Disabled"}
                </li>
                <li>
                  Logo:{" "}
                  {pendingLogo || existing?.logoMimeType ? "Added" : "Not added"}
                </li>
                <li>
                  Signature:{" "}
                  {pendingSignature || existing?.signatureMimeType
                    ? "Added"
                    : "Not added"}
                </li>
              </ul>
            </div>
          </div>
        );
    }
  })();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const stepErrors = validateBusinessStep(currentStep, {
      name,
      legalName,
      businessType,
      phone,
      email,
      address: addressLine1,
      addressLine1,
      addressLine2,
      landmark,
      countryOfOperations,
      financialYearStartDate,
      city,
      stateName,
      stateCode,
      pincode,
      currency,
      invoicePrefix,
      paymentPrefix,
      quotationPrefix,
      creditNotePrefix,
      deliveryChallanPrefix,
      proformaPrefix,
      defaultRoundOff,
      defaultTermsAndConditions,
      gstRegType,
      gstin,
      pan,
      tan,
      cin,
      llpin,
      udyamNumber,
      iecCode,
      lutArn,
      eInvoiceEnabled,
      eWayBillEnabled,
      assesseeOfOtherTerritory,
      gstReturnPeriodicity,
      eWayBillThreshold:
        eWayBillThreshold.trim() === ""
          ? null
          : Number(eWayBillThreshold),
      deductorType,
      responsiblePersonName,
      responsiblePersonPan,
      responsiblePersonDesignation,
    });

    if (Object.keys(stepErrors).length > 0) {
      setErrors(stepErrors);
      return;
    }

    setErrors({});

    if (onboardingMode && currentStep < wizardSteps.length - 1) {
      const nextStep = currentStep + 1;
      setCurrentStep(nextStep);
      setMaxStep((m) => Math.max(m, nextStep));
      return;
    }

    const data = {
      name,
      legalName: legalName || undefined,
      businessType: businessType as
        | "proprietorship"
        | "partnership"
        | "llp"
        | "private_limited"
        | "public_limited"
        | "one_person_company"
        | "huf"
        | "trust"
        | "society"
        | "other",

      phone: phone || undefined,
      email: email || undefined,
      address: addressLine1 || undefined,
      addressLine1: addressLine1 || undefined,
      addressLine2: addressLine2 || undefined,
      landmark: landmark || undefined,
      city: city || undefined,
      state: stateName || undefined,
      stateCode: stateCode || undefined,
      pincode: pincode || undefined,
      countryOfOperations: countryOfOperations || undefined,
      financialYearStartDate: financialYearStartDate || undefined,

      currency: currency || "INR",

      invoicePrefix: invoicePrefix || "INV",
      paymentPrefix: paymentPrefix || "PAY",
      quotationPrefix: quotationPrefix || "QTN",
      creditNotePrefix: creditNotePrefix || "CN",
      deliveryChallanPrefix: deliveryChallanPrefix || "DC",
      proformaPrefix: proformaPrefix || "PI",
      debitNotePrefix: debitNotePrefix || "DN",
      salesReturnPrefix: salesReturnPrefix || "SR",
      purchaseReturnPrefix: purchaseReturnPrefix || "PR",
      salesOrderPrefix: salesOrderPrefix || "SO",
      purchaseOrderPrefix: purchaseOrderPrefix || "PO",
      goodsReceiptNotePrefix: goodsReceiptNotePrefix || "GRN",
      annualTurnover:
        annualTurnover.trim() === "" ? null : Number(annualTurnover),

      defaultRoundOff,
      defaultTermsAndConditions:
        defaultTermsAndConditions || undefined,

      gstRegistrationType: gstRegType as
        | "unregistered"
        | "regular"
        | "composition",

      gstin:
        gstRegType !== "unregistered"
          ? gstin || undefined
          : undefined,

      pan: pan || undefined,
      tan: tan || undefined,
      cin: cin || undefined,
      llpin: llpin || undefined,
      udyamNumber: udyamNumber || undefined,
      iecCode: iecCode || undefined,
      lutArn: lutArn || undefined,

      eInvoiceEnabled,
      eWayBillEnabled,

      // Blank means "leave whatever is stored alone" — the server only writes
      // a credential pair when both halves are present.
      eInvoiceUsername: eInvoiceUsername.trim() || undefined,
      eInvoicePassword: eInvoicePassword || undefined,
      eWayBillUsername: eWayBillUsername.trim() || undefined,
      eWayBillPassword: eWayBillPassword || undefined,

      assesseeOfOtherTerritory,
      gstReturnPeriodicity,
      eWayBillThreshold:
        eWayBillThreshold.trim() === ""
          ? undefined
          : Number(eWayBillThreshold),

      deductorType: (hasTan && deductorType) || undefined,
      responsiblePersonName: (hasTan && responsiblePersonName) || undefined,
      responsiblePersonPan: (hasTan && responsiblePersonPan) || undefined,
      responsiblePersonDesignation:
        (hasTan && responsiblePersonDesignation) || undefined,
    };

    if (existing) {
      updateMutation.mutate({
        id: existing.id,
        data,
      });
    } else {
      createMutation.mutate(data);
    }
  }

  const isLastStep = currentStep === wizardSteps.length - 1;

  if (onboardingMode && !existing) {
    return (
      <div className="overflow-hidden rounded-[22px] border border-border-light bg-surface-0 shadow-[0_40px_100px_-40px_rgba(15,27,61,.45)] lg:flex">
        <aside className="flex flex-col bg-[#0f1b3d] px-7 py-8 text-white lg:w-[292px] lg:shrink-0">
          <div className="flex items-center gap-2.5">
            <Logo className="h-[30px] w-[30px]" />
            <span className="font-display text-[17px] font-extrabold">Fintranzact</span>
          </div>
          <h2 className="mt-7 font-display text-[22px] font-extrabold leading-tight">Set up your business</h2>
          <p className="mt-1.5 text-[13px] leading-relaxed text-[#9fb0d6]">
            Four quick steps. You can change any of this later in Settings.
          </p>
          <ol className="mt-7 flex gap-3 overflow-x-auto lg:flex-col lg:gap-0 lg:overflow-visible">
            {wizardSteps.map((title, i) => {
              const done = i < currentStep;
              const current = i === currentStep;
              const reachable = i <= maxStep;
              return (
                <li key={title} className="flex shrink-0 gap-3.5">
                  <div className="flex flex-col items-center">
                    <button
                      type="button"
                      disabled={!reachable || current}
                      onClick={() => {
                        setErrors({});
                        setCurrentStep(i);
                      }}
                      aria-current={current ? "step" : undefined}
                      aria-label={`Step ${i + 1}: ${title}${done ? " (done)" : ""}`}
                      className={cn(
                        "flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 text-sm font-extrabold transition",
                        done && "border-brand-600 bg-brand-600 text-white",
                        current && "border-brand-600 bg-white text-[#0f1b3d]",
                        !done && !current && "border-white/25 text-[#8fa3cf]",
                        reachable && !current && "cursor-pointer hover:border-brand-300",
                      )}
                    >
                      {done ? <Icon icon={Tick02Icon} size={16} strokeWidth={2.75} /> : i + 1}
                    </button>
                    {i < wizardSteps.length - 1 && (
                      <span
                        className={cn(
                          "hidden h-10 w-0.5 rounded-full lg:block",
                          i < currentStep ? "bg-brand-600" : "bg-white/15",
                        )}
                      />
                    )}
                  </div>
                  <div className="pt-1.5">
                    <p className={cn("text-sm font-bold", done || current ? "text-white" : "text-[#8fa3cf]")}>{title}</p>
                    <p className="mt-0.5 hidden text-xs text-[#8fa3cf] lg:block">{WIZARD_STEP_HINTS[i]?.sub}</p>
                  </div>
                </li>
              );
            })}
          </ol>
          <div className="mt-auto hidden gap-2.5 rounded-xl border border-white/10 bg-white/[0.06] p-3.5 text-xs leading-relaxed text-[#b9c6e4] lg:mt-10 lg:flex">
            <Icon icon={InformationCircleIcon} size={18} className="shrink-0 text-[#a9bde6]" />
            <span>Your details stay private and appear only on your own invoices.</span>
          </div>
        </aside>

        <form onSubmit={handleSubmit} className="flex min-w-0 flex-1 flex-col">
          <div className="border-b border-border-light px-6 pb-4 pt-6 md:px-8">
            <p className="text-xs font-bold uppercase tracking-[0.12em] text-brand-600 dark:text-brand-300">
              Step {currentStep + 1} of {wizardSteps.length}
            </p>
            <h3 className="mt-1.5 font-display text-[22px] font-extrabold text-[#0f1b3d] dark:text-white">
              {wizardSteps[currentStep]}
            </h3>
            <p className="mt-1 text-sm text-text-tertiary">{WIZARD_STEP_HINTS[currentStep]?.intro}</p>
          </div>
          <div className="h-1 bg-surface-2">
            <div
              className="h-1 bg-brand-600 transition-[width] duration-300"
              style={{ width: `${((currentStep + 1) / wizardSteps.length) * 100}%` }}
            />
          </div>

          <div className="flex-1 px-6 py-6 md:px-8">{stepContent}</div>

          <div className="flex items-center justify-between gap-3 border-t border-border-light px-6 py-4 md:px-8">
            {currentStep > 0 ? (
              <button
                type="button"
                className="btn-secondary h-11 px-5"
                onClick={() => {
                  setErrors({});
                  setCurrentStep((step) => step - 1);
                }}
              >
                <Icon icon={ArrowLeft01Icon} size={16} strokeWidth={2} />
                Back
              </button>
            ) : (
              <span className="text-[13px] text-text-tertiary">
                Fields marked <span className="text-red-500">*</span> are required
              </span>
            )}
            <button type="submit" disabled={isPending} className="btn-primary h-11 px-6">
              {isPending ? "Saving..." : isLastStep ? "Create business" : "Continue"}
              {!isPending && <Icon icon={ArrowRight01Icon} size={16} strokeWidth={2} />}
            </button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="card p-6">
      <div className="mb-5">
        <h2 className="text-base font-semibold text-text-primary">
          {existing
            ? "Edit Business"
            : onboardingMode
              ? "Set up your business"
              : "Set Up Your Business"}
        </h2>

        {onboardingMode && (
          <div className="mt-3">
            <div className="flex justify-between text-[10px] uppercase tracking-widest text-text-tertiary mb-2">
              <span>
                Step {currentStep + 1} of {wizardSteps.length}
              </span>

              <span>{wizardSteps[currentStep]}</span>
            </div>

            <div className="h-2 w-full rounded-full bg-surface-2 overflow-hidden">
              <div
                className="h-full rounded-full bg-brand-600 transition-all"
                style={{
                  width: `${((currentStep + 1) / wizardSteps.length) * 100
                    }% `,
                }}
              />
            </div>
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {stepContent}

        <div className="flex gap-3 pt-2">
          {existing && (
            <button
              type="button"
              onClick={() => onDone()}
              className="btn-secondary flex-1"
            >
              Cancel
            </button>
          )}

          {!existing && onboardingMode && currentStep > 0 && (
            <button
              type="button"
              className="btn-secondary flex-1"
              onClick={() =>
                setCurrentStep((step) => step - 1)
              }
            >
              Back
            </button>
          )}

          <button
            type="submit"
            disabled={isPending}
            className="btn-primary flex-1"
          >
            {isPending
              ? "Saving..."
              : onboardingMode
                ? isLastStep
                  ? "Create Business"
                  : "Next"
                : existing
                  ? "Save Changes"
                  : "Create Business"}
          </button>
        </div>
      </form>
    </div>
  );
}