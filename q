 apps/mobile/app/(app)/_layout.tsx                  |     6 [32m+[m[31m-[m
 apps/web/src/__tests__/form-validation.test.tsx    |   146 [32m+[m[31m-[m
 apps/web/src/components/settings/BusinessTab.tsx   |   994 [32m+[m[31m-[m
 apps/web/src/routeTree.gen.ts                      |    42 [32m+[m
 apps/web/src/routes/__root.tsx                     |  1056 [32m+[m[31m-[m
 apps/web/src/routes/auth/plan-selection.tsx        |   297 [32m+[m[31m-[m
 apps/web/src/routes/business/create.tsx            |   102 [32m+[m
 apps/web/src/routes/onboarding.tsx                 |   147 [32m+[m
 apps/web/src/routes/settings.tsx                   |    12 [32m+[m[31m-[m
 .../db/0022_add_session_auth_fields_backup.sql     |     7 [32m+[m
 .../db/drizzle-tenant/0011_supreme_dark_beast.sql  |     5 [32m+[m
 .../drizzle-tenant/0012_amusing_madame_hydra.sql   |     9 [32m+[m
 packages/db/drizzle-tenant/meta/0011_snapshot.json |  9059 [32m+++++++++++++++++[m
 packages/db/drizzle-tenant/meta/0012_snapshot.json |  9116 [32m+++++++++++++++++[m
 packages/db/drizzle-tenant/meta/_journal.json      |    14 [32m+[m
 packages/db/drizzle-tenant/schema.ts               |     9 [32m+[m
 packages/db/drizzle/0021_stiff_shooting_star.sql   |    16 [32m+[m
 .../db/drizzle/0022_add_session_auth_fields.sql    |     9 [32m+[m
 packages/db/drizzle/meta/0021_snapshot.json        | 10118 [32m+++++++++++++++++++[m
 packages/db/drizzle/meta/0022_snapshot.json        | 10118 [32m+++++++++++++++++++[m
 packages/db/drizzle/meta/_journal.json             |    14 [32m+[m
 packages/db/drizzle/schema.ts                      |     9 [32m+[m
 packages/db/src/tenant-schema.ts                   |    38 [32m+[m[31m-[m
 packages/shared/src/validators.ts                  |    51 [32m+[m[31m-[m
 24 files changed, 40890 insertions(+), 504 deletions(-)
warning: in the working copy of 'packages/db/drizzle-control/meta/_journal.json', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'packages/db/drizzle-tenant/meta/_journal.json', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'packages/db/drizzle/meta/_journal.json', LF will be replaced by CRLF the next time Git touches it
[1mdiff --git a/apps/web/src/__tests__/form-validation.test.tsx b/apps/web/src/__tests__/form-validation.test.tsx[m
[1mindex a5ecdeb..bda55da 100644[m
[1m--- a/apps/web/src/__tests__/form-validation.test.tsx[m
[1m+++ b/apps/web/src/__tests__/form-validation.test.tsx[m
[36m@@ -405,6 +405,9 @@[m [mdescribe("Business onboarding step validation", () => {[m
       lutArn: "",[m
       eInvoiceEnabled: false,[m
       eWayBillEnabled: false,[m
[32m+[m[32m      assesseeOfOtherTerritory: false,[m
[32m+[m[32m      gstReturnPeriodicity: "monthly",[m
[32m+[m[32m      eWayBillThreshold: null,[m
     });[m
 [m
     expect(errs.name).toBe("Business name is required");[m
[36m@@ -450,6 +453,9 @@[m [mdescribe("Business onboarding step validation", () => {[m
       lutArn: "",[m
       eInvoiceEnabled: false,[m
       eWayBillEnabled: false,[m
[32m+[m[32m      assesseeOfOtherTerritory: false,[m
[32m+[m[32m      gstReturnPeriodicity: "monthly",[m
[32m+[m[32m      eWayBillThreshold: null,[m
     });[m
 [m
     expect(errs.gstin).toBe("GSTIN is required for GST-registered businesses");[m
[36m@@ -496,6 +502,9 @@[m [mdescribe("Business onboarding step validation", () => {[m
       lutArn: "",[m
       eInvoiceEnabled: false,[m
       eWayBillEnabled: false,[m
[32m+[m[32m      assesseeOfOtherTerritory: false,[m
[32m+[m[32m      gstReturnPeriodicity: "monthly",[m
[32m+[m[32m      eWayBillThreshold: null,[m
     });[m
 [m
     expect(errs.phone).toBe("Phone number is required");[m
[36m@@ -539,6 +548,9 @@[m [mdescribe("Business onboarding step validation", () => {[m
       lutArn: "",[m
       eInvoiceEnabled: false,[m
       eWayBillEnabled: false,[m
[32m+[m[32m      assesseeOfOtherTerritory: false,[m
[32m+[m[32m      gstReturnPeriodicity: "monthly",[m
[32m+[m[32m      eWayBillThreshold: null,[m
     });[m
     expect(addressErrs.address).toBe("Address is required");[m
 [m
[36m@@ -581,6 +593,9 @@[m [mdescribe("Business onboarding step validation", () => {[m
       lutArn: "",[m
       eInvoiceEnabled: false,[m
       eWayBillEnabled: false,[m
[32m+[m[32m      assesseeOfOtherTerritory: false,[m
[32m+[m[32m      gstReturnPeriodicity: "monthly",[m
[32m+[m[32m      eWayBillThreshold: null,[m
     });[m
     expect(locationErrs.pincode).toBe("Pincode is required");[m
     expect(locationErrs.city).toBe("City is required");[m
[1mdiff --git a/apps/web/src/components/settings/BusinessTab.tsx b/apps/web/src/components/settings/BusinessTab.tsx[m
[1mindex 6b3bb54..67fd0dd 100644[m
[1m--- a/apps/web/src/components/settings/BusinessTab.tsx[m
[1m+++ b/apps/web/src/components/settings/BusinessTab.tsx[m
[36m@@ -68,6 +68,9 @@[m [mexport interface BusinessStepValues {[m
   lutArn: string;[m
   eInvoiceEnabled: boolean;[m
   eWayBillEnabled: boolean;[m
[32m+[m[32m  assesseeOfOtherTerritory: boolean;[m
[32m+[m[32m  gstReturnPeriodicity: string;[m
[32m+[m[32m  eWayBillThreshold: number | null;[m
 }[m
 [m
 export function validateBusinessStep([m
[36m@@ -319,6 +322,19 @@[m [mexport function BusinessForm({[m
     existing?.eWayBillEnabled ?? false,[m
   );[m
 [m
[32m+[m[32m  const [assesseeOfOtherTerritory, setAssesseeOfOtherTerritory] =[m
[32m+[m[32m    useState(existing?.assesseeOfOtherTerritory ?? false);[m
[32m+[m
[32m+[m[32m  const [gstReturnPeriodicity, setGstReturnPeriodicity] = useState<[m
[32m+[m[32m    "monthly" | "quarterly"[m
[32m+[m[32m  >(existing?.gstReturnPeriodicity ?? "monthly");[m
[32m+[m
[32m+[m[32m  const [eWayBillThreshold, setEWayBillThreshold] = useState([m
[32m+[m[32m    existing?.eWayBillThreshold != null[m
[32m+[m[32m      ? String(existing.eWayBillThreshold)[m
[32m+[m[32m      : "",[m
[32m+[m[32m  );[m
[32m+[m
   const [currentStep, setCurrentStep] = useState(0);[m
   const [errors, setErrors] = useState<Record<string, string>>({});[m
 [m
[36m@@ -616,7 +632,13 @@[m [mexport function BusinessForm({[m
               <Listbox[m
                 label="GST Registration"[m
                 value={gstRegType}[m
[31m-                onChange={setGstRegType}[m
[32m+[m[32m                onChange={(value) => {[m
[32m+[m[32m                  setGstRegType(value);[m
[32m+[m
[32m+[m[32m                  if (value !== "regular") {[m
[32m+[m[32m                    setEInvoiceEnabled(false);[m
[32m+[m[32m                  }[m
[32m+[m[32m                }}[m
                 options={GST_REG_OPTIONS}[m
               />[m
 [m
[36m@@ -698,32 +720,89 @@[m [mexport function BusinessForm({[m
               />[m
             </div>[m
 [m
[32m+[m
             <div className="space-y-3">[m
               <h3 className="text-sm font-semibold text-text-primary">[m
[31m-                Compliance features[m
[32m+[m[32m                GST configuration[m
               </h3>[m
 [m
               <label className="flex items-center justify-between rounded-xl border border-border-light p-4 cursor-pointer">[m
                 <div>[m
                   <p className="text-sm font-medium text-text-primary">[m
[31m-                    Enable e-Invoice[m
[32m+[m[32m                    Assessee of Other Territory[m
                   </p>[m
[31m-[m
                   <p className="text-xs text-text-tertiary mt-1">[m
[31m-                    Enable e-Invoice functionality for this business.[m
[32m+[m[32m                    Specify whether the business is an assessee of another territory.[m
                   </p>[m
                 </div>[m
[31m-[m
                 <input[m
                   type="checkbox"[m
[31m-                  checked={eInvoiceEnabled}[m
[32m+[m[32m                  checked={assesseeOfOtherTerritory}[m
                   onChange={(e) =>[m
[31m-                    setEInvoiceEnabled(e.target.checked)[m
[32m+[m[32m                    setAssesseeOfOtherTerritory(e.target.checked)[m
                   }[m
                   className="h-4 w-4"[m
                 />[m
               </label>[m
 [m
[32m+[m[32m              <div className="space-y-1.5">[m
[32m+[m[32m                <label className="text-sm font-medium text-text-primary">[m
[32m+[m[32m                  GST/VAT Return Periodicity[m
[32m+[m[32m                </label>[m
[32m+[m[32m                <select[m
[32m+[m[32m                  value={gstReturnPeriodicity}[m
[32m+[m[32m                  onChange={(e) =>[m
[32m+[m[32m                    setGstReturnPeriodicity([m
[32m+[m[32m                      e.target.value as "monthly" | "quarterly",[m
[32m+[m[32m                    )[m
[32m+[m[32m                  }[m
[32m+[m[32m                  className="w-full rounded-xl border border-border-light bg-surface px-3 py-2 text-sm text-text-primary"[m
[32m+[m[32m                >[m
[32m+[m[32m                  <option value="monthly">Monthly</option>[m
[32m+[m[32m                  <option value="quarterly">Quarterly (QRMP)</option>[m
[32m+[m[32m                </select>[m
[32m+[m[32m              </div>[m
[32m+[m
[32m+[m[32m              <div className="space-y-1.5">[m
[32m+[m[32m                <label className="text-sm font-medium text-text-primary">[m
[32m+[m[32m                  E-Way Bill Threshold (₹)[m
[32m+[m[32m                </label>[m
[32m+[m[32m                <input[m
[32m+[m[32m                  type="number"[m
[32m+[m[32m                  min="0"[m
[32m+[m[32m                  step="0.01"[m
[32m+[m[32m                  value={eWayBillThreshold}[m
[32m+[m[32m                  onChange={(e) => setEWayBillThreshold(e.target.value)}[m
[32m+[m[32m                  placeholder="Optional"[m
[32m+[m[32m                  className="w-full rounded-xl border border-border-light bg-surface px-3 py-2 text-sm text-text-primary"[m
[32m+[m[32m                />[m
[32m+[m[32m              </div>[m
[32m+[m[32m            </div>[m
[32m+[m
[32m+[m[32m            <div className="space-y-3">[m
[32m+[m[32m              <h3 className="text-sm font-semibold text-text-primary">[m
[32m+[m[32m                Compliance features[m
[32m+[m[32m              </h3>[m
[32m+[m
[32m+[m[32m              <label className="flex items-center justify-between gap-4">[m
[32m+[m[32m                <div>[m
[32m+[m[32m                  <p className="font-medium">Enable e-Invoice</p>[m
[32m+[m[32m                  <p className="text-sm text-muted-foreground">[m
[32m+[m[32m                    {gstRegType === "regular"[m
[32m+[m[32m                      ? "Enable e-Invoice functionality for this business."[m
[32m+[m[32m                      : "Available only when GST Registration is set to Regular."}[m
[32m+[m[32m                  </p>[m
[32m+[m[32m                </div>[m
[32m+[m
[32m+[m[32m                <input[m
[32m+[m[32m                  type="checkbox"[m
[32m+[m[32m                  checked={gstRegType === "regular" && eInvoiceEnabled}[m
[32m+[m[32m                  disabled={gstRegType !== "regular"}[m
[32m+[m[32m                  onChange={(e) => setEInvoiceEnabled(e.target.checked)}[m
[32m+[m[32m                  className="h-4 w-4 disabled:cursor-not-allowed disabled:opacity-50"[m
[32m+[m[32m                />[m
[32m+[m[32m              </label>[m
[32m+[m
               <label className="flex items-center justify-between rounded-xl border border-border-light p-4 cursor-pointer">[m
                 <div>[m
                   <p className="text-sm font-medium text-text-primary">[m
[36m@@ -845,6 +924,15 @@[m [mexport function BusinessForm({[m
                     : gstin || "—"}[m
                 </li>[m
 [m
[32m+[m[32m                <li>[m
[32m+[m[32m                  <span className="text-text-tertiary">[m
[32m+[m[32m                    GST Registration:[m
[32m+[m[32m                  </span>{" "}[m
[32m+[m[32m                  {GST_REG_OPTIONS.find([m
[32m+[m[32m                    (option) => option.value === gstRegType[m
[32m+[m[32m                  )?.label ?? "Not GST Registered"}[m
[32m+[m[32m                </li>[m
[32m+[m
                 <li>[m
                   <span className="text-text-tertiary">TAN:</span>{" "}[m
                   {tan || "—"}[m
[36m@@ -894,6 +982,32 @@[m [mexport function BusinessForm({[m
                   </span>{" "}[m
                   {eWayBillEnabled ? "Enabled" : "Disabled"}[m
                 </li>[m
[32m+[m
[32m+[m
[32m+[m[32m                <li>[m
[32m+[m[32m                  <span className="text-text-tertiary">[m
[32m+[m[32m                    Other Territory:[m
[32m+[m[32m                  </span>{" "}[m
[32m+[m[32m                  {assesseeOfOtherTerritory ? "Yes" : "No"}[m
[32m+[m[32m                </li>[m
[32m+[m
[32m+[m[32m                <li>[m
[32m+[m[32m                  <span className="text-text-tertiary">[m
[32m+[m[32m                    Return Periodicity:[m
[32m+[m[32m                  </span>{" "}[m
[32m+[m[32m                  {gstReturnPeriodicity === "monthly"[m
[32m+[m[32m                    ? "Monthly"[m
[32m+[m[32m                    : "Quarterly (QRMP)"}[m
[32m+[m[32m                </li>[m
[32m+[m
[32m+[m[32m                <li>[m
[32m+[m[32m                  <span className="text-text-tertiary">[m
[32m+[m[32m                    E-Way Bill Threshold:[m
[32m+[m[32m                  </span>{" "}[m
[32m+[m[32m                  {eWayBillThreshold.trim()[m
[32m+[m[32m                    ? `₹${Number(eWayBillThreshold).toLocaleString("en-IN")}`[m
[32m+[m[32m                    : "Not set"}[m
[32m+[m[32m                </li>[m
               </ul>[m
             </div>[m
 [m
[36m@@ -958,6 +1072,12 @@[m [mexport function BusinessForm({[m
       lutArn,[m
       eInvoiceEnabled,[m
       eWayBillEnabled,[m
[32m+[m[32m      assesseeOfOtherTerritory,[m
[32m+[m[32m      gstReturnPeriodicity,[m
[32m+[m[32m      eWayBillThreshold:[m
[32m+[m[32m        eWayBillThreshold.trim() === ""[m
[32m+[m[32m          ? null[m
[32m+[m[32m          : Number(eWayBillThreshold),[m
     });[m
 [m
     if (Object.keys(stepErrors).length > 0) {[m
[36m@@ -1033,6 +1153,12 @@[m [mexport function BusinessForm({[m
 [m
       eInvoiceEnabled,[m
       eWayBillEnabled,[m
[32m+[m[32m      assesseeOfOtherTerritory,[m
[32m+[m[32m      gstReturnPeriodicity,[m
[32m+[m[32m      eWayBillThreshold:[m
[32m+[m[32m        eWayBillThreshold.trim() === ""[m
[32m+[m[32m          ? undefined[m
[32m+[m[32m          : Number(eWayBillThreshold),[m
     };[m
 [m
     if (existing) {[m
[1mdiff --git a/packages/api/src/routers/business.ts b/packages/api/src/routers/business.ts[m
[1mindex 7f6fb30..5f0dd12 100644[m
[1m--- a/packages/api/src/routers/business.ts[m
[1m+++ b/packages/api/src/routers/business.ts[m
[36m@@ -285,6 +285,10 @@[m [mexport const businessRouter = router({[m
     const biz = await ctx.db.transaction(async (tx) => {[m
       const [biz] = await tx.insert(businesses).values({[m
         ...input,[m
[32m+[m[32m        eWayBillThreshold:[m
[32m+[m[32m          input.eWayBillThreshold == null[m
[32m+[m[32m            ? null[m
[32m+[m[32m            : String(input.eWayBillThreshold),[m
         createdByUserId: ctx.user.id,[m
       }).returning();[m
 [m
[1mdiff --git a/packages/db/drizzle-control/meta/_journal.json b/packages/db/drizzle-control/meta/_journal.json[m
[1mindex d3bcbaf..fe7234a 100644[m
[1m--- a/packages/db/drizzle-control/meta/_journal.json[m
[1m+++ b/packages/db/drizzle-control/meta/_journal.json[m
[36m@@ -36,6 +36,13 @@[m
       "when": 1700000000000,[m
       "tag": "0000_add_tenant_referral_code",[m
       "breakpoints": false[m
[32m+[m[32m    },[m
[32m+[m[32m    {[m
[32m+[m[32m      "idx": 5,[m
[32m+[m[32m      "version": "7",[m
[32m+[m[32m      "when": 1790607429010,[m
[32m+[m[32m      "tag": "0005_useful_darkhawk",[m
[32m+[m[32m      "breakpoints": true[m
     }[m
   ][m
 }[m
\ No newline at end of file[m
[1mdiff --git a/packages/db/drizzle-tenant/meta/_journal.json b/packages/db/drizzle-tenant/meta/_journal.json[m
[1mindex 1477a79..e0e95a9 100644[m
[1m--- a/packages/db/drizzle-tenant/meta/_journal.json[m
[1m+++ b/packages/db/drizzle-tenant/meta/_journal.json[m
[36m@@ -92,6 +92,20 @@[m
       "when": 1790593679168,[m
       "tag": "0012_amusing_madame_hydra",[m
       "breakpoints": true[m
[32m+[m[32m    },[m
[32m+[m[32m    {[m
[32m+[m[32m      "idx": 13,[m
[32m+[m[32m      "version": "7",[m
[32m+[m[32m      "when": 1790600000000,[m
[32m+[m[32m      "tag": "0013_gst_step_two_settings",[m
[32m+[m[32m      "breakpoints": true[m
[32m+[m[32m    },[m
[32m+[m[32m    {[m
[32m+[m[32m      "idx": 14,[m
[32m+[m[32m      "version": "7",[m
[32m+[m[32m      "when": 1790607430367,[m
[32m+[m[32m      "tag": "0014_superb_firebird",[m
[32m+[m[32m      "breakpoints": true[m
     }[m
   ][m
 }[m
\ No newline at end of file[m
[1mdiff --git a/packages/db/drizzle/meta/_journal.json b/packages/db/drizzle/meta/_journal.json[m
[1mindex 6eb017b..4a2fdc9 100644[m
[1m--- a/packages/db/drizzle/meta/_journal.json[m
[1m+++ b/packages/db/drizzle/meta/_journal.json[m
[36m@@ -162,6 +162,13 @@[m
       "when": 1790596945041,[m
       "tag": "0022_add_session_auth_fields",[m
       "breakpoints": true[m
[32m+[m[32m    },[m
[32m+[m[32m    {[m
[32m+[m[32m      "idx": 23,[m
[32m+[m[32m      "version": "7",[m
[32m+[m[32m      "when": 1790607427472,[m
[32m+[m[32m      "tag": "0023_loose_miracleman",[m
[32m+[m[32m      "breakpoints": true[m
     }[m
   ][m
 }[m
\ No newline at end of file[m
[1mdiff --git a/packages/db/src/tenant-schema.ts b/packages/db/src/tenant-schema.ts[m
[1mindex 6806fad..a570017 100644[m
[1m--- a/packages/db/src/tenant-schema.ts[m
[1m+++ b/packages/db/src/tenant-schema.ts[m
[36m@@ -68,6 +68,16 @@[m [mexport const businesses = pgTable("businesses", {[m
   eWayBillEnabled: boolean("e_way_bill_enabled")[m
     .default(false)[m
     .notNull(),[m
[32m+[m[32m  assesseeOfOtherTerritory: boolean("assessee_of_other_territory")[m
[32m+[m[32m    .default(false)[m
[32m+[m[32m    .notNull(),[m
[32m+[m[32m  gstReturnPeriodicity: text("gst_return_periodicity")[m
[32m+[m[32m    .default("monthly")[m
[32m+[m[32m    .notNull(),[m
[32m+[m[32m  eWayBillThreshold: numeric("e_way_bill_threshold", {[m
[32m+[m[32m    precision: 15,[m
[32m+[m[32m    scale: 2,[m
[32m+[m[32m  }),[m
   phone: text("phone"),[m
   email: text("email"),[m
   address: text("address"),[m
[1mdiff --git a/packages/shared/src/validators.ts b/packages/shared/src/validators.ts[m
[1mindex 455a0e9..eb77148 100644[m
[1m--- a/packages/shared/src/validators.ts[m
[1m+++ b/packages/shared/src/validators.ts[m
[36m@@ -124,6 +124,13 @@[m [mexport const createBusinessSchema = z.object({[m
   lutArn: z.string().max(100).optional().or(z.literal("")),[m
   eInvoiceEnabled: z.boolean().default(false),[m
   eWayBillEnabled: z.boolean().default(false),[m
[32m+[m[32m  assesseeOfOtherTerritory: z.boolean().default(false),[m
[32m+[m[32m  gstReturnPeriodicity: z.enum(["monthly", "quarterly"]).default("monthly"),[m
[32m+[m[32m  eWayBillThreshold: z.coerce[m
[32m+[m[32m    .number()[m
[32m+[m[32m    .nonnegative()[m
[32m+[m[32m    .optional()[m
[32m+[m[32m    .nullable(),[m
 [m
   // Document defaults[m
   invoicePrefix: z.string().min(1).max(10).default("INV"),[m
