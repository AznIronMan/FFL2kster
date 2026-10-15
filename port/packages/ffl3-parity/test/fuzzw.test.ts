/** Legend III members' weapons (zwNN: weapon effects; tools/ffl3/traces.py MEMBER_WEAPONS): see fuzzlib.ts. */
import { inputSweep } from "./fuzzlib.js";

inputSweep("w", "member weapons", "[0-9a-f]{2}");
