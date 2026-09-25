import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { InputField } from "@/components/ui/FormField";
import { Combobox } from "@/components/ui/Combobox";
import { Listbox } from "@/components/ui/Listbox";
import { toast } from "@/hooks/useToast";
import { GstinInput } from "./GstinInput";
import { PanInput } from "./PanInput";
import { PhoneInput } from "./PhoneInput";
import { PincodeInput } from "./PincodeInput";
import { INDIAN_STATES } from "@/lib/indian-states";
import { LogoUploader } from "./LogoUploader";

const GST_REG_OPTIONS = [
  { value: "unregistered", label: "Not GST Registered" },
  { value: "regular", label: "GST Regular" },
  { value: "composition", label: "GST Composition Scheme" },
];

export interface BusinessStepValues {
  name: string;
  legalName: string;
  gstRegType: string;
  gstin: string;
  stateCode: string;
  pan: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  stateName: string;
  pincode: string;
}

export function validateBusinessStep(step: number, values: BusinessStepValues) {
  const errors: Record<string, string> = {};
  const panPattern = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
  const gstinPattern = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

  switch (step) {
    case 0:
      if (!values.name.trim()) errors.name = "Business name is required";
      break;
    case 1:
      if (values.gstRegType !== "unregistered") {
        if (!values.gstin.trim()) {
          errors.gstin = "GSTIN is required for GST-registered businesses";
        } else if (!gstinPattern.test(values.gstin)) {
          errors.gstin = "Invalid GSTIN format";
        }

        if (!values.pan.trim()) {
          errors.pan = "PAN is required for GST-registered businesses";
        } else if (!panPattern.test(values.pan)) {
          errors.pan = "Invalid PAN format";
        }
      }
      break;
    case 2:
      if (!values.phone.trim()) errors.phone = "Phone number is required";
      if (values.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) {
        errors.email = "Enter a valid email address";
      }
      break;
    case 3:
      if (!values.address.trim()) errors.address = "Address is required";
      break;
    case 4:
      if (!values.pincode.trim()) errors.pincode = "Pincode is required";
      if (!values.city.trim()) errors.city = "City is required";
      if (!values.stateName.trim()) errors.stateName = "State is required";
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

  // Logo management sits alongside the business card/form in both states:
  // uploads don't need the business in edit mode, and having it always
  // visible makes the feature discoverable.
  return (
    <div className="space-y-6">
      {editing
        ? <BusinessForm existing={biz} onDone={() => setEditing(false)} />
        : <BusinessCard biz={biz} onEdit={() => setEditing(true)} />
      }
      <LogoUploader
        businessId={biz.id}
        logoUpdatedAt={biz.logoUpdatedAt}
        hasLogo={!!biz.logoMimeType}
      />
    </div>
  );
}

function BusinessCard({ biz, onEdit }: { biz: any; onEdit: () => void }) {
  const fields: [string, string | undefined | null][] = [
    ["Legal Name", biz.legalName],
    ["GSTIN", biz.gstin],
    ["PAN", biz.pan],
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
        <h3 className="text-base font-semibold text-text-primary">{biz.name}</h3>
        <button className="btn-secondary" onClick={onEdit}>Edit</button>
      </div>

      <div className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
        {fields.map(([label, value]) => (
          <div key={label}>
            <span className="text-xs text-text-tertiary">{label}</span>
            <p className={value ? "text-text-primary" : "text-text-tertiary"}>
              {value || "—"}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

export function BusinessForm({ existing, onDone, onboardingMode = false }: { existing?: any; onDone: (name?: string) => void; onboardingMode?: boolean }) {
  const [name, setName] = useState(existing?.name || "");
  const [legalName, setLegalName] = useState(existing?.legalName || "");
  const [gstRegType, setGstRegType] = useState(existing?.gstRegistrationType || "unregistered");
  const [gstin, setGstin] = useState(existing?.gstin || "");
  const [stateCode, setStateCode] = useState(existing?.stateCode || "");
  const [pan, setPan] = useState(existing?.pan || "");
  const [phone, setPhone] = useState(existing?.phone || "");
  const [email, setEmail] = useState(existing?.email || "");
  const [address, setAddress] = useState(existing?.address || "");
  const [city, setCity] = useState(existing?.city || "");
  const [stateName, setStateName] = useState(existing?.state || "");
  const [pincode, setPincode] = useState(existing?.pincode || "");
  const [currentStep, setCurrentStep] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const utils = trpc.useUtils();

  const stateOptions = INDIAN_STATES.map((s) => ({ value: s.name, label: s.name }));
  const wizardSteps = [
    "Business identity",
    "GST & PAN",
    "Contact",
    "Address",
    "Location",
    "Review",
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

  const isPending = createMutation.isPending || updateMutation.isPending;

  const stepContent = (() => {
    switch (currentStep) {
      case 0:
        return (
          <div className="space-y-4">
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
            </div>
          </div>
        );
      case 1:
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Listbox
                  label="GST Registration"
                  value={gstRegType}
                  onChange={setGstRegType}
                  options={GST_REG_OPTIONS}
                />
              </div>
              <PanInput value={pan} onChange={setPan} error={errors.pan} />
            </div>
            {gstRegType !== "unregistered" && (
              <div className="grid grid-cols-2 gap-4">
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
              </div>
            )}
          </div>
        );
      case 2:
        return (
          <div className="grid grid-cols-2 gap-4">
            <PhoneInput value={phone} onChange={setPhone} required error={errors.phone} />
            <InputField
              label="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              error={errors.email}
            />
          </div>
        );
      case 3:
        return (
          <div>
            <InputField
              label="Address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              required
              error={errors.address}
            />
          </div>
        );
      case 4:
        return (
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
            <div>
              <InputField
                label="City"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                required
                error={errors.city}
              />
            </div>
            <div>
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
          </div>
        );
      default:
        return (
          <div className="space-y-4 text-sm text-text-secondary">
            <div className="rounded-xl border border-border-light bg-surface-2 p-4">
              <p className="font-medium text-text-primary mb-2">Business summary</p>
              <ul className="space-y-2">
                <li><span className="text-text-tertiary">Name:</span> {name || "—"}</li>
                <li><span className="text-text-tertiary">Legal name:</span> {legalName || "—"}</li>
                <li><span className="text-text-tertiary">GST:</span> {gstRegType === "unregistered" ? "Not registered" : gstin || "—"}</li>
                <li><span className="text-text-tertiary">PAN:</span> {pan || "—"}</li>
                <li><span className="text-text-tertiary">Phone:</span> {phone || "—"}</li>
                <li><span className="text-text-tertiary">Email:</span> {email || "—"}</li>
                <li><span className="text-text-tertiary">Address:</span> {address || "—"}</li>
                <li><span className="text-text-tertiary">Location:</span> {city || "—"}, {stateName || "—"} {pincode || ""}</li>
              </ul>
            </div>
            <InputField
              label="Currency"
              value="INR"
              readOnly
              className="opacity-60 cursor-not-allowed"
            />
          </div>
        );
    }
  })();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const stepErrors = validateBusinessStep(currentStep, {
      name,
      legalName,
      gstRegType,
      gstin,
      stateCode,
      pan,
      phone,
      email,
      address,
      city,
      stateName,
      pincode,
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
      gstRegistrationType: gstRegType as "unregistered" | "regular" | "composition",
      gstin: gstRegType !== "unregistered" ? (gstin || undefined) : undefined,
      stateCode: stateCode || undefined,
      pan: pan || undefined,
      phone: phone || undefined,
      email: email || undefined,
      address: address || undefined,
      city: city || undefined,
      state: stateName || undefined,
      pincode: pincode || undefined,
    };
    if (existing) {
      updateMutation.mutate({ id: existing.id, data });
    } else {
      createMutation.mutate(data);
    }
  }

  const isLastStep = currentStep === wizardSteps.length - 1;

  return (
    <div className="card p-6">
      <div className="mb-5">
        <h2 className="text-base font-semibold text-text-primary">
          {existing ? "Edit Business" : onboardingMode ? "Set up your business" : "Set Up Your Business"}
        </h2>
        {onboardingMode && (
          <div className="mt-3">
            <div className="flex justify-between text-[10px] uppercase tracking-widest text-text-tertiary mb-2">
              <span>Step {currentStep + 1} of {wizardSteps.length}</span>
              <span>{wizardSteps[currentStep]}</span>
            </div>
            <div className="h-2 w-full rounded-full bg-surface-2 overflow-hidden">
              <div
                className="h-full rounded-full bg-brand-600 transition-all"
                style={{ width: `${((currentStep + 1) / wizardSteps.length) * 100}%` }}
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
              onClick={() => setCurrentStep((step) => step - 1)}
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
