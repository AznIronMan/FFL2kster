/** Legend III event sweep (zeTTP: map event type TT, parameter P): see fuzzlib.ts. */
import { inputSweep } from "./fuzzlib.js";

inputSweep("e", "map events", "[0-9a-j]{3}");
