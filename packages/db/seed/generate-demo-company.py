"""
Generates demo-company.sql: a ready-made demo organisation with a business,
customers, suppliers, items, invoices, payments, bank accounts and expenses.

    python generate-demo-company.py > demo-company.sql

The SQL is plain and idempotent (it clears the demo rows first, then inserts),
so it can be run again at any time. Dates are relative to now(), so the data
always looks recent. All amounts follow the app's own GST rules (taxable value
after line discount, tax rounded per head, total rounded to the rupee).
"""
import random
import uuid
from decimal import Decimal, ROUND_HALF_UP

random.seed(2026)
NS = uuid.UUID("5d0c2c9a-8a1e-4a7e-9d33-0d3e0f0de110")
D = Decimal


def uid(name):
    return str(uuid.uuid5(NS, name))


def q2(x):
    return D(x).quantize(D("0.01"), rounding=ROUND_HALF_UP)


def lit(v):
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "TRUE" if v else "FALSE"
    if isinstance(v, (int, D)):
        return str(v)
    return "'" + str(v).replace("'", "''") + "'"


def ago(days, hour=11):
    """A timestamp `days` days ago at `hour` o'clock (negative = in the future)."""
    return f"(date_trunc('day', now()) - interval '{days} days' + interval '{hour} hours')"


class Raw(str):
    pass


def val(v):
    return str(v) if isinstance(v, Raw) else lit(v)


out = []


def insert(table, cols, rows):
    if not rows:
        return
    out.append(f"INSERT INTO {table} ({', '.join(cols)}) VALUES")
    out.append(",\n".join("  (" + ", ".join(val(v) for v in r) + ")" for r in rows) + ";\n")


# ── Fixed ids ────────────────────────────────────────────────────────────
TENANT = uid("tenant")
USER = uid("user")
BIZ = uid("business")
PASSWORD_HASH = "$argon2id$v=19$m=65536,t=3,p=4$JlEhoase664fShleJhzAZA$9Y6o6C50gRhsm5uAxkIbAcUT70gQ6dejdTQlZYpuRUQ"
EMAIL = "demo@fintranzact.test"
BIZ_STATE, BIZ_CODE = "Maharashtra", "27"

# ── Parties ──────────────────────────────────────────────────────────────
# key, type, name, city, state, code, gstin, pan, phone, category, credit days
PARTIES = [
    ("c1", "customer", "Sunrise Supermart", "Pune", "Maharashtra", "27", "27AAJCS5678K1Z2", "AAJCS5678K", "9822011001", "Retail", 30),
    ("c2", "customer", "Patel General Stores", "Ahmedabad", "Gujarat", "24", "24AABFP2345L1Z8", "AABFP2345L", "9825022002", "Retail", 15),
    ("c3", "customer", "Kumar Kirana", "Mumbai", "Maharashtra", "27", None, None, "9820033003", "Retail", 7),
    ("c4", "customer", "Gupta Wholesale Mart", "Indore", "Madhya Pradesh", "23", "23AAGFG7890M1Z4", "AAGFG7890M", "9826044004", "Wholesale", 45),
    ("c5", "customer", "Royal Hotel & Caterers", "Nashik", "Maharashtra", "27", "27AAECR3456N1Z6", "AAECR3456N", "9823055005", "HoReCa", 30),
    ("c6", "customer", "Walk-in Customer", "Pune", "Maharashtra", "27", None, None, None, "Cash sales", 0),
    ("s1", "supplier", "Agro Fresh Distributors", "Pune", "Maharashtra", "27", "27AACCA1111A1Z1", "AACCA1111A", "9822066006", "Groceries", 30),
    ("s2", "supplier", "Bharat FMCG Pvt Ltd", "Surat", "Gujarat", "24", "24AAACB2222B1Z2", "AAACB2222B", "9824077007", "FMCG", 45),
    ("s3", "supplier", "Delhi Electronics Hub", "New Delhi", "Delhi", "07", "07AAACD3333C1Z3", "AAACD3333C", "9811088008", "Electronics", 30),
]
P = {p[0]: p for p in PARTIES}

# ── Items ────────────────────────────────────────────────────────────────
# key, name, hsn, unit, type, sale, buy, mrp, tax %, opening stock, low alert, category
ITEMS = [
    ("rice", "Basmati Rice 5 kg", "1006", "bag", "product", 520, 430, 560, 5, 120, 30, "Grocery"),
    ("dal", "Toor Dal 1 kg", "0713", "pkt", "product", 165, 140, 180, 5, 200, 50, "Grocery"),
    ("oil", "Sunflower Oil 1 L", "1512", "pkt", "product", 145, 125, 160, 5, 180, 40, "Grocery"),
    ("sugar", "Sugar 1 kg", "1701", "pkt", "product", 48, 41, 54, 5, 300, 60, "Grocery"),
    ("tea", "Premium Tea 500 g", "0902", "pkt", "product", 240, 200, 275, 5, 90, 25, "Grocery"),
    ("ghee", "Pure Ghee 1 kg", "0405", "pkt", "product", 620, 540, 680, 12, 60, 15, "Grocery"),
    ("eggs", "Farm Eggs (dozen)", "0407", "dozen", "product", 84, 70, 90, 0, 80, 20, "Grocery"),
    ("detergent", "Detergent Powder 1 kg", "3402", "pkt", "product", 120, 95, 135, 18, 150, 40, "Household"),
    ("soap", "Bathing Soap (pack of 4)", "3401", "pack", "product", 150, 115, 170, 18, 140, 35, "Household"),
    ("notebook", "Notebook A4 (172 pages)", "4820", "pcs", "product", 60, 42, 70, 12, 250, 60, "Stationery"),
    ("bulb", "LED Bulb 9 W", "8539", "pcs", "product", 110, 72, 135, 18, 160, 40, "Electronics"),
    ("charger", "Mobile Charger 20 W", "8504", "pcs", "product", 399, 240, 499, 18, 70, 20, "Electronics"),
    ("bottle", "Steel Water Bottle 750 ml", "7323", "pcs", "product", 450, 310, 549, 18, 55, 15, "Household"),
    ("tshirt", "Cotton T-Shirt", "6109", "pcs", "product", 399, 250, 599, 5, 100, 25, "Apparel"),
    ("install", "Delivery & Installation", "9965", "other", "service", 500, None, None, 18, 0, None, "Services"),
    ("amc", "Annual Maintenance Contract", "9987", "other", "service", 6000, None, None, 18, 0, None, "Services"),
]
IT = {i[0]: i for i in ITEMS}
stock = {i[0]: D(i[9]) for i in ITEMS}


def intra(code):
    return code == BIZ_CODE


def line(item_key, qty, disc=0, price=None):
    it = IT[item_key]
    unit_price = D(price if price is not None else it[5])
    qty = D(qty)
    taxable = q2(qty * unit_price * (D(100) - D(disc)) / D(100))
    return dict(key=item_key, name=it[1], qty=qty, price=unit_price, disc=D(disc), rate=D(it[8]), taxable=taxable, unit=it[3])


def tax_on(taxable, rate, is_intra):
    if is_intra:
        half = q2(taxable * rate / D(200))
        return half + half
    return q2(taxable * rate / D(100))


def totals(lines, is_intra):
    for ln in lines:
        ln["tax"] = tax_on(ln["taxable"], ln["rate"], is_intra)
        ln["total"] = ln["taxable"] + ln["tax"]
    subtotal = sum((ln["taxable"] for ln in lines), D(0))
    tax = sum((ln["tax"] for ln in lines), D(0))
    gross = subtotal + tax
    total = gross.quantize(D("1"), rounding=ROUND_HALF_UP)
    return subtotal, tax, total - gross, total


# ── Documents ────────────────────────────────────────────────────────────
# (kind, number, party, days_ago, due_in_days, status_hint, lines, paid_fraction, notes)
sales_plan = [
    ("c1", 148, 30, [("rice", 20), ("dal", 30), ("oil", 24, 2)], "paid"),
    ("c2", 141, 15, [("sugar", 60), ("tea", 20), ("detergent", 25)], "paid"),
    ("c4", 135, 45, [("rice", 40, 3), ("dal", 60), ("sugar", 100)], "paid"),
    ("c5", 128, 30, [("oil", 40), ("ghee", 12), ("eggs", 30)], "paid"),
    ("c3", 121, 7, [("soap", 12), ("detergent", 10)], "paid"),
    ("c1", 112, 30, [("bulb", 40), ("charger", 15), ("install", 1)], "paid"),
    ("c2", 104, 15, [("notebook", 80), ("bottle", 12)], "paid"),
    ("c4", 96, 45, [("tshirt", 30), ("bottle", 10)], "partial"),
    ("c5", 88, 30, [("rice", 15), ("tea", 10), ("ghee", 8)], "paid"),
    ("c1", 79, 30, [("dal", 40), ("oil", 30), ("sugar", 50)], "paid"),
    ("c3", 70, 7, [("eggs", 10), ("soap", 6)], "paid"),
    ("c2", 62, 15, [("detergent", 30), ("soap", 20), ("bulb", 25)], "partial"),
    ("c4", 55, 45, [("rice", 30), ("dal", 50)], "paid"),
    ("c5", 47, 30, [("oil", 25), ("sugar", 40), ("amc", 1)], "overdue"),
    ("c1", 38, 30, [("tshirt", 20), ("notebook", 50), ("charger", 10)], "partial"),
    ("c3", 31, 7, [("tea", 6), ("dal", 8)], "overdue"),
    ("c2", 24, 15, [("rice", 25), ("ghee", 6)], "sent"),
    ("c4", 18, 45, [("sugar", 80), ("oil", 30), ("detergent", 20)], "sent"),
    ("c1", 11, 30, [("bottle", 8), ("bulb", 30), ("install", 1)], "sent"),
    ("c5", 6, 30, [("eggs", 25), ("dal", 20)], "sent"),
    ("c6", 3, 0, [("soap", 2), ("tea", 1), ("eggs", 2)], "paid"),
    ("c3", 2, 7, [("notebook", 20)], "draft"),
    ("c1", 1, 30, [("rice", 10)], "cancelled"),
]
purchase_plan = [
    ("s1", 150, 30, [("rice", 100), ("dal", 150), ("sugar", 250), ("oil", 120)], "paid", "AFD/26/0412"),
    ("s2", 120, 45, [("detergent", 150), ("soap", 140), ("tea", 80)], "paid", "BF-7781"),
    ("s3", 100, 30, [("bulb", 160), ("charger", 70)], "paid", "DEH/2261"),
    ("s1", 60, 30, [("eggs", 80), ("ghee", 40), ("oil", 80)], "partial", "AFD/26/0509"),
    ("s2", 25, 45, [("notebook", 200), ("bottle", 50), ("tshirt", 100)], "sent", "BF-8010"),
    ("s3", 8, 30, [("charger", 40), ("bulb", 60)], "sent", "DEH/2318"),
]

docs = []  # collected invoice dicts
inv_no = 0
for pk, days, due, ls, status in sales_plan:
    inv_no += 1
    docs.append(dict(type="sale", dtype="invoice", number=f"INV-{inv_no:05d}", party=pk, days=days, due=due,
                     lines=[line(*l) if len(l) == 3 else line(l[0], l[1]) for l in ls], status=status, supplier_no=None))
pur_no = 0
for pk, days, due, ls, status, sno in purchase_plan:
    pur_no += 1
    lines_ = []
    for l in ls:
        it = IT[l[0]]
        lines_.append(line(l[0], l[1], price=it[6]))
    docs.append(dict(type="purchase", dtype="invoice", number=f"PUR-{pur_no:05d}", party=pk, days=days, due=due,
                     lines=lines_, status=status, supplier_no=sno))

# Quotations and a credit note (no stock or payment effect except the credit note, which is left open)
quo_no = 0
for pk, days, ls in [("c4", 9, [("rice", 60), ("dal", 80)]), ("c5", 4, [("oil", 50), ("ghee", 20), ("amc", 1)])]:
    quo_no += 1
    docs.append(dict(type="sale", dtype="quotation", number=f"QTN-{quo_no:05d}", party=pk, days=days, due=15,
                     lines=[line(*l) if len(l) == 3 else line(l[0], l[1]) for l in ls], status="sent", supplier_no=None))
docs.append(dict(type="sale", dtype="credit_note", number="CN-00001", party="c2", days=20, due=0,
                 lines=[line("detergent", 4)], status="sent", supplier_no=None))

# ── Compute amounts, paid, stock ─────────────────────────────────────────
payments = []  # dicts
pay_no = 0
for d in docs:
    is_in = intra(P[d["party"]][5])
    d["sub"], d["tax"], d["round"], d["total"] = totals(d["lines"], is_in)
    d["paid"] = D(0)
    d["id"] = uid("inv-" + d["number"])
    if d["dtype"] == "invoice":
        if d["status"] == "sent" and d["days"] > d["due"]:
            d["status"] = "overdue"  # unpaid and past its due date
        for ln in d["lines"]:
            if IT[ln["key"]][4] == "product" and d["status"] not in ("draft", "cancelled"):
                stock[ln["key"]] += ln["qty"] if d["type"] == "purchase" else -ln["qty"]
        if d["status"] == "paid":
            d["paid"] = d["total"]
        elif d["status"] == "partial":
            d["paid"] = (d["total"] * D("0.4")).quantize(D("1"), rounding=ROUND_HALF_UP)

# Bank accounts
BANKS = [
    ("cash", "Cash in Hand", None, None, None, "cash", D("25000"), True),
    ("hdfc", "HDFC Current A/c", "50200012345678", "HDFC0000123", "HDFC Bank", "current", D("350000"), False),
    ("upi", "Business UPI", "sharma.traders@okhdfcbank", None, "HDFC Bank", "upi", D("60000"), False),
]
bal = {b[0]: b[6] for b in BANKS}
bank_tx = []


def mode_for(i):
    return [("bank", "hdfc"), ("upi", "upi"), ("cash", "cash"), ("bank", "hdfc")][i % 4]


idx = 0
for d in docs:
    if d["dtype"] != "invoice" or d["paid"] <= 0:
        continue
    pay_no += 1
    idx += 1
    mode, acct = mode_for(idx)
    if d["party"] == "c6":
        mode, acct = "cash", "cash"
    # Customers pay a few days after the invoice (suppliers too).
    days_ago = max(d["days"] - random.randint(2, 12), 0)
    p = dict(id=uid("pay-" + d["number"]), number=f"PAY-{pay_no:05d}", invoice=d, amount=d["paid"], mode=mode, acct=acct,
             days=days_ago, ref=(f"UTR{random.randint(10**9, 10**10 - 1)}" if mode in ("bank", "upi") else None))
    payments.append(p)
    delta = p["amount"] if d["type"] == "sale" else -p["amount"]
    bal[acct] += delta
    bank_tx.append(dict(id=uid("bt-" + p["id"]), acct=acct, type="deposit" if d["type"] == "sale" else "withdrawal",
                        amount=p["amount"], desc=f"Payment {p['number']} - {P[d['party']][2]}", ref_id=p["id"], days=days_ago))

EXPENSES = [
    ("Rent", "Shop rent", 28000, "bank", "hdfc", 62), ("Rent", "Shop rent", 28000, "bank", "hdfc", 32), ("Rent", "Shop rent", 28000, "bank", "hdfc", 2),
    ("Salaries", "Staff salaries", 54000, "bank", "hdfc", 60), ("Salaries", "Staff salaries", 54000, "bank", "hdfc", 30),
    ("Electricity", "Electricity bill", 6420, "upi", "upi", 45), ("Electricity", "Electricity bill", 7110, "upi", "upi", 15),
    ("Transport", "Freight and delivery", 3800, "cash", "cash", 21), ("Transport", "Freight and delivery", 2650, "cash", "cash", 9),
    ("Marketing", "Flyers and banner", 4500, "upi", "upi", 40),
    ("Office", "Stationery and supplies", 1850, "cash", "cash", 12),
    ("Insurance", "Shop insurance premium", 9600, "bank", "hdfc", 85),
]
exp_rows = []
for i, (cat, desc, amt, mode, acct, days) in enumerate(EXPENSES, 1):
    eid = uid(f"exp-{i}")
    exp_rows.append((eid, cat, desc, D(amt), mode, days, acct))
    bal[acct] -= D(amt)
    bank_tx.append(dict(id=uid("bt-" + eid), acct=acct, type="withdrawal", amount=D(amt), desc=f"{cat}: {desc}", ref_id=eid, days=days, ref_type="expense"))

# ── Emit SQL ─────────────────────────────────────────────────────────────
out.append("""-- Demo company for manual testing. Generated by generate-demo-company.py.
--
--   Login:     %s
--   Password:  Demo@12345
--   Business:  Sharma Traders (Pune, Maharashtra)
--
-- Safe to run again: it removes the demo organisation first. It touches only
-- rows with the demo ids below and never anyone else's data.
-- Run with:  psql "$DATABASE_URL" -f demo-company.sql

BEGIN;

-- ── Clear any earlier copy ──
DELETE FROM payment_allocations WHERE payment_id IN (SELECT id FROM payments WHERE business_id = '%s');
DELETE FROM bank_transactions   WHERE business_id = '%s';
DELETE FROM payments            WHERE business_id = '%s';
DELETE FROM expenses            WHERE business_id = '%s';
DELETE FROM invoice_items       WHERE invoice_id IN (SELECT id FROM invoices WHERE business_id = '%s');
DELETE FROM invoices            WHERE business_id = '%s';
DELETE FROM items               WHERE business_id = '%s';
DELETE FROM parties             WHERE business_id = '%s';
DELETE FROM bank_accounts       WHERE business_id = '%s';
DELETE FROM business_members    WHERE business_id = '%s';
DELETE FROM businesses          WHERE id = '%s';
DELETE FROM tenants             WHERE id = '%s';
DELETE FROM users               WHERE id = '%s' OR email = '%s';
""" % ((EMAIL,) + (BIZ,) * 11 + (TENANT, USER, EMAIL)))

# Control data
insert("users", ["id", "email", "name", "password_hash", "email_verified"], [(USER, EMAIL, "Demo Owner", PASSWORD_HASH, True)])
insert("tenants", ["id", "name", "slug", "plan", "status", "plan_selected_at"],
       [(TENANT, "Sharma Traders Group", "demo-sharma-traders", "pro", "active", Raw("now()"))])
insert("tenant_members", ["id", "tenant_id", "user_id", "role", "accepted_at"],
       [(uid("member"), TENANT, USER, "owner", Raw("now()"))])

# Business
next_inv = inv_no + 1
next_pay = pay_no + 1
insert("businesses", [
    "id", "created_by_user_id", "name", "legal_name", "gst_registration_type", "gstin", "pan", "business_type", "phone", "email",
    "address", "address_line_1", "city", "state", "state_code", "pincode", "invoice_prefix", "next_invoice_number",
    "payment_prefix", "next_payment_number", "quotation_prefix", "next_quotation_number", "credit_note_prefix",
    "next_credit_note_number", "financial_year_start_month", "annual_turnover", "pos_enabled", "default_terms_and_conditions",
], [(
    BIZ, USER, "Sharma Traders", "Sharma Traders", "regular", "27AABCS1234F1Z5", "AABCS1234F", "proprietorship",
    "9822000000", "accounts@sharmatraders.example", "Shop 12, Market Yard, Pune, Maharashtra 411037", "Shop 12, Market Yard",
    "Pune", BIZ_STATE, BIZ_CODE, "411037", "INV", next_inv, "PAY", next_pay, "QTN", quo_no + 1, "CN", 2, 4, D("12500000"), True,
    "Goods once sold will not be taken back. Payment due within the credit period. Subject to Pune jurisdiction.",
)])
insert("business_members", ["id", "business_id", "user_id", "role"], [(uid("bm"), BIZ, USER, "admin")])

insert("bank_accounts",
       ["id", "business_id", "account_name", "account_number", "ifsc", "bank_name", "account_type", "opening_balance", "current_balance", "is_default"],
       [(uid("bank-" + b[0]), BIZ, b[1], b[2], b[3], b[4], b[5], b[6], bal[b[0]], b[7]) for b in BANKS])

insert("parties", [
    "id", "business_id", "type", "name", "phone", "email", "gstin", "pan", "billing_address", "city", "state", "state_code", "pincode",
    "opening_balance", "category", "credit_period_days", "contact_person_name", "gst_registration_type",
], [(
    uid("party-" + p[0]), BIZ, p[1], p[2], p[8], None if p[8] is None else p[2].lower().replace(" ", "").replace("&", "and")[:18] + "@example.com",
    p[6], p[7], f"{p[3]} market area, {p[3]}", p[3], p[4], p[5], None, D(0), p[9], p[10], None, "regular" if p[6] else "unregistered",
) for p in PARTIES])

insert("items", [
    "id", "business_id", "name", "hsn", "sku", "unit", "sale_price", "purchase_price", "mrp", "tax_percent", "stock_quantity",
    "low_stock_alert", "item_type", "category", "created_at",
], [(
    uid("item-" + i[0]), BIZ, i[1], i[2], f"SKU-{n:03d}", i[3], D(i[5]), None if i[6] is None else D(i[6]), None if i[7] is None else D(i[7]),
    D(i[8]), stock[i[0]] if i[4] == "product" else D(0), None if i[10] is None else D(i[10]), i[4], i[11], Raw(ago(120)),
) for n, i in enumerate(ITEMS, 1)])

insert("invoices", [
    "id", "business_id", "party_id", "type", "status", "document_type", "invoice_number", "supplier_invoice_number", "invoice_date",
    "due_date", "subtotal", "tax_amount", "discount_amount", "additional_charges", "round_off", "total_amount", "amount_paid",
    "stock_mode", "created_by_user_id", "created_by_name", "notes", "created_at", "updated_at",
], [(
    d["id"], BIZ, uid("party-" + d["party"]), d["type"], d["status"], d["dtype"], d["number"], d["supplier_no"], Raw(ago(d["days"])),
    Raw(ago(d["days"] - d["due"])) if d["due"] else None, d["sub"], d["tax"], D(0), D(0), d["round"], d["total"], d["paid"],
    "legacy", USER, "Demo Owner", "Thank you for your business." if d["type"] == "sale" and d["dtype"] == "invoice" else None,
    Raw(ago(d["days"])), Raw(ago(d["days"])),
) for d in docs])

item_rows = []
for d in docs:
    for n, ln in enumerate(d["lines"]):
        item_rows.append((uid(f"line-{d['number']}-{n}"), d["id"], uid("item-" + ln["key"]), ln["name"], ln["qty"], ln["price"], ln["rate"],
                          ln["tax"], ln["disc"], ln["total"], n, ln["unit"]))
insert("invoice_items", ["id", "invoice_id", "item_id", "item_name", "quantity", "unit_price", "tax_percent", "tax_amount",
                         "discount_percent", "total_amount", "sort_order", "selected_unit"], item_rows)

insert("payments", ["id", "payment_number", "business_id", "invoice_id", "party_id", "amount", "mode", "reference_number", "payment_date",
                    "bank_account_id", "created_by_user_id", "created_by_name", "notes"],
       [(p["id"], p["number"], BIZ, p["invoice"]["id"], uid("party-" + p["invoice"]["party"]), p["amount"], p["mode"], p["ref"], Raw(ago(p["days"], 15)),
         uid("bank-" + p["acct"]), USER, "Demo Owner", f"Against {p['invoice']['number']}") for p in payments])
insert("payment_allocations", ["id", "payment_id", "invoice_id", "amount"],
       [(uid("alloc-" + p["id"]), p["id"], p["invoice"]["id"], p["amount"]) for p in payments])

insert("expenses", ["id", "business_id", "category", "description", "amount", "mode", "expense_date", "bank_account_id", "created_by_user_id", "created_by_name"],
       [(e[0], BIZ, e[1], e[2], e[3], e[4], Raw(ago(e[5], 12)), uid("bank-" + e[6]), USER, "Demo Owner") for e in exp_rows])

insert("bank_transactions", ["id", "business_id", "bank_account_id", "type", "amount", "description", "reference_type", "reference_id", "transaction_date"],
       [(t["id"], BIZ, uid("bank-" + t["acct"]), t["type"], t["amount"], t["desc"], t.get("ref_type", "payment"), t["ref_id"], Raw(ago(t["days"], 15))) for t in bank_tx])

out.append("COMMIT;\n")
sold = sum(d["total"] for d in docs if d["type"] == "sale" and d["dtype"] == "invoice" and d["status"] != "cancelled")
out.append(f"-- {len(docs)} documents, {len(payments)} payments, {len(exp_rows)} expenses, {len(ITEMS)} items, {len(PARTIES)} parties. Sales total Rs {sold}.")
import sys

neg = {k: str(v) for k, v in stock.items() if v < 0}
print("negative stock:", neg or "none", file=sys.stderr)
sys.stdout.reconfigure(encoding="utf-8")
print("\n".join(out))
