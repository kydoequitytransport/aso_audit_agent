# ASO Audit Agent (Mastra + TypeScript)

Take-home implementation of a chat-driven Apple App Store ASO auditor.

## What This App Does

Given an Apple App Store URL (for example: `https://apps.apple.com/us/app/spotify-music-and-podcasts/id324684580`), the agent:

1. Fetches app listing metadata.
2. Confirms with the user: **"Is this the app you meant?"**
3. Runs a full ASO audit only after explicit confirmation.
4. Returns a structured recommendation report with:
	 - ASO Score Card (weighted dimensions)
	 - Quick Wins
	 - High-Impact Changes
	 - Strategic Recommendations
	 - Competitor Comparison (top 3 sampled competitors)

The audit uses public iTunes endpoints by default, and can optionally enrich App Store page signals through Firecrawl when a key is present.

## Stack

- Mastra (agents, tools, workflows, memory)
- TypeScript
- Zod schemas for input/output validation
- Public Apple/iTunes APIs for listing + ratings + reviews + competitor samples

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create environment file:

```bash
cp .env.example .env
```

3. Add at least one provider key in `.env`:

- Recommended: `GOOGLE_API_KEY` for Gemini
- Optional: `ASO_AGENT_MODEL` to override model (default: `google/gemini-2.0-flash`)
- Optional fallback: `OPENAI_API_KEY` (+ `OPENAI_BASE_URL` for OpenAI-compatible providers like NVIDIA NIM)

4. Run locally:

```bash
npm run dev
```

Open `http://localhost:4111` and use Mastra Studio chat with `asoAuditAgent`.

## Free-Tier Friendly Path

This repo is ready-made for a "register and paste key" workflow:

- Recommended default: Gemini API key in `GOOGLE_API_KEY`
	- Set `ASO_AGENT_MODEL=google/gemini-2.0-flash` (stable) or `google/gemini-flash-lite-latest` (lowest cost)
- Alternative free-credits option: NVIDIA NIM
	- Set `OPENAI_API_KEY` to your NIM key
	- Set `OPENAI_BASE_URL=https://integrate.api.nvidia.com/v1`
	- Set `ASO_AGENT_MODEL` to a model exposed by your NIM account

Firecrawl is optional. If `FIRECRAWL_API_KEY` is set, the workflow attempts page scrape enrichment and falls back safely to iTunes-only signals when unavailable.

## Architecture Decisions

### Agent

- File: `src/mastra/agents/aso-audit-agent.ts`
- Enforces a strict two-stage flow:
	- metadata confirmation first
	- audit execution only after explicit yes
- Uses memory so multi-turn confirmation behaves naturally in chat.

### Tools

- File: `src/mastra/tools/aso-tools.ts`
- `fetchAppMetadataTool`:
	- validates/parses App Store URL
	- returns app name, developer, icon, category, country
- `runAsoAuditTool`:
	- blocks if `confirmed=false`
	- triggers workflow for full audit

### Workflow

- File: `src/mastra/workflows/aso-audit-workflow.ts`
- Multi-step deterministic pipeline:
	- fetch listing metadata
	- collect reviews and competitors
	- compute weighted score card and evidence payload

## Notes On Data Coverage

- iOS keyword field is not publicly available via iTunes APIs.
- Subtitle and app preview are estimated from available metadata.
- The agent is instructed to explicitly disclose these limitations in the output.

## Suggested Demo Flow (for screen recording)

1. Start the app with `npm run dev`.
2. Paste an unseen App Store URL.
3. Show metadata confirmation question.
4. Reply "yes" and run audit.
5. Walk through score card and prioritized recommendations.

## Repository Delivery Checklist

- Private GitHub repo
- Invite `@mikekhristo` as collaborator
- Ensure `.env.example` is complete
- Verify `npm install && npm run dev` works
- Include a short screen recording walkthrough