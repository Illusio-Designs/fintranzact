import {
  ArrowDataTransferHorizontalIcon,
  BankIcon,
  BarCode01Icon,
  Calculator01Icon,
  Calendar03Icon,
  CheckListIcon,
  Clock01Icon,
  Coins01Icon,
  CreditCardIcon,
  CsvIcon,
  DeliveryTruck01Icon,
  FileEditIcon,
  FileImportIcon,
  GitCompareIcon,
  Invoice01Icon,
  KeyboardIcon,
  Layers01Icon,
  MoneyReceive01Icon,
  PackageIcon,
  PauseIcon,
  PercentIcon,
  PrinterIcon,
  QrCodeIcon,
  RepeatIcon,
  ReturnRequestIcon,
  Share01Icon,
  ShoppingCart01Icon,
  SparklesIcon,
  Tag01Icon,
  TaxesIcon,
  Wallet01Icon,
  WhatsappIcon,
} from "@hugeicons/core-free-icons";
import type { FeaturePage } from "./types";

/**
 * Sales & money feature pages. Every claim here was checked against the help
 * centre (src/content/help) and the API routers. Keep it that way: when the
 * product changes, change these pages too, and never describe something that
 * is not built (batch/expiry tracking, serial/IMEI numbers and KOT/table
 * management are NOT built).
 */
export const SALES_MONEY_PAGES: FeaturePage[] = [
  // ── Invoicing ─────────────────────────────────────────────────
  {
    slug: "invoicing",
    title: "GST invoicing",
    navLabel: "GST invoices",
    tagline:
      "Make a correct GST invoice in under a minute, share it on WhatsApp, and let your customer pay by UPI from the same link.",
    summary:
      "Create GST sale and purchase invoices with HSN codes, CGST, SGST or IGST worked out for you, PDF in three sizes, UPI QR and WhatsApp share links.",
    icon: Invoice01Icon,
    highlights: [
      {
        title: "Tax worked out for you",
        body: "Fintranzact compares your state code with the party's and applies CGST + SGST or IGST on every line. Tax-inclusive prices are split back into taxable value and tax.",
        icon: TaxesIcon,
      },
      {
        title: "Numbers with no gaps",
        body: "Every invoice gets the next number in its series, like INV-00001, even when two people bill at the same moment. Change the prefix in settings.",
        icon: CheckListIcon,
      },
      {
        title: "PDF in three sizes",
        body: "A4 for email and filing, A5 landscape for counters, and 80mm for thermal printers, with your logo, GSTIN, HSN codes and tax breakdown.",
        icon: PrinterIcon,
      },
      {
        title: "Share links and WhatsApp",
        body: "Send a link your customer opens without signing in. See how many times it was opened, and turn it off whenever you like.",
        icon: Share01Icon,
      },
      {
        title: "Get paid by UPI",
        body: "Add your UPI ID once and every unpaid sale invoice carries a UPI QR code for the balance due, on the PDF and on the share link.",
        icon: QrCodeIcon,
      },
      {
        title: "Stock moves by itself",
        body: "Sale invoices take stock out and purchase invoices bring it in, in the same step, with variants and alternate units converted for you.",
        icon: PackageIcon,
      },
    ],
    steps: [
      {
        title: "Pick the customer",
        body: "Search your parties or add a new one on the spot with just a name and phone number. The due date fills in from the customer's credit period.",
      },
      {
        title: "Add the items",
        body: "Pick items from your list or type a free-text line. Price, GST rate and HSN code fill in, and you can change quantity, rate, tax and discount on each line.",
      },
      {
        title: "Add charges and round off",
        body: "Add an invoice-level discount, delivery or packing charges and a round-off. The total updates as you type.",
      },
      {
        title: "Save and send",
        body: "Save to get the next invoice number. Download the PDF or click Get link and send it on WhatsApp, then record the payment when it comes in.",
      },
    ],
    details: [
      {
        heading: "What goes on the invoice",
        points: [
          "Your business name, logo, address and GSTIN, and the party's billing and shipping details.",
          "HSN or SAC code, quantity, unit, rate, discount, taxable value and GST on every line.",
          "CGST and SGST for sales within your state, IGST for sales to another state, based on the two-digit state codes.",
          "Notes and terms and conditions, with your default terms filled in for you.",
          "Your bank details and a UPI QR code for the amount still due, if you choose to show them.",
        ],
      },
      {
        heading: "Built for the way Indian businesses bill",
        points: [
          "Sale and purchase invoices in one place, switched with a Sales / Purchases toggle.",
          "Items with variants (size, colour) and alternate units (box, dozen, piece), priced and stocked correctly.",
          "Customer price levels, so wholesale and retail customers get their own prices automatically.",
          "Composition businesses get invoices without GST columns, and unregistered businesses can bill without any GST breakdown.",
          "Statuses from draft to sent, partly paid, paid and overdue, updated as payments are recorded.",
        ],
      },
      {
        heading: "After the invoice",
        points: [
          "Record full or part payments against it, or split one payment across several invoices.",
          "Issue a credit note or a sales return straight from the invoice, and it stays linked to the original.",
          "Generate the e-invoice IRN and QR code, or an e-way bill, from the same invoice.",
          "Every invoice flows into GSTR-1, GSTR-3B, the sales register and the party ledger without re-entry.",
        ],
      },
    ],
    faqs: [
      {
        q: "Do I need to add all my parties and items first?",
        a: "No. You can create a customer or an item from inside the invoice form without leaving it. Adding them in advance just saves a little typing later.",
      },
      {
        q: "Can I bill a customer in another state?",
        a: "Yes. When the party's state code is different from yours, Fintranzact charges IGST instead of CGST and SGST. Make sure the state is set correctly on the party.",
      },
      {
        q: "Can I edit an invoice after saving it?",
        a: "Yes, until it is fully paid. Editing the lines reverses the old stock movement and applies the new one. For a paid invoice, remove the payment first or issue a credit note.",
      },
      {
        q: "Can I continue my numbering from another app?",
        a: "Yes. In Settings, change the prefix and move the next number forward so your new invoices carry on from where your old software stopped.",
      },
      {
        q: "Can my customer pay from the invoice?",
        a: "Yes. If you have a UPI account under Cash & Bank, the share link and PDF show a UPI QR code for the balance due. Record the payment in Fintranzact when the money arrives.",
      },
      {
        q: "Can I make invoices on my phone?",
        a: "Yes. The Android and iPhone apps create sale and purchase invoices too. Invoice-level discounts, extra charges and round-off are on the web and desktop app for now.",
      },
    ],
    related: ["quotations", "payments", "e-invoicing", "credit-notes-returns"],
    helpPath: "/help/invoicing/create-invoice",
  },

  // ── Quotations & proforma ─────────────────────────────────────
  {
    slug: "quotations",
    title: "Quotations and proforma invoices",
    navLabel: "Quotations & proforma",
    tagline: "Send a price quote or ask for an advance, then turn it into a GST invoice in one click when the customer says yes.",
    summary:
      "Create quotations and proforma invoices, share them as a link on WhatsApp, collect advances by UPI, and convert them into GST invoices without retyping.",
    icon: FileEditIcon,
    highlights: [
      {
        title: "Quote in a minute",
        body: "The same fast form as invoices: pick the customer, add items with price, GST and line discounts, and add your terms.",
        icon: FileEditIcon,
      },
      {
        title: "Convert without retyping",
        body: "When the customer agrees, one click creates a draft invoice with the customer, items, notes, terms and charges copied across.",
        icon: RepeatIcon,
      },
      {
        title: "Share on WhatsApp",
        body: "Get a link the customer opens without signing in, and send it on WhatsApp with the document number already in the message.",
        icon: WhatsappIcon,
      },
      {
        title: "Collect the advance",
        body: "A proforma's link shows the amount due and your UPI QR code, so the customer can pay the advance before you deliver.",
        icon: QrCodeIcon,
      },
      {
        title: "Nothing touches your books",
        body: "Quotations and proformas don't move stock, don't add to the customer's balance and don't appear in GST returns until you convert them.",
        icon: CheckListIcon,
      },
    ],
    steps: [
      {
        title: "Create the quote",
        body: "Open Quotations or Proforma Invoices, pick the customer and add the items. Use the due date as the \"valid until\" date.",
      },
      {
        title: "Send it",
        body: "Click Get link on the quotation and send it on WhatsApp, or copy the link into an email.",
      },
      {
        title: "Follow up",
        body: "Mark it as sent, and use the status tabs to see which quotes are still waiting on the customer.",
      },
      {
        title: "Convert to an invoice",
        body: "When the order is confirmed, click Convert to Invoice. Check the date on the new draft invoice and send it.",
      },
    ],
    details: [
      {
        heading: "Quotation or proforma: which to use",
        points: [
          "A quotation tells the customer what you would charge. Its link shows only the total.",
          "A proforma invoice looks like an invoice and is used to ask for an advance. Its link shows the amount due and your UPI payment options.",
          "Each has its own number series: QTN-00001 for quotations and PI-00001 for proformas, and you can change the prefixes.",
          "Both move through Draft, Sent and Cancelled, and both can be converted into a sale invoice.",
        ],
      },
      {
        heading: "What conversion copies",
        points: [
          "The customer, every line item, notes, terms, extra charges and round-off.",
          "The quotation's date and due date, so you can edit the draft invoice to today's date if you need to.",
          "A link back to the original quotation or proforma, which stays unchanged.",
          "Stock goes out only when the invoice is saved, like any other sale.",
        ],
      },
      {
        heading: "Pricing that follows the customer",
        points: [
          "If the customer is on a price level, such as wholesale or dealer, prices fill in from that level.",
          "Prices you type yourself are kept as you typed them.",
          "Line discounts and GST are worked out on every line, just like on an invoice.",
        ],
      },
    ],
    faqs: [
      {
        q: "Does a quotation reserve stock?",
        a: "No. Quotations and proformas never touch stock. Stock goes out only when you convert to an invoice, or when you send the goods on a delivery challan.",
      },
      {
        q: "Is a proforma invoice an accounting entry?",
        a: "No. A proforma does not add to the customer's ledger or to GSTR-1. Only the tax invoice you convert it into does.",
      },
      {
        q: "Can I edit a quotation after sending it?",
        a: "Drafts can be edited. Once a quotation is sent, create a new one with the changes so the customer's copy stays as it was.",
      },
      {
        q: "Can I convert the same quotation twice?",
        a: "Yes. The quotation is not changed by conversion, so you can convert it again, for example for a repeat order at the same prices.",
      },
      {
        q: "Can I make quotations on my phone?",
        a: "Yes. The mobile app creates quotations and proforma invoices and converts them into invoices. Editing and share links are on the web and desktop app.",
      },
    ],
    related: ["invoicing", "delivery-challans", "price-levels", "payments"],
    helpPath: "/help/documents/quotations-and-proforma",
  },

  // ── Delivery challans ─────────────────────────────────────────
  {
    slug: "delivery-challans",
    title: "Delivery challans",
    navLabel: "Delivery challans",
    tagline: "Send goods now and bill later. Fintranzact tracks what is still unbilled on every challan, down to the item.",
    summary:
      "Dispatch goods on a delivery challan, track billed and pending quantities, and bill all or part of a challan into a GST invoice without moving stock twice.",
    icon: DeliveryTruck01Icon,
    highlights: [
      {
        title: "Stock leaves at dispatch",
        body: "Goods go out of the warehouse you pick as soon as the challan is saved, so your stock is right even before you bill.",
        icon: PackageIcon,
      },
      {
        title: "Bill in parts",
        body: "Convert a challan into an invoice for everything pending, or only part of it. Bill the rest later on another invoice.",
        icon: Layers01Icon,
      },
      {
        title: "See what is unbilled",
        body: "Every challan shows Not billed, Partly billed, Billed or Closed, and item-wise ordered, done and pending quantities.",
        icon: CheckListIcon,
      },
      {
        title: "No double stock movement",
        body: "An invoice made from a challan doesn't move stock again, because the challan already did.",
        icon: ArrowDataTransferHorizontalIcon,
      },
      {
        title: "Short-close what won't be billed",
        body: "If part of a challan will never be billed, short-close it. Reopen it later if you change your mind.",
        icon: FileEditIcon,
      },
    ],
    steps: [
      {
        title: "Create the challan",
        body: "Open Delivery Challans, pick the customer and the warehouse to dispatch from, and add the items.",
      },
      {
        title: "Dispatch the goods",
        body: "Save the challan. Stock goes out straight away and you get the next challan number, like DC-00001. Share it as a link if you want.",
      },
      {
        title: "Bill when ready",
        body: "Click Convert, choose how much of each item to bill now, and create the invoice. It starts as a draft for you to check.",
      },
      {
        title: "Close it out",
        body: "Keep billing until nothing is pending, or short-close what the customer will not be billed for.",
      },
    ],
    details: [
      {
        heading: "When businesses use a challan",
        points: [
          "Goods sent on approval, where the customer keeps only some of them.",
          "Deliveries made through the month and billed together at month end.",
          "Goods sent out for job work or to another location without a sale.",
        ],
      },
      {
        heading: "How a challan affects your books",
        points: [
          "Stock goes out as soon as it is saved, from the warehouse you choose.",
          "The customer's balance doesn't change until you bill the challan on an invoice.",
          "Challans are not part of GSTR-1 or GSTR-3B. The invoice you make from one is.",
          "Cancelling or deleting a challan puts its stock back.",
        ],
      },
      {
        heading: "Safeguards",
        points: [
          "You can't bill more than is pending on any line.",
          "If an item doesn't have enough stock, you see what is available before saving, and your stock settings decide whether stock may go below zero.",
          "While an invoice made from a challan is active, the challan can't be cancelled, so stock movements are never lost.",
          "If you cancel an invoice made from a challan, its quantities become pending on the challan again.",
        ],
      },
    ],
    faqs: [
      {
        q: "Will converting a challan deduct stock again?",
        a: "No. The invoice is saved without a stock movement of its own, because the challan already took the goods out.",
      },
      {
        q: "Can I bill only part of a challan?",
        a: "Yes, on the web and desktop app. Lower the quantity to bill now for each item. The rest stays pending for a later invoice.",
      },
      {
        q: "Does a challan show on the customer's statement?",
        a: "No. Only the invoice you make from it adds to the customer's balance and appears in their ledger.",
      },
      {
        q: "Can I bill two challans on one invoice?",
        a: "Not today. Each conversion creates one invoice from one challan.",
      },
      {
        q: "How do I record goods coming in before the supplier's bill?",
        a: "Use a goods receipt note against the purchase order. Delivery challans are always for goods going out.",
      },
    ],
    related: ["invoicing", "e-way-bills", "warehouses", "orders-goods-receipts"],
    helpPath: "/help/documents/delivery-challans",
  },

  // ── Credit notes & returns ────────────────────────────────────
  {
    slug: "credit-notes-returns",
    title: "Credit notes and sales returns",
    navLabel: "Credit notes & returns",
    tagline: "Correct a bill or take goods back with the balance, stock and GST reports kept in step.",
    summary:
      "Issue credit notes and sales returns straight from the invoice. Balance, stock and GSTR-1 entries update together, linked to the original invoice.",
    icon: ReturnRequestIcon,
    highlights: [
      {
        title: "Issue from the invoice",
        body: "One click on the invoice opens a credit note or sales return already filled in with the customer and items. Keep only what you are crediting.",
        icon: Invoice01Icon,
      },
      {
        title: "Returned goods back in stock",
        body: "A sales return brings the goods back into the warehouse you choose, using your sales-return warehouse by default.",
        icon: PackageIcon,
      },
      {
        title: "Balance goes down",
        body: "The invoice's balance due and the customer's ledger go down by the credit, and the invoice shows as Adjusted once fully covered.",
        icon: Wallet01Icon,
      },
      {
        title: "Never credit too much",
        body: "Credit notes and returns against one invoice can't add up to more than the invoice total. Fintranzact tells you what is left.",
        icon: Calculator01Icon,
      },
      {
        title: "Ready for GSTR-1",
        body: "Credit notes and sales returns appear in the credit notes section of GSTR-1, with the original invoice number when they are linked.",
        icon: TaxesIcon,
      },
    ],
    steps: [
      {
        title: "Open the invoice",
        body: "Find the invoice the customer is disputing or returning goods against.",
      },
      {
        title: "Choose credit note or return",
        body: "Click Issue Credit Note for a price correction or discount, or Create Sales Return when goods physically come back.",
      },
      {
        title: "Adjust the lines",
        body: "Change quantities or prices to what you are crediting and remove the rest. For a return, pick the warehouse the goods go into.",
      },
      {
        title: "Save",
        body: "The note is linked to the invoice, the balance and stock update, and you can share it with the customer as a link.",
      },
    ],
    details: [
      {
        heading: "Credit note or sales return?",
        points: [
          "Use a credit note when nothing comes back: a price correction, a discount after the sale, or a short supply you won't deliver. It never changes stock.",
          "Use a sales return when the customer sends goods back. Stock comes in and the customer's balance goes down.",
          "Credit notes are numbered CN-00001 and sales returns SR-00001, each with its own series.",
        ],
      },
      {
        heading: "What updates when you save",
        points: [
          "The invoice's balance due, and its status once credits cover the whole amount.",
          "The customer's party ledger, as a credit that reduces what they owe.",
          "Stock, for sales returns, in the warehouse you picked.",
          "The credit notes section of your GSTR-1 report.",
        ],
      },
      {
        heading: "Good to know",
        points: [
          "You can also create a standalone credit note or return from its own page. It reduces the party's balance but isn't tied to one invoice.",
          "Supplier credit notes are supported on the purchases side of the Credit Notes page.",
          "Debit notes and purchase returns are created through the Fintranzact CLI or the AI assistant integration (MCP server) for now, not from a screen in the app.",
          "Cancelling a return takes its stock back out and removes it from the invoice's adjusted amount.",
        ],
      },
    ],
    faqs: [
      {
        q: "Does a credit note bring stock back?",
        a: "No. A credit note only changes money owed. Use a sales return when goods physically come back, and the stock is added back for you.",
      },
      {
        q: "How do I refund the customer?",
        a: "Record the money going out under Cash & Bank. Marking a credit note as paid changes only its label; the customer's balance already went down when you saved it.",
      },
      {
        q: "Can I link an existing credit note to an invoice later?",
        a: "No. The link is set when you issue the credit note from the invoice. Delete the unlinked draft and issue a new one from the invoice instead.",
      },
      {
        q: "Can I issue credit notes on my phone?",
        a: "Yes. The mobile app issues credit notes and sales returns from an invoice, and creates standalone ones too.",
      },
    ],
    related: ["invoicing", "gst-filing", "inventory", "payments"],
    helpPath: "/help/documents/credit-and-debit-notes",
  },

  // ── Point of sale ─────────────────────────────────────────────
  {
    slug: "point-of-sale",
    title: "Point of sale billing",
    navLabel: "Point of sale",
    tagline: "A fast, full-screen billing counter: scan, tap, take cash or UPI and print the receipt. Every sale is a proper GST invoice.",
    summary:
      "Full-screen POS for retail counters: barcode scanning, keyboard shortcuts, up to five held bills, cash or UPI payment and 80mm receipts, saved as GST invoices.",
    icon: ShoppingCart01Icon,
    highlights: [
      {
        title: "Scan or tap to bill",
        body: "USB and Bluetooth barcode scanners work with no setup. Scanning a carton barcode adds its full piece count in one go.",
        icon: BarCode01Icon,
      },
      {
        title: "Keyboard first",
        body: "F2 to search, F3 for the customer, F6 to hold a bill and F9 to take payment, so the queue keeps moving.",
        icon: KeyboardIcon,
      },
      {
        title: "Hold up to five bills",
        body: "Park a bill when a customer steps away and serve the next person. Switch back with Alt+1 to Alt+5.",
        icon: PauseIcon,
      },
      {
        title: "Cash or UPI",
        body: "Take payment in cash or UPI with one click. The payment is recorded against the invoice for you.",
        icon: MoneyReceive01Icon,
      },
      {
        title: "Thermal receipts",
        body: "The receipt prints in 80mm thermal format on your default printer as soon as the sale is complete.",
        icon: PrinterIcon,
      },
      {
        title: "One set of books",
        body: "POS sales are ordinary GST invoices, so they show in your invoices, stock, GST reports and payments with nothing to sync.",
        icon: Invoice01Icon,
      },
    ],
    steps: [
      {
        title: "Turn on POS",
        body: "An owner or admin switches on Point-of-Sale mode in Settings. A Switch to POS button then appears on the Invoices page.",
      },
      {
        title: "Build the bill",
        body: "Scan items or tap their tiles. Each tile shows the price and stock in hand, and items with variants or units get their own tiles.",
      },
      {
        title: "Pick the customer",
        body: "Bills start as Walk-in Customer. Press F3 to attach a regular customer or add a new one with just a name and phone number.",
      },
      {
        title: "Take payment",
        body: "Press F9, choose Cash or UPI and confirm. The invoice and payment are saved and the receipt prints.",
      },
    ],
    details: [
      {
        heading: "Made for busy counters",
        points: [
          "A clean full-screen register with no menus in the way: a product grid, a cart and a pay button.",
          "Search matches item name, barcode and SKU.",
          "Each browser tab works as a separate till, so two counters can bill from one computer.",
          "When one till completes a sale, other tills in the same browser refresh their stock figures.",
        ],
      },
      {
        heading: "What gets saved",
        points: [
          "A sale invoice from your normal invoice series, with GST worked out from each item's tax rate.",
          "A payment for the full amount in the mode you chose, dated today.",
          "Stock taken out for each line in the right unit or variant.",
          "Held bills are kept in the browser, so they survive a page refresh.",
        ],
      },
      {
        heading: "Who can use it",
        points: [
          "POS runs in the web and desktop app, not in the mobile app.",
          "Owners, admins, seller managers and sellers can bill at the register.",
          "Only owners and admins can switch POS mode on or off for a business.",
        ],
      },
    ],
    faqs: [
      {
        q: "Is a POS sale a GST invoice?",
        a: "Yes. Every POS sale is saved as a regular sale invoice with GST worked out from each item's rate, and it appears in your GST reports.",
      },
      {
        q: "Can I give a discount at the counter?",
        a: "The register uses the item's price as set. For a sale that needs a discount or a different price, create it from the regular invoice form.",
      },
      {
        q: "Which barcode scanners work?",
        a: "Any USB or Bluetooth scanner that types the code and ends with Enter. There is nothing to install or set up.",
      },
      {
        q: "Can I split a payment between cash and UPI?",
        a: "Not in the register. Take one mode at the counter, then adjust or add payments from the invoice afterwards if you need to.",
      },
      {
        q: "How do I check the cash at day end?",
        a: "POS sales are normal payments, so review today's entries on the Payments page and your cash account under Cash & Bank.",
      },
    ],
    related: ["invoicing", "physical-stock-barcodes", "price-levels", "payments"],
    helpPath: "/help/pos",
  },

  // ── Recurring invoices ────────────────────────────────────────
  {
    slug: "recurring-invoices",
    title: "Recurring invoices",
    navLabel: "Recurring invoices",
    tagline: "Set up rent, retainers, AMCs and subscriptions once. Fintranzact creates the invoice every time it falls due.",
    summary:
      "Automate repeat billing with recurring invoice templates: weekly to yearly or a custom interval, run history, pause and resume, and smart suggestions.",
    icon: RepeatIcon,
    highlights: [
      {
        title: "Any schedule",
        body: "Weekly, every two weeks, monthly, quarterly, half-yearly, yearly, or a custom interval of 1 to 365 days.",
        icon: Calendar03Icon,
      },
      {
        title: "Drafts you can check",
        body: "Each run creates a draft invoice with the next invoice number, so you review it before it goes to the customer.",
        icon: Invoice01Icon,
      },
      {
        title: "Stop when you choose",
        body: "Set an end date or a maximum number of runs, or let the template run until you pause or delete it.",
        icon: Clock01Icon,
      },
      {
        title: "Pause, resume, run now",
        body: "Pause a template for a quiet month, resume it later, or create this period's invoice straight away with Run Now.",
        icon: PauseIcon,
      },
      {
        title: "Smart suggestions",
        body: "Fintranzact spots customers you already bill at regular intervals and offers to turn them into a template.",
        icon: SparklesIcon,
      },
    ],
    steps: [
      {
        title: "Create a template",
        body: "Give it a name, pick the customer and whether it is a sale or purchase, and add the line items.",
      },
      {
        title: "Set the schedule",
        body: "Choose how often it runs and the start date, and optionally an end date or maximum number of runs.",
      },
      {
        title: "Let it run",
        body: "When a run falls due, Fintranzact creates the invoice, records the run and moves the next run date forward.",
      },
      {
        title: "Review and send",
        body: "Open the new draft on the Invoices page, check it and share it with the customer as usual.",
      },
    ],
    details: [
      {
        heading: "What each generated invoice includes",
        points: [
          "The same party, line items, notes and terms as the template.",
          "The next number from your normal invoice series, so there is only one sequence to file.",
          "Stock movement for any line linked to a stock item, exactly like a manual invoice.",
          "A tag showing it came from a recurring template.",
        ],
      },
      {
        heading: "Stay in control",
        points: [
          "Execution history shows every run, the invoice it created, and any error.",
          "Month-based schedules keep the same day of the month, moving to the last day in shorter months.",
          "Edits apply to future runs only; invoices already created are never changed.",
          "Deleting a template stops future runs and keeps the invoices it made.",
        ],
      },
      {
        heading: "Good fits",
        points: [
          "Rent, maintenance and annual maintenance contracts (AMCs).",
          "Monthly retainers for consultants, agencies and CAs.",
          "Hosting, software and other subscriptions.",
          "Regular supplier bills, by setting the template type to Purchase.",
        ],
      },
    ],
    faqs: [
      {
        q: "Does Fintranzact send the invoice to my customer automatically?",
        a: "No. It creates the invoice as a draft. You review it and share it as a link, on WhatsApp or as a PDF, just like any other invoice.",
      },
      {
        q: "What happens if I set a start date in the past?",
        a: "Back-dated templates don't create catch-up invoices. The first run is one period from today. Use Run Now if you need an invoice for the missed period.",
      },
      {
        q: "Can I change the amount for one month only?",
        a: "Edit the template's lines before the run and change them back afterwards, or pause the template and make that month's invoice by hand.",
      },
      {
        q: "Who can create and change templates?",
        a: "Owners, admins and seller managers. Sellers and accountants can see templates but can't change or run them.",
      },
      {
        q: "Is there a limit on how many invoices are generated?",
        a: "Some plans have a monthly limit on scheduled runs. The page shows how many runs you have used this month against your plan.",
      },
    ],
    related: ["invoicing", "payments", "banking"],
    helpPath: "/help/invoicing/recurring-invoices",
  },

  // ── Payments ──────────────────────────────────────────────────
  {
    slug: "payments",
    title: "Payments and receivables",
    navLabel: "Payments",
    tagline: "Record every rupee in and out, match it to the right invoices, and always know who owes you what.",
    summary:
      "Record receipts and supplier payments by cash, UPI, bank or cheque, split one payment across invoices, track part payments and keep bank balances right.",
    icon: CreditCardIcon,
    highlights: [
      {
        title: "Split one payment",
        body: "A customer pays a round sum for several bills? Allocate it across their open invoices, oldest first, or set each amount yourself.",
        icon: Layers01Icon,
      },
      {
        title: "Part payments and advances",
        body: "Record part payments and the invoice shows as partly paid. Advances wait on the party's account until you allocate them.",
        icon: Coins01Icon,
      },
      {
        title: "Every payment mode",
        body: "Cash, bank transfer, UPI, cheque or other, with a reference field for the UTR, UPI reference or cheque number.",
        icon: Wallet01Icon,
      },
      {
        title: "Bank balances follow",
        body: "Link a payment to a bank, cash or UPI account and the account's balance and transaction list update for you.",
        icon: BankIcon,
      },
      {
        title: "Gateway charges handled",
        body: "Paid through Razorpay, PayU or PhonePe? Fintranzact records the gateway charge as an expense and moves the net amount to your bank.",
        icon: CreditCardIcon,
      },
      {
        title: "Settlement discounts",
        body: "Settle for a round figure with a payment discount that clears the balance without counting it as income.",
        icon: PercentIcon,
      },
    ],
    steps: [
      {
        title: "Open the invoice or Payments",
        body: "Click Record Payment on an invoice for a single bill, or go to Payments to record one payment for several invoices.",
      },
      {
        title: "Enter the details",
        body: "The amount fills in with the balance due. Choose the mode, the date, the account it went into and the reference number.",
      },
      {
        title: "Allocate",
        body: "Tick the invoices this payment covers. Fintranzact fills them oldest first, and you can change any amount.",
      },
      {
        title: "Save",
        body: "Invoice statuses, the party's ledger and the bank account balance all update in one step.",
      },
    ],
    details: [
      {
        heading: "Always know who owes what",
        points: [
          "Invoices move to partly paid or paid automatically as payments are recorded.",
          "Overdue invoices are flagged once they pass their due date with money still owed.",
          "The party ledger shows every invoice, payment, credit note and return for a customer or supplier.",
          "The MSME payables report lists unpaid bills from MSME suppliers with their 45-day pay-by dates under Section 43B(h).",
        ],
      },
      {
        heading: "Built for Indian payments",
        points: [
          "All amounts are in INR.",
          "Enter the UTR for NEFT, RTGS and IMPS, or the UPI reference, and bank reconciliation can match the payment to your statement automatically.",
          "Each payment gets its own number, like PAY-00001.",
          "Export the payment list to CSV for any date range.",
        ],
      },
      {
        heading: "Safe corrections",
        points: [
          "Deleting a payment reverses its bank transaction and puts the balance back on the invoices it paid.",
          "Only owners and admins can delete payments.",
          "Gateway charges and settlement transfers are reversed too when a gateway payment is deleted.",
        ],
      },
    ],
    faqs: [
      {
        q: "A customer paid in advance. How do I record it?",
        a: "Record the payment without allocating it to an invoice. It shows as a credit on the party's account, and you can allocate it when you raise the invoice.",
      },
      {
        q: "How do I record a part payment?",
        a: "Enter the amount received and allocate it to the invoice. The invoice shows as partly paid until you record the rest.",
      },
      {
        q: "The invoice is short by one rupee. What do I do?",
        a: "Use the discount field on the payment to write off the small difference, and the invoice will show as paid.",
      },
      {
        q: "Does a payment made from a share link get recorded automatically?",
        a: "No. When the money arrives in your bank or UPI account, record it under Payments as usual.",
      },
      {
        q: "Can I record payments on my phone?",
        a: "Yes. The mobile app records payments from an invoice or from the Payments tab, including splitting a payment across invoices.",
      },
    ],
    related: ["invoicing", "banking", "expenses", "reporting"],
    helpPath: "/help/payments",
  },

  // ── Expenses ──────────────────────────────────────────────────
  {
    slug: "expenses",
    title: "Expense tracking",
    navLabel: "Expenses",
    tagline: "Note down rent, salaries, electricity and every other running cost in seconds, and see where the money goes.",
    summary:
      "Record business expenses by category and payment mode, keep cash and bank balances right, filter by date and category, and see spending in your reports.",
    icon: Wallet01Icon,
    highlights: [
      {
        title: "Quick to record",
        body: "Category, amount, mode and date is all it takes. Add a description or bill number if you want.",
        icon: FileEditIcon,
      },
      {
        title: "Your own categories",
        body: "Rent, electricity, salaries, travel: type any category and reuse it. The mobile app suggests the ones you have used before.",
        icon: Tag01Icon,
      },
      {
        title: "Balances stay right",
        body: "Cash expenses come out of your cash account and bank, cheque or UPI expenses out of the matching account, your default first.",
        icon: BankIcon,
      },
      {
        title: "Filter and export",
        body: "Filter by category and date range, search the list, and export it to CSV for your accountant.",
        icon: CsvIcon,
      },
      {
        title: "Income against spend",
        body: "The dashboard shows expenses for the financial year and a month-by-month comparison of income and expenses.",
        icon: Calculator01Icon,
      },
    ],
    steps: [
      {
        title: "Open Expenses",
        body: "Click New Expense, or press N on the Expenses page.",
      },
      {
        title: "Fill in the basics",
        body: "Pick or type a category, enter the amount, how it was paid and the date.",
      },
      {
        title: "Add a reference",
        body: "Note the vendor's bill number or cheque number so it's easy to find later and to match on your bank statement.",
      },
      {
        title: "Save",
        body: "The expense is recorded and the matching cash or bank account balance goes down.",
      },
    ],
    details: [
      {
        heading: "Expense or purchase invoice?",
        points: [
          "Use an expense for running costs such as rent, utilities, salaries, travel and small cash spends.",
          "Use a purchase invoice for goods you resell, or whenever you want to claim input tax credit, because it is linked to the supplier and their GSTIN.",
          "Expenses don't generate input tax credit.",
        ],
      },
      {
        heading: "Where expenses show up",
        points: [
          "The Expenses report, with totals per category for any date range.",
          "Profit and loss, the day book and the dashboard.",
          "The cash or bank account the expense was paid from.",
          "Payment gateway charges are filed as expenses automatically when you use a gateway account.",
        ],
      },
      {
        heading: "Straight from your bank statement",
        points: [
          "During bank reconciliation, turn a bank charge or auto-debit on your statement into an expense with one click.",
          "Categorisation rules fill in the category for narrations that repeat every month.",
        ],
      },
    ],
    faqs: [
      {
        q: "Can I attach a photo of the bill?",
        a: "Not yet. Put the bill number in the reference field so you can find the paper copy later.",
      },
      {
        q: "How do I see expenses by category?",
        a: "Open Reports and choose the Expenses report. It shows the total for each category over the dates you pick.",
      },
      {
        q: "Can I claim GST input credit on an expense?",
        a: "No. If you want input tax credit, record the purchase as a purchase invoice from the supplier with the GST rate on each line.",
      },
      {
        q: "What happens when I delete an expense?",
        a: "It is removed from reports and totals, and the bank or cash transaction it created is reversed.",
      },
    ],
    related: ["banking", "payments", "reporting"],
    helpPath: "/help/expenses",
  },

  // ── Banking ───────────────────────────────────────────────────
  {
    slug: "banking",
    title: "Cash, bank and reconciliation",
    navLabel: "Cash & bank",
    tagline: "Every bank account, UPI account and cash box in one place, reconciled against your bank statement in minutes.",
    summary:
      "Track bank, UPI, cash, card and payment gateway accounts, transfer between them, and reconcile bank statements from SBI, HDFC, ICICI and more by CSV.",
    icon: BankIcon,
    highlights: [
      {
        title: "All your accounts",
        body: "Savings, current, cash, UPI, business credit card and payment gateway accounts, each with its own balance and transaction list.",
        icon: BankIcon,
      },
      {
        title: "Balances that keep themselves",
        body: "Payments, expenses and transfers post to the right account automatically, with a running balance on every line.",
        icon: Calculator01Icon,
      },
      {
        title: "Statement import",
        body: "Upload your bank statement as a CSV. Built-in layouts cover SBI, HDFC, ICICI, Axis, Kotak, PNB, Bank of Baroda, Union Bank, IDBI and IndusInd.",
        icon: FileImportIcon,
      },
      {
        title: "Auto-matching",
        body: "Statement lines are matched to your payments, expenses and bank entries by amount, date and UTR, cheque or UPI reference.",
        icon: GitCompareIcon,
      },
      {
        title: "Bank reconciliation statement",
        body: "The BRS compares your book balance with the statement balance and shows what is still unmatched.",
        icon: CheckListIcon,
      },
      {
        title: "UPI QR on invoices",
        body: "Add a UPI account with your UPI ID and unpaid sale invoices carry a QR code for the exact balance due.",
        icon: QrCodeIcon,
      },
    ],
    steps: [
      {
        title: "Add your accounts",
        body: "Add each bank, UPI and cash account with its opening balance. Mark one as the default for new payments.",
      },
      {
        title: "Work as usual",
        body: "Record payments and expenses. Each one posts to the right account, and transfers between accounts are saved as one step.",
      },
      {
        title: "Import the statement",
        body: "Download last month's statement from net banking as CSV and upload it. Your bank's layout is detected for you.",
      },
      {
        title: "Review and reconcile",
        body: "Confirm the automatic matches, match the rest by hand, turn bank charges into expenses, and check the BRS.",
      },
    ],
    details: [
      {
        heading: "Everyday banking",
        points: [
          "Summary cards for total balance, cash in hand and bank balance.",
          "Transfer money between your own accounts, with a withdrawal and a deposit saved together.",
          "Add deposits or withdrawals by hand for interest or charges that didn't come from a payment or expense.",
          "Find payments not linked to any account and assign them to one in bulk.",
        ],
      },
      {
        heading: "Reconciliation that does the matching",
        points: [
          "Reads UPI, NEFT, RTGS, IMPS and cheque narrations to find references.",
          "Each match shows its confidence, from exact reference matches down to amount-and-date matches you should check.",
          "Save your own column layout as a template if your bank isn't built in.",
          "Categorisation rules fill in the expense category for narrations that repeat.",
        ],
      },
      {
        heading: "Payment gateways",
        points: [
          "Set a charge rate for each payment mode: credit card, debit card, UPI, net banking and wallet.",
          "When a customer pays through the gateway, the charge is recorded as an expense.",
          "The net amount can be settled to your bank account automatically.",
        ],
      },
    ],
    faqs: [
      {
        q: "Does Fintranzact connect to my bank directly?",
        a: "No. There is no live bank feed. Download your statement as a CSV from net banking and import it on the Bank Reconciliation page.",
      },
      {
        q: "My bank isn't in the list. Can I still reconcile?",
        a: "Yes. Map the columns yourself once and save them as a template, and next month's statement imports in one click.",
      },
      {
        q: "Can I import a PDF or Excel statement?",
        a: "The import takes CSV files. Open an Excel or PDF statement in a spreadsheet program and save it as CSV first.",
      },
      {
        q: "Who can use bank reconciliation?",
        a: "Owners, admins and accountants. It is in the web and desktop app; the mobile app shows balances and transactions.",
      },
      {
        q: "Does Fintranzact connect to Razorpay or PayU?",
        a: "No. Gateway accounts are for bookkeeping: they work out the charges and settlements for payments you record.",
      },
    ],
    related: ["payments", "expenses", "reporting"],
    helpPath: "/help/banking",
  },
];

