# Frontend Code Report

This document summarizes the contents of the `frontend` folder: purpose of each file, exported components/functions, key props and behaviors, and any notable backend or runtime interactions. Use this as a foundation for your report or to produce higher-level documentation.

---

**Project Overview:**
- Framework: Next.js (App Router) with TypeScript and Tailwind CSS.
- UI primitives: Radix + shadcn-based `ui` components plus custom components in `components/`.
- Runtime: client components ("use client") for interactive parts like chat, upload and match management.
- Backend endpoints used (from frontend code):
  - `http://localhost:9000/api/matches` (list, upload, details, analyze, delete)
  - `http://localhost:8000/analyze` (chat analysis / AI endpoint)
  - Media URLs served under `/api/media/<match_id>/...`

---

## Top-level config and metadata

- `tsconfig.json`
  - TypeScript config for project. Enables `jsx: preserve`, `esnext` modules and path alias `@/*`.

- `next.config.mjs`
  - Next.js config: disables image optimization (`images.unoptimized = true`), and ignores TypeScript/ESLint build errors.

- `package.json`
  - Lists dependencies (Next 15, React 19, tailwind, Radix, lucide, LLaVA tooling referenced in comments). Use `npm run dev` / `next dev`.

- `components.json`
  - shadcn UI scaffolding metadata and aliases mapping (e.g., `ui` → `@/components/ui`). Helpful for UI generator tooling.

- `postcss.config.mjs` and `pnpm-lock.yaml`
  - PostCSS + Tailwind plugin setup; lockfile present (do not edit).

---

## Global styles

- `styles/globals.css` and `app/globals.css`
  - Tailwind entrypoints and theme variables. Defines CSS custom properties (light/dark) and utility layers.
  - Adds theme tokens (colors, radius, chart colors) used across components.

---

## App-level pages and layout (App Router)

- `app/layout.tsx`
  - Root layout for the Next.js App Router.
  - Exports `RootLayout` default which wraps children with fonts (Google `Poppins`, `GeistMono`) and `Analytics`.
  - Sets `metadata` (title, description).

- `app/page.tsx`
  - Homepage composition: imports and places `SiteNav`, `HeroSection`, `ProblemSection`, `SolutionSection`, `FeaturesSection`, `TechnologySection`, `BenefitsSection`, `AboutSection`, `FinalCTASection`, and `SiteFooter`.

- `app/chat/page.tsx`
  - Chat UI page (client component). Main responsibilities:
    - Maintains `messages`, `input`, `selectedVideo` and `selectedFrame` state.
    - Calls backend `POST http://localhost:8000/analyze` to send a user query and receive `AnalysisResult`.
    - Renders messages and uses `AnalysisDisplay` to show analysis results (frames/clips).
    - Uses `Dialog` primitives for video/frame preview (components in `components/ui`).

- `app/upload/page.tsx`
  - Upload page (client component) for uploading match videos and an optional poster.
  - Handles file selection, previews, `FormData` submission to `http://localhost:9000/api/matches/upload`.
  - Shows upload progress UI and `ConfirmDialog` for status messages.

- `app/matches/page.tsx`
  - Matches listing page. Fetches `http://localhost:9000/api/matches` and shows grid of match cards.
  - Supports filtering by status (`all`, `uploaded`, `processing`, `completed`, `failed`).
  - Uses `SiteNav` and `SiteFooter`.

- `app/matches/[match_id]/page.tsx`
  - Match details page (client component).
  - Fetches `http://localhost:9000/api/matches/<match_id>` for match data.
  - Connects to WebSocket `ws://localhost:9000/ws/progress/<matchId>` for realtime analysis progress.
  - Exposes actions: analyze/re-analyze (POST to `/analyze`), delete (DELETE to match endpoint), play/download clips.
  - Renders event stats, event clips, timeline, and video player.

---

## Main components (`components/`)

Note: many components are client components and use Tailwind classes and `ui` primitives.

- `components/site-nav.tsx`
  - `SiteNav` header component with navigation links to Home, Chat, Matches, Upload.
  - Small, stateless, renders logo and nav items.

- `components/footer.tsx`
  - `SiteFooter` component with site info, quick links and legal links.

- `components/hero-section.tsx` and `components/hero-placeholder.tsx`
  - Hero UI for landing page: large headline, call to action buttons (`/chat`, `/upload`).
  - `HeroPlaceholder` contains a hero image background.

- `components/content-card.tsx`
  - `ContentCard({title, meta})` presents a thumbnail and short metadata.

- `components/content-grid.tsx` and `components/section-row.tsx`
  - `ContentGrid` composes multiple `SectionRow`s which use `ContentCard` elements. Useful for event/replay grids.

- `components/filter-pills.tsx`
  - `FilterPills` small pill-list using `Button` variants to display filters like Live/Upcoming/Highlights.

- `components/feature-carousel.tsx`
  - `FeatureCarousel` implements a simple auto-scrolling carousel of features, manual prev/next controls, and indicators.

- `components/features-section.tsx`, `technology-section.tsx`, `tech-stack.tsx`, `benefits-section.tsx`, `how-it-works.tsx`, `solution-section.tsx`, `about-section.tsx`, `final-cta-section.tsx`, `problem-section.tsx`
  - Informational sections used on the homepage. Mostly static content with icons.

- `components/confirm-dialog.tsx`
  - `ConfirmDialog` client component. Props:
    - `isOpen`, `onClose`, optional `onConfirm`, `title`, `message`, `type`, `confirmText`, `cancelText`.
  - Renders a full-screen modal overlay with icon and buttons. Supports `confirm` mode with separate confirm/cancel buttons.

---

## Analysis & Chat UI internals

- `app/chat/components/AnalysisDisplay.tsx`
  - Complex presentational component that renders `AnalysisResult` structures returned by analysis backend.
  - Handles three modes:
    - `all_commentary` — shows a list/grid of events with frames, clip links and collapsible detail panels.
    - Single event (answer/commentary) — shows `FormattedText`, key frame, clip preview and `EventDetails` with frames/commentary.
  - Local helpers:
    - `FormattedText` — basic markdown-ish parsing for headers and numbered sections.
  - Interactions:
    - `onVideoClick(url)` to open a clip in a `Dialog` (handled by parent chat page)
    - `onFrameClick(frame)` to open frame detail (parent handles frame dialog)

---

## UI Primitives (`components/ui/*`)

These are shadcn-style small building blocks exported for consistency.

- `components/ui/button.tsx`
  - Exports `Button` and `buttonVariants` using `class-variance-authority` (CVA).
  - Props: `variant`, `size`, `asChild`.

- `components/ui/card.tsx`
  - Card primitives: `Card`, `CardHeader`, `CardTitle`, `CardContent`, `CardFooter`, etc.

- `components/ui/dialog.tsx`
  - Wrappers around `@radix-ui/react-dialog` components with sensible default classes.
  - Exports `Dialog`, `DialogTrigger`, `DialogContent`, `DialogHeader`, `DialogFooter`, `DialogTitle`, `DialogDescription`.

- `components/ui/input.tsx`
  - `Input` wrapper with `cn` utility for merging classes.

- `components/ui/collapsible.tsx`
  - Small wrapper around Radix Collapsible primitives.

These primitives are used across many pages for consistent styling and accessibility.

---

## Theme and utilities

- `components/theme-provider.tsx`
  - Lightweight wrapper around `next-themes` `ThemeProvider`.

- `lib/utils.ts`
  - Exports `cn(...inputs)` helper that merges CSS classes using `clsx` + `tailwind-merge`.

---

## Notable behaviors and backend coupling

- Upload flow (`/upload`): uses `fetch('http://localhost:9000/api/matches/upload', { method: 'POST', body: FormData })`.
- Matches list and detail pages use `http://localhost:9000/api/matches` endpoints and expect responses with keys like `success`, `matches`, `match`, `analysis_data`, and `event_clips`.
- Chat uses `http://localhost:8000/analyze` and expects `AnalysisResult` JSON with shape documented in `app/chat/page.tsx` and `AnalysisDisplay.tsx`.
- Match detail page connects to `ws://localhost:9000/ws/progress/<matchId>` for realtime progress updates during analysis.

---

## Non-code and static assets

- `public/` (images & placeholders)
  - Contains site logo, hero images and placeholders used by components. Not code, but referenced by many components via `/images/...` or `/placeholder.svg`.

- `pnpm-lock.yaml` and large lockfiles: do not include in the report beyond noting they exist.

---

## Quick notes and recommended next steps

- All client-facing pages assume local backend addresses (`localhost:8000` and `localhost:9000`). Document these in your report and confirm actual deployed endpoints.
- If you want a richer per-function report, I can extend this file to include:
  - Full prop types and default values for each component
  - Example usage snippets for complex components (`AnalysisDisplay`, `MatchDetailsPage`)
  - API contract typings (expected request/response shapes)

If you'd like, I can split this into per-directory markdown files (e.g., `components/README.md`, `app/README.md`) or generate a higher-level PDF-ready report. Which would you prefer?

---

## Detailed Per-File Reference (expanded)

Below are file-by-file details for the `frontend` folder. For each file I include:
- Purpose: short description
- Exports: exported components/functions/values
- Key props / types: shape of important props and state
- Notable internal helpers: short notes about helper functions or logic
- Backend interactions: network or WebSocket endpoints used
- Example usage: short snippet or description of how component is used

Note: Only source files are expanded (TSX/TS/MJS/CSS/JSON where relevant). Static assets omitted.

---

### app/layout.tsx
- Purpose: Root React layout for the App Router. Provides fonts, analytics and wraps pages in HTML/body.
- Exports: default `RootLayout`, and `metadata` object.
- Key props: accepts `children: React.ReactNode` from Next App Router.
- Notable internals: Uses `Poppins` Google font and `GeistMono`; wraps children in `Suspense` and includes `Analytics` from Vercel.
- Backend interactions: None.
- Example usage: Managed by Next as the root layout; no manual imports required.

### app/page.tsx
- Purpose: Homepage composition; composes multiple presentational sections.
- Exports: default `Page` component.
- Exports used: `SiteNav`, `HeroSection`, `ProblemSection`, `SolutionSection`, `FeaturesSection`, `TechnologySection`, `BenefitsSection`, `AboutSection`, `FinalCTASection`, `SiteFooter`.
- Props: none.
- Notable internals: purely presentational; arranges hero and informational sections.

### app/chat/page.tsx
- Purpose: Interactive chat page that sends natural-language queries to the analysis backend and displays results.
- Exports: default `ChatPage` component.
- Key types and state:
  - Msg: { id, role: 'user'|'assistant', text, data?: AnalysisResult }
  - AnalysisResult: complex shape documented in file (query, response, clip_url, key_frame, context_frames, all_events, etc.)
  - State: `messages: Msg[]`, `input: string`, `isLoading: boolean`, `selectedVideo: string|null`, `selectedFrame: Frame|null`.
- Notable helpers:
  - `fixImageUrl(url)` prefixes `/` image paths with `http://localhost:8000`.
  - `cleanFrameDescription(description)` extracts the response content from model formatting (e.g., after `[/INST]` markers).
  - `fixAllUrls(data)` walks the AnalysisResult and replaces image/clip URLs + cleans descriptions.
- Backend interactions:
  - POST `http://localhost:8000/analyze` with JSON body containing the user's query (string). Expects `AnalysisResult` JSON.
- Example usage: used as route `/chat`; `AnalysisDisplay` is used to render analysis results and expects `onVideoClick` and `onFrameClick` callbacks.

### app/upload/page.tsx
- Purpose: Form UI for uploading match videos and optional poster images.
- Exports: default `UploadPage` component.
- Key state/props:
  - `videoFile`, `posterFile`, `videoUrl`, `posterUrl` (local preview object URLs)
  - `isUploading`, `uploadProgress` for UI feedback
  - `dialog` object for ConfirmDialog message state
- Notable internals:
  - `handleVideoChange` and `handlePosterChange` set files + preview URLs.
  - `handleSubmit` builds `FormData`, appends `video` and `poster`, POSTs to backend upload endpoint, shows dialog on success/failure.
- Backend interactions:
  - POST `http://localhost:9000/api/matches/upload` with form data: expects JSON { success: boolean, ... }.
- Example usage:
  - Fill match title/date, choose video file and optional poster, click Upload Match to send to backend.

### app/matches/page.tsx
- Purpose: List all uploaded matches, with status filters and links to individual match pages.
- Exports: default `MatchesPage`.
- Key types:
  - `Match` shape: id, match_id, title, date, description, poster_path, status, created_at.
- Notable internals:
  - `fetchMatches()` loads matches from the API and handles error/loading states.
  - `getPosterUrl(match)` resolves poster path to `http://localhost:9000/api/media/...` or fallback placeholder.
- Backend interactions:
  - GET `http://localhost:9000/api/matches` (optional `?status=` filter)
- Example usage: navigate to `/matches` to view grid; each card links to `/matches/<match_id>`.

### app/matches/[match_id]/page.tsx
- Purpose: Match details & management (play highlights, analyze, re-analyze, delete, download clips).
- Exports: default `MatchDetailsPage`.
- Key types/props:
  - `Match`: includes `video_path`, `poster_path`, `status`, `main_highlights`, `event_clips`, `analysis_data`, etc.
  - `ProgressUpdate`: { status, progress, message, timestamp }
- Notable internals and helpers:
  - `fetchMatchDetails()` GETs the match, sets `currentVideoUrl` if `main_highlights` exists.
  - `connectWebSocket()` opens `ws://localhost:9000/ws/progress/<matchId>` to receive `ProgressUpdate` messages and updates UI progress bar.
  - `handleAnalyze()` POSTs to `.../analyze` and uses websocket for realtime progress.
  - `handleDelete()` shows `ConfirmDialog` and sends DELETE request to the match endpoint.
  - `playClip(clipPath)` and `downloadClip(clipPath)` construct media URLs under `http://localhost:9000/api/media/<matchId>/...`.
- Backend interactions:
  - GET `http://localhost:9000/api/matches/<matchId>`
  - POST `http://localhost:9000/api/matches/<matchId>/analyze`
  - DELETE `http://localhost:9000/api/matches/<matchId>`
  - WebSocket `ws://localhost:9000/ws/progress/<matchId>`
- Example usage: admin or uploader visits a match page, clicks "Analyze Match" to begin processing and watches the progress bar.

### components/site-nav.tsx
- Purpose: Top navigation bar used across pages.
- Exports: `SiteNav` component.
- Props: none.
- Notable internals: static `navItems` array with labels and hrefs.
- Example usage: imported in `app/layout` or pages as `<SiteNav />`.

### components/footer.tsx
- Purpose: Site footer with quick links and legal placeholders.
- Exports: `SiteFooter`.
- Props: none.

### components/hero-section.tsx
- Purpose: Prominent landing hero with CTAs to `/chat` and `/upload`.
- Exports: default `HeroSection`.
- Props: none; static content.

### components/hero-placeholder.tsx
- Purpose: Alternate hero used in some contexts; heavy visual background.
- Exports: `HeroPlaceholder`.

### components/content-card.tsx
- Purpose: Small card used to represent a video or item in grids.
- Exports: `ContentCard({ title, meta })`.
- Props:
  - `title: string` (required)
  - `meta?: string` (optional tag shown on thumbnail)
- Example usage: `<ContentCard title="Match Title" meta="Replay" />`.

### components/section-row.tsx
- Purpose: Section wrapper to render a titled horizontally scrollable row of `ContentCard` items.
- Exports: `SectionRow({ id?, title, items })`.
- Props:
  - `id?: string` (optional anchor)
  - `title: string`
  - `items: { id: number, title: string, meta?: string }[]`
- Example usage: used by `ContentGrid`.

### components/content-grid.tsx
- Purpose: Composes several `SectionRow`s for "    ,", "     	  : " (placeholder) content.
- Exports: `ContentGrid`.

### components/filter-pills.tsx
- Purpose: Small pill-based filter UI using `Button` component.
- Exports: `FilterPills`.

### components/feature-carousel.tsx
- Purpose: Auto-scrolling feature carousel with controls and indicators.
- Exports: `FeatureCarousel`.
- Key state: `current: number`, `autoScroll: boolean`.
- Notable internals: `useEffect` sets interval when `autoScroll` true; `next` and `prev` functions update `current` and disable autoScroll.

### components/features-section.tsx
- Purpose: Informational features list with icons.
- Exports: default `FeaturesSection`.

### components/benefits-section.tsx
- Purpose: Describes beneficiaries of the platform.
- Exports: default `BenefitsSection`.

### components/about-section.tsx
- Purpose: Static about section describing the product mission.
- Exports: default `AboutSection`.

### components/problem-section.tsx
- Purpose: Explains the problem statement (time/cost of highlight creation).
- Exports: default `ProblemSection`.

### components/solution-section.tsx
- Purpose: Outlines solution approach at a high level.
- Exports: default `SolutionSection`.

### components/technology-section.tsx
- Purpose: Technical stack overview and capabilities.
- Exports: default `TechnologySection`.

### components/tech-stack.tsx
- Purpose: Grid of technologies used by the platform.
- Exports: `TechStack`.

### components/final-cta-section.tsx
- Purpose: Final call-to-action area used on landing page.
- Exports: default `FinalCTASection`.

### components/confirm-dialog.tsx
- Purpose: Reusable confirmation and info dialog UI.
- Exports: `ConfirmDialog`.
- Props:
  - `isOpen: boolean`
  - `onClose: () => void`
  - `onConfirm?: () => void`
  - `title: string`, `message: string`
  - `type?: 'success'|'error'|'warning'|'info'|'confirm'`
  - `confirmText?: string`, `cancelText?: string`
- Behavior: For `type === 'confirm'` and `onConfirm` provided, renders Cancel + Confirm buttons; otherwise single primary button.

### app/chat/components/AnalysisDisplay.tsx
- Purpose: Visual renderer for `AnalysisResult` returned by the AI backend. One of the most complex frontend components.
- Exports: default `AnalysisDisplay` plus helper components `EventDetails` and `FormattedText`.
- Key props:
  - `data: AnalysisResult` (see shape below)
  - `onVideoClick: (url: string) => void`
  - `onFrameClick: (frame: Frame) => void`
- AnalysisResult shape (important fields):
  - `query: string`
  - `query_type: 'answer'|'commentary'|'all_commentary'`
  - `event_type: string`
  - `response: string` (formatted text)
  - `clip_url?: string`, `key_frame?: string`
  - `context_frames?: Frame[]` (Frame: file:string, global_timestamp:string, rag_description:string, active_events:string[], ...)
  - `all_events?: EventDetail[]` (EventDetail includes frame_count, commentary_count, context_frames, context_commentary, clip_url, is_replay)
  - `total?: number` (for all_commentary)
- Notable internals:
  - Renders a grid of event cards when `query_type === 'all_commentary'` with collapsible details.
  - `FormattedText` does simple parsing of lines to create headings, numbered sections, and bold text by converting to HTML via `dangerouslySetInnerHTML` (sanitization note: not sanitized; input is backend-generated — consider sanitizing if backend is untrusted).
  - `EventDetails` component shows per-event metadata, commentary and frame thumbnails; clicking a frame calls `onFrameClick`.
- Backend interactions: none directly; expects parent to handle `onVideoClick` and open dialogs. Expects cleaned URLs from parent.
- Example usage (parent):
  - <AnalysisDisplay data={analysisData} onVideoClick={(u)=>setSelectedVideo(u)} onFrameClick={(f)=>setSelectedFrame(f)} />

### components/ui/button.tsx
- Purpose: Reusable Button primitive with CVA variants.
- Exports: `Button`, `buttonVariants`.
- Props: standard button props + `variant?: 'default'|'destructive'|'outline'|'secondary'|'ghost'|'link'`, `size?: 'default'|'sm'|'lg'|'icon'|'icon-sm'|'icon-lg'`, `asChild?: boolean`.

### components/ui/card.tsx
- Purpose: Card primitives used across the UI.
- Exports: `Card`, `CardHeader`, `CardFooter`, `CardTitle`, `CardAction`, `CardDescription`, `CardContent`.

### components/ui/dialog.tsx
- Purpose: Dialog primitive wrappers around Radix Dialog with default styling and accessible structure.
- Exports: `Dialog`, `DialogClose`, `DialogContent`, `DialogDescription`, `DialogFooter`, `DialogHeader`, `DialogOverlay`, `DialogPortal`, `DialogTitle`, `DialogTrigger`.

### components/ui/input.tsx
- Purpose: Styled input wrapper that uses `cn()` helper for class merges.
- Exports: `Input`.
- Props: same as native `<input>`.

### components/ui/collapsible.tsx
- Purpose: Small wrapper around Radix collapsible components to maintain consistent styling.
- Exports: `Collapsible`, `CollapsibleTrigger`, `CollapsibleContent`.

### components/ui/card.tsx (already described)

### components/ui/button.tsx (already described)

### components/theme-provider.tsx
- Purpose: Thin wrapper around `next-themes` `ThemeProvider` for app-level theming.
- Exports: `ThemeProvider`.

### lib/utils.ts
- Purpose: Utility to merge CSS class names using `clsx` + `tailwind-merge`.
- Exports: `cn(...inputs: ClassValue[])`.
- Example usage: `className={cn('p-4', condition && 'bg-red-500')}`.

### next.config.mjs
- Purpose: Next.js configuration; disables Next image optimization and ignores build-time lint/type errors.

### package.json
- Purpose: Lists project dependencies (Next 15, React 19, Radix, lucide, tailwind, etc.) and scripts: `dev`, `build`, `start`, `lint`.

### postcss.config.mjs
- Purpose: PostCSS config referencing `@tailwindcss/postcss` plugin.

### styles/globals.css and app/globals.css
- Purpose: Tailwind CSS entrypoints and theme variables. Defines color tokens used site-wide and a couple of key utility rules (e.g., `.animate-shimmer`).

---

## Security & Sanitation Notes

- `AnalysisDisplay` uses `dangerouslySetInnerHTML` to render processed text in `FormattedText`; the backend is currently trusted in this app, but if you accept user-provided or external content, sanitize HTML or replace `dangerouslySetInnerHTML` with a safer renderer.
- Several components construct backend URLs directly; ensure production endpoints are correctly configured (environment variables) rather than hard-coded `localhost`.

---

## Suggested next steps

- Convert hard-coded backend hostnames to a single env-driven configuration (e.g., `NEXT_PUBLIC_API_BASE_URL`).
- Optionally split this large report into per-folder README files: `app/README.md`, `components/README.md`, `components/ui/README.md`.
- If you want full prop tables and example usage for each exported component, I can generate them next; I recommend starting with the highest-complexity components: `AnalysisDisplay`, `MatchDetailsPage`, `ChatPage`, and `UploadPage`.

I updated the todo list and expanded this report. Tell me if you'd like me to:
- Generate per-folder README files splitting the content above.
- Produce prop tables and usage snippets for specific components (I recommend `AnalysisDisplay` and `MatchDetailsPage` first).
- Replace `localhost` endpoints with environment variables in the code (I can prepare a patch for that).

