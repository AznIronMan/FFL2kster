/** Legend III ship's console items chosen (znIRF: item I, row R, flags F; tools/ffl3/traces.py):
 *  see fuzzlib.ts. */
import { inputSweep } from "./fuzzlib.js";

inputSweep("n", "console items", "[0-3][0-2][0-2]");
