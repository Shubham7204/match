"use client"

import { useState, useRef, useEffect } from "react"
import { SiteNav } from "@/components/site-nav"
import { SiteFooter } from "@/components/footer"

type Msg = { id: number; role: "user" | "assistant"; text: string }

export default function ChatPage() {
  const [messages, setMessages] = useState<Msg[]>([
    {
      id: 1,
      role: "assistant",
      text: "Hi! I'm your AI Football Highlights Assistant. Ask me about match highlights, player appearances, specific events, or match summaries. I can analyze the AI-detected data from your uploaded matches.",
    },
  ])
  const [input, setInput] = useState("")
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" })
  }, [messages.length])

  function send() {
    if (!input.trim()) return
    const next: Msg = { id: Date.now(), role: "user", text: input.trim() }
    setMessages((m) => [...m, next])
    setInput("")
    setTimeout(() => {
      setMessages((m) => [
        ...m,
        {
          id: Date.now() + 1,
          role: "assistant",
          text: "I've analyzed the match footage using YOLOv8n and LLaVA vision models. I detected 3 goals, 12 key passes, 8 tackles, and 5 player highlights. Would you like me to show you specific moments or filter by player?",
        },
      ])
    }, 600)
  }

  return (
    <main className="flex min-h-screen flex-col bg-background text-foreground">
      <SiteNav />
      <section className="border-b border-border/60 bg-gradient-to-b from-secondary/5 to-background">
        <div className="mx-auto max-w-3xl px-4 py-8 md:px-6 md:py-12">
          <h1 className="text-3xl md:text-4xl font-bold mb-2">Match Highlights Chat</h1>
          <p className="text-muted-foreground">
            Query AI-analyzed football data. Ask about specific events, players, or get match summaries.
          </p>
        </div>
      </section>
      <section className="flex flex-1 flex-col">
        <div ref={listRef} className="flex-1 overflow-auto bg-background" aria-label="Chat messages">
          <div className="mx-auto max-w-3xl space-y-4 px-4 py-8 md:px-6">
            {messages.map((m) => (
              <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={
                    m.role === "user"
                      ? "max-w-[75%] rounded-xl bg-primary px-5 py-3 text-sm text-primary-foreground shadow-md"
                      : "max-w-[75%] rounded-xl bg-card/60 px-5 py-3 text-sm text-foreground ring-1 ring-border/40"
                  }
                >
                  {m.text}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="border-t border-border/60 bg-background">
          <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-4 md:px-6">
            <input
              className="flex-1 rounded-lg border border-border/60 bg-card/40 px-4 py-3 text-sm outline-none transition-all focus:border-primary/50 focus:ring-1 focus:ring-primary/20"
              placeholder="Ask about highlights, players, or match summaries..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send()}
              aria-label="Message"
            />
            <button
              className="inline-flex h-10 items-center rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground transition-all hover:opacity-90 hover:shadow-md active:scale-95"
              onClick={send}
            >
              Send
            </button>
          </div>
        </div>
      </section>
      <SiteFooter />
    </main>
  )
}
