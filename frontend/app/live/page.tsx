"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { SiteNav } from "@/components/site-nav"
import { SiteFooter } from "@/components/footer"
import {
  Play, Loader2, AlertCircle, CheckCircle, Radio,
  Square, ChevronRight, Zap, Clock, Activity,
  Target, TriangleAlert, Crosshair, Flag, Wind, Film,
  Download, Cpu, Scissors, Wifi, LogIn, StopCircle, Trash2
} from "lucide-react"

const LIVE_API = "http://localhost:8500"

// ── Types ───────────────────────────────────────────────────────────────────
interface LiveSession {
  session_id: string
  title: string
  hls_url: string
  status: "live" | "stopped" | "completed" | "failed"
  analysis_window_sec: number
  segments_downloaded: number
  windows_analyzed: number
  events: LiveEvent[]
  main_highlights: string | null
  created_at: string
}

interface LiveEvent {
  event_type: string
  timestamp: number
  time_formatted: string
  confidence: number
  clip_url: string
  audio_verified: boolean
  window_index: number
}

interface ActivityEntry {
  id: number
  type: string
  message: string
  time: string
}

// ── Helpers ──────────────────────────────────────────────────────────────────
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
const now = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })

function getActivityIcon(type: string) {
  switch (type) {
    case "segment": return <Download className="w-3.5 h-3.5 text-primary/60" />
    case "window":  return <Cpu className="w-3.5 h-3.5 text-primary/60" />
    case "clip":    return <Scissors className="w-3.5 h-3.5 text-primary" />
    case "done":    return <CheckCircle className="w-3.5 h-3.5 text-green-400" />
    case "final":   return <Flag className="w-3.5 h-3.5 text-primary" />
    case "error":   return <AlertCircle className="w-3.5 h-3.5 text-destructive" />
    case "ws":      return <Wifi className="w-3.5 h-3.5 text-muted-foreground" />
    case "start":   return <Play className="w-3.5 h-3.5 text-green-400" />
    case "stop":    return <StopCircle className="w-3.5 h-3.5 text-destructive" />
    default:        return <Radio className="w-3.5 h-3.5 text-muted-foreground" />
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PAGE
// ═══════════════════════════════════════════════════════════════════════════
export default function LivePage() {
  const router = useRouter()

  // Form state
  const [hlsUrl, setHlsUrl]               = useState("")
  const [title, setTitle]                  = useState("Live Match")
  const [windowSec, setWindowSec]          = useState(120)
  const [quality, setQuality]              = useState("720p")

  // Session state
  const [sessionId, setSessionId]          = useState<string | null>(null)
  const [sessionStatus, setSessionStatus]  = useState<LiveSession["status"] | null>(null)
  const [isStarting, setIsStarting]        = useState(false)
  const [isStopping, setIsStopping]        = useState(false)
  const [error, setError]                  = useState<string | null>(null)

  // Live data
  const [events, setEvents]                = useState<LiveEvent[]>([])
  const [activityLog, setActivityLog]      = useState<ActivityEntry[]>([])
  const [segmentCount, setSegmentCount]    = useState(0)
  const [bufferedDur, setBufferedDur]      = useState(0)
  const [windowsAnalyzed, setWindowsAnalyzed] = useState(0)
  const [highlightsUrl, setHighlightsUrl]  = useState<string | null>(null)
  const [playingUrl, setPlayingUrl]        = useState<string | null>(null)

  // Past sessions
  const [pastSessions, setPastSessions]    = useState<LiveSession[]>([])
  const [loadingSessions, setLoadingSessions] = useState(true)

  // Refs
  const wsRef        = useRef<WebSocket | null>(null)
  const logRef       = useRef<HTMLDivElement>(null)
  const activityIdRef= useRef(0)

  // ── Session list ────────────────────────────────────────────────────────
  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch(`${LIVE_API}/api/live`)
      if (res.ok) {
        const data = await res.json()
        setPastSessions(data.sessions || [])
      }
    } catch { /* ignore */ }
    finally { setLoadingSessions(false) }
  }, [])

  const deleteSession = async (e: React.MouseEvent, sid: string) => {
    e.preventDefault() // prevent navigating to session link
    e.stopPropagation()
    if (!confirm("Are you sure you want to delete this session?")) return

    try {
      await fetch(`${LIVE_API}/api/live/${sid}`, { method: "DELETE" })
      fetchSessions() // refresh the list
    } catch (err) {
      console.error(err)
    }
  }

  useEffect(() => {
    fetchSessions()
  }, [fetchSessions])


  // ── Scroll activity log ─────────────────────────────────────────────────
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [activityLog])

  // ── Add to activity log ─────────────────────────────────────────────────
  const addLog = useCallback((type: string, message: string) => {
    setActivityLog(prev => [
      ...prev.slice(-99),
      { id: activityIdRef.current++, type, message, time: now() }
    ])
  }, [])

  // ── WebSocket setup ─────────────────────────────────────────────────────
  const connectWs = useCallback((sid: string) => {
    if (wsRef.current) wsRef.current.close()

    const ws = new WebSocket(`ws://localhost:8500/ws/live/${sid}`)

    ws.onopen = () => addLog("ws", "WebSocket connected — awaiting events")

    ws.onmessage = (e) => {
      let msg: any
      try { msg = JSON.parse(e.data) } catch { return }

      switch (msg.type) {
        case "state":
          // Restore existing state on reconnect — prefix clip_url with LIVE_API
          if (msg.session?.events) {
            const fixedEvents = (msg.session.events as LiveEvent[]).map(ev => ({
              ...ev,
              clip_url: ev.clip_url.startsWith("http") ? ev.clip_url : `${LIVE_API}${ev.clip_url}`,
            }))
            setEvents(fixedEvents)
          }
          if (msg.session?.segments_downloaded) setSegmentCount(msg.session.segments_downloaded)
          if (msg.session?.windows_analyzed) setWindowsAnalyzed(msg.session.windows_analyzed)
          break

        case "segment":
          setSegmentCount(msg.count)
          setBufferedDur(msg.duration)
          addLog("segment", `Segment ${msg.count} received — buffered ${msg.duration}s`)
          break

        case "window_start":
          setWindowsAnalyzed(msg.window)
          addLog("window", `Analysing window ${msg.window} (${msg.duration_sec}s of footage)...`)
          break

        case "clip_ready": {
          const ev: LiveEvent = {
            event_type: msg.event,
            timestamp: msg.timestamp,
            time_formatted: msg.time_formatted,
            confidence: msg.confidence,
            clip_url: `${LIVE_API}${msg.clip_url}`,
            audio_verified: msg.audio_verified,
            window_index: msg.window,
          }
          setEvents(prev => [...prev, ev])
          addLog("clip", `Clip ready — ${msg.event.toUpperCase()} at ${msg.time_formatted}`)
          break
        }

        case "window_done":
          addLog("done", `Window ${msg.window} done — ${msg.events_found} event(s) found`)
          break

        case "final_ready":
          setSessionStatus(msg.status as any)
          if (msg.highlights_url) {
            setHighlightsUrl(`${LIVE_API}${msg.highlights_url}`)
          }
          addLog("final", `Stream ${msg.status}. Total events: ${msg.total_events}`)
          fetchSessions()
          break

        case "error":
          addLog("error", msg.message)
          break

        case "ping":
          break
      }
    }

    ws.onerror = () => addLog("error", "WebSocket connection error")
    ws.onclose = () => addLog("ws", "WebSocket disconnected")
    wsRef.current = ws
  }, [addLog, fetchSessions])

  useEffect(() => () => { wsRef.current?.close() }, [])

  // ── Start session ───────────────────────────────────────────────────────
  const handleStart = async () => {
    setIsStarting(true)
    setError(null)
    setEvents([])
    setActivityLog([])
    setSegmentCount(0)
    setBufferedDur(0)
    setWindowsAnalyzed(0)
    setHighlightsUrl(null)
    setPlayingUrl(null)

    const url = hlsUrl.trim()
    if (!url) {
      setError("Please enter a valid HLS URL (.m3u8)")
      setIsStarting(false)
      return
    }

    try {
      const res = await fetch(`${LIVE_API}/api/live/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url,
          title,
          analysis_window_sec: windowSec,
          quality_hint: quality,
        }),
      })
      const data = await res.json()
      if (!data.session_id) throw new Error(data.detail || "Failed to start session")
      setSessionId(data.session_id)
      setSessionStatus("live")
      addLog("start", `Session started: ${data.session_id}`)
      connectWs(data.session_id)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setIsStarting(false)
    }
  }

  // ── Stop session ─────────────────────────────────────────────────────────
  const handleStop = async () => {
    if (!sessionId) return
    setIsStopping(true)
    try {
      await fetch(`${LIVE_API}/api/live/${sessionId}/stop`, { method: "DELETE" })
      addLog("stop", "Stop signal sent")
    } catch { /* ignore */ }
    finally { setIsStopping(false) }
  }

  const isActive = sessionStatus === "live"
  const isDone   = sessionStatus === "completed" || sessionStatus === "stopped"

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <main className="min-h-screen bg-background text-foreground">
      <SiteNav />

      {/* ── Page Header ── */}
      <section className="border-b border-border/60 bg-gradient-to-b from-secondary/5 to-background">
        <div className="mx-auto max-w-7xl px-4 py-6 md:px-6 md:py-8">
          <div className="flex items-center gap-3 mb-1">
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${
              isActive
                ? "bg-red-500/10 text-red-400 border-red-500/20 animate-pulse"
                : "bg-secondary text-muted-foreground border-border/40"
            }`}>
              <Radio className="w-3 h-3" />
              {isActive ? "LIVE" : "OFFLINE"}
            </span>
            <h1 className="text-2xl font-bold">Live Highlight Generator</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Paste a live HLS stream URL — our AI will detect and clip highlights in real time.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-6 md:px-6 md:py-10 space-y-6">

        {/* ── Main Grid: Config + Player + Clips ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* LEFT: Config + Controls */}
          <div className="space-y-4">
            {/* Session Config Card */}
            <div className="bg-card border border-border/60 rounded-xl p-5 space-y-4">
              <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
                Stream Configuration
              </h2>

              {/* HLS URL */}
              <label className="block space-y-1.5">
                <span className="text-sm font-medium">Live HLS URL (.m3u8)</span>
                <input
                  value={hlsUrl}
                  onChange={e => setHlsUrl(e.target.value)}
                  placeholder="https://example.com/live/stream.m3u8"
                  disabled={isActive}
                  className="w-full rounded-lg border border-border/60 bg-card/40 px-3 py-2 text-sm transition-all focus:border-primary/50 focus:ring-1 focus:ring-primary/20 disabled:opacity-50"
                />
              </label>
              {/* Title */}
              <label className="block space-y-1.5">
                <span className="text-sm font-medium">Session Title</span>
                <input
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder="Live Match"
                  disabled={isActive}
                  className="w-full rounded-lg border border-border/60 bg-card/40 px-3 py-2 text-sm focus:border-primary/50 focus:ring-1 focus:ring-primary/20 disabled:opacity-50"
                />
              </label>

              {/* Analysis window */}
              <label className="block space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Analysis Window</span>
                  <span className="text-xs font-semibold text-primary">{windowSec}s</span>
                </div>
                <input
                  type="range" min={60} max={300} step={30}
                  value={windowSec}
                  onChange={e => setWindowSec(Number(e.target.value))}
                  disabled={isActive}
                  className="w-full accent-primary"
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>60s (faster)</span><span>300s (thorough)</span>
                </div>
              </label>

              {/* Quality hint */}
              <label className="block space-y-1.5">
                <span className="text-sm font-medium">Stream Input Quality</span>
                <span className="block text-xs text-muted-foreground -mt-1">Which rendition to download from the live stream for analysis</span>
                <select
                  value={quality}
                  onChange={e => setQuality(e.target.value)}
                  disabled={isActive}
                  className="w-full rounded-lg border border-border/60 bg-card/40 px-3 py-2 text-sm focus:border-primary/50 disabled:opacity-50"
                >
                  {["144p","240p","360p","480p","720p","1080p"].map(q => (
                    <option key={q} value={q}>{q}</option>
                  ))}
                </select>
              </label>

              {/* Error */}
              {error && (
                <div className="flex items-start gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
                  <AlertCircle className="w-4 h-4 text-destructive mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-destructive">{error}</p>
                </div>
              )}

              {/* Action buttons */}
              <div className="flex gap-2 pt-1">
                {!isActive ? (
                  <button
                    onClick={handleStart}
                    disabled={isStarting}
                    className="flex-1 inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition-all"
                  >
                    {isStarting ? (
                      <><Loader2 className="w-4 h-4 animate-spin" /> Starting…</>
                    ) : (
                      <><Radio className="w-4 h-4" /> Start Live</>
                    )}
                  </button>
                ) : (
                  <button
                    onClick={handleStop}
                    disabled={isStopping}
                    className="flex-1 inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-destructive/10 text-destructive border border-destructive/20 text-sm font-semibold hover:bg-destructive/20 disabled:opacity-50 transition-all"
                  >
                    {isStopping ? (
                      <><Loader2 className="w-4 h-4 animate-spin" /> Stopping…</>
                    ) : (
                      <><Square className="w-4 h-4" /> Stop</>
                    )}
                  </button>
                )}
              </div>
            </div>

            {/* Live Stats Card */}
            {sessionId && (
              <div className="bg-card border border-border/60 rounded-xl p-5 space-y-3">
                <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
                  Live Stats
                </h2>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { label: "Segments", value: segmentCount, icon: <Activity className="w-4 h-4" /> },
                    { label: "Windows", value: windowsAnalyzed, icon: <Zap className="w-4 h-4" /> },
                    { label: "Clips", value: events.length, icon: <Play className="w-4 h-4" /> },
                  ].map(s => (
                    <div key={s.label} className="text-center p-3 bg-secondary/30 rounded-lg">
                      <div className="flex justify-center mb-1 text-primary">{s.icon}</div>
                      <div className="text-xl font-bold text-foreground">{s.value}</div>
                      <div className="text-xs text-muted-foreground">{s.label}</div>
                    </div>
                  ))}
                </div>
                {bufferedDur > 0 && (
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Buffer</span>
                      <span className="font-semibold text-foreground">{bufferedDur.toFixed(0)}s / {windowSec}s</span>
                    </div>
                    <div className="w-full h-2 bg-secondary/30 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-primary to-primary/60 rounded-full transition-all duration-500"
                        style={{ width: `${Math.min((bufferedDur / windowSec) * 100, 100)}%` }}
                      />
                    </div>
                  </div>
                )}
                {isDone && highlightsUrl && (
                  <a
                    href={highlightsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2 w-full h-9 rounded-lg bg-green-500/10 text-green-400 border border-green-500/20 text-sm font-semibold hover:bg-green-500/20 transition-all"
                  >
                    <Play className="w-4 h-4" /> Final Highlights
                  </a>
                )}
              </div>
            )}
          </div>

          {/* CENTER: Video player + activity log */}
          <div className="space-y-4">
            {/* Video player */}
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
                  {isActive ? (
                    <>
                      <div className="relative">
                        <div className="w-16 h-16 rounded-full border-4 border-primary/30 border-t-primary animate-spin" />
                        <Radio className="absolute inset-0 m-auto w-6 h-6 text-primary" />
                      </div>
                      <p className="text-sm font-semibold text-muted-foreground">Analysing live stream…</p>
                      <p className="text-xs text-muted-foreground">Clips will appear on the right when detected</p>
                    </>
                  ) : (
                    <>
                      <div className="w-16 h-16 rounded-full bg-secondary/50 flex items-center justify-center">
                        <Play className="w-8 h-8 text-muted-foreground ml-1" />
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {isDone ? "Click a clip to play it" : "Start a live session to begin"}
                      </p>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Activity Log */}
            {sessionId && (
              <div className="bg-card border border-border/60 rounded-xl p-4">
                <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                  <Activity className="w-4 h-4 text-primary" />
                  Activity Feed
                </h3>
                <div
                  ref={logRef}
                  className="space-y-1.5 max-h-52 overflow-y-auto scrollbar-thin"
                >
                  {activityLog.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-4 text-center">Waiting for events...</p>
                  ) : (
                    [...activityLog].reverse().map(entry => (
                      <div
                        key={entry.id}
                        className={`flex items-start gap-2 px-3 py-2 rounded-lg text-xs transition-all ${
                          entry.type === "clip" ? "bg-primary/5 border border-primary/10" :
                          entry.type === "error" ? "bg-destructive/5 border border-destructive/10" :
                          "bg-secondary/20"
                        }`}
                      >
                        <span className="flex-shrink-0 mt-px">{getActivityIcon(entry.type)}</span>
                        <span className="flex-1 text-muted-foreground">{entry.message}</span>
                        <span className="text-muted-foreground/50 flex-shrink-0">{entry.time}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          {/* RIGHT: Clips Gallery */}
          <div className="space-y-4">
            <div className="bg-card border border-border/60 rounded-xl p-4">
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <Zap className="w-4 h-4 text-primary" />
                Live Highlights
                {events.length > 0 && (
                  <span className="ml-auto inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-primary/10 text-primary">
                    {events.length}
                  </span>
                )}
              </h3>

              {events.length === 0 ? (
                <div className="py-10 text-center">
                  <div className="w-12 h-12 rounded-full bg-secondary/50 flex items-center justify-center mx-auto mb-3">
                    <Clock className="w-6 h-6 text-muted-foreground" />
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {isActive
                      ? `Clips appear after ${windowSec}s of stream is analysed`
                      : "No highlights yet"}
                  </p>
                </div>
              ) : (
                <div className="space-y-2 max-h-[520px] overflow-y-auto">
                  {[...events].reverse().map((ev, i) => (
                    <div
                      key={i}
                      className={`group flex items-center gap-3 p-3 rounded-lg border cursor-pointer hover:shadow-md transition-all ${
                        playingUrl === ev.clip_url
                          ? "bg-primary/10 border-primary/30"
                          : "bg-secondary/20 border-transparent hover:border-border/60"
                      }`}
                      onClick={() => setPlayingUrl(ev.clip_url)}
                    >
                      <div className={`w-9 h-9 rounded-lg border flex items-center justify-center flex-shrink-0 ${EVENT_COLORS[ev.event_type] ?? "bg-secondary/50 border-border/40"}`}>
                        {EVENT_ICON_MAP[ev.event_type] ?? <Film className="w-4 h-4" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-sm capitalize">{ev.event_type}</div>
                        <div className="text-xs text-muted-foreground flex items-center gap-2">
                          <Clock className="w-3 h-3" />
                          {ev.time_formatted}
                          <span>·</span>
                          <span>{(ev.confidence * 100).toFixed(0)}%</span>
                          {ev.audio_verified && (
                            <span className="text-green-400 font-medium">· audio</span>
                          )}
                        </div>
                      </div>
                      <Play className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors flex-shrink-0" />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Past Sessions ── */}
        <div className="bg-card border border-border/60 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold">Past Sessions</h2>
            <button
              onClick={fetchSessions}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Refresh
            </button>
          </div>

          {loadingSessions ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
          ) : pastSessions.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              No past sessions yet. Start your first live session above.
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {pastSessions.map(s => (
                <Link
                  key={s.session_id}
                  href={`/live/${s.session_id}`}
                  className="group flex items-center justify-between gap-3 p-3 bg-secondary/20 rounded-lg border border-transparent hover:border-border/60 hover:bg-secondary/40 transition-all"
                >
                  <div className="flex items-center gap-3 min-w-0 pr-2">
                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                      s.status === "live"      ? "bg-red-400 animate-pulse" :
                      s.status === "completed" ? "bg-green-400" :
                      s.status === "stopped"   ? "bg-yellow-400" :
                      "bg-secondary"
                    }`} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate pr-4">{s.title}</div>
                      <div className="text-xs text-muted-foreground">
                        {s.events?.length ?? 0} clip(s) · {s.status}
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={(e) => deleteSession(e, s.session_id)}
                      className="p-1.5 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors opacity-0 group-hover:opacity-100"
                      title="Delete Session"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                    <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors flex-shrink-0" />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

      </section>
      <SiteFooter />
    </main>
  )
}
