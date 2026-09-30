import {
  Alert02Icon,
  ArrowDataTransferHorizontalIcon,
  ArrowLeftRightIcon,
  ArrowTurnBackwardIcon,
  BalanceScaleIcon,
  BarCode01Icon,
  Calculator01Icon,
  Calendar03Icon,
  Cancel01Icon,
  ChartIncreaseIcon,
  CheckListIcon,
  CheckmarkCircle02Icon,
  ClipboardIcon,
  ClipboardListIcon,
  CookBookIcon,
  DeliveryTruck01Icon,
  Factory01Icon,
  FolderTreeIcon,
  HourglassIcon,
  Invoice01Icon,
  Layers01Icon,
  Layers02Icon,
  ListViewIcon,
  NoteEditIcon,
  PackageDeliveredIcon,
  PackageIcon,
  PackageMovingIcon,
  PackageReceiveIcon,
  PercentIcon,
  PrinterIcon,
  QrCodeIcon,
  Recycle01Icon,
  ScanIcon,
  SecurityCheckIcon,
  Settings02Icon,
  ShoppingCart01Icon,
  Tag01Icon,
  Timer01Icon,
  UserGroupIcon,
  UserLock01Icon,
  WarehouseIcon,
  WeightScaleIcon,
} from "@hugeicons/core-free-icons";
import type { FeaturePage } from "./types";

/**
 * Public feature pages for inventory, warehouses and production
 * (/features/<slug>).
 *
 * Every claim here was checked against the stock, warehouse, barcode,
 * priceLevel, orders, manufacturing and inventory-reports routers, the web
 * screens that use them, and the help articles under content/help/inventory.
 * Batch/expiry tracking, serial/IMEI numbers and stock per rack or bin are
 * NOT built, so none of these pages may promise them.
 */
export const INVENTORY_PAGES: FeaturePage[] = [
  // ── Inventory ──────────────────────────────────────────────
  {
    slug: "inventory",
    title: "Inventory management that keeps itself up to date",
    navLabel: "Inventory",
    tagline:
      "Stock goes up and down as you bill, buy and take returns, for every item, variant and unit, so the numbers on screen match the shelf.",
    summary:
      "Inventory software for Indian businesses: items with variants and alternate units, stock that moves with every bill, low-stock alerts and stock groups.",
    icon: PackageIcon,
    highlights: [
      {
        title: "Stock moves with your documents",
        body: "Sale invoices, delivery challans and purchase returns take stock out. Purchase bills, goods receipts and sales returns bring it in. There is no separate stock entry to remember.",
        icon: PackageMovingIcon,
      },
      {
        title: "Variants and alternate units",
        body: "Sell a shirt in sizes and colours, each with its own stock, SKU and price, or buy rice by the 50 kg sack and sell it by the kilo.",
        icon: Layers01Icon,
      },
      {
        title: "Stock groups, the Tally way",
        body: "File items into nested groups such as Groceries › Rice › Basmati and see quantity and value for any level.",
        icon: FolderTreeIcon,
      },
      {
        title: "Low-stock alerts",
        body: "Set an alert level on each item. Items at or below it are flagged on the items list and show up in the reorder report.",
        icon: Alert02Icon,
      },
      {
        title: "Adjustments with a reason",
        body: "Record damaged, lost, found or sample stock at a warehouse, with the reason, the date and the name of whoever made the change.",
        icon: NoteEditIcon,
      },
      {
        title: "Your rule for selling below zero",
        body: "Allow it, get a warning, or block any bill that would take a warehouse below zero. You choose once for the whole business.",
        icon: SecurityCheckIcon,
      },
    ],
    steps: [
      {
        title: "Add your items",
        body: "Add products and services with HSN or SAC code, GST rate, sale and purchase price, unit and opening stock, or import them from a CSV file.",
      },
      {
        title: "Organise them",
        body: "Put items into stock groups and set a low-stock alert on everything you buy again and again.",
      },
      {
        title: "Bill as usual",
        body: "Invoices, delivery challans, purchase bills, GRNs and returns update stock the moment they are saved.",
      },
      {
        title: "Correct and review",
        body: "Use a stock adjustment for damage or losses, and check the stock summary and reorder report to decide what to buy.",
      },
    ],
    details: [
      {
        heading: "What changes your stock",
        points: [
          "Sale invoices (including point-of-sale bills and online store orders), delivery challans and purchase returns take stock out.",
          "Purchase invoices, goods receipt notes and sales returns bring stock in.",
          "Quotations, proforma invoices, sales and purchase orders, credit notes and debit notes never change stock.",
          "Editing a document posts only the difference: change 10 to 12 and two more go out. Cancelling or deleting it puts the stock back.",
          "An invoice made from a delivery challan or GRN does not move the goods a second time.",
        ],
      },
      {
        heading: "Items the way you sell them",
        points: [
          "Products carry stock. Services such as installation, delivery charges or consulting never do.",
          "Variant items keep their own stock, SKU, price and low-stock alert for each variant, with up to five attributes such as size, colour and material.",
          "Alternate units convert on their own: sell 2 boxes of 12 and 24 pieces leave stock.",
          "Quantities can have up to three decimals, so 2.5 kg or 1.75 m is fine.",
        ],
      },
      {
        heading: "Keeping stock honest",
        points: [
          "Choose Allow, Warn or Block for bills that would take a warehouse below zero. Warn is the default.",
          "On sale invoices, challans and purchase returns, the form warns you before saving if any item is short, showing what is available and what is needed.",
          "Every adjustment is logged with the stock before and after, the reason, the date and the person who made it.",
          "Scan your shelves with a barcode scanner and post the differences when the books and the shelf disagree.",
        ],
      },
    ],
    faqs: [
      {
        q: "Do I have to enter stock movements by hand?",
        a: "No. Stock goes up and down as you save invoices, challans, GRNs and returns. Stock adjustments are only for changes that are not a sale or a purchase, such as damaged or lost goods.",
      },
      {
        q: "Does a draft invoice reduce stock?",
        a: "Yes. A draft invoice or challan already takes the goods out, the same as a sent one. If you only want to quote a price, use a quotation, which never moves stock.",
      },
      {
        q: "Can I sell more than I have in stock?",
        a: "You decide. Allow lets stock go below zero silently, Warn (the default) shows a shortfall but still saves, and Block stops the document from being saved until the quantities fit.",
      },
      {
        q: "How do I bring in the stock I already have?",
        a: "Enter the opening stock on each item, or import your items from a CSV file with a stock quantity column. Opening stock is valued at the item's purchase price.",
      },
      {
        q: "Can I organise items into groups like in Tally?",
        a: "Yes. Stock groups can be nested as deep as you like, and an item in a sub-group counts towards every group above it in reports.",
      },
    ],
    related: ["warehouses", "physical-stock-barcodes", "stock-valuation", "inventory-reports"],
    helpPath: "/help/inventory/how-stock-moves",
  },

  // ── Warehouses ─────────────────────────────────────────────
  {
    slug: "warehouses",
    title: "Warehouses and godowns",
    navLabel: "Warehouses",
    tagline:
      "Know not just how much stock you have, but which godown, shop or storeroom it is sitting in.",
    summary:
      "Multi-godown stock tracking: stock per warehouse, a default warehouse for each document type, a dispatch-from picker on bills and transfer rights per person.",
    icon: WarehouseIcon,
    highlights: [
      {
        title: "Stock in every location",
        body: "One table lists every item with a column for each warehouse and a total, with low stock flagged.",
        icon: WarehouseIcon,
      },
      {
        title: "A default for each job",
        body: "Choose where sales and challans ship from, where purchases and GRNs land, and where returns and adjustments go.",
        icon: Settings02Icon,
      },
      {
        title: "Dispatch from, receive into",
        body: "Once you have two warehouses, invoices, challans, GRNs and returns show a warehouse picker, already set to the right default.",
        icon: DeliveryTruck01Icon,
      },
      {
        title: "Shortages checked per warehouse",
        body: "Fifty in the godown does not help a bill from the shop that has five. The shortfall warning looks at the warehouse you picked.",
        icon: Alert02Icon,
      },
      {
        title: "Who can move stock where",
        body: "Owners and admins manage every warehouse. Give sales managers the right to transfer, or to adjust and count, one warehouse at a time.",
        icon: UserLock01Icon,
      },
    ],
    steps: [
      {
        title: "Start with Main warehouse",
        body: "Every business gets a Main warehouse automatically, so a single shop never has to think about warehouses at all.",
      },
      {
        title: "Add your godowns and shops",
        body: "Give each one a name, a short code such as PUNE, a type and an address.",
      },
      {
        title: "Set the defaults",
        body: "Pick the default warehouse for sales and challans, purchases, sales returns, purchase returns, and opening stock and adjustments.",
      },
      {
        title: "Give access",
        body: "On each warehouse, tick Transfer or Adjust & count for the team members who need it.",
      },
      {
        title: "Bill from the right place",
        body: "Choose Dispatch from or Receive into on the document, and stock moves at that warehouse.",
      },
    ],
    details: [
      {
        heading: "Setting up your locations",
        points: [
          "Warehouse types are Main warehouse, Godown, Shop / store, In transit and Other. The type is a label to help you recognise it; all of them work the same way.",
          "Make a warehouse inactive when you stop using it. Its history stays, and it can be made active again later.",
          "A warehouse that has never had a stock movement can be deleted. One with history is kept, so your stock records stay complete.",
          "Note the areas, racks, shelves and bins inside a warehouse to record your layout. Stock itself is tracked per warehouse.",
        ],
      },
      {
        heading: "On your documents",
        points: [
          "The warehouse picker appears on sale and purchase invoices, delivery challans, GRNs and returns once you have two active warehouses.",
          "It applies to the whole document. If one order needs goods from two godowns, transfer them into one first.",
          "When you convert an order into a challan, GRN or invoice, you pick the warehouse in the same dialog.",
          "Change the warehouse on a saved document and the stock moves from the old warehouse to the new one.",
        ],
      },
      {
        heading: "Control and reports",
        points: [
          "Stock transfers and the stock adjustments page never take a warehouse below zero.",
          "Warehouse access covers transfers, adjustments, physical stock counts and manufacturing at that warehouse.",
          "Godown Summary shows the quantity and value held in each warehouse, and the Stock Ledger and Movement Summary can be filtered to one warehouse.",
        ],
      },
    ],
    faqs: [
      {
        q: "I have only one shop. Do I need to set anything up?",
        a: "No. Main warehouse is created for you and everything uses it. The warehouse picker does not even appear on documents until you add a second active warehouse.",
      },
      {
        q: "Can I show goods that are on a truck between two godowns?",
        a: "Yes. Add a warehouse with the type In transit and make two transfers: godown to in transit when the truck leaves, and in transit to the shop when it arrives.",
      },
      {
        q: "Can I stop a staff member from moving stock out of a godown?",
        a: "Yes, for transfers and adjustments. Sales managers need Transfer or Adjust & count on that warehouse, and sellers and accountants cannot transfer or adjust stock at all.",
      },
      {
        q: "Why can't I delete an old warehouse?",
        a: "A warehouse that has ever had a stock movement is part of your stock history. Move its stock out with a transfer, choose another default if needed, and make it inactive instead.",
      },
      {
        q: "Can I see how much stock is in each rack or bin?",
        a: "Not yet. Racks, shelves and bins record your layout, while stock, transfers and reports work at warehouse level.",
      },
    ],
    related: ["stock-transfers", "inventory", "physical-stock-barcodes", "inventory-reports"],
    helpPath: "/help/inventory/warehouses",
  },

  // ── Stock transfers ────────────────────────────────────────
  {
    slug: "stock-transfers",
    title: "Stock transfers between warehouses",
    navLabel: "Stock transfers",
    tagline:
      "Move stock from the godown to the shop in a single entry, and keep a dated journal of every move.",
    summary:
      "Move stock between godowns and shops in one entry. Stock is checked at the source, your totals stay the same, and every transfer is kept in a journal.",
    icon: ArrowDataTransferHorizontalIcon,
    highlights: [
      {
        title: "Many items in one transfer",
        body: "Add up to 100 lines to a transfer. Each item shows how much is available at the source as you pick it.",
        icon: ClipboardListIcon,
      },
      {
        title: "No moving stock you don't have",
        body: "The source warehouse must hold enough of every line. If one line falls short, nothing moves.",
        icon: Alert02Icon,
      },
      {
        title: "Instant and balanced",
        body: "Stock leaves one warehouse and arrives in the other at the same moment, so your total stock, profit and GST are untouched.",
        icon: ArrowLeftRightIcon,
      },
      {
        title: "A journal of every move",
        body: "See the date, from and to, the items and the total quantity for each transfer, newest first.",
        icon: ListViewIcon,
      },
      {
        title: "Permission per warehouse",
        body: "Owners and admins can move stock anywhere. Sales managers need the Transfer permission on both warehouses.",
        icon: UserLock01Icon,
      },
    ],
    steps: [
      {
        title: "Choose From and To",
        body: "Pick the two warehouses. Only active warehouses are listed, and each list hides the one picked in the other.",
      },
      {
        title: "Add the items",
        body: "Search for each item, see how much is at the source, for example 12 pcs here, and enter the quantity to move.",
      },
      {
        title: "Check the date and save",
        body: "The date starts as today and can be changed. Save, and the stock is moved straight away.",
      },
      {
        title: "Follow it in your reports",
        body: "Each transfer shows in the transfer journal and in the Stock Ledger as Transfer out and Transfer in.",
      },
    ],
    details: [
      {
        heading: "Rules that keep stock right",
        points: [
          "From and To must be two different, active warehouses.",
          "Quantities must be more than zero, with up to three decimals.",
          "The stock check applies whatever your setting for selling below zero is.",
          "If the same item is on two lines, both are added together for the check.",
          "Items with variants are moved variant by variant, for example T-shirt, Red / M.",
        ],
      },
      {
        heading: "Good to know",
        points: [
          "Transfers cannot be edited or deleted. To fix a mistake, make a second transfer in the opposite direction.",
          "Services do not carry stock, so they cannot be transferred.",
          "Transfers work at warehouse level, not rack or bin.",
          "With All warehouses selected, the Movement Summary leaves transfers out because they do not change your total. Pick one warehouse to see them.",
        ],
      },
    ],
    faqs: [
      {
        q: "Does a transfer affect my profit or GST?",
        a: "No. It only changes where your stock is kept. Your total quantity and stock value stay the same.",
      },
      {
        q: "Is there an in-transit stage?",
        a: "A transfer is instant. To see goods on the road, add a warehouse with the type In transit and make one transfer when the truck leaves and another when it arrives.",
      },
      {
        q: "I transferred the wrong quantity. How do I undo it?",
        a: "Transfers are permanent, so make a second transfer in the opposite direction for the extra quantity.",
      },
      {
        q: "Who can make transfers?",
        a: "Owners and admins can transfer between any warehouses. Sales managers can when they have the Transfer permission on both warehouses. Sellers and accountants cannot make transfers.",
      },
    ],
    related: ["warehouses", "inventory", "inventory-reports"],
    helpPath: "/help/inventory/stock-transfers",
  },

  // ── Barcodes and physical stock ────────────────────────────
  {
    slug: "physical-stock-barcodes",
    title: "Barcodes and physical stock counts",
    navLabel: "Barcodes & stock counts",
    tagline:
      "Label every product, scan at the counter, and count your shelves by scanning them against your books.",
    summary:
      "Barcode labels, scanning at the point of sale, and stock counts by scanner, with a report of missing, short and extra items you can post in one click.",
    icon: BarCode01Icon,
    highlights: [
      {
        title: "Your barcode type, locked in",
        body: "Choose EAN-13, Code 128 or QR, and one or many codes per item, then lock the setup so every label from every counter matches.",
        icon: BarCode01Icon,
      },
      {
        title: "Supplier codes or your own",
        body: "Scan the maker's barcode into an item, or let Fintranzact create one. Items on a purchase bill that have no code can get one when the bill is saved.",
        icon: QrCodeIcon,
      },
      {
        title: "Pack and carton codes",
        body: "With many codes per item, a carton code can add 12 or 24 pieces in a single scan, at the counter and during a count.",
        icon: PackageIcon,
      },
      {
        title: "Label printing",
        body: "Print labels for one item, a filtered list of items, or one per piece received on a purchase bill, with the name and price if you want them.",
        icon: PrinterIcon,
      },
      {
        title: "Count by scanning",
        body: "Pick a warehouse and scan every shelf. Scans are kept in your browser as you go, and you can undo the last one.",
        icon: ScanIcon,
      },
      {
        title: "Differences posted in one click",
        body: "The report lists what matched, what is missing and what is short or extra, with the value, and posts the differences as adjustments.",
        icon: CheckListIcon,
      },
    ],
    steps: [
      {
        title: "Switch on barcodes",
        body: "In Settings, turn on barcodes, choose the type and whether an item can have more than one code, then lock the setup.",
      },
      {
        title: "Give items codes and print labels",
        body: "Scan existing codes into items or create new ones, then print labels on your label printer.",
      },
      {
        title: "Scan at the counter",
        body: "On the point-of-sale screen, each scan adds the item to the bill. A pack code adds the whole pack.",
      },
      {
        title: "Count a warehouse",
        body: "Open Physical Stock, pick the warehouse and scan everything on the shelves. The Expected here list shows what you have not found yet.",
      },
      {
        title: "Review and post",
        body: "Press End scan to see the report, then post the differences as stock adjustments or save the report to post later.",
      },
    ],
    details: [
      {
        heading: "Barcode setup",
        points: [
          "EAN-13 prints on 50 × 25 mm labels, Code 128 on 75 × 25 mm, and QR on 38 × 25 mm, two across.",
          "EAN-13 codes that Fintranzact creates use the in-store range starting with 2. With Code 128 or QR, a short SKU can be the code itself.",
          "Every code must be unique in your business, and each variant can have its own.",
          "Labels print as a PDF at the exact label size, through your computer's normal print window.",
        ],
      },
      {
        heading: "Where scanning works",
        points: [
          "Point of sale: any USB or Bluetooth scanner that types like a keyboard adds items to the bill, with no setup.",
          "Physical Stock: each scan counts an item. Main codes, extra and pack codes and SKUs are all recognised.",
          "On regular invoice forms, find items by name or SKU instead.",
        ],
      },
      {
        heading: "The count report",
        points: [
          "Summary cards show items expected, matched, missing and short or extra, and the value of the change at purchase price.",
          "Each difference shows the books quantity, the scanned quantity and its value.",
          "Codes that are not in the system are listed but never adjusted, with a link to add the item.",
          "Items in stock without a barcode are listed separately and left untouched.",
          "Posting records each change as a stock adjustment marked Physical stock verification. Every count is kept in a list of past counts.",
        ],
      },
    ],
    faqs: [
      {
        q: "Can I use the barcodes already printed on my products?",
        a: "Yes. Scan them into each item's barcode field. If you also want your own code or a carton code on the same item, choose many barcodes per item before you lock the setup.",
      },
      {
        q: "What kind of scanner do I need?",
        a: "Any USB or Bluetooth barcode scanner that types into the computer like a keyboard. There is nothing to install.",
      },
      {
        q: "What if I only scanned part of a warehouse?",
        a: "A count covers the whole warehouse, so anything in the books that you did not scan is treated as missing. Use Save report only and check the differences, or finish scanning before you post.",
      },
      {
        q: "Can I type counted quantities instead of scanning?",
        a: "Physical Stock works by scanning. To correct a few items by hand, make a stock adjustment with a reason instead.",
      },
      {
        q: "Can I change the barcode type later?",
        a: "No. Locking is permanent, so every code and label stays consistent. Decide on the type before you create codes or print labels.",
      },
      {
        q: "Is the MRP printed on the label?",
        a: "No. Labels show the barcode, with the product name and sale price if you switch them on.",
      },
    ],
    related: ["point-of-sale", "inventory", "warehouses"],
    helpPath: "/help/inventory/barcodes",
  },

  // ── Stock valuation ────────────────────────────────────────
  {
    slug: "stock-valuation",
    title: "Stock valuation at average cost or FIFO",
    navLabel: "Stock valuation",
    tagline:
      "Your closing stock valued from your own purchase bills, flowing straight into your profit & loss and balance sheet.",
    summary:
      "Value closing stock at average cost or FIFO from your purchase bills, without GST, and see it in your profit & loss and balance sheet with no closing entry.",
    icon: Calculator01Icon,
    highlights: [
      {
        title: "Average cost or FIFO",
        body: "Pick the method that suits you. Every stock report, the profit & loss and the balance sheet use the same one.",
        icon: Calculator01Icon,
      },
      {
        title: "Built from purchase bills",
        body: "Cost is each purchase line's taxable value after the line discount, without the GST you claim as input credit.",
        icon: Invoice01Icon,
      },
      {
        title: "Manufacturing costs included",
        body: "Goods you make come in at the cost of the components used plus labour, power or job-work costs you add.",
        icon: Factory01Icon,
      },
      {
        title: "Profit that counts your stock",
        body: "The profit & loss adjusts for stock you bought but have not sold, so gross profit is real, not just sales minus purchases.",
        icon: ChartIncreaseIcon,
      },
      {
        title: "Balance sheet ready",
        body: "Closing stock on the chosen date appears under Inventory, and the balance sheet still balances.",
        icon: BalanceScaleIcon,
      },
      {
        title: "Nothing to post",
        body: "Valuation is worked out whenever you open a report. There is no closing stock voucher to pass at year end.",
        icon: CheckmarkCircle02Icon,
      },
    ],
    steps: [
      {
        title: "Choose a method",
        body: "An owner or admin picks Average cost or FIFO in the inventory settings on the Warehouses page. Average cost is the default.",
      },
      {
        title: "Record purchases as usual",
        body: "Every purchase invoice adds to the cost history. Opening stock uses the item's purchase price.",
      },
      {
        title: "Open your reports",
        body: "Stock Summary, Godown Summary, Stock Group Summary, the profit & loss and the balance sheet all show the value on the same basis.",
      },
    ],
    details: [
      {
        heading: "What goes into cost",
        points: [
          "Purchase invoice lines at their taxable value, after the line discount and without GST.",
          "Finished goods from manufacturing at the components used plus additional costs. By-products and scrap come in at zero.",
          "Opening stock, and items with no purchases yet, at the purchase price on the item. Each variant is valued on its own.",
          "Not included: discounts on the whole bill, freight and other charges added to the bill, and GRNs that have not been billed yet.",
        ],
      },
      {
        heading: "How each method works",
        points: [
          "Average cost: the value of your purchase bills and opening stock up to the date, divided by their quantity, applied to the stock on hand.",
          "FIFO: the stock on hand is taken to be what you bought or made most recently.",
          "Example: you bought 100 pcs at ₹10, then 100 pcs at ₹14, and have 120 left. Average cost values them at ₹1,440; FIFO at ₹1,600.",
          "Stock below zero is valued at ₹0, and services are never valued.",
        ],
      },
      {
        heading: "In your accounts",
        points: [
          "The profit & loss shows Changes in inventories of stock-in-trade: opening stock minus closing stock for the period.",
          "Put simply, cost of goods sold is opening stock plus purchases minus closing stock.",
          "The balance sheet shows closing stock under Inventory for the as-of date.",
          "Stock on a past date is worked out by undoing later movements, so you can value stock for any date, such as 31 March.",
        ],
      },
    ],
    faqs: [
      {
        q: "Is GST included in my stock value?",
        a: "No. Stock is valued at the taxable value on your purchase bills, without GST.",
      },
      {
        q: "Which method should I choose?",
        a: "If you are not sure, keep Average cost. It smooths out price changes and is what most small traders use. FIFO gives a value closer to today's prices when your purchase prices keep rising.",
      },
      {
        q: "Can I switch methods later?",
        a: "Yes, at any time. Because valuation is calculated rather than posted, switching re-values every period, including past ones, so pick a method and keep it once a year's accounts are final.",
      },
      {
        q: "Do stock adjustments carry a cost?",
        a: "No. Adjustments change the quantity only, and the stock that remains is valued by your chosen method. Writing off damaged goods lowers your closing stock value automatically.",
      },
      {
        q: "Is freight added to the cost of my stock?",
        a: "Charges added to the whole bill, such as freight or packing, are not loaded into stock cost. If landed cost matters to you, include those costs in the line rates.",
      },
    ],
    related: ["inventory-reports", "reporting", "manufacturing", "inventory"],
    helpPath: "/help/inventory/stock-valuation",
  },

  // ── Price levels ───────────────────────────────────────────
  {
    slug: "price-levels",
    title: "Price levels, quantity slabs and MRP",
    navLabel: "Price levels & MRP",
    tagline:
      "Retail, wholesale and dealer prices that fill themselves in for each customer, with MRP checked on every line.",
    summary:
      "Keep retail, wholesale and dealer price lists with quantity slabs and dated price changes. Invoices pick each customer's price and warn above MRP.",
    icon: Tag01Icon,
    highlights: [
      {
        title: "Named price lists",
        body: "Create levels such as Retail, Wholesale and Dealer. Mark one as the default for customers without a level of their own.",
        icon: Tag01Icon,
      },
      {
        title: "The right price for each customer",
        body: "Give a customer a price level and their invoices, quotations and orders pick up those prices on their own.",
        icon: UserGroupIcon,
      },
      {
        title: "Quantity slabs",
        body: "Set breaks such as ₹100 from 1 piece, ₹95 from 10 and ₹90 from 50, as a rate, a discount percentage or both.",
        icon: Layers02Icon,
      },
      {
        title: "A price for each unit",
        body: "For items with alternate units, set a separate rate per box or carton instead of a simple multiple of the piece price.",
        icon: WeightScaleIcon,
      },
      {
        title: "Price changes on a date",
        body: "Schedule new prices with an effective-from date. Documents dated on or after it use them; earlier ones keep the old prices.",
        icon: Calendar03Icon,
      },
      {
        title: "MRP on every item",
        body: "Record the MRP on items. You get a warning when a price is above it, and it prints under the item name on sale invoices.",
        icon: Alert02Icon,
      },
    ],
    steps: [
      {
        title: "Create your levels",
        body: "Add a level for each group of customers, such as Wholesale, and choose which one is the default.",
      },
      {
        title: "Fill in the prices",
        body: "Type prices into the grid, one column per level, or use Bulk update to set a whole level at a percentage from your sale prices.",
      },
      {
        title: "Add slabs and dates if you need them",
        body: "Open the slab editor on any price to add quantity breaks, a price per unit or a future effective date.",
      },
      {
        title: "Assign levels to customers",
        body: "Choose a price level on each customer in Parties.",
      },
      {
        title: "Bill",
        body: "Prices fill in as you add lines, and the form tells you which level is in use, for example Prices from the Wholesale price level.",
      },
    ],
    details: [
      {
        heading: "How a price is picked",
        points: [
          "The customer's own level is used, otherwise the default level. With no level at all, the item's sale price is used.",
          "A price set for the line's unit comes first. Otherwise the base price is multiplied by the unit conversion.",
          "The latest price effective on or before the document date applies, then the highest quantity slab the line reaches.",
          "Prices update as you change the customer, date, item, unit or quantity, but a price you type yourself is never overwritten.",
        ],
      },
      {
        heading: "Bulk update",
        points: [
          "Start from the items' sale prices or from the level's current prices.",
          "Change them by a percentage, for example −8 for 8% below.",
          "Keep the paise or round to the nearest rupee, and limit the change to one category if you like.",
          "Prices never go below zero.",
        ],
      },
      {
        heading: "Where price levels apply",
        points: [
          "Sale invoices, quotations, proforma invoices, sales orders, delivery challans and debit notes.",
          "Purchases always use the item's purchase price, and credit notes and sales returns are not re-priced.",
          "Documents you already made keep their prices when a level changes.",
          "The Price List report shows every item's sale price, MRP and price on each level for any date.",
        ],
      },
    ],
    faqs: [
      {
        q: "A customer has no price level. Which price do they get?",
        a: "The default level's price, if you have marked a level as the default. Otherwise the item's own sale price.",
      },
      {
        q: "Can I give one customer a special price on one item?",
        a: "Price levels work for groups of customers. For a one-off price, type it on the invoice line; a typed price is never replaced.",
      },
      {
        q: "Will changing a price level change old invoices?",
        a: "No. Prices are filled in when a document is created. To plan a change, set an effective-from date and it starts on that day.",
      },
      {
        q: "Can I sell above MRP?",
        a: "Fintranzact warns you on the item and on the invoice line but does not stop you. Selling above the printed MRP is not allowed by law, so correct the price.",
      },
    ],
    related: ["invoicing", "quotations", "inventory", "inventory-reports"],
    helpPath: "/help/inventory/price-levels",
  },

  // ── Orders and goods receipts ──────────────────────────────
  {
    slug: "orders-goods-receipts",
    title: "Sales orders, purchase orders and goods receipts",
    navLabel: "Orders & GRN",
    tagline:
      "Track every order from the day it is placed until it is fully delivered, received and billed, one lot at a time.",
    summary:
      "Sales and purchase orders with part deliveries, goods receipt notes and live pending quantities, so you know what is still to ship, receive or bill.",
    icon: ClipboardIcon,
    highlights: [
      {
        title: "Sales orders",
        body: "Record what a customer ordered with a delivery-by date. Stock does not move until the goods actually leave.",
        icon: ClipboardIcon,
      },
      {
        title: "Purchase orders",
        body: "Record what you ordered from a supplier, then turn it into a goods receipt or a purchase invoice.",
        icon: ShoppingCart01Icon,
      },
      {
        title: "Goods receipt notes",
        body: "Bring stock in when goods arrive, before the supplier's bill. The purchase invoice made from the GRN does not add them twice.",
        icon: PackageReceiveIcon,
      },
      {
        title: "Part deliveries",
        body: "Convert pending items as many times as you need, taking only what is ready each time.",
        icon: PackageDeliveredIcon,
      },
      {
        title: "Live pending quantities",
        body: "Every line shows ordered, done and pending, and status tabs show open, partly done and fulfilled orders.",
        icon: Timer01Icon,
      },
      {
        title: "Short-close and reopen",
        body: "When the rest of an order will never come, short-close it. Changed your mind? Reopen it and carry on.",
        icon: Cancel01Icon,
      },
    ],
    steps: [
      {
        title: "Record the order",
        body: "Create a sales order for a customer or a purchase order for a supplier, with items, quantities and a delivery-by date.",
      },
      {
        title: "Convert as goods move",
        body: "Turn a sales order into a delivery challan or invoice, and a purchase order into a GRN or purchase invoice. Lower Take now to deliver part of a line.",
      },
      {
        title: "Pick the warehouse",
        body: "With more than one warehouse, choose where the goods leave from or arrive into in the same dialog.",
      },
      {
        title: "Bill through Convert",
        body: "When it is time to bill, convert the challan or GRN into the invoice so the two stay linked and stock is not counted twice.",
      },
      {
        title: "Follow up",
        body: "Check the pending order reports for overdue deliveries and GRNs still waiting for a bill.",
      },
    ],
    details: [
      {
        heading: "Which document moves stock",
        points: [
          "Sales orders and purchase orders never move stock.",
          "A delivery challan takes stock out; a goods receipt note brings it in.",
          "An invoice made from a challan or GRN does not move stock again, because the goods already moved.",
          "A challan or GRN that has been billed cannot be deleted while its invoice stands.",
        ],
      },
      {
        heading: "How pending is worked out",
        points: [
          "Pending is ordered minus delivered, received or billed, line by line, in base units.",
          "Only documents made with Convert count, so a separately typed invoice does not reduce what is pending.",
          "If a document made from an order is deleted, its quantity goes back to pending.",
          "Open any order to see its fulfilment table and every document made from it, each with a link back to the source.",
        ],
      },
      {
        heading: "Pending reports",
        points: [
          "Pending Sales Orders and Pending Purchase Orders show what is still to be delivered or received.",
          "Pending GRNs and Pending Delivery Challans show goods that have moved but are not billed yet.",
          "Filter by party, or show only orders past their delivery-by date.",
          "Each report shows the pending value before tax and exports to CSV.",
        ],
      },
    ],
    faqs: [
      {
        q: "Does a sales order reduce my stock?",
        a: "No. Stock goes out when you create the delivery challan, or the invoice if you bill the order directly.",
      },
      {
        q: "Can I deliver an order in several lots?",
        a: "Yes. Convert it as many times as needed, lowering Take now each time. The order shows as partly delivered until everything has gone.",
      },
      {
        q: "I typed a new invoice instead of converting the challan. What now?",
        a: "The goods were taken out of stock twice and the challan still shows as not billed. Delete the separate invoice and convert the challan instead.",
      },
      {
        q: "What is the difference between short-close and deleting?",
        a: "Short-close keeps everything already delivered or received and simply stops expecting the rest. Deleting is for drafts you no longer need.",
      },
    ],
    related: ["delivery-challans", "invoicing", "warehouses", "inventory-reports"],
    helpPath: "/help/inventory/orders-and-grn",
  },

  // ── Manufacturing ──────────────────────────────────────────
  {
    slug: "manufacturing",
    title: "Bill of materials and production",
    navLabel: "Manufacturing",
    tagline:
      "Recipes for what you make, production entries that move the stock for you, and a real cost for every unit.",
    summary:
      "Bills of materials with wastage and by-products, production entries that use up raw material and add finished goods, and costing with labour and job work.",
    icon: Factory01Icon,
    highlights: [
      {
        title: "Bills of materials",
        body: "List the components and quantities that go into each item you make. An item can have several BOMs, with one as the default.",
        icon: CookBookIcon,
      },
      {
        title: "Wastage built in",
        body: "Add a wastage percentage to any component. Ten kilos with 5% wastage is taken out of stock as 10.5 kg.",
        icon: PercentIcon,
      },
      {
        title: "By-products and scrap",
        body: "Record what a run gives off besides the main item. By-products are added to stock at zero cost.",
        icon: Recycle01Icon,
      },
      {
        title: "Shortages before you post",
        body: "The components are scaled to the quantity you are making, with the stock at the source warehouse shown on every line.",
        icon: Alert02Icon,
      },
      {
        title: "A real cost per unit",
        body: "Components at their current stock value, plus labour, power or job-work costs, divided by the quantity made.",
        icon: Calculator01Icon,
      },
      {
        title: "Cancel cleanly",
        body: "Cancelling a production entry puts the components back and takes the goods made out again. The number is kept.",
        icon: ArrowTurnBackwardIcon,
      },
    ],
    steps: [
      {
        title: "Build a BOM",
        body: "Pick the item made and the output quantity the recipe is for, such as 10 kg, then add its components, wastage and any by-products.",
      },
      {
        title: "Plan the run",
        body: "Choose the item, the BOM, the quantity to make and the date, and where components come from and finished goods go.",
      },
      {
        title: "Record what was really used",
        body: "Components are filled in from the BOM. Change them to what you actually used and add labour or other costs.",
      },
      {
        title: "Post the journal",
        body: "Components go out, finished goods and by-products come in, and the entry is numbered MJ-1, MJ-2 and so on.",
      },
    ],
    details: [
      {
        heading: "Bill of materials rules",
        points: [
          "Up to 200 components and 50 by-products in a BOM.",
          "An item cannot be made from itself, directly or through another BOM.",
          "Services cannot be components, and items with variants need a specific variant.",
          "Untick Active to stop using a recipe without deleting it. Deleting a BOM never changes production already recorded.",
        ],
      },
      {
        heading: "What posting does",
        points: [
          "Components leave the take-from warehouse, which can be the same as the put-in warehouse.",
          "The finished item arrives at (component cost + additional costs) ÷ quantity made.",
          "If a component is short, you see a note. Under the Block setting, posting is refused with a list of what is short.",
          "No BOM yet? Choose to enter the components by hand for a one-off run.",
        ],
      },
      {
        heading: "Costing and your accounts",
        points: [
          "Components are costed at their current stock value, on average cost or FIFO, whichever your business uses.",
          "Finished goods enter stock valuation at the journal's total cost, so closing stock includes the labour and overheads you added.",
          "Production entries move quantities only. Record actual wage and power bills as expenses as usual.",
          "Owners, admins and sales managers can post journals; sales managers also need Adjust & count rights on the warehouses used.",
        ],
      },
    ],
    faqs: [
      {
        q: "Can I make something without setting up a BOM?",
        a: "Yes. Choose to enter the components yourself. By-products can only be added when you use a BOM.",
      },
      {
        q: "The BOM says 10 kg of sugar but we used 11 kg. What do I do?",
        a: "Change the quantity under components used before posting. The BOM is the starting point; the journal records what was actually used.",
      },
      {
        q: "Can one item have more than one BOM?",
        a: "Yes, for example a regular and a premium recipe. One is the default, and you can pick another on each production entry.",
      },
      {
        q: "Can I add job-work or labour charges?",
        a: "Yes. Add up to 20 additional costs, each with a label and an amount. They are included in the cost of the goods made.",
      },
      {
        q: "Can I cancel a production entry?",
        a: "Yes. Cancelling reverses its stock movements. Under the Block setting it cannot be cancelled once the goods made have already been sold or used.",
      },
    ],
    related: ["inventory", "warehouses", "stock-valuation", "orders-goods-receipts"],
    helpPath: "/help/inventory/manufacturing",
  },

  // ── Inventory reports ──────────────────────────────────────
  {
    slug: "inventory-reports",
    title: "Inventory reports",
    navLabel: "Inventory reports",
    tagline:
      "Know what to buy, what is not selling, where your stock is and what it is worth, in a few clicks.",
    summary:
      "Stock summary, stock ledger, godown summary, ageing, reorder and dead stock reports, stock groups, price list and pending orders, all exportable to CSV.",
    icon: ChartIncreaseIcon,
    highlights: [
      {
        title: "Stock Summary",
        body: "Every product's stock, cost value and sale value, with low stock flagged and variants you can expand.",
        icon: PackageIcon,
      },
      {
        title: "Stock Ledger",
        body: "Every movement of an item with a running balance, showing the invoice, challan, transfer or count behind each one.",
        icon: ListViewIcon,
      },
      {
        title: "Godown Summary",
        body: "How much stock each warehouse holds today and what it is worth.",
        icon: WarehouseIcon,
      },
      {
        title: "Reorder Status",
        body: "Items at or below their reorder level, with a suggested quantity to buy for the next 15 to 90 days.",
        icon: ShoppingCart01Icon,
      },
      {
        title: "Stock Ageing and Dead Stock",
        body: "See how long stock has been sitting and which items have not gone out in 30 days to a year.",
        icon: HourglassIcon,
      },
      {
        title: "Stock Group Summary",
        body: "Quantity and value for each stock group on any date, with drill-down to sub-groups and items.",
        icon: FolderTreeIcon,
      },
    ],
    steps: [
      {
        title: "Open Reports",
        body: "Inventory reports sit in the Inventory and Orders groups on the Reports page.",
      },
      {
        title: "Set the date or filters",
        body: "Pick a date range for the ledger and movement reports, and filter by warehouse, stock group, category or party where it applies.",
      },
      {
        title: "Drill in",
        body: "Expand an item to its variants, click a group to see what is inside, or open one item's ledger.",
      },
      {
        title: "Export",
        body: "Every report has an Export CSV button for your spreadsheet or your accountant.",
      },
    ],
    details: [
      {
        heading: "Where your stock stands",
        points: [
          "Stock Summary: total cost value, total sale value, number of SKUs and low-stock count, with a stock group filter.",
          "Godown Summary: items, quantity and value held in each warehouse.",
          "Stock Group Summary: quantity and value by group as on any date, with a row for items not in a group.",
          "Values follow your valuation method, so totals tie back to your profit & loss and balance sheet.",
        ],
      },
      {
        heading: "How it moved",
        points: [
          "Stock Ledger: opening, inward, outward and closing for one item, and what caused each movement, for all warehouses or one.",
          "Movement Summary: opening, inward, outward, closing and value for every item over the date range.",
        ],
      },
      {
        heading: "What to do next",
        points: [
          "Reorder Status suggests an order from the shortfall to the reorder level plus that many days of sales at the last 30 days' pace.",
          "Stock Ageing splits stock into 0 to 30, 31 to 60, 61 to 90, 91 to 180 and over 180 days.",
          "Dead Stock lists items not sold in 30, 60, 90, 180 or 365 days, with their value, highest first.",
          "Pending Sales Orders, Pending Purchase Orders, Pending GRNs and Pending Delivery Challans show what is still to ship, receive or bill.",
          "Price List shows every item's sale price, MRP and price on each level for any date.",
        ],
      },
    ],
    faqs: [
      {
        q: "Why doesn't changing the date range change the Stock Summary?",
        a: "Stock Summary, Godown Summary, Stock Ageing, Reorder Status, Dead Stock and the pending order reports always show today's position. For stock on a past date, use Stock Group Summary or Movement Summary.",
      },
      {
        q: "Why is an item missing from Reorder Status?",
        a: "Only items with a low-stock alert set, and at or below it, appear there. Set an alert level on the items you reorder.",
      },
      {
        q: "Do the stock values match my profit & loss?",
        a: "Yes. The stock reports use the same valuation method as the profit & loss and balance sheet, so totals for the same date tie up.",
      },
      {
        q: "How do I get a year-end stock statement?",
        a: "Run Stock Group Summary with the date range ending on 31 March. It gives closing quantity and value by group, matching the closing stock in your accounts.",
      },
    ],
    related: ["inventory", "stock-valuation", "reporting", "orders-goods-receipts"],
    helpPath: "/help/inventory/reports",
  },
];
