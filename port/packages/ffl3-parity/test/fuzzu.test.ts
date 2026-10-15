/** Legend III field uses (zuII: a bag of item II; zvNN: one spell known): see fuzzlib.ts. */
import { inputSweep } from "./fuzzlib.js";

inputSweep("u", "field items", "[0-9a-f]{2}");
inputSweep("v", "field spells");
