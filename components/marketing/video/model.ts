export const STUDIO_TABS = [
  { value: "create", label: "Create" },
  { value: "templates", label: "Templates" },
  { value: "inspiration", label: "Inspiration" },
  { value: "videos", label: "My videos" },
] as const;

export const ASPECT_RATIOS = [
  { value: "16:9", label: "Wide", width: 16, height: 9 },
  { value: "9:16", label: "Vertical", width: 9, height: 16 },
  { value: "1:1", label: "Square", width: 1, height: 1 },
  { value: "4:3", label: "Classic", width: 4, height: 3 },
  { value: "3:4", label: "Portrait", width: 3, height: 4 },
  { value: "21:9", label: "Cinema", width: 21, height: 9 },
] as const;

export type StudioTab = (typeof STUDIO_TABS)[number]["value"];
export type AspectRatio = (typeof ASPECT_RATIOS)[number]["value"];

/** Fit every ratio into the same bounding square without stretching it. */
export function ratioShape(value: AspectRatio, size = 340) {
  const ratio = ASPECT_RATIOS.find((option) => option.value === value)!;
  const scale = size / Math.max(ratio.width, ratio.height);
  return { width: Math.round(ratio.width * scale), height: Math.round(ratio.height * scale) };
}
export type CreateSource = "media" | "image" | "text";
export type StartMode = "own" | "ideas" | null;
export type MediaKind = "photo" | "clip" | "audio";
export type VideoUse = "Reference" | "Extend" | "Edit";
export type StudioStage = "ready" | "making" | "draft" | "final";
export type RenderTarget = "draft" | "final";
export type QuickChange = "Shorter" | "Brighter" | "New opening" | "Different music";
export const QUICK_CHANGES: readonly QuickChange[] = ["Shorter", "Brighter", "New opening", "Different music"];

export const FILE_LIMITS = { photo: 30, clip: 10, audio: 10 } as const;
export const MIN_LENGTH = 4;
export const MAX_LENGTH = 30;
export const DEFAULT_LENGTH = 15;
export const MAX_PROMPT_LENGTH = 10_000;
export const IDEAS_LOADING_MS = 1_400;

export type StudioAsset = {
  id: string;
  name: string;
  kind: MediaKind;
  origin: "file" | "asset" | "url";
  file?: File;
  /** Only local blob URLs are rendered; pasted links are stored without fetching. */
  previewUrl?: string;
  sourceUrl?: string;
};

export type VideoIdea = {
  id: string;
  title: string;
  description: string;
  aspectRatio: AspectRatio;
  seconds: number;
  scenes: readonly string[];
};

/** Browser-only sample content from the prototype; no website is requested. */
export const MOCK_IDEAS: readonly VideoIdea[] = [
  {
    id: "morning-rush",
    title: "Morning rush, made calm",
    description: "A busy morning turns quiet when the first cup is poured.",
    aspectRatio: "9:16",
    seconds: 15,
    scenes: [
      "A queue of tired commuters outside the shop at 7am",
      "Close-up pour into a warm cup, steam rising",
      "First sip, a smile, the Brightbean logo",
    ],
  },
  {
    id: "bean-to-cup",
    title: "From bean to cup",
    description: "Follow one coffee bean from the roaster to your hands.",
    aspectRatio: "1:1",
    seconds: 20,
    scenes: [
      "Green beans tumble into the roaster",
      "Dark beans grind, water pours slowly",
      "A hand lifts the cup, end on the logo",
    ],
  },
  {
    id: "meet-the-roaster",
    title: "Meet the roaster",
    description: "A warm story from the person who picks every blend.",
    aspectRatio: "16:9",
    seconds: 30,
    scenes: [
      "The roaster opens the shop before sunrise",
      "She tastes three blends and picks one",
      "Customers enjoy it, end on “Fresh every morning”",
    ],
  },
];

export const MOCK_WEBSITE = "brightbean.coffee";

export type VideoTemplate = {
  id: string;
  title: string;
  category: string;
  aspectRatio: AspectRatio;
  seconds: number;
  scenes: readonly string[];
};

export const MOCK_TEMPLATES: readonly VideoTemplate[] = [
  { id: "product", title: "Product in 15 seconds", category: "Product demo", aspectRatio: "9:16", seconds: 15, scenes: ["Opening shot of the product", "Show what makes it special", "End on the brand logo"] },
  { id: "before-after", title: "Before and after", category: "Ads", aspectRatio: "1:1", seconds: 15, scenes: ["Show the everyday problem", "Introduce the product and its best feature", "Reveal the difference, end on the brand logo"] },
  { id: "customer", title: "Customer story", category: "Social", aspectRatio: "16:9", seconds: 15, scenes: ["Meet a customer in their own space", "They show how they use the product", "A happy moment, end on the brand logo"] },
  { id: "how-it-works", title: "How it works", category: "Explainer", aspectRatio: "16:9", seconds: 15, scenes: ["Introduce the product", "Show the three simple steps", "The finished result, end on the brand logo"] },
  { id: "offer", title: "Limited offer", category: "Ads", aspectRatio: "9:16", seconds: 15, scenes: ["Reveal the special offer", "Show the product up close", "Invite people to try it, end on the brand logo"] },
  { id: "behind-scenes", title: "Behind the scenes", category: "Social", aspectRatio: "9:16", seconds: 15, scenes: ["Open the doors before the day begins", "Meet the people who make the product", "A proud team moment, end on the brand logo"] },
];

export type FinishedVideo = {
  id: string;
  title: string;
  prompt: string;
  aspectRatio: AspectRatio;
  seconds: number;
};

// TODO: Replace the sample balance and costs with authoritative pricing when
// generation is connected. These numbers must never charge or spend credits.
export const PLACEHOLDER_CREDITS = 240;
export function placeholderCreditCosts(seconds: number) {
  const length = Math.min(MAX_LENGTH, Math.max(MIN_LENGTH, seconds));
  return { draft: Math.max(2, Math.round(length / 2)), final: Math.round((length * 8) / 3) };
}

export type StudioState = {
  tab: StudioTab;
  source: CreateSource;
  /** Keep Media and the single first frame separately when switching source. */
  mediaFiles: StudioAsset[];
  imageFile: StudioAsset | null;
  urlOpen: boolean;
  url: string;
  mode: StartMode;
  ideasLoading: boolean;
  selectedIdea: string | null;
  prompt: string;
  aspectRatio: AspectRatio;
  seconds: number;
  videoUse: VideoUse;
  title: string;
  stage: StudioStage;
  renderTarget: RenderTarget | null;
  progress: number;
  dirty: boolean;
  quickChanges: QuickChange[];
  scene: number;
  playing: boolean;
  credits: number;
  videos: FinishedVideo[];
};

export const INITIAL_STUDIO_STATE: StudioState = {
  tab: "create",
  source: "text",
  mediaFiles: [],
  imageFile: null,
  urlOpen: false,
  url: "",
  mode: null,
  ideasLoading: false,
  selectedIdea: null,
  prompt: "",
  aspectRatio: "9:16",
  seconds: DEFAULT_LENGTH,
  videoUse: "Reference",
  title: "",
  stage: "ready",
  renderTarget: null,
  progress: 0,
  dirty: false,
  quickChanges: [],
  scene: 0,
  playing: false,
  credits: PLACEHOLDER_CREDITS,
  videos: [],
};

export function countFiles(files: readonly StudioAsset[]): Record<MediaKind, number> {
  const counts = { photo: 0, clip: 0, audio: 0 };
  for (const file of files) counts[file.kind]++;
  return counts;
}

/** Enforced for local files, the sample asset and pasted URLs alike. */
export function canAddFile(files: readonly StudioAsset[], kind: MediaKind): boolean {
  return countFiles(files)[kind] < FILE_LIMITS[kind];
}

export function fileKind(file: File): MediaKind | null {
  if (file.type.startsWith("image/")) return "photo";
  if (file.type.startsWith("video/")) return "clip";
  if (file.type.startsWith("audio/")) return "audio";
  return null;
}

/** Classify a pasted URL by its path, without reading it over the network. */
export function urlKind(url: URL): MediaKind {
  if (/\.(mp4|mov|webm|m4v|ogv)$/i.test(url.pathname)) return "clip";
  if (/\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(url.pathname)) return "audio";
  return "photo";
}
