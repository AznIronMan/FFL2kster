/** The game switch every summary shows: one button per other Legend — play it when its data is on
 *  this device, else import its ROM. main.ts sets the provider (it knows which packages are
 *  stored); the Legend I and III summaries only ask for it. */
export interface GameLink { label: string; run: () => void }

let provider: (current: 1 | 2 | 3) => GameLink[] = () => [];

export function setGameLinks(f: (current: 1 | 2 | 3) => GameLink[]): void { provider = f; }

/** The buttons for the games other than `current`, in order I, II, III. */
export function gameLinks(current: 1 | 2 | 3): GameLink[] { return provider(current); }
