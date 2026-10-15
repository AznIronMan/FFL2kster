/** Legend III enemy abilities (zxKK: formation KK, the HP of every entity 9999 at frame 600): see
 *  tools/ffl3/traces.py ENEMY_ABILITIES and fuzzlib.ts. */
import { inputSweep } from "./fuzzlib.js";

inputSweep("x", "enemy abilities", "[0-9a-f]{2}");
