"use client"

import { useState } from "react"
import { SiteNav } from "@/components/site-nav"
import { SiteFooter } from "@/components/footer"
import { Upload, CheckCircle2 } from "lucide-react"

export default function UploadPage() {
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [posterUrl, setPosterUrl] = useState<string | null>(null)

  return (
    <main className="min-h-screen bg-background text-foreground">
      <SiteNav />
      <section className="border-b border-border/60 bg-gradient-to-b from-secondary/5 to-background">
        <div className="mx-auto max-w-4xl px-4 py-8 md:px-6 md:py-12">
          <h1 className="text-4xl md:text-5xl font-bold mb-3">Upload Match Video</h1>
          <p className="text-lg text-muted-foreground mb-4">
            Upload your football match video and let our AI analyze it for highlights, player appearances, and key
            moments.
          </p>
          <p className="text-sm text-muted-foreground">
            Our system will process your video using advanced computer vision to automatically generate
            broadcast-quality highlights.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-4xl px-4 py-12 md:px-6 md:py-16">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-12">
          <div className="bg-primary/10 border border-primary/20 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="font-semibold text-sm text-foreground">Event Detection</h3>
                <p className="text-xs text-muted-foreground mt-1">Goals, fouls, tackles, celebrations</p>
              </div>
            </div>
          </div>
          <div className="bg-primary/10 border border-primary/20 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="font-semibold text-sm text-foreground">Player Tracking</h3>
                <p className="text-xs text-muted-foreground mt-1">Identify and track player performances</p>
              </div>
            </div>
          </div>
          <div className="bg-primary/10 border border-primary/20 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="font-semibold text-sm text-foreground">Highlight Reel</h3>
                <p className="text-xs text-muted-foreground mt-1">10-15 min from 90-min match</p>
              </div>
            </div>
          </div>
        </div>

        <form
          className="space-y-8"
          onSubmit={(e) => {
            e.preventDefault()
            alert("Demo: Match metadata submitted for AI analysis. In production, this would process your video.")
          }}
        >
          <div className="grid gap-6 md:grid-cols-2">
            <label className="space-y-2">
              <span className="text-sm font-semibold text-foreground">Match Title *</span>
              <input
                className="w-full rounded-lg border border-border/60 bg-card/40 px-4 py-3 text-sm transition-all focus:border-primary/50 focus:ring-1 focus:ring-primary/20"
                placeholder="e.g., Team A vs Team B - Final"
                required
              />
            </label>
            <label className="space-y-2">
              <span className="text-sm font-semibold text-foreground">Match Date *</span>
              <input
                type="date"
                className="w-full rounded-lg border border-border/60 bg-card/40 px-4 py-3 text-sm transition-all focus:border-primary/50 focus:ring-1 focus:ring-primary/20"
                required
              />
            </label>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <label className="space-y-2">
              <span className="text-sm font-semibold text-foreground">Video File *</span>
              <input
                type="file"
                accept="video/*"
                className="w-full rounded-lg border border-border/60 bg-card/40 px-4 py-3 text-sm"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) setVideoUrl(URL.createObjectURL(file))
                }}
                required
              />
              {videoUrl ? (
                <video
                  src={videoUrl}
                  controls
                  className="mt-3 aspect-video w-full rounded-lg border border-border/60 bg-black shadow-md"
                />
              ) : (
                <div className="mt-3 aspect-video w-full rounded-lg border-2 border-dashed border-border/40 bg-card/20 flex flex-col items-center justify-center gap-2">
                  <Upload className="w-6 h-6 text-muted-foreground" />
                  <p className="text-xs text-muted-foreground">Select a video file (MP4, WebM, etc.)</p>
                </div>
              )}
            </label>

            <label className="space-y-2">
              <span className="text-sm font-semibold text-foreground">Poster Image</span>
              <input
                type="file"
                accept="image/*"
                className="w-full rounded-lg border border-border/60 bg-card/40 px-4 py-3 text-sm"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) setPosterUrl(URL.createObjectURL(file))
                }}
              />
              {posterUrl ? (
                <img
                  src={posterUrl || "/placeholder.svg"}
                  alt="Poster preview"
                  className="mt-3 aspect-video w-full rounded-lg border border-border/60 object-cover shadow-md"
                />
              ) : (
                <div className="mt-3 aspect-video w-full rounded-lg border-2 border-dashed border-border/40 bg-card/20 flex flex-col items-center justify-center gap-2">
                  <Upload className="w-6 h-6 text-muted-foreground" />
                  <p className="text-xs text-muted-foreground">Select a poster image</p>
                </div>
              )}
            </label>
          </div>

          <label className="space-y-2">
            <span className="text-sm font-semibold text-foreground">Match Description</span>
            <textarea
              className="min-h-32 w-full rounded-lg border border-border/60 bg-card/40 px-4 py-3 text-sm transition-all focus:border-primary/50 focus:ring-1 focus:ring-primary/20"
              placeholder="Add details about the match, teams, tournament, etc..."
            />
          </label>

          <div className="bg-secondary/50 border border-secondary/30 rounded-lg p-4">
            <p className="text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">Note:</span> This is a demo interface. Files are processed
              locally in your browser for preview. In production, videos would be sent to our AI pipeline for analysis.
            </p>
          </div>

          <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
            <button
              type="submit"
              className="inline-flex h-12 items-center rounded-lg bg-primary px-8 text-base font-semibold text-primary-foreground transition-all hover:opacity-90 hover:shadow-lg active:scale-95"
            >
              Publish & Analyze
            </button>
            <button
              type="button"
              className="inline-flex h-12 items-center rounded-lg border border-border/60 bg-background/60 px-8 text-base font-medium transition-all hover:bg-background/80 hover:shadow-md"
              onClick={() => {
                setVideoUrl(null)
                setPosterUrl(null)
              }}
            >
              Reset Form
            </button>
          </div>
        </form>
      </section>
      <SiteFooter />
    </main>
  )
}
