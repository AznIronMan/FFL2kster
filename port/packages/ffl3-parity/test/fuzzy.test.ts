/** Legend III save starts (zyTKNN: field states made from players' battery saves, local only;
 *  tools/ffl3/traces.py save_sweep): see fuzzlib.ts. */
import { inputSweep } from "./fuzzlib.js";

inputSweep("y", "save starts", "[a-z][blf][0-9]{2}");
