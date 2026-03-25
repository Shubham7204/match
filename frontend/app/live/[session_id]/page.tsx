"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { useParams } from "next/navigation"
import Link from "next/link"
import { SiteNav } from "@/components/site-nav"
import { SiteFooter } from "@/components/footer"
import {
  Play, Loader2, AlertCircle, ArrowLeft,
  Clock, Download, Radio, Activity, Zap, CheckCircle,
  Target, TriangleAlert, Crosshair, Flag, Wind, Film
} from "lucide-react"

const LIVE_API = "http://localhost:8500"

interface LiveEvent {
  event_type: string
  timestamp: number
  time_formatted: string
  confidence: number
  clip_url: string
  audio_verified: boolean
  window_index: number
  clip_name?: string
}

interface Session {
  session_id: string
  title: string
  hls_url: string
  status: string
  analysis_window_sec: number
  segments_downloaded: number
  windows_analyzed: number
  events: LiveEvent[]
  main_highlights: string | null
  created_at: string
}

const EVENT_ICON_MAP: Record<string, React.ReactNode> = {
  goal:     <Target className="w-4 h-4" />,
  foul:     <TriangleAlert className="w-4 h-4" />,
  penalty:  <Crosshair className="w-4 h-4" />,
  corner:   <Flag className="w-4 h-4" />,
  freekick: <Wind className="w-4 h-4" />,
}
const EVENT_COLORS: Record<string, string> = {
  goal:     "bg-green-500/10 text-green-400 border-green-500/20",
  foul:     "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  penalty:  "bg-red-500/10 text-red-400 border-red-500/20",
  corner:   "bg-blue-500/10 text-blue-400 border-blue-500/20",
  freekick: "bg-purple-500/10 text-purple-400 border-purple-500/20",
}

// Ensure clip URLs always point to port 8500
const fixUrl = (url: string) =>
  url.startsWith("http") ? url : `${LIVE_API}${url}`

export default function LiveSessionPage() {
  const params    = useParams()
  const sessionId = params.session_id as string

  const [session, setSession]     = useState<Session | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError]         = useState<string | null>(null)
  const [playingUrl, setPlayingUrl]   = useState<string | null>(null)
  const [liveEvents, setLiveEvents]   = useState<LiveEvent[]>([])
  const [wsStatus, setWsStatus]       = useState<"connecting" | "open" | "closed">("closed")

  const wsRef = useRef<WebSocket | null>(null)

  // ── Fetch session ──────────────────────────────────────────────────────
  const fetchSession = useCallback(async () => {
    try {
      const res  = await fetch(`${LIVE_API}/api/live/${sessionId}`)
      const data = await res.json()
      if (data.success) {
        setSession(data.session)
        // Fix relative clip_url from MongoDB -> absolute URL
        const fixedEvents = (data.session.events ?? []).map((ev: LiveEvent) => ({
          ...ev,
          clip_url: fixUrl(ev.clip_url),
        }))
        setLiveEvents(fixedEvents)
        // Auto-play highlights if completed
        if (data.session.main_highlights && !playingUrl) {
          setPlayingUrl(`${LIVE_API}/api/live/${sessionId}/highlights`)
        }
      } else {
        setError(data.detail || "Session not found")
      }
    } catch {
      setError("Failed to connect to server")
    } finally {
      setIsLoading(false)
    }
  }, [sessionId, playingUrl])

  // ── WebSocket for "live" sessions ──────────────────────────────────────
  useEffect(() => {
    fetchSession()
  }, [sessionId])

  useEffect(() => {
    if (!session) return
    if (session.status !== "live") return

    const ws = new WebSocket(`ws://localhost:8500/ws/live/${sessionId}`)
    setWsStatus("connecting")
    wsRef.current = ws

    ws.onopen = () => setWsStatus("open")
    ws.onclose = () => setWsStatus("closed")

    ws.onmessage = (e) => {
      let msg: any
      try { msg = JSON.parse(e.data) } catch { return }

      if (msg.type === "clip_ready") {
        const ev: LiveEvent = {
          event_type: msg.event,
          timestamp: msg.timestamp,
          time_formatted: msg.time_formatted,
          confidence: msg.confidence,
          clip_url: fixUrl(msg.clip_url),   // always absolute
          audio_verified: msg.audio_verified,
          window_index: msg.window,
        }
        setLiveEvents(prev => [...prev, ev])
      }

      if (msg.type === "final_ready") {
        fetchSession()
      }
    }

    return () => ws.close()
  }, [session?.status, sessionId])

  useEffect(() => () => { wsRef.current?.close() }, [])

  // ── Render ──────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <main className="min-h-screen bg-background">
        <SiteNav />
        <div className="flex flex-col items-center justify-center py-28">
          <Loader2 className="w-10 h-10 animate-spin text-primary mb-4" />
          <p className="text-muted-foreground">Loading session…</p>
        </div>
        <SiteFooter />
      </main>
    )
  }

  if (error || !session) {
    return (
      <main className="min-h-screen bg-background">
        <SiteNav />
        <div className="mx-auto max-w-2xl px-4 py-20 text-center">
          <AlertCircle className="w-12 h-12 text-destructive mx-auto mb-4" />
          <p className="text-destructive font-semibold mb-2">Session not found</p>
          <p className="text-sm text-muted-foreground mb-6">{error}</p>
          <Link href="/live" className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:opacity-90">
            Back to Live
          </Link>
        </div>
        <SiteFooter />
      </main>
    )
  }

  const isLive      = session.status === "live"
  const isDone      = session.status === "completed" || session.status === "stopped"
  const eventCounts = liveEvents.reduce<Record<string, number>>((acc, ev) => {
    acc[ev.event_type] = (acc[ev.event_type] ?? 0) + 1
    return acc
  }, {})

  return (
    <main className="min-h-screen bg-background text-foreground">
      <SiteNav />

      {/* ── Header ── */}
      <section className="border-b border-border/60 bg-gradient-to-b from-secondary/5 to-background">
        <div className="mx-auto max-w-7xl px-4 py-6 md:px-6 md:py-8">
          <Link
            href="/live"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-4 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" /> Back to Live
          </Link>

          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <div className="flex items-center gap-3 mb-1">
                {isLive && (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border bg-red-500/10 text-red-400 border-red-500/20 animate-pulse">
                    <Radio className="w-3 h-3" /> LIVE
                  </span>
                )}
                {isDone && (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border bg-green-500/10 text-green-400 border-green-500/20">
                    <CheckCircle className="w-3 h-3" /> {session.status.toUpperCase()}
                  </span>
                )}
                <h1 className="text-2xl md:text-3xl font-bold">{session.title}</h1>
              </div>
              <p className="text-sm text-muted-foreground font-mono truncate max-w-xl">{session.hls_url}</p>
            </div>

            {session.main_highlights && (
              <a
                href={`${LIVE_API}/api/live/${sessionId}/highlights`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2 bg-green-500/10 text-green-400 border border-green-500/20 rounded-lg font-medium hover:bg-green-500/20 transition-all text-sm"
              >
                <Download className="w-4 h-4" /> Final Highlights
              </a>
            )}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-6 md:px-6 md:py-10">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* LEFT: Stats + event type breakdown */}
          <div className="space-y-4">
            {/* Session Info */}
            <div className="bg-card border border-border/60 rounded-xl p-5 space-y-3">
              <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Session Info</h2>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: "Segments", value: session.segments_downloaded },
                  { label: "Windows", value: session.windows_analyzed },
                  { label: "Clips", value: liveEvents.length },
                ].map(s => (
                  <div key={s.label} className="text-center p-3 bg-secondary/30 rounded-lg">
                    <div className="text-xl font-bold">{s.value}</div>
                    <div className="text-xs text-muted-foreground">{s.label}</div>
                  </div>
                ))}
              </div>
              <div className="text-xs text-muted-foreground space-y-1 pt-1 border-t border-border/40">
                <div className="flex justify-between">
                  <span>Window size</span>
                  <span className="font-medium text-foreground">{session.analysis_window_sec}s</span>
                </div>
                <div className="flex justify-between">
                  <span>Created</span>
                  <span className="font-medium text-foreground">{new Date(session.created_at).toLocaleString()}</span>
                </div>
              </div>
            </div>

            {/* Event type breakdown */}
            {Object.keys(eventCounts).length > 0 && (
              <div className="bg-card border border-border/60 rounded-xl p-5 space-y-3">
                <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Event Breakdown</h2>
                <div className="space-y-2">
                  {Object.entries(eventCounts).map(([type, count]) => (
                    <div key={type} className="flex items-center gap-3">
                      <span className={`inline-flex items-center justify-center w-8 h-8 rounded-lg border flex-shrink-0 ${EVENT_COLORS[type] ?? "bg-secondary/50 border-border/40"}`}>
                        {EVENT_ICON_MAP[type] ?? <Film className="w-4 h-4" />}
                      </span>
                      <span className="flex-1 text-sm capitalize">{type}</span>
                      <div className="flex-1 h-2 bg-secondary/30 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary/70 rounded-full"
                          style={{ width: `${(count / liveEvents.length) * 100}%` }}
                        />
                      </div>
                      <span className="text-sm font-bold w-6 text-right">{count}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* WebSocket status indicator (when live) */}
            {isLive && (
              <div className={`flex items-center gap-2 px-4 py-3 rounded-lg border text-sm ${
                wsStatus === "open"
                  ? "bg-green-500/5 border-green-500/20 text-green-400"
                  : "bg-secondary/20 border-border/40 text-muted-foreground"
              }`}>
                <Activity className="w-4 h-4" />
                {wsStatus === "open" ? "Receiving live updates" : "Connecting to stream…"}
              </div>
            )}
          </div>

          {/* CENTER: Video Player */}
          <div className="space-y-4">
            <div className="bg-card border border-border/60 rounded-xl overflow-hidden">
              {playingUrl ? (
                <video
                  key={playingUrl}
                  src={playingUrl}
                  controls
                  autoPlay
                  className="w-full aspect-video bg-black"
                />
              ) : (
                <div className="aspect-video bg-secondary/20 flex flex-col items-center justify-center gap-3">
                  {isLive ? (
                    <>
                      <div className="relative">
                        <div className="w-14 h-14 rounded-full border-4 border-primary/30 border-t-primary animate-spin" />
                        <Zap className="absolute inset-0 m-auto w-5 h-5 text-primary" />
                      </div>
                      <p className="text-sm text-muted-foreground">Live analysis in progress…</p>
                    </>
                  ) : (
                    <>
                      <Play className="w-10 h-10 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">Select a clip to play</p>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Now playing label */}
            {playingUrl && (
              <div className="px-3 py-2 bg-secondary/30 rounded-lg text-xs text-muted-foreground truncate">
                ▶ {playingUrl.split("/").pop()}
              </div>
            )}

            {/* Final highlights prominent card */}
            {session.main_highlights && (
              <div
                onClick={() => setPlayingUrl(`${LIVE_API}/api/live/${sessionId}/highlights`)}
                className="bg-gradient-to-r from-primary/10 to-primary/5 border border-primary/20 rounded-xl p-4 cursor-pointer hover:from-primary/15 transition-all"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
                    <Play className="w-5 h-5 text-primary ml-0.5" fill="currentColor" />
                  </div>
                  <div>
                    <div className="font-semibold text-sm">Main Highlights Reel</div>
                    <div className="text-xs text-muted-foreground">
                      {liveEvents.length} events compiled
                    </div>
                  </div>
                  <Download
                    className="w-4 h-4 text-muted-foreground ml-auto"
                    onClick={e => {
                      e.stopPropagation()
                      window.open(`${LIVE_API}/api/live/${sessionId}/highlights`, "_blank")
                    }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* RIGHT: Clips list */}
          <div>
            <div className="bg-card border border-border/60 rounded-xl p-4">
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <Zap className="w-4 h-4 text-primary" />
                Highlight Clips
                {liveEvents.length > 0 && (
                  <span className="ml-auto inline-flex px-2 py-0.5 rounded-full text-xs font-semibold bg-primary/10 text-primary">
                    {liveEvents.length}
                  </span>
                )}
              </h3>

              {liveEvents.length === 0 ? (
                <div className="py-12 text-center">
                  <Clock className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">
                    {isLive ? "Clips will appear as the stream is analysed" : "No clips generated"}
                  </p>
                </div>
              ) : (
                <div className="space-y-2 max-h-[500px] overflow-y-auto">
                  {[...liveEvents].reverse().map((ev, i) => (
                    <div
                      key={i}
                      className={`group flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                        playingUrl === ev.clip_url
                          ? "bg-primary/10 border-primary/30"
                          : "bg-secondary/20 border-transparent hover:border-border/60 hover:bg-secondary/40"
                      }`}
                      onClick={() => setPlayingUrl(ev.clip_url)}
                    >
                      <div className={`w-9 h-9 rounded-lg border flex items-center justify-center flex-shrink-0 ${EVENT_COLORS[ev.event_type] ?? "bg-secondary/50 border-border/40"}`}>
                        {EVENT_ICON_MAP[ev.event_type] ?? <Film className="w-4 h-4" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-sm capitalize">{ev.event_type}</div>
                        <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                          <Clock className="w-3 h-3" />
                          {ev.time_formatted}
                          <span>·</span>
                          {(ev.confidence * 100).toFixed(0)}%
                          {ev.audio_verified && <span className="text-green-400 font-medium">· audio</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={e => { e.stopPropagation(); window.open(ev.clip_url, "_blank") }}
                          className="p-1.5 hover:bg-primary/10 rounded transition-colors"
                          title="Download"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </button>
                        <Play className="w-4 h-4 text-primary" />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
      <SiteFooter />
    </main>
  )
}
