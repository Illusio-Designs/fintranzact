import {
  Analytics01Icon,
  ApiIcon,
  BankIcon,
  BarCode01Icon,
  Briefcase01Icon,
  Building03Icon,
  Calendar03Icon,
  ChartBarLineIcon,
  CheckListIcon,
  ClipboardIcon,
  CloudUploadIcon,
  ComputerIcon,
  DeliveryTruck01Icon,
  Download04Icon,
  Factory01Icon,
  FileEditIcon,
  FileValidationIcon,
  GitCompareIcon,
  Invoice01Icon,
  Layers01Icon,
  Medicine02Icon,
  MoneyReceive01Icon,
  PackageIcon,
  PercentIcon,
  QrCodeIcon,
  RepeatIcon,
  Restaurant01Icon,
  ReturnRequestIcon,
  Route01Icon,
  SecurityCheckIcon,
  Share01Icon,
  ShoppingBag01Icon,
  ShoppingBasket01Icon,
  ShoppingCart01Icon,
  Store01Icon,
  Tag01Icon,
  Target02Icon,
  TaxesIcon,
  TShirtIcon,
  TvSmartIcon,
  Wallet01Icon,
  WarehouseIcon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@/components/ui/Icon";
import type { FeatureSlug } from "@/lib/feature-slugs";

/**
 * Content for the public solutions pages (/solutions and /solutions/<slug>).
 *
 * Every capability named here exists in the product today — each entry in
 * FEATURES was checked against the web routes and API routers. When adding a
 * page, reuse these entries instead of writing new claims, and leave out
 * anything that is not built yet (serial/IMEI numbers, KOT and table
 * management are NOT built). Batch / lot numbers with expiry dates ARE built:
 * per item, with first-expiry-first-out sales and expiry reports — but not in
 * manufacturing or physical stock counts, so don't claim those.
 */

export type SolutionFeature = {
  name: string;
  body: string;
  /** The feature page this card links to (/features/<page>). */
  page: FeatureSlug;
  icon: IconSvgElement;
};

/** The verified feature catalogue the solution pages pick from. */
export const FEATURES = {
  gstInvoices: {
    name: "GST invoices",
    body: "Sale and purchase invoices with HSN/SAC codes and CGST, SGST, IGST and cess worked out on every line.",
    page: "invoicing",
    icon: Invoice01Icon,
  },
  quotations: {
    name: "Quotations & proforma",
    body: "Send estimates and proforma invoices, then convert them to invoices without retyping.",
    page: "quotations",
    icon: FileEditIcon,
  },
  challans: {
    name: "Delivery challans",
    body: "Move goods without a sale and invoice them later from the challan.",
    page: "delivery-challans",
    icon: DeliveryTruck01Icon,
  },
  orders: {
    name: "Sales & purchase orders",
    body: "Record orders, receive goods against purchase orders with GRNs, and see ordered, fulfilled and pending quantities.",
    page: "orders-goods-receipts",
    icon: ClipboardIcon,
  },
  returns: {
    name: "Credit notes & returns",
    body: "Handle sales returns and adjustments with the tax reversed correctly.",
    page: "credit-notes-returns",
    icon: ReturnRequestIcon,
  },
  recurring: {
    name: "Recurring invoices",
    body: "Automate monthly and periodic billing for retainers and subscriptions.",
    page: "recurring-invoices",
    icon: RepeatIcon,
  },
  pos: {
    name: "Point of sale",
    body: "A full-screen checkout with barcode scanning, keyboard shortcuts, held sales, cash or UPI payment and thermal receipts.",
    page: "point-of-sale",
    icon: ShoppingCart01Icon,
  },
  shareLinks: {
    name: "Shareable invoice links",
    body: "Send a link your customer opens without signing in, share it on WhatsApp, and show your UPI QR code for payment.",
    page: "invoicing",
    icon: Share01Icon,
  },
  eInvoice: {
    name: "e-Invoicing",
    body: "Generate the IRN and signed QR code directly from your invoices.",
    page: "e-invoicing",
    icon: QrCodeIcon,
  },
  ewayBill: {
    name: "e-Way bills",
    body: "Create and track e-way bills for goods in transit from the invoice or challan.",
    page: "e-way-bills",
    icon: Route01Icon,
  },
  gstReturns: {
    name: "GSTR-1 & GSTR-3B",
    body: "File-ready return summaries built from the transactions you already recorded.",
    page: "gst-filing",
    icon: TaxesIcon,
  },
  gstr2b: {
    name: "GSTR-2B & input tax credit",
    body: "Match supplier data against your purchase bills, spot mismatches and track eligible and claimed ITC.",
    page: "gst-filing",
    icon: GitCompareIcon,
  },
  composition: {
    name: "Composition scheme",
    body: "Mark your business as a composition dealer and inter-state sale invoices are blocked, as the rules require.",
    page: "gst-filing",
    icon: PercentIcon,
  },
  payments: {
    name: "Payments & outstanding",
    body: "Record receipts and payments against invoices and follow up with outstanding and ageing reports.",
    page: "payments",
    icon: MoneyReceive01Icon,
  },
  expenses: {
    name: "Expenses",
    body: "Log business expenses by category, with GST where it applies.",
    page: "expenses",
    icon: Wallet01Icon,
  },
  banking: {
    name: "Cash, bank & reconciliation",
    body: "Keep several cash and bank accounts, import statements and match them against your books.",
    page: "banking",
    icon: BankIcon,
  },
  reports: {
    name: "Accounting reports",
    body: "Profit & loss, balance sheet, trial balance, general ledger, day book, cash flow and party statements.",
    page: "reporting",
    icon: ChartBarLineIcon,
  },
  tally: {
    name: "Tally export",
    body: "Export vouchers for a date range from the Tally Export report to carry your books into Tally.",
    page: "reporting",
    icon: Download04Icon,
  },
  items: {
    name: "Items, variants & units",
    body: "Products and services with variants such as size and colour, alternate units like box and piece, and tax rates.",
    page: "inventory",
    icon: PackageIcon,
  },
  barcodes: {
    name: "Barcodes & label printing",
    body: "Print barcode labels for one item, several items, or one per piece received on a purchase bill.",
    page: "physical-stock-barcodes",
    icon: BarCode01Icon,
  },
  priceLevels: {
    name: "Price levels & MRP",
    body: "Keep separate price lists such as retail and wholesale, assign one to a party, and record MRP on items.",
    page: "price-levels",
    icon: Tag01Icon,
  },
  warehouses: {
    name: "Warehouses & stock transfers",
    body: "Track stock per shop or godown, move it between them, and decide who may transfer or adjust stock where.",
    page: "warehouses",
    icon: WarehouseIcon,
  },
  batches: {
    name: "Batches & expiry",
    body: "Record the batch and expiry on every purchase; sales take the batch that expires first and skip expired stock.",
    page: "inventory",
    icon: Calendar03Icon,
  },
  stockCount: {
    name: "Physical stock counts",
    body: "Count shelves with a barcode scanner, compare against your books and post the difference.",
    page: "physical-stock-barcodes",
    icon: CheckListIcon,
  },
  stockReports: {
    name: "Stock valuation & reports",
    body: "Value stock on weighted average or FIFO, with stock ledger, ageing, dead stock and reorder reports.",
    page: "stock-valuation",
    icon: Layers01Icon,
  },
  manufacturing: {
    name: "Bill of materials & production",
    body: "Define BOMs with wastage and by-products, see shortages before a run, and add labour or job-work costs to what you make.",
    page: "manufacturing",
    icon: Factory01Icon,
  },
  shipments: {
    name: "Shipments",
    body: "Track dispatches and deliveries for your orders.",
    page: "delivery-challans",
    icon: DeliveryTruck01Icon,
  },
  onlineStore: {
    name: "Online store",
    body: "Publish a storefront for your items and receive orders straight into your books.",
    page: "online-store",
    icon: ShoppingBag01Icon,
  },
  multiBusiness: {
    name: "Multiple businesses & GSTINs",
    body: "Add a business for each GSTIN, each with its own invoice series and books, and switch between them from the sidebar.",
    page: "team-roles",
    icon: Building03Icon,
  },
  roles: {
    name: "Roles & permissions",
    body: "Invite admins, sales managers, salespeople and accountants, each with access that fits their job.",
    page: "team-roles",
    icon: SecurityCheckIcon,
  },
  salesTargets: {
    name: "Sales targets",
    body: "Set targets for your salespeople and let each of them follow their own progress.",
    page: "team-roles",
    icon: Target02Icon,
  },
  devices: {
    name: "Web, desktop & mobile",
    body: "Use Fintranzact in the browser, as a desktop app or on your phone.",
    page: "mobile-desktop-apps",
    icon: ComputerIcon,
  },
  api: {
    name: "API, CLI & AI assistants",
    body: "API keys, a command-line tool and an MCP server for connecting AI assistants to your books.",
    page: "api-integrations",
    icon: ApiIcon,
  },
  importExport: {
    name: "Import & export",
    body: "Bring in parties and items from spreadsheets and export all of your data whenever you like.",
    page: "api-integrations",
    icon: CloudUploadIcon,
  },
} satisfies Record<string, SolutionFeature>;

export type FeatureId = keyof typeof FEATURES;

export type SolutionGroup = "industry" | "size";

export type Solution = {
  slug: string;
  group: SolutionGroup;
  /** Short name, as in the header menu. */
  name: string;
  icon: IconSvgElement;
  /** One line for the /solutions index card. */
  summary: string;
  title: string;
  subtitle: string;
  /** Meta description for search results. */
  description: string;
  pains: Array<{ pain: string; answer: string }>;
  features: FeatureId[];
  workflow: Array<{ title: string; body: string }>;
  faqs: Array<{ q: string; a: string }>;
};

export const SOLUTIONS: Solution[] = [
  // ── By industry ─────────────────────────────────────────────
  {
    slug: "retail",
    group: "industry",
    name: "Retail & kirana",
    icon: ShoppingBasket01Icon,
    summary: "Fast counter billing, barcodes and stock that updates with every sale.",
    title: "Quick counter billing for retail and kirana stores",
    subtitle:
      "Ring up walk-in customers in seconds, scan barcodes, take cash or UPI and always know what is on the shelf, with GST handled on every bill.",
    description:
      "GST billing software for retail and kirana stores: point of sale with barcode scanning, cash and UPI, label printing, stock tracking and GST returns.",
    pains: [
      {
        pain: "A queue builds up while bills are written or typed item by item.",
        answer:
          "The point-of-sale screen is built for the counter: scan a barcode or tap an item, use keyboard shortcuts, and hold a sale while you serve the next customer.",
      },
      {
        pain: "Loose items and unlabelled stock slow down checkout.",
        answer: "Assign barcodes to items and print labels for one item, many items, or everything that arrived on a purchase bill.",
      },
      {
        pain: "You only find out an item is out of stock when a customer asks for it.",
        answer: "Stock moves with every sale and purchase, and reorder and dead-stock reports show what to buy and what is not moving.",
      },
      {
        pain: "Month-end GST means sorting through bills and notebooks.",
        answer: "Every counter sale is a proper GST invoice, so GSTR-1 and GSTR-3B summaries come straight from what you billed.",
      },
    ],
    features: ["pos", "barcodes", "priceLevels", "stockReports", "stockCount", "gstReturns", "onlineStore", "payments"],
    workflow: [
      { title: "Add your items", body: "Import items from a spreadsheet or add them with prices, MRP, tax rates and barcodes." },
      { title: "Turn on the POS", body: "Enable point of sale for your business and open the checkout screen on the counter computer." },
      { title: "Bill at the counter", body: "Scan, take cash or UPI, and print a thermal receipt. Stock updates as you sell." },
      { title: "Close the month", body: "Check stock reports, count shelves when you need to, and pull your GST return summaries." },
    ],
    faqs: [
      {
        q: "Can I use a barcode scanner?",
        a: "Yes. Scanners that type into the computer like a keyboard work on the point-of-sale screen and during physical stock counts.",
      },
      {
        q: "Which payment modes does the POS take?",
        a: "The checkout screen records cash and UPI payments. Other receipts can be recorded against the invoice from the payments section.",
      },
      {
        q: "Can I print receipts on a thermal printer?",
        a: "Yes. POS sales print a thermal-size receipt through your computer's print window.",
      },
      {
        q: "Do I need to be online?",
        a: "Fintranzact runs in the browser, as a desktop app and on mobile, and needs an internet connection to save your bills.",
      },
    ],
  },
  {
    slug: "wholesale",
    group: "industry",
    name: "Wholesale & distribution",
    icon: DeliveryTruck01Icon,
    summary: "Orders, challans, e-way bills, party-wise price lists and godown stock.",
    title: "Billing and stock control for wholesalers and distributors",
    subtitle:
      "Take orders, dispatch on challans with e-way bills, bill each buyer at their own price level and keep stock accurate across godowns.",
    description:
      "Wholesale and distribution software: sales and purchase orders, GRN, delivery challans, e-way bills, price levels per party, warehouses and outstanding reports.",
    pains: [
      {
        pain: "Different customers get different rates and staff pick the wrong one.",
        answer: "Keep price levels such as wholesale and dealer, assign one to each party, and entry forms pick up that party's price.",
      },
      {
        pain: "Part-delivered orders are hard to follow.",
        answer: "Sales and purchase orders show ordered, fulfilled and pending quantities, and goods received are recorded against purchase orders with GRNs.",
      },
      {
        pain: "Every dispatch needs a challan and an e-way bill.",
        answer: "Create delivery challans and generate e-way bills from your documents, then invoice when the time comes.",
      },
      {
        pain: "Payments from buyers slip through the cracks.",
        answer: "Outstanding and ageing reports show who owes what and for how long, and party statements are ready to send.",
      },
    ],
    features: ["orders", "challans", "ewayBill", "priceLevels", "items", "warehouses", "payments", "salesTargets"],
    workflow: [
      { title: "Set up parties and prices", body: "Import your buyers and suppliers, look up details from a GSTIN and assign price levels." },
      { title: "Take the order", body: "Record the sales order and convert it to a challan or invoice as goods go out." },
      { title: "Dispatch", body: "Generate the e-way bill and track the shipment. Stock moves out of the right godown." },
      { title: "Collect", body: "Record payments against invoices and follow up using the outstanding report." },
    ],
    faqs: [
      {
        q: "Can I sell in boxes and pieces?",
        a: "Yes. Items can have alternate units with a conversion factor, so you can buy by the carton and sell by the piece.",
      },
      {
        q: "Can I keep stock in more than one godown?",
        a: "Yes. Add warehouses, transfer stock between them and see stock for each location.",
      },
      {
        q: "Can my salespeople bill without seeing everything?",
        a: "Yes. The salesperson role can create invoices, parties and payments but cannot change items or see the full books.",
      },
    ],
  },
  {
    slug: "manufacturing",
    group: "industry",
    name: "Manufacturing",
    icon: Factory01Icon,
    summary: "Bills of materials, production runs and raw-material stock.",
    title: "Production, stock and GST in one place for manufacturers",
    subtitle:
      "Define bills of materials, see shortages before a run, post production that consumes raw material and adds finished goods, and bill with GST.",
    description:
      "Manufacturing software for small factories: bills of materials with wastage and by-products, production runs, raw-material stock, costing, e-invoicing and GST returns.",
    pains: [
      {
        pain: "You do not know if there is enough raw material until the run starts.",
        answer: "Planning a production run scales the BOM to the quantity and shows stock and shortages at the source warehouse before you post.",
      },
      {
        pain: "Finished-goods cost is a guess.",
        answer: "Production uses current component rates, and you can add labour, power or job-work costs to the cost of what you make.",
      },
      {
        pain: "Raw-material and finished-goods stock drift apart from reality.",
        answer: "Posting a run consumes components and adds finished goods and by-products, and physical stock counts correct any differences.",
      },
      {
        pain: "Large B2B invoices need e-invoices and e-way bills.",
        answer: "Generate the IRN, signed QR code and e-way bill from the invoice itself.",
      },
    ],
    features: ["manufacturing", "items", "warehouses", "stockReports", "orders", "eInvoice", "ewayBill", "gstr2b"],
    workflow: [
      { title: "Build your BOMs", body: "List the components, quantities and wastage for each finished item, plus any by-products." },
      { title: "Buy raw material", body: "Raise purchase orders, receive goods with GRNs and record purchase bills." },
      { title: "Run production", body: "Check the plan for shortages, then post the run to move stock and cost." },
      { title: "Sell and file", body: "Invoice with e-invoicing and e-way bills, then pull your GST returns." },
    ],
    faqs: [
      {
        q: "Can one item have more than one BOM?",
        a: "Yes. An item can have several BOMs, with one marked as the default.",
      },
      {
        q: "How is stock valued?",
        a: "Choose weighted average or FIFO for your business. Stock reports and production costs use that method.",
      },
      {
        q: "Can I cancel a production entry?",
        a: "Yes. A posted manufacturing journal can be cancelled, which reverses its stock movements.",
      },
    ],
  },
  {
    slug: "services",
    group: "industry",
    name: "Services & agencies",
    icon: Briefcase01Icon,
    summary: "Quotes, recurring invoices, payment links and clean books.",
    title: "Invoicing and books for service businesses and agencies",
    subtitle:
      "Send quotations, bill retainers automatically, share invoices your clients can pay by UPI, and keep expenses and GST in order.",
    description:
      "Invoicing software for service businesses and agencies: quotations, recurring invoices, SAC codes, shareable invoice links with UPI QR, expenses and GST returns.",
    pains: [
      {
        pain: "Monthly retainers have to be invoiced by hand every month.",
        answer: "Set up recurring invoices once and they are created on schedule.",
      },
      {
        pain: "Clients take weeks to pay.",
        answer: "Share an invoice link on WhatsApp that opens without a login and shows your UPI QR code, then track what is outstanding.",
      },
      {
        pain: "Quotes and final invoices never quite match.",
        answer: "Convert an accepted quotation or proforma into an invoice in one step, with nothing retyped.",
      },
      {
        pain: "Expenses and GST credit get lost in email and receipts.",
        answer: "Log expenses by category with GST, and match supplier data in GSTR-2B to track your input tax credit.",
      },
    ],
    features: ["quotations", "recurring", "shareLinks", "gstInvoices", "payments", "expenses", "gstr2b", "reports"],
    workflow: [
      { title: "Quote", body: "Send a quotation or proforma invoice with the right SAC codes." },
      { title: "Invoice", body: "Convert it when the client agrees, or set it up as a recurring invoice." },
      { title: "Get paid", body: "Share the invoice link and record the payment when it arrives." },
      { title: "Stay compliant", body: "Log expenses, reconcile the bank and pull GSTR-1 and GSTR-3B summaries." },
    ],
    faqs: [
      {
        q: "Can I bill services without keeping stock?",
        a: "Yes. Add services as items with SAC codes and tax rates; they are not counted as stock.",
      },
      {
        q: "How does the UPI QR code appear on the invoice link?",
        a: "Add your UPI ID to a bank account in Fintranzact and shared invoice links show a QR code your client can scan to pay.",
      },
      {
        q: "Can my accountant see the books?",
        a: "Yes. Invite them with the accountant role for full access to payments, expenses, banking and reports.",
      },
    ],
  },
  {
    slug: "pharmacy",
    group: "industry",
    name: "Pharmacy",
    icon: Medicine02Icon,
    summary: "Counter billing, MRP, barcodes, batch and expiry tracking for chemists.",
    title: "Counter billing and stock for pharmacies and medical stores",
    subtitle:
      "Bill quickly at the counter with MRP and GST on every line, sell the batch that expires first, and use reorder and expiry reports to keep the right medicines on the shelf.",
    description:
      "Billing software for pharmacies and medical stores: point of sale, MRP, batch and expiry tracking, barcodes, purchase bills, reorder reports and GST returns.",
    pains: [
      {
        pain: "Customers wait while each medicine is looked up and priced.",
        answer: "Scan or search items on the point-of-sale screen, with MRP, selling price and GST already set on each item.",
      },
      {
        pain: "Fast movers run out while slow ones pile up.",
        answer: "Reorder status shows items below their reorder level, and dead-stock and ageing reports show what is not selling.",
      },
      {
        pain: "Expired strips turn up on the shelf, or go out to a customer.",
        answer: "Track batches and expiry on medicines: purchases record each batch, sales take the one that expires first and skip expired stock, and the Expiring Soon report shows what to return to the supplier.",
      },
      {
        pain: "Supplier bills and GST credit are hard to match.",
        answer: "Record purchase bills with GST and reconcile them against GSTR-2B to see which credit you can claim.",
      },
      {
        pain: "Stock on the shelf does not match the books.",
        answer: "Run a physical stock count with a barcode scanner and post the difference in one go.",
      },
    ],
    features: ["pos", "batches", "priceLevels", "barcodes", "stockReports", "stockCount", "gstr2b", "gstReturns"],
    workflow: [
      { title: "Add your items", body: "Import or add items with HSN codes, tax rates, MRP and barcodes, and turn on batch and expiry tracking for medicines." },
      { title: "Record purchases", body: "Enter supplier bills with the batch number and expiry of each line, so stock and input tax credit are up to date." },
      { title: "Bill at the counter", body: "Use the point-of-sale screen with cash or UPI and thermal receipts." },
      { title: "Reorder and file", body: "Check reorder and dead-stock reports, then pull your GST summaries." },
    ],
    faqs: [
      {
        q: "Does Fintranzact track batch numbers and expiry dates?",
        a: "Yes. Turn on Track batches and Track expiry on an item. Purchase bills record the batch, expiry and batch MRP; sales and POS bills take the batch that expires first (or the one you pick) and won't sell an expired batch unless you allow it; the invoice prints the batch and expiry under each line; and Batch-wise Stock, Expiring Soon and Expired Stock reports show what you hold.",
      },
      {
        q: "Can I sell by strip and by box?",
        a: "Yes. Items can have alternate units with a conversion factor, such as strips in a box.",
      },
      {
        q: "Can I show MRP on items?",
        a: "Yes. Record MRP on each item alongside its selling price and price levels.",
      },
    ],
  },
  {
    slug: "restaurants",
    group: "industry",
    name: "Restaurants & cafés",
    icon: Restaurant01Icon,
    summary: "Quick counter billing, UPI and simple GST for food businesses.",
    title: "Simple counter billing for restaurants and cafés",
    subtitle:
      "Bill takeaway and counter orders in seconds, take cash or UPI, print thermal receipts and keep your purchases, expenses and GST in one place.",
    description:
      "Counter billing for restaurants and cafés: fast point of sale, cash and UPI, thermal receipts, composition scheme support, expenses and GST returns.",
    pains: [
      {
        pain: "Billing at the counter is slow during the rush.",
        answer: "The point-of-sale screen uses item tiles and keyboard shortcuts, and lets you hold one bill while you start the next.",
      },
      {
        pain: "Supplies and daily expenses are never recorded properly.",
        answer: "Record purchase bills from suppliers and log daily expenses by category, with GST where it applies.",
      },
      {
        pain: "Unsure how composition rules affect your invoices.",
        answer: "Mark your business as a composition dealer and Fintranzact blocks inter-state sale invoices, which composition dealers cannot issue.",
      },
      {
        pain: "You cannot tell if the month was profitable.",
        answer: "Profit & loss, day book and cash flow reports come straight from your sales, purchases and expenses.",
      },
    ],
    features: ["pos", "composition", "expenses", "banking", "reports", "gstReturns"],
    workflow: [
      { title: "Set up your menu", body: "Add dishes and drinks as items with prices and tax rates." },
      { title: "Bill at the counter", body: "Tap items on the POS, take cash or UPI and print a thermal receipt." },
      { title: "Record costs", body: "Enter supplier bills and daily expenses as they happen." },
      { title: "Review and file", body: "Check profit & loss and pull your GST summaries each period." },
    ],
    faqs: [
      {
        q: "Does Fintranzact support KOTs and table management?",
        a: "Not today. There are no kitchen order tickets, table layouts or waiter screens; the POS is a counter checkout that creates GST invoices.",
      },
      {
        q: "Does it connect to food delivery apps?",
        a: "No. Orders from delivery platforms are not imported automatically.",
      },
      {
        q: "Can I use it on a tablet or phone?",
        a: "Fintranzact runs in the browser, as a desktop app and on mobile.",
      },
    ],
  },
  {
    slug: "electronics",
    group: "industry",
    name: "Electronics",
    icon: TvSmartIcon,
    summary: "Barcodes, variants, e-way bills and stock valuation for high-value goods.",
    title: "Billing and inventory for electronics stores and dealers",
    subtitle:
      "Keep model-wise stock with variants and barcodes, bill with the right HSN and GST, and generate e-way bills for high-value consignments.",
    description:
      "Billing software for electronics shops and dealers: product variants, barcodes and labels, price levels, e-way bills, stock valuation and GST returns.",
    pains: [
      {
        pain: "The same model comes in several colours and storage sizes.",
        answer: "Create variants for each item with attributes such as colour and storage, each with its own stock, price and barcode.",
      },
      {
        pain: "High-value stock is tied up and hard to value.",
        answer: "Value stock on weighted average or FIFO and use ageing reports to spot items that have sat too long.",
      },
      {
        pain: "Dealer and retail customers pay different prices.",
        answer: "Keep dealer and retail price levels and assign the right one to each party.",
      },
      {
        pain: "Large consignments need e-way bills.",
        answer: "Generate e-way bills from your invoices and challans and track goods in transit.",
      },
    ],
    features: ["items", "barcodes", "priceLevels", "stockReports", "ewayBill", "eInvoice", "pos", "warehouses"],
    workflow: [
      { title: "Set up your catalogue", body: "Add models with variants, HSN codes, tax rates and barcodes." },
      { title: "Receive stock", body: "Record purchase bills and print barcode labels for what arrived." },
      { title: "Sell", body: "Bill at the counter or on invoices, with e-way bills for large consignments." },
      { title: "Review", body: "Check stock valuation, ageing and dead stock to decide what to reorder." },
    ],
    faqs: [
      {
        q: "Can I track serial or IMEI numbers?",
        a: "Not yet. Serial and IMEI number tracking is not available today; stock is tracked by item and variant.",
      },
      {
        q: "Does it manage warranties or repairs?",
        a: "No. Warranty tracking and service or repair jobs are not part of Fintranzact.",
      },
      {
        q: "Can I keep stock in the shop and a godown?",
        a: "Yes. Add warehouses and transfer stock between them.",
      },
    ],
  },
  {
    slug: "apparel",
    group: "industry",
    name: "Apparel & textiles",
    icon: TShirtIcon,
    summary: "Size and colour variants, labels and wholesale price levels.",
    title: "Billing and stock for apparel and textile businesses",
    subtitle:
      "Track every size and colour as a variant, print barcode labels for each piece you receive, and bill retail and wholesale buyers at their own prices.",
    description:
      "Billing and inventory for apparel and textile businesses: size and colour variants, barcode labels, price levels, point of sale, warehouses and GST returns.",
    pains: [
      {
        pain: "One style has dozens of size and colour combinations.",
        answer: "Create variants with attributes such as size and colour, each with its own stock, price and barcode.",
      },
      {
        pain: "Labelling new stock takes hours.",
        answer: "Print one barcode label per piece received on a purchase bill, straight from the bill.",
      },
      {
        pain: "Retail and wholesale buyers pay different rates.",
        answer: "Keep price levels for each type of buyer and assign them to parties so the right price comes up.",
      },
      {
        pain: "Stock in the shop and the godown never matches.",
        answer: "Track stock per location, transfer between them and run physical counts with a scanner.",
      },
    ],
    features: ["items", "barcodes", "priceLevels", "pos", "warehouses", "stockCount", "challans", "gstReturns"],
    workflow: [
      { title: "Create styles", body: "Add each style with its size and colour variants, HSN code and tax rate." },
      { title: "Receive and label", body: "Enter the purchase bill and print a label for each piece." },
      { title: "Sell", body: "Scan at the POS for walk-ins, or send challans and invoices to wholesale buyers." },
      { title: "Count and file", body: "Run stock counts, check dead stock and pull your GST summaries." },
    ],
    faqs: [
      {
        q: "Can I sell fabric by the metre?",
        a: "Yes. Quantities can be fractional, and items can have alternate units with a conversion factor.",
      },
      {
        q: "Can I sell online too?",
        a: "Yes. Publish selected items to your online store and orders arrive in your books.",
      },
      {
        q: "Can I tag goods with the MRP?",
        a: "Yes. Record MRP on each item alongside its selling price.",
      },
    ],
  },

  // ── By business size ───────────────────────────────────────
  {
    slug: "freelancers",
    group: "size",
    name: "Freelancers & small shops",
    icon: Store01Icon,
    summary: "GST invoicing and simple books for one-person businesses.",
    title: "GST invoicing for freelancers and small shops",
    subtitle:
      "Create professional GST invoices in seconds, share them on WhatsApp, get paid by UPI and keep simple books, from ₹299 a month.",
    description:
      "GST invoicing for freelancers and small shops: professional invoices, shareable links with UPI QR, payments, expenses and GST return summaries.",
    pains: [
      {
        pain: "Invoices in Word or Excel look unprofessional and have tax mistakes.",
        answer: "Fintranzact works out the GST on every line and produces a clean invoice with your logo and signature.",
      },
      {
        pain: "Chasing payments takes more time than the work itself.",
        answer: "Share an invoice link that shows your UPI QR code, and see at a glance who still owes you.",
      },
      {
        pain: "You cannot afford accounting software yet.",
        answer: "Start with a 14-day free trial, then Starter is ₹299 a month before GST. There is no invoice limit and no Fintranzact branding on your documents.",
      },
      {
        pain: "Filing season means scrambling for numbers.",
        answer: "Your sales and purchases feed GSTR-1 and GSTR-3B summaries, and your accountant can be invited to see the books.",
      },
    ],
    features: ["gstInvoices", "quotations", "shareLinks", "payments", "expenses", "gstReturns", "devices"],
    workflow: [
      { title: "Start your free trial", body: "Create an account with your email or phone number and add your business details." },
      { title: "Send your first invoice", body: "Add a customer, pick items or services and share the invoice." },
      { title: "Get paid", body: "Record payments as they arrive and follow up on what is outstanding." },
      { title: "File", body: "Use the GST summaries yourself or invite your accountant." },
    ],
    faqs: [
      {
        q: "Is there a free trial?",
        a: "Yes. Every new organization gets a 14-day free trial, with no card needed. After that, plans start at ₹299 a month before GST, with no invoice cap and no Fintranzact branding on your documents.",
      },
      {
        q: "I am not GST registered. Can I still use it?",
        a: "Yes. You can set up your business without a GSTIN and add it later.",
      },
      {
        q: "Can I use it on my phone?",
        a: "Yes. Fintranzact works in the browser, as a desktop app and on mobile.",
      },
    ],
  },
  {
    slug: "growing-businesses",
    group: "size",
    name: "Growing businesses",
    icon: Analytics01Icon,
    summary: "Team roles, inventory, orders and reports as you add people and stock.",
    title: "Room to grow for businesses adding people, stock and customers",
    subtitle:
      "Bring your team in with the right access, run orders and inventory properly, and see where the business stands with real reports.",
    description:
      "Billing, inventory and accounting for growing Indian businesses: team roles, sales targets, orders, warehouses, bank reconciliation, reports and API access.",
    pains: [
      {
        pain: "More staff means more people touching the books.",
        answer: "Give each person a role: admins, sales managers, salespeople and accountants each see and change only what their job needs.",
      },
      {
        pain: "Spreadsheets for stock and orders stopped working.",
        answer: "Orders, challans, GRNs, warehouses and stock reports keep inventory in step with every transaction.",
      },
      {
        pain: "You are not sure where the cash is going.",
        answer: "Reconcile the bank, and use profit & loss, cash flow and collection reports to see how the business is doing.",
      },
      {
        pain: "Your other tools do not talk to your billing.",
        answer: "Connect them through the API, the command-line tool or an AI assistant using the MCP server.",
      },
    ],
    features: ["roles", "salesTargets", "orders", "warehouses", "banking", "reports", "api", "importExport"],
    workflow: [
      { title: "Bring your data", body: "Import parties and items from spreadsheets so nothing is retyped." },
      { title: "Invite the team", body: "Add staff and your accountant with the role each one needs." },
      { title: "Run operations", body: "Take orders, move stock between locations and bill from one system." },
      { title: "Review", body: "Reconcile the bank and read your reports every month." },
    ],
    faqs: [
      {
        q: "How many team members can I add?",
        a: "Starter includes 3 users, Growth 10 and Business has no limit. See the pricing page for the plans.",
      },
      {
        q: "Can I see what my team changed?",
        a: "Yes. Changes are recorded in an audit trail you can review in settings.",
      },
      {
        q: "Can I move from my current software?",
        a: "Yes. Import parties and items from spreadsheets, or bring data over from myBillBook with the import tool.",
      },
    ],
  },
  {
    slug: "multi-branch",
    group: "size",
    name: "Multi-branch & multi-GSTIN",
    icon: Building03Icon,
    summary: "Several GSTINs, branches and godowns under one login.",
    title: "Several branches and GSTINs, one login",
    subtitle:
      "Add a business for each GSTIN, keep separate books and invoice series for each, track stock across branches and godowns, and switch between them in a click.",
    description:
      "Software for multi-branch, multi-GSTIN businesses: one login for several GST registrations, separate books per GSTIN, warehouses, stock transfers and team roles.",
    pains: [
      {
        pain: "Each state registration needs its own invoices and returns.",
        answer: "Add a business for each GSTIN. Each has its own invoice series, books and GST returns, and you switch between them from the sidebar.",
      },
      {
        pain: "Stock sits in several shops and godowns.",
        answer: "Add a warehouse for each location, transfer stock between them and see stock for each place.",
      },
      {
        pain: "Branch staff should not be able to change stock everywhere.",
        answer: "Choose, per warehouse, who may transfer or adjust stock there.",
      },
      {
        pain: "Head office cannot see the whole picture quickly.",
        answer: "Open any business from the same login and use each one's reports, stock and outstanding views.",
      },
    ],
    features: ["multiBusiness", "warehouses", "roles", "stockReports", "gstReturns", "eInvoice", "reports", "api"],
    workflow: [
      { title: "Add each GSTIN", body: "Create a business for every registration with its own address and invoice series." },
      { title: "Map your locations", body: "Add shops and godowns as warehouses and set who can move stock where." },
      { title: "Invite your team", body: "Give branch staff and accountants the roles they need." },
      { title: "Run and review", body: "Switch between businesses to bill, transfer stock and pull each GSTIN's returns." },
    ],
    faqs: [
      {
        q: "How many businesses can I add?",
        a: "Starter allows one business, Growth up to three and Business has no limit.",
      },
      {
        q: "Is there a consolidated report across all GSTINs?",
        a: "Not today. Each business has its own books and reports; you switch between them to review each one.",
      },
      {
        q: "Can I move stock from one GSTIN to another?",
        a: "Stock transfers move goods between warehouses of the same business. Between two GSTINs, record a sale in one business and a purchase in the other, as GST requires.",
      },
    ],
  },
  {
    slug: "accountants",
    group: "size",
    name: "Accountants & CAs",
    icon: FileValidationIcon,
    summary: "An accountant role, client switching, GST tools and Tally export.",
    title: "Work in your clients' books with the access you need",
    subtitle:
      "Get invited to each client's organization with the accountant role, switch between clients from one login, reconcile GST and banking, and export to Tally.",
    description:
      "Fintranzact for accountants and CAs: accountant role, access to several client organizations from one login, GSTR-2B and ITC reconciliation, bank reconciliation, reports and Tally export.",
    pains: [
      {
        pain: "Clients send you photos of bills and spreadsheets at filing time.",
        answer: "Your client invites you to their Fintranzact organization and you work directly in the same books they bill from.",
      },
      {
        pain: "Juggling many clients means many logins.",
        answer: "Accept invitations from each client and pick which organization to open from one login.",
      },
      {
        pain: "Input tax credit mismatches take days to find.",
        answer: "Reconcile purchase bills against GSTR-2B, track eligible and claimed ITC, and pull GSTR-1 and GSTR-3B summaries.",
      },
      {
        pain: "You still finalise accounts in Tally.",
        answer: "Use the Tally Export report to carry a period's vouchers from Fintranzact into Tally.",
      },
    ],
    features: ["roles", "gstr2b", "gstReturns", "banking", "reports", "tally", "api", "importExport"],
    workflow: [
      { title: "Get invited", body: "Your client invites your email with the accountant role." },
      { title: "Open the books", body: "Pick the client's organization and business after you sign in." },
      { title: "Reconcile", body: "Match bank statements and GSTR-2B, post journal entries and review ITC." },
      { title: "Report and file", body: "Pull the return summaries, financial statements or a Tally export." },
    ],
    faqs: [
      {
        q: "What can the accountant role do?",
        a: "Accountants have full access to payments, expenses, banking, the chart of accounts and journal entries, ITC and reconciliation, and can read invoices, parties, items, e-invoices, e-way bills and reports. They cannot create or edit sales invoices.",
      },
      {
        q: "Is there a partner programme for CAs?",
        a: "Yes. See the Partner with us page to work with us and refer your clients.",
      },
      {
        q: "Can I automate work across clients?",
        a: "Yes. API keys, the command-line tool and the MCP server let you script work in each organization you have access to.",
      },
    ],
  },
];

export const SOLUTION_GROUPS: Array<{ id: SolutionGroup; title: string; intro: string }> = [
  { id: "industry", title: "By industry", intro: "How Fintranzact fits the way your trade works." },
  { id: "size", title: "By business size", intro: "From a one-person shop to many GSTINs and an accounting practice." },
];

export function getSolution(slug: string): Solution | undefined {
  return SOLUTIONS.find((s) => s.slug === slug);
}
