# Payroll Phase 3: mobile attendance, self-service and biometric import

Phase 3 of the Payroll add-on (see [`payroll.md`](payroll.md)). `ADDON_FEATURES.payroll.implemented` stays **false**: nothing here puts the add-on on sale. Code: `packages/shared/src/payroll-self.ts` (pure rules), `packages/api/src/lib/payroll/{employee-access,punches,leave-requests}.ts`, routers `payrollSelf`, `payrollAccess`, `payrollPunch`, `payrollImport`, REST `packages/api/src/http/attendancePush.ts`.

## 1. Employee identity

An employee login is a normal user who is a member of one tenant with the new role `employee`, linked to exactly one employee record.

- Control DB: `invitations` gains `employee_id` and `business_id`; the `member_role` enum gains `hr` and `employee`.
- Tenant DB: `employee_logins` (`employee_id` unique; `business_id` + `user_id` unique) is the only thing that ties a login to an employee.
- **Invitation**: `payrollAccess.invite` sends a single-use link. Only the SHA-256 of the token is stored; it expires in 7 days; it is claimed with a conditional update (so two clicks cannot both succeed); the signed-up email must equal the invited email. A stale link is cleared on re-invite.
- **Accept** (`acceptEmployeeInvitation`, reached from the existing accept paths in `tenant.ts`) creates the `tenant_members` row (role `employee`), a `business_members` row for that one business only, and the `employee_logins` link.
- **Revoke**: `payrollAccess.revokeLogin`, `payrollEmployee.exit`, or removing the user from Team. When the last link goes, the tenant membership is removed too.
- Self-service procedures never take an employee id from the client. `resolveSelf` finds the employee from `employee_logins` for `ctx.user` and the current business.
- Phone-only invites are not built: there is no OTP login in the product, so an email address is required.

## 2. Seats

`SEATLESS_ROLES = ["auditor", "ca_filing", "employee"]` (shared `accountant-access.ts`) are excluded from `enforceTeamMemberLimit` and `countsTowardTeamLimit`. Employee logins are included in the Payroll add-on: no per-login charge and no team seat. `updateMemberRole` refuses to change an employee's role.

## 3. Roles

| Role | Payroll rights |
|---|---|
| `hr` | `Payroll` create, read, update and `Business:read`. No manage, so no approving runs, no delete, no unmasked identity numbers. No `PayrollPosting`. No AI. |
| `employee` | Only the new subject `PayrollSelf`. |
| `accountant`, `owner`, `admin` | As before, plus `PayrollPosting`. |

New subjects: `PayrollSelf` (employee only) and `PayrollPosting` (accountant, owner, admin; HR excluded). `payrollRun.post`, `payrollRun.markPaid` and `payrollStatutory.recordPayment` need `PayrollPosting`, so HR can prepare payroll but not post to the books.

**Employees can reach nothing else.** A backstop in `trpc.ts` `isAuthenticated` (shared by every authenticated procedure base, including protected and tenant procedures) refuses any call from an employee unless the path is in `EMPLOYEE_ALLOWED_PROCEDURES` (`payrollSelf.*`, `tenant.current`), `EMPLOYEE_ACCOUNT_PROCEDURES` (sign-in/out and organization switching: `tenant.list`, `select`, `leave`, invitation handling, `billing.config`, `plan.list`, `system.maintenanceStatus`, and similar) or the `auth.` prefix. It reads the role from the cached gate membership, so it adds no query per call. The AI assistant is a separate procedure family that employees cannot reach by the same rule. `employee-hr-sweep.test.ts` calls every procedure as an employee and as HR.

2FA is not required of employees (`two-factor.ts`): they have no access to anything that 2FA protects.

## 4. Punch model and rollup

Table `employee_punches`: one row per check-in or check-out.

- `punched_at` is the **server clock** (`punchClock.now`, replaceable in tests). `client_time` is kept for reference. A phone clock more than 600 seconds off is refused with a clear message.
- Rules: minimum 30 s between punches; a check-out needs an open check-in (an open "in" is valid for 18 hours); 40 punches an hour per employee; consent must be accepted (`ATTENDANCE_CONSENT_VERSION`, stored in `attendance_consents`).
- Source is `app`, `import` or `device`; `device_id` identifies the phone or device.
- **Rollup** (`rollupEmployeeDays`) uses pure functions. `sequencePunches` pairs punches by the IST day of the check-in (overnight shifts included), treats punches within 120 s as duplicates and reports `missed_out`, `orphan_out` and `open`. `rollupDay` gives a full day at 75% or more of the shift hours, a half day at 50% or more, flags late arrival after the grace period, and adds overtime only when enabled. The result is written to `attendance_records` with source `punch`. It never overwrites a `manual`, `leave` or `lock` row and skips a month that a payroll run has locked. Rejected punches are excluded.

## 5. Selfie storage and retention

- PNG or JPEG only (magic bytes checked by `validateLogoDataUrl`), at most 300 KB, stored as `bytea` in `employee_punch_selfies`, **not** in an object store and never at a public URL. The app shrinks the photo with `expo-image-manipulator` before sending.
- Only `hr`, `admin`, `superadmin` and the owner can read a selfie or a punch's location (`canViewAttendanceProof`). Selfies are returned as data URLs to a signed-in reviewer.
- Retention is a setting per business: 7 to 365 days, default 90. `purgeExpiredSelfies` runs from `selfie-purge-scheduler.ts` every 6 hours (started and stopped in `server.ts`), and immediately when retention is shortened. The punch row stays; the photo goes.
- Selfies are not part of the self-export, not logged and never sent to the AI. In the export, `employee_punches` has its latitude and longitude redacted.

## 6. Geofence policies

`attendance_settings.geofence_policy`: `off`, `record` (default), `warn`, `block`. Places are `work_locations` (centre and radius in metres); `employee_work_locations` assigns places to employees (none assigned means all of the business's places). `evaluateGeofence` uses the haversine distance. Results: `inside`, `outside`, `no_location`, `low_accuracy` (accuracy worse than 100 m), `not_checked`. Anything other than inside is flagged and gets `review_status = pending`; HR approves or rejects. `block` refuses an outside punch. The app's optional `mockLocation` hint flags `mock_location`.

**Limit:** the server cannot detect a faked location. It is evidence for review, not proof. Shift-level location assignment was not built; assignment is per employee.

## 7. Biometric formats and the push endpoint

Import (`payrollImport.preview` and `commit`): CSV or tab-separated text. `parseDelimitedText`, `guessImportMapping` and `buildImportPunches` handle a header row, an employee code column, a combined or split date and time, and an in/out column. `parseDeviceTimestamp` reads naive times as IST. A punch more than 24 hours in the future is invalid. The unique key (employee, `punched_at`, source, `device_id`) makes re-importing a file idempotent. Unknown employee codes are reported, not created. Each commit is a batch in `attendance_import_batches` and can be **undone**; to replace a file, undo and import again. Preview and commit are limited to 10 a minute.

No vendor SDK and no direct device protocol is included.

REST `POST /api/attendance/push` (policy `write-gated` in `rest-entitlement-policy.ts`): the caller sends `Authorization: Bearer fdk_<tenantId>_<48 hex>`, a per-business **device key** created by `payrollPunch.deviceKeyCreate`; only its SHA-256 is stored in `attendance_device_keys`. Body `{ punches: [{ employeeCode, timestamp, direction?, deviceId? }] }`, at most 500 punches and 256 KB. It needs the Payroll add-on and a writable organization (403 with the entitlement body otherwise) and is limited to 60 a minute per key and 120 a minute per IP. A separate key type is used because no REST route in this repo reads user API keys.

## 8. Security and 2FA

- Isolation: every self-service query is keyed on the employee found from the login. Tests prove one employee cannot see another's punches, payslips, leave or Form 16, in the same business or another.
- Payslips: only runs in `approved`, `posted` or `paid`. Form 16: only a year HR has released (`form16_releases`) in which the employee has approved payroll; the file is the Phase 2 working copy.
- Leave: `payrollSelf.leaveApply` and the HR path share `lib/payroll/leave-requests.ts`. Decisions notify the employee by the existing email service. No new notification channel was added.
- Employees are not asked for 2FA (section 3).
- Punch and import audit entries carry ids and counts, never coordinates or images.

## 9. AI exclusion

The AI assistant is unchanged. It has no tool for `payrollSelf`, `payrollPunch`, `payrollAccess` or `payrollImport`, and an employee cannot call it (the backstop above). Selfies, locations and punch records are never put into a prompt, a tool result or a log. A note in `lib/ai/tools.ts` records this rule.

## 10. Export decisions

The self-export registry (`lib/tableRegistry.ts`, shared `selfExport/rowSchemas.ts`) includes seven new tables: `attendance_settings`, `work_locations`, `employee_work_locations`, `employee_punches` (latitude and longitude redacted), `attendance_import_batches`, `attendance_consents` and `form16_releases`. **Not exported:** `employee_punch_selfies` (personal images), `employee_logins` (identity links) and `attendance_device_keys` (secrets).

## Not built, and known limits

- Live tracking, background location, vendor SDKs, face matching: out of scope on purpose.
- A faked location cannot be detected on the server.
- Phone-only invites (no OTP login exists).
- Per-shift location assignment (per employee only).
- Replacing an import in one step (use undo then import).
- Phase 4: the employee sees only their own loans and advances, read only (`payrollSelf.loans`, `payrollSelf.loanStatement`; see [`payroll-phase-4.md`](payroll-phase-4.md) section 5). Full and final settlements, bonus and gratuity have no employee view.
- No camera, GPS or device hardware was available where this was built: the capture flows are tested with the camera, location and server injected, and need a test on a real phone (see `PENDING-OWNER-TASKS.md`).
