/** Legend III battle commands (zcNN: Start turns a member's command page: Defend, Cover) and lost
 *  battles (zlNN: the "continue" question): see fuzzlib.ts. */
import { inputSweep } from "./fuzzlib.js";

inputSweep("c", "battle commands");
inputSweep("l", "lost battles");
