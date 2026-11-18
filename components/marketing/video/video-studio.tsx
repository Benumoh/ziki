"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { marketingPath, type ProjectRef } from "@/lib/project-paths";
import { AspectRatioPicker } from "./aspect-ratio-picker";
import { CreateFrom } from "./create-from";
import { LengthSlider } from "./length-slider";
import { PromptEditor } from "./prompt-editor";
import { StartOptions } from "./start-options";
import { VideoLibrary } from "./video-library";
import { VideoPreview } from "./video-preview";
import {
  FILE_LIMITS, IDEAS_LOADING_MS, INITIAL_STUDIO_STATE, MAX_PROMPT_LENGTH,
  STUDIO_TABS, canAddFile, countFiles, fileKind, placeholderCreditCosts, urlKind,
  type CreateSource, type QuickChange, type RenderTarget, type StartMode,
  type StudioAsset, type StudioState, type StudioTab, type VideoIdea, type VideoTemplate,
} from "./model";
import { styles } from "./styles";
import "./video-studio.css";

/** The complete prototype is local to this component: no uploads or generation requests. */
export function VideoStudio({ slug, projectName }: { slug: ProjectRef; projectName: string }) {
  const [state, setState] = useState<StudioState>(INITIAL_STUDIO_STATE);
  const id = useId();
  const prompt = useRef<HTMLTextAreaElement>(null);
  const resources = useRef({
    urls: new Set<string>(),
    ideas: null as ReturnType<typeof setTimeout> | null,
    playback: null as ReturnType<typeof setInterval> | null,
    render: null as ReturnType<typeof setInterval> | null,
  });
  const notify = useToast();
  const files = state.source === "media" ? state.mediaFiles : state.source === "image" && state.imageFile ? [state.imageFile] : [];

  useEffect(() => {
    const owned = resources.current;
    return () => {
      for (const url of owned.urls) URL.revokeObjectURL(url);
      if (owned.ideas) clearTimeout(owned.ideas);
      if (owned.playback) clearInterval(owned.playback);
      if (owned.render) clearInterval(owned.render);
    };
  }, []);

  function release(file: StudioAsset) {
    if (file.previewUrl) {
      URL.revokeObjectURL(file.previewUrl);
      resources.current.urls.delete(file.previewUrl);
    }
  }

  function stopPlayback() {
    if (resources.current.playback) clearInterval(resources.current.playback);
    resources.current.playback = null;
  }

  function edit(patch: Partial<StudioState>) {
    if (state.stage === "making") return;
    stopPlayback();
    setState((previous) => ({
      ...previous, ...patch,
      stage: previous.stage === "final" ? "draft" : previous.stage,
      dirty: previous.dirty || previous.stage === "draft" || previous.stage === "final",
      scene: 0, playing: false,
    }));
  }

  function selectTab(tab: StudioTab, focus = false) {
    stopPlayback();
    setState((previous) => ({ ...previous, tab, playing: false }));
    if (focus) document.getElementById(`${id}-tab-${tab}`)?.focus();
  }

  function navigateTabs(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number;
    if (event.key === "ArrowRight") next = (index + 1) % STUDIO_TABS.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + STUDIO_TABS.length) % STUDIO_TABS.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = STUDIO_TABS.length - 1;
    else return;
    event.preventDefault();
    selectTab(STUDIO_TABS[next].value, true);
  }

  function chooseMode(mode: Exclude<StartMode, null>) {
    if (state.stage === "making") return;
    if (resources.current.ideas) clearTimeout(resources.current.ideas);
    setState((previous) => ({ ...previous, mode, ideasLoading: mode === "ideas", selectedIdea: mode === "ideas" ? null : previous.selectedIdea }));
    if (mode === "ideas") {
      resources.current.ideas = setTimeout(() => {
        setState((previous) => ({ ...previous, ideasLoading: false }));
        resources.current.ideas = null;
      }, IDEAS_LOADING_MS);
    } else prompt.current?.focus();
  }

  function chooseIdea(idea: VideoIdea) {
    edit({ selectedIdea: idea.id, title: idea.title, prompt: idea.scenes.join("\n"), aspectRatio: idea.aspectRatio, seconds: idea.seconds });
  }

  function chooseTemplate(template: VideoTemplate) {
    if (state.stage === "making") return;
    if (resources.current.ideas) clearTimeout(resources.current.ideas);
    stopPlayback();
    setState((previous) => ({
      ...previous, tab: "create", title: template.title,
      prompt: template.scenes.join("\n").replaceAll("the brand logo", `the ${projectName} logo`),
      aspectRatio: template.aspectRatio, seconds: template.seconds,
      mode: null, ideasLoading: false, selectedIdea: null,
      stage: "ready", renderTarget: null, dirty: false, quickChanges: [], scene: 0, playing: false,
    }));
    document.getElementById(`${id}-tab-create`)?.focus();
  }

  function commitFiles(additions: StudioAsset[]) {
    if (!additions.length) return;
    if (state.source === "image") {
      if (state.imageFile) release(state.imageFile);
      edit({ imageFile: additions[0] });
    } else edit({ mediaFiles: [...state.mediaFiles, ...additions] });
  }

  function addFiles(candidates: File[]) {
    if (state.stage === "making") return;
    const additions: StudioAsset[] = [];
    const counts = countFiles(files);
    let warning = "";
    for (const file of candidates) {
      const kind = fileKind(file);
      if (!kind || (state.source === "image" && kind !== "photo")) {
        warning = state.source === "image" ? "Choose an image for the first frame" : "Choose a photo, clip or audio file";
        continue;
      }
      if (state.source === "image" && additions.length) break;
      if (state.source === "media" && counts[kind] >= FILE_LIMITS[kind]) {
        warning = "You reached the limit for that file type";
        continue;
      }
      counts[kind]++;
      const previewUrl = kind === "photo" ? URL.createObjectURL(file) : undefined;
      if (previewUrl) resources.current.urls.add(previewUrl);
      additions.push({ id: crypto.randomUUID(), name: file.name, kind, file, previewUrl, origin: "file" });
    }
    commitFiles(additions);
    if (warning) notify(warning, "error");
  }

  function appendMedia(file: StudioAsset): boolean {
    if (state.stage === "making") return false;
    if (!canAddFile(state.mediaFiles, file.kind)) {
      notify("You reached the limit for that file type", "error");
      return false;
    }
    edit({ mediaFiles: [...state.mediaFiles, file] });
    return true;
  }

  function addAsset() {
    if (appendMedia({ id: crypto.randomUUID(), name: `${projectName} logo`, kind: "photo", origin: "asset" })) notify("Added from your assets", "info");
  }

  function addUrl() {
    let url: URL;
    try {
      url = new URL(state.url.trim());
      if (!["https:", "http:"].includes(url.protocol)) throw new Error("Unsupported URL");
    } catch {
      notify("Paste a full link that starts with https", "error");
      return;
    }
    if (appendMedia({ id: crypto.randomUUID(), name: url.href, kind: urlKind(url), origin: "url", sourceUrl: url.href })) {
      setState((previous) => ({ ...previous, urlOpen: false, url: "" }));
    }
  }

  function removeFile(fileId: string) {
    if (state.stage === "making") return;
    const index = files.findIndex((file) => file.id === fileId);
    if (index < 0) return;
    release(files[index]);
    // Keep the references in existing scenes attached to the same remaining files.
    const updatedPrompt = state.prompt.replace(/@(\d+)\b/g, (match, number: string) => {
      const reference = Number(number);
      return reference === index + 1 ? "" : reference > index + 1 && reference <= files.length ? `@${reference - 1}` : match;
    });
    edit({ ...(state.source === "image" ? { imageFile: null } : { mediaFiles: state.mediaFiles.filter((file) => file.id !== fileId) }), prompt: updatedPrompt });
  }

  function insertReference(reference: string) {
    const field = prompt.current;
    const start = field?.selectionStart ?? state.prompt.length;
    const end = field?.selectionEnd ?? start;
    const value = `${state.prompt.slice(0, start)}${reference} ${state.prompt.slice(end)}`;
    if (value.length > MAX_PROMPT_LENGTH) { notify("The prompt is limited to 10,000 characters", "error"); return; }
    edit({ prompt: value });
    requestAnimationFrame(() => { field?.focus(); field?.setSelectionRange(start + reference.length + 1, start + reference.length + 1); });
  }

  function improvePrompt() {
    const lines = state.prompt.split("\n").map((line) => line.trim()).filter(Boolean);
    if (!lines.length) { notify("Write a short idea first", "info"); return; }
    if (lines.length > 1) { notify("Your prompt already has scenes", "info"); return; }
    const value = `${lines[0]}\nShow the best part up close, in warm light\nEnd on the ${projectName} logo`;
    if (value.length > MAX_PROMPT_LENGTH) { notify("The prompt is limited to 10,000 characters", "error"); return; }
    edit({ prompt: value });
  }

  function play() {
    stopPlayback();
    if (state.playing) { setState((previous) => ({ ...previous, playing: false })); return; }
    const count = state.prompt.split("\n").filter((line) => line.trim()).length;
    if (!count) { notify("Write a scene first", "info"); return; }
    let scene = 0;
    setState((previous) => ({ ...previous, scene: 0, playing: true }));
    resources.current.playback = setInterval(() => {
      scene++;
      if (scene >= count) {
        stopPlayback();
        setState((previous) => ({ ...previous, playing: false }));
      } else {
        const nextScene = scene;
        setState((previous) => ({ ...previous, scene: nextScene }));
      }
    }, 1_600);
  }

  function make(target: RenderTarget) {
    if (state.stage === "making" || resources.current.render || !state.prompt.trim()) return;
    const cost = placeholderCreditCosts(state.seconds)[target];
    if (state.credits < cost) { notify("Not enough credits for this video", "error"); return; }
    stopPlayback();
    const result = { id: crypto.randomUUID(), title: state.title || state.prompt.trim().split("\n")[0] || "My video", prompt: state.prompt, seconds: state.seconds, aspectRatio: state.aspectRatio };
    let ticks = 0;
    setState((previous) => ({ ...previous, stage: "making", renderTarget: target, progress: 0, playing: false }));
    resources.current.render = setInterval(() => {
      ticks++;
      const progress = Math.min(100, Math.round((ticks / 30) * 100));
      if (progress < 100) { setState((previous) => ({ ...previous, progress })); return; }
      if (resources.current.render) clearInterval(resources.current.render);
      resources.current.render = null;
      setState((previous) => ({
        ...previous, stage: target, renderTarget: null, progress: 100,
        credits: previous.credits - cost, dirty: false, quickChanges: [], scene: 0,
        videos: target === "final" ? [result, ...previous.videos] : previous.videos,
      }));
      notify(target === "final" ? "Your video is ready" : "Your draft is ready", "info");
      requestAnimationFrame(() => document.getElementById(`${id}-preview`)?.focus());
    }, 100);
  }

  function quickChange(change: QuickChange) {
    edit({ quickChanges: state.quickChanges.includes(change) ? state.quickChanges.filter((value) => value !== change) : [...state.quickChanges, change] });
  }

  function again() {
    stopPlayback();
    setState((previous) => ({ ...previous, mode: null, selectedIdea: null, title: "", prompt: "", stage: "ready", dirty: false, quickChanges: [], scene: 0, playing: false }));
    requestAnimationFrame(() => prompt.current?.focus());
  }

  return (
    <section className={styles.studio} aria-label="Video studio">
      <div className={styles.topBar}>
        <Link className={styles.link} href={marketingPath(slug)}>← Back to Marketing</Link>
        <Badge className={styles.tag}><span aria-live="polite" aria-atomic="true">{state.credits} credits</span></Badge>
      </div>
      <div className={styles.tabs} role="tablist" aria-label="Video studio">
        {STUDIO_TABS.map((tab, index) => (
          <button key={tab.value} type="button" role="tab" id={`${id}-tab-${tab.value}`} aria-controls={`${id}-panel-${tab.value}`} aria-selected={state.tab === tab.value} tabIndex={state.tab === tab.value ? 0 : -1} onClick={() => selectTab(tab.value)} onKeyDown={(event) => navigateTabs(event, index)}>{tab.label}</button>
        ))}
      </div>
      {STUDIO_TABS.map((tab) => (
        <div key={tab.value} role="tabpanel" id={`${id}-panel-${tab.value}`} aria-labelledby={`${id}-tab-${tab.value}`} hidden={state.tab !== tab.value} tabIndex={0}>
          {state.tab === tab.value && (tab.value === "create" ? (
            <>
              <h1>Make a video for {projectName}</h1>
              <p className={styles.subtitle}>Work in any order. The preview on the right follows everything you change.</p>
              <div className={styles.workspace}>
                <fieldset className={styles.leftColumn} disabled={state.stage === "making"} aria-label="Video settings">
                  <CreateFrom source={state.source} files={files} urlOpen={state.urlOpen} url={state.url} videoUse={state.videoUse} onSource={(source: CreateSource) => edit({ source })} onFiles={addFiles} onRemove={removeFile} onAsset={addAsset} onToggleUrl={() => setState((previous) => ({ ...previous, urlOpen: !previous.urlOpen }))} onUrl={(url) => setState((previous) => ({ ...previous, url }))} onAddUrl={addUrl} onVideoUse={(videoUse) => edit({ videoUse })} />
                  <StartOptions mode={state.mode} loading={state.ideasLoading} selectedIdea={state.selectedIdea} onMode={chooseMode} onIdea={chooseIdea} />
                  <section className={styles.card} aria-label="Prompt and video format">
                    <PromptEditor value={state.prompt} references={files.slice(0, 6).map((_, index) => `@${index + 1}`)} inputRef={prompt} onChange={(value) => edit({ prompt: value.slice(0, MAX_PROMPT_LENGTH) })} onInsert={insertReference} onImprove={improvePrompt} onInspiration={() => selectTab("inspiration", true)} />
                    <AspectRatioPicker value={state.aspectRatio} onChange={(aspectRatio) => edit({ aspectRatio })} />
                    <LengthSlider seconds={state.seconds} onChange={(seconds) => edit({ seconds })} />
                  </section>
                </fieldset>
                <aside className={styles.rightColumn}>
                  <VideoPreview previewId={`${id}-preview`} state={state} projectName={projectName} onMake={make} onScene={(scene) => { stopPlayback(); setState((previous) => ({ ...previous, scene, playing: false })); }} onPlay={play} onQuickChange={quickChange} onDownload={(format) => notify(`${format} download is simulated`, "info")} onShare={() => notify("Sharing is simulated", "info")} onAgain={again} />
                </aside>
              </div>
            </>
          ) : <VideoLibrary tab={tab.value} projectName={projectName} videos={state.videos} disabled={state.stage === "making"} onTemplate={chooseTemplate} />)}
        </div>
      ))}
    </section>
  );
}
