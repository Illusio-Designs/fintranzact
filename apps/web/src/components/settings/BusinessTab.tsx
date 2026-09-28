import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { InputField } from "@/components/ui/FormField";
import { Combobox } from "@/components/ui/Combobox";
import { Listbox } from "@/components/ui/Listbox";
import { toast } from "@/hooks/useToast";
import { GstinInput } from "./GstinInput";
import { PanInput } from "./PanInput";
import { PincodeInput } from "./PincodeInput";
import { INDIAN_STATES } from "@/lib/indian-states";
import { LogoUploader } from "./LogoUploader";

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
      if (!values.pan.trim()) {
        errors.pan = "PAN is required";
      } else if (!panPattern.test(values.pan)) {
        errors.pan = "Invalid PAN format";
      }

      if (values.gstRegType !== "unregistered") {
        if (!values.gstin.trim()) {
          errors.gstin =
            "GSTIN is required for GST-registered businesses";
        } else if (!gstinPattern.test(values.gstin)) {
          errors.gstin = "Invalid GSTIN format";
        }
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

  const [currentStep, setCurrentStep] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const utils = trpc.useUtils();

  const stateOptions = INDIAN_STATES.map((s) => ({
    value: s.name,
    label: s.name,
  }));

  const wizardSteps = [
    "Business details",
    "Statutory details",
    "Review & create",
  ];

  const createMutation = trpc.business.create.useMutation({
    onSuccess: () => {
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

              <InputField
                label="Phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
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

              <InputField
                label="Country of Operations"
                value={countryOfOperations}
                onChange={(e) => setCountryOfOperations(e.target.value)}
                required
              />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <PincodeInput
                value={pincode}
                onChange={setPincode}
                currentCity={city}
                currentState={stateName}
                onCityStateResolved={(resolvedCity, resolvedState) => {
                  if (!city.trim()) setCity(resolvedCity);
                  if (!stateName.trim()) setStateName(resolvedState);
                }}
                error={errors.pincode}
              />

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
            </div>

            <InputField
              label="Financial Year Start Date"
              value={financialYearStartDate}
              onChange={(e) => setFinancialYearStartDate(e.target.value)}
              type="date"
            />

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
              </div>
            </div>

            <div className="rounded-xl border border-border-light p-4">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={defaultRoundOff}
                  onChange={(e) => setDefaultRoundOff(e.target.checked)}
                  className="h-4 w-4"
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
              <PanInput
                value={pan}
                onChange={setPan}
                error={errors.pan}
              />

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
                    if (!pan) setPan(detectedPan);
                  }}
                  error={errors.gstin}
                />
              )}

              <InputField
                label="TAN"
                value={tan}
                onChange={(e) =>
                  setTan(e.target.value.toUpperCase())
                }
                maxLength={10}
                placeholder="Optional"
              />

              {isCompanyType && (
                <InputField
                  label="CIN"
                  value={cin}
                  onChange={(e) =>
                    setCin(e.target.value.toUpperCase())
                  }
                  maxLength={21}
                  placeholder="Company CIN"
                />
              )}

              {isLlp && (
                <InputField
                  label="LLPIN"
                  value={llpin}
                  onChange={(e) =>
                    setLlpin(e.target.value.toUpperCase())
                  }
                  maxLength={7}
                  placeholder="LLP Identification Number"
                />
              )}

              <InputField
                label="Udyam Registration Number"
                value={udyamNumber}
                onChange={(e) => setUdyamNumber(e.target.value)}
                maxLength={30}
                placeholder="Optional"
              />

              <InputField
                label="IEC Code"
                value={iecCode}
                onChange={(e) =>
                  setIecCode(e.target.value.toUpperCase())
                }
                maxLength={10}
                placeholder="Optional"
              />

              <InputField
                label="LUT ARN"
                value={lutArn}
                onChange={(e) => setLutArn(e.target.value)}
                maxLength={100}
                placeholder="Optional"
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
                    Specify whether the business is an assessee of another territory.
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={assesseeOfOtherTerritory}
                  onChange={(e) =>
                    setAssesseeOfOtherTerritory(e.target.checked)
                  }
                  className="h-4 w-4"
                />
              </label>

              <div className="space-y-1.5">
                <label className="text-sm font-medium text-text-primary">
                  GST/VAT Return Periodicity
                </label>
                <select
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
                </select>
              </div>

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
                  placeholder="Optional"
                  className="w-full rounded-xl border border-border-light bg-surface px-3 py-2 text-sm text-text-primary"
                />
              </div>
            </div>

            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-text-primary">
                Compliance features
              </h3>

              <label className="flex items-center justify-between gap-4">
                <div>
                  <p className="font-medium">Enable e-Invoice</p>
                  <p className="text-sm text-muted-foreground">
                    {gstRegType === "regular"
                      ? "Enable e-Invoice functionality for this business."
                      : "Available only when GST Registration is set to Regular."}
                  </p>
                </div>

                <input
                  type="checkbox"
                  checked={gstRegType === "regular" && eInvoiceEnabled}
                  disabled={gstRegType !== "regular"}
                  onChange={(e) => setEInvoiceEnabled(e.target.checked)}
                  className="h-4 w-4 disabled:cursor-not-allowed disabled:opacity-50"
                />
              </label>

              <label className="flex items-center justify-between rounded-xl border border-border-light p-4 cursor-pointer">
                <div>
                  <p className="text-sm font-medium text-text-primary">
                    Enable E-Way Bill
                  </p>

                  <p className="text-xs text-text-tertiary mt-1">
                    Enable E-Way Bill functionality for this business.
                  </p>
                </div>

                <input
                  type="checkbox"
                  checked={eWayBillEnabled}
                  onChange={(e) =>
                    setEWayBillEnabled(e.target.checked)
                  }
                  className="h-4 w-4"
                />
              </label>
            </div>
          </div>
        );

      // ==========================================================
      // STEP 3 — REVIEW
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
                Document defaults
              </p>

              <ul className="space-y-2">
                <li>Invoice: {invoicePrefix}</li>
                <li>Payment: {paymentPrefix}</li>
                <li>Quotation: {quotationPrefix}</li>
                <li>Credit Note: {creditNotePrefix}</li>
                <li>Delivery Challan: {deliveryChallanPrefix}</li>
                <li>Proforma: {proformaPrefix}</li>
                <li>
                  Round-off: {defaultRoundOff ? "Enabled" : "Disabled"}
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
    });

    if (Object.keys(stepErrors).length > 0) {
      setErrors(stepErrors);
      return;
    }

    setErrors({});

    if (onboardingMode && currentStep < wizardSteps.length - 1) {
      setCurrentStep((step) => step + 1);
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
      assesseeOfOtherTerritory,
      gstReturnPeriodicity,
      eWayBillThreshold:
        eWayBillThreshold.trim() === ""
          ? undefined
          : Number(eWayBillThreshold),
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