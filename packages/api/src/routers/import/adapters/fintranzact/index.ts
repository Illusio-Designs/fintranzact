import { registerAdapter } from "../registry.js";
import {
  transformParty,
  transformItem,
  transformInvoice,
  transformPayment,
  transformTransfer,
} from "./transforms.js";

registerAdapter("fintranzact", {
  transformParty,
  transformItem,
  transformInvoice,
  transformPayment,
  transformTransfer,
});
