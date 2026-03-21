# OpenLander v1.0 Launch Checklist

## Pre-Launch (Before any public posting)

### Visual Assets (BLOCKING - do these first)

- [ ] **Screenshot 1**: Dashboard main view (project list with status indicators)
- [ ] **Screenshot 2**: Deploy in progress (build log streaming, progress bar)
- [ ] **Screenshot 3**: Deploy success (status: Running, URL displayed, quick stats)
- [ ] **Screenshot 4**: AI auto-recovery (error detected → AI analysis → retry → success)
- [ ] **Demo video** (60-90 sec): Full deploy flow + AI recovery in one take
- [ ] All visuals placed in `docs/marketing/assets/` and referenced in README

> See [VISUAL-GUIDE.md](./VISUAL-GUIDE.md) for exact shot composition and recording instructions.

### README Optimization

- [ ] Hero section: One-liner + screenshot/video at the very top
- [ ] Feature list with icons/emoji (scannable in 5 seconds)
- [ ] "Quick Start" section: 3 commands max (`npm i -g openlander && openlander init && openlander deploy`)
- [ ] Comparison table (vs Coolify, vs Vercel, vs manual Docker)
- [ ] "Why OpenLander?" section emphasizing AI auto-recovery + MCP
- [ ] Badges: license, version, build status, stars
- [ ] Remove or collapse any overly technical sections below the fold

### Repository Polish

- [ ] License changed to AGPL-3.0
- [ ] `package.json` license field updated
- [ ] GitHub repo description: "Self-hosted deployment platform with AI auto-recovery"
- [ ] GitHub topics: `deployment`, `docker`, `self-hosted`, `ai`, `devops`, `mcp`, `paas`, `traefik`
- [ ] Social preview image (1280x640, OG image for link sharing)
- [ ] GitHub Discussions enabled
- [ ] Issue templates (bug report, feature request)
- [ ] Contributing guide (CONTRIBUTING.md) - keep it short

### Technical Readiness

- [ ] v1.0.0 tagged and released
- [ ] `npm i -g openlander` works cleanly on a fresh machine
- [ ] Install → first deploy takes under 5 minutes
- [ ] Known bugs documented in GitHub Issues (honesty builds trust)
- [ ] CHANGELOG.md up to date

---

## Launch Week

### Day 1 (Monday): Soft Launch

- [ ] Post on r/selfhosted
  - Title format: "I built a self-hosted deployment platform where AI fixes build failures automatically"
  - Include 1 screenshot + quick description
  - Respond to EVERY comment within 2 hours
- [ ] Share on personal Twitter/X

### Day 2-3: Observe & Fix

- [ ] Monitor r/selfhosted reactions
- [ ] Fix any install issues users report (PRIORITY)
- [ ] Respond to all GitHub issues within 1 hour

### Day 4 (Thursday): Main Launch

- [ ] **Hacker News "Show HN"** (THE most important post)
  - Post between 9-11 AM ET (11 PM - 1 AM KST)
  - See [CHANNELS.md](./CHANNELS.md) for exact format
  - Stay online for 4+ hours to respond to comments
- [ ] Simultaneously post Twitter/X thread

### Day 5-7: Follow-up

- [ ] Post on r/devops
- [ ] Post on r/webdev
- [ ] Post on r/LocalLLaMA (if Ollama integration is a feature)
- [ ] Submit to Product Hunt (separate from HN, different day)

---

## Post-Launch (Week 2+)

### Community Building

- [ ] Open Discord server (or GitHub Discussions if low volume)
- [ ] Respond to every issue within 24 hours (non-negotiable)
- [ ] Weekly dev update on Twitter/X (even if small)
- [ ] First blog post: "How I built OpenLander in 24 days with AI"

### Growth Channels

- [ ] Submit to [awesome-selfhosted](https://github.com/awesome-selfhosted/awesome-selfhosted)
- [ ] Submit to [awesome-docker](https://github.com/veggiemonk/awesome-docker)
- [ ] Write comparison: "OpenLander vs Coolify: When to use which"
- [ ] dev.to / Hashnode blog posts
- [ ] Consider Chinese README (zh-CN) for Chinese developer market
- [ ] Consider Japanese README (ja) for Japanese selfhost community

### Metrics to Track

| Metric                    | Tool    | Target (3 months)   |
| ------------------------- | ------- | ------------------- |
| GitHub Stars              | GitHub  | 1,000+              |
| npm weekly downloads      | npm     | 500+                |
| GitHub Issues (open)      | GitHub  | Response time < 24h |
| Discord/community members | Discord | 100+                |
| First external PR         | GitHub  | Within 1 month      |

---

## Anti-Patterns (Things that kill launches)

- **DO NOT** post on multiple subreddits on the same day (looks spammy)
- **DO NOT** post on HN without screenshots in the README
- **DO NOT** argue with negative commenters (thank them, fix the issue)
- **DO NOT** launch on Friday or weekend (low engagement)
- **DO NOT** disappear after launch (first 48h response rate is everything)
- **DO NOT** add features during launch week (focus on stability + community)
