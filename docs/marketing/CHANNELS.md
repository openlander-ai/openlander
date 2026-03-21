# Channel-by-Channel Launch Strategy

Exact templates, timing, and rules for each platform.

---

## 1. Hacker News (Show HN) — Primary Launch Channel

### Why HN First

HN front page = 300-2,000 stars in a day. No other channel comes close.
The developer audience is exactly the OpenLander target: builders who self-host.

### Post Format

```
Title: Show HN: OpenLander – Self-hosted deploys with AI that fixes build failures

Body:
Hi HN, I built OpenLander — a self-hosted deployment platform where AI
automatically recovers from build failures and container crashes.

Paste a Git URL → get a URL. If something breaks, AI analyzes the error,
fixes the Dockerfile, and retries. No manual debugging.

Key features:
- AI auto-recovery (supports Gemini free tier, OpenAI, Ollama)
- 60+ MCP tools (deploy directly from Cursor/Claude Code)
- Traefik auto-routing with SSL
- Blue-green deploys, rollback, health monitoring
- SQLite — no external DB needed

Built solo in ~4 weeks using AI-assisted development.
The entire platform is TypeScript, ~57K lines, fully tested.

Stack: Node.js, Docker, Traefik, Drizzle ORM, React 19, Hono

Open source (AGPL-3.0): https://github.com/[org]/OpenLander

I'd love feedback on the AI recovery approach — is this something
you'd actually trust in production?
```

### HN Rules

- **Timing**: Tuesday-Thursday, 9-11 AM Eastern (11 PM - 1 AM KST)
- **Stay online**: Respond to every comment for 4+ hours
- **Be humble**: "I built X" not "X is the best"
- **Ask a question**: Ends with a genuine question to encourage discussion
- **Never**: Ask for upvotes, sound salesy, or mention pricing
- **Controversy helps**: "Built with AI" will generate debate — that's good, engagement = rank

### HN Comment Strategy

- Thank people who give feedback (even negative)
- Answer technical questions with depth (HN loves specifics)
- If someone asks "how is this different from Coolify?" — be honest:
  "Coolify is great and more mature. OpenLander's differentiator is AI
  auto-recovery. If your build fails, AI fixes it and retries."
- Share architecture details if asked (HN respects transparency)

---

## 2. Reddit — Sustained Growth

### Posting Schedule (one subreddit per day, minimum 2 days apart)

| Day          | Subreddit            | Angle                                                                |
| ------------ | -------------------- | -------------------------------------------------------------------- |
| Mon (Week 1) | r/selfhosted (350K+) | "I built a self-hosted PaaS with AI auto-recovery"                   |
| Thu (Week 1) | HN (primary launch)  | See above                                                            |
| Mon (Week 2) | r/devops (200K+)     | "AI-powered deployment recovery — does this actually save time?"     |
| Thu (Week 2) | r/webdev (900K+)     | "Paste a Git URL, get a deployed app with SSL — open source"         |
| Mon (Week 3) | r/LocalLLaMA (400K+) | "Built a deployment platform that uses local LLMs for auto-recovery" |
| Thu (Week 3) | r/homelab (800K+)    | "Running my own PaaS on a single VPS — replaced Vercel"              |

### Reddit Post Template (r/selfhosted)

```
Title: I built a self-hosted deployment platform where AI fixes
build failures automatically [open source]

Body:
Hey r/selfhosted,

I've been building OpenLander — a self-hosted alternative to
Vercel/Netlify with a twist: when builds fail, AI analyzes the
error and retries with a fix.

**What it does:**
- Git URL → Docker build → Traefik routing → SSL — all automatic
- If the build fails, AI figures out why and fixes it
- 60+ MCP tools (deploy from Cursor/Claude Code)
- Runs on a single VPS, SQLite, no external dependencies

**What it doesn't do (yet):**
- No multi-user/RBAC (it's single-user for now)
- No Kubernetes (Docker only)
- Not a Coolify replacement (they're more mature)

**Stack:** TypeScript, Docker, Traefik, React 19, SQLite

**Install:** `npm i -g openlander`

GitHub: [link]

Would love to hear what you think, especially about the
AI recovery approach. Is this something you'd trust?

[Screenshot of dashboard]
```

### Reddit Rules

- **Always include screenshots** (posts with images get 3x more engagement)
- **Be honest about limitations** (r/selfhosted hates overpromising)
- **"Not a Coolify replacement"** — say this proactively (avoids hostile comparisons)
- **Never**: Cross-post the same text, sound like an ad, ignore comments
- **Flair**: Use appropriate flair (usually "New Project" or "Tool/Resource")

---

## 3. Twitter/X — Developer Virality

### Thread Format

```
Tweet 1 (hook):
I built a deployment platform in 4 weeks.
Solo. With AI.
57K lines of TypeScript.

It fixes its own build failures. Here's how:

🧵

Tweet 2:
The problem: Deploying apps is still painful.
Docker, reverse proxies, SSL, DNS...
Tools like Vercel make it easy but cost $$$.
Self-hosting? You need DevOps skills.

Tweet 3:
So I built OpenLander.
Paste a Git URL → click deploy → get a URL.

But the real feature:
When builds FAIL, AI analyzes the error
and fixes it automatically.

[Screenshot: AI recovery in action]

Tweet 4:
It works with:
- Gemini (free tier — $0 cost)
- OpenAI / Anthropic
- Ollama (fully local, no API needed)

No AI? It still works — AI is optional.

Tweet 5:
60+ MCP tools built in.
Deploy directly from Cursor or Claude Code.
No browser needed.

"Deploy my-app to production" — done.

Tweet 6:
The stack:
- TypeScript (strict mode, 0 type escapes)
- Docker + Traefik (auto SSL)
- SQLite (no external DB)
- React 19 dashboard
- 1,454 tests passing

Tweet 7:
Free. Open source (AGPL-3.0). Self-hosted.

Star on GitHub: [link]

If you try it, let me know what breaks.
I'll fix it today.
```

### Twitter Rules

- **Thread, not single tweet** (threads get 5x more reach)
- **Include images** in tweets 3 and 5 minimum
- **Post time**: 9-11 AM ET (best for global dev audience)
- **Engage**: Reply to every quote tweet and reply for 24 hours
- **Pin the thread** to your profile

---

## 4. Product Hunt — Separate Launch

### Timing

- NOT the same week as HN
- Tuesday-Thursday (best PH days)
- 12:01 AM PT (launch time on PH)

### Listing

```
Name: OpenLander
Tagline: "Self-hosted deploys that fix their own failures"
Description: (short)
  Open-source deployment platform with AI auto-recovery.
  Paste a Git URL, get a deployed app. When builds fail,
  AI fixes them automatically.

Topics: Developer Tools, DevOps, Open Source, Self-Hosted
```

### Product Hunt Tips

- Ask 10-15 friends/colleagues to upvote in the first hour (this is normal and expected)
- Respond to every comment on PH
- First comment should be the "maker story" — why you built it
- Include all 4 screenshots + demo video in the gallery

---

## 5. Awesome Lists — Long-tail SEO

These drive steady, passive stars over months.

| List               | Requirements                        | Link                                             |
| ------------------ | ----------------------------------- | ------------------------------------------------ |
| awesome-selfhosted | Must be FOSS, must be self-hostable | github.com/awesome-selfhosted/awesome-selfhosted |
| awesome-docker     | Docker-related tools                | github.com/veggiemonk/awesome-docker             |
| awesome-sysadmin   | Sysadmin tools                      | github.com/awesome-foss/awesome-sysadmin         |

Submit PRs after you have 100+ stars (some lists have minimum requirements).

---

## 6. Blog Posts — SEO & Credibility

### Post Ideas (in order of priority)

1. **"How I built a deployment platform in 4 weeks with AI"** — dev.to, Hashnode
   - This is your origin story. People love build stories.
   - Include architecture decisions, mistakes, what AI helped with.

2. **"OpenLander vs Coolify vs Dokploy: Honest comparison"** — dev.to
   - Be genuinely honest. Praise Coolify where it's better.
   - This ranks on Google for people searching alternatives.

3. **"AI auto-recovery for Docker deployments: How it works"** — dev.to
   - Technical deep dive into the AI recovery pipeline.
   - Positions you as an expert in AI+DevOps.

---

## Response Templates

### Positive Comment

```
Thanks! Let me know if you run into any issues —
I'm actively maintaining this and fixing things fast.
```

### "How is this different from Coolify?"

```
Coolify is great and more mature (51K stars, 4 years of development).
The main difference is AI auto-recovery — when builds fail, OpenLander
uses AI to analyze the error and fix it automatically. Also, 60+ MCP
tools let you deploy directly from Cursor/Claude Code.

If you're happy with Coolify, there's no reason to switch.
If the AI recovery sounds useful, give OpenLander a try.
```

### "Why would I trust AI to fix my deployments?"

```
Fair concern. AI is optional — you can disable it entirely and use
OpenLander as a standard deployment platform.

When enabled, AI only touches build configuration (Dockerfile, dependencies).
It never modifies your application code. And you can review every AI
suggestion before it's applied.

Think of it as "AI-assisted debugging" rather than "AI running your infra."
```

### Negative/Hostile Comment

```
Appreciate the honest feedback. [Address their specific point].
I'll add that to the roadmap / I'll look into that.
```

Never argue. Never be defensive. Every hostile comment is a chance to show maturity.
