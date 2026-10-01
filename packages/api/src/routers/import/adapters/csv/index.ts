// Tally and Generic CSV sources. The import wizard maps their columns to the
// canonical field names in the browser (Settings → Data → Import), so the
// rows arrive in the same shape as myBillBook's and take the same tolerant
// transforms (units like "Pieces" / "NOS", amounts like "₹ 1,250.50", dates
// in Indian or ISO form). Without these registered, every Tally or Generic
// CSV import was refused with "Unknown import source".
import { registerAdapter } from "../registry.js";
import {
  transformParty,
  transformItem,
  transformInvoice,
  transformPayment,
  transformTransfer,
} from "../mybillbook/transforms.js";

const csvAdapter = {
  transformParty,
  transformItem,
  transformInvoice,
  transformPayment,
  transformTransfer,
};

registerAdapter("generic", csvAdapter);
registerAdapter("tally", csvAdapter);
