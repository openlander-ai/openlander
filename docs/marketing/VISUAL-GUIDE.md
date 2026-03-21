# Visual Assets Guide

What to capture, how to capture it, and where to use it.

---

## Tools

| Tool                               | Use For                    | Notes                                |
| ---------------------------------- | -------------------------- | ------------------------------------ |
| **macOS Screenshot** (Cmd+Shift+4) | Static screenshots         | Clean, native                        |
| **OBS Studio** (free)              | Screen recording → MP4     | Best for demo videos                 |
| **ScreenStudio** ($89, macOS)      | Polished screen recordings | Auto-zoom, cursor effects — worth it |
| **CleanShot X** ($29, macOS)       | Screenshots + annotations  | Scrolling capture, blur tool         |
| **Shottr** (free, macOS)           | Quick screenshots          | Lightweight alternative              |
| **ffmpeg**                         | MP4 → optimized MP4/WebM   | Compress for GitHub README           |

> Pick ONE recording tool. Don't overthink it. OBS (free) is fine.

---

## Screenshot Spec

### Format & Size

- **Format**: PNG (screenshots), MP4 (video)
- **Resolution**: 2x retina (will look sharp on any screen)
- **Browser**: Use a clean browser profile (no bookmarks bar, no extensions visible)
- **Theme**: Use the app's default theme (dark if dark, light if light)
- **Window**: Capture the app window only, not full desktop
- **Aspect ratio**: 16:9 preferred (fits GitHub README and social previews)

### Clean-up Checklist (before every capture)

- [ ] No personal data visible (real domain names, IPs, tokens)
- [ ] Use realistic but fake data (e.g., `my-saas-app`, `api.example.com`)
- [ ] Browser URL bar shows `localhost:3000` or a clean demo URL
- [ ] No OS notifications visible
- [ ] Terminal font size readable at 50% zoom (bump to 16px+)

---

## The 4 Required Screenshots

### Shot 1: Dashboard Overview

**Purpose**: "This is a real, polished product"

```
What to show:
- Project list with 3-5 projects
- Mix of statuses: Running (green), Building (yellow), Stopped (gray)
- Sidebar visible, showing navigation structure
- Clean, modern UI feel

Setup:
- Deploy 3-5 demo projects before capture
  - A Node.js app (status: Running)
  - A Python app (status: Running)
  - A static site (status: Running)
  - One project mid-build (status: Building) — if timing allows
```

### Shot 2: Deploy in Progress

**Purpose**: "See it actually building — live logs, real feedback"

```
What to show:
- Build log streaming in real time
- Visible progress: git clone → dependency install → docker build
- Status indicator showing "Building..."
- Project name and git repo URL visible

Tip: Capture this DURING an actual build. Don't fake it.
```

### Shot 3: Deploy Success

**Purpose**: "It works. Here's the URL."

```
What to show:
- Status: Running with green indicator
- Deployed URL prominently displayed (and clickable)
- Basic stats: uptime, port, container info
- Maybe a "Visit" or "Open" button visible

Bonus: If you can split-screen with the actual deployed app in a browser
tab, that's even more powerful.
```

### Shot 4: AI Auto-Recovery (THE money shot)

**Purpose**: "This is why OpenLander is different"

```
What to show:
- A build that FAILED (red error state)
- AI analysis section visible: "Analyzing build failure..."
- AI's diagnosis: what went wrong, what it's fixing
- Retry in progress or success after AI fix

Setup:
- Prepare a project that will fail on purpose:
  - Node.js app with wrong base image in Dockerfile
  - Missing dependency that AI can detect and fix
- Deploy it → let it fail → let AI recover → capture the whole flow
- For a screenshot: capture the moment AI analysis is visible
- For video: record the full fail → analyze → fix → success cycle
```

---

## Demo Video (60-90 seconds)

### Script

```
[0-5s]   Title card: "OpenLander — Deploy with AI Auto-Recovery"

[5-15s]  Dashboard overview. Narration (text overlay):
         "Paste a Git URL. Click deploy. Get a URL."

[15-30s] Start a deploy. Show logs streaming.
         Build completes. URL appears.
         Click the URL — app loads in browser.

[30-35s] Transition text: "But what happens when builds fail?"

[35-55s] Deploy a broken project.
         Build fails — red error.
         AI kicks in: "Analyzing failure..."
         AI identifies the issue.
         AI retries with fix.
         Build succeeds — green.

[55-65s] Text overlay: "60+ MCP tools — deploy from Cursor or Claude Code"
         (Optional: quick terminal clip showing MCP deploy)

[65-75s] Feature highlights (text overlays, fast cuts):
         - Auto SSL via Traefik
         - Blue-green deploys
         - Rollback in one click
         - Works with Gemini free tier

[75-85s] Final card:
         "OpenLander — Self-hosted deploys that fix themselves"
         "github.com/[your-org]/OpenLander"
         "Star us on GitHub"
```

### Recording Tips

- **No voiceover needed**. Text overlays + background music is cleaner.
- **Speed up boring parts** (dependency install) to 4x-8x
- **Slow down money moments** (AI analysis, success state) to 1x
- **Background music**: Use royalty-free lo-fi or ambient (e.g., from Uppbeat, Pixabay)
- **Resolution**: 1920x1080 minimum
- **Export**: MP4 H.264, < 20MB for Twitter, < 100MB for YouTube

---

## Where Each Asset Goes

| Asset                      | README           | HN Post | Reddit | Twitter           | Product Hunt   |
| -------------------------- | ---------------- | ------- | ------ | ----------------- | -------------- |
| Screenshot 1 (dashboard)   | Hero image       | Link    | Inline | Thread image      | Gallery        |
| Screenshot 2 (building)    | Features section | -       | -      | -                 | Gallery        |
| Screenshot 3 (success)     | Features section | -       | -      | Thread image      | Gallery        |
| Screenshot 4 (AI recovery) | Features section | Link    | Inline | Thread image      | Gallery        |
| Demo video (60-90s)        | Link/embed       | Link    | Link   | Uploaded natively | Featured video |

### GitHub README Image Embedding

```markdown
<!-- Use HTML for sizing control -->
<p align="center">
  <img src="docs/marketing/assets/dashboard.png" alt="OpenLander Dashboard" width="800">
</p>

<!-- For video, link to YouTube or use a GIF preview -->
<p align="center">
  <a href="https://youtube.com/watch?v=YOUR_VIDEO">
    <img src="docs/marketing/assets/video-thumbnail.png" alt="Demo Video" width="600">
  </a>
</p>
```

---

## Social Preview Image (OG Image)

**What**: The image that appears when someone shares your GitHub link on Twitter/Slack/Discord.

```
Size: 1280 x 640px
Content:
  - OpenLander logo (if you have one) or just the name in bold
  - Tagline: "Self-hosted deploys with AI auto-recovery"
  - Dark background, clean typography
  - Optional: small screenshot of dashboard in corner

Tool: Canva (free), Figma, or even a well-designed HTML page screenshotted.
Set in: GitHub repo → Settings → Social preview
```

---

## File Structure

```
docs/marketing/
  assets/
    dashboard.png
    deploy-building.png
    deploy-success.png
    ai-recovery.png
    video-thumbnail.png
    social-preview.png
    demo.mp4 (or link to YouTube)
  LAUNCH-CHECKLIST.md
  VISUAL-GUIDE.md
  CHANNELS.md
```
