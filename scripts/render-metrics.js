#!/usr/bin/env node
/**
 * Fetches GitHub profile metrics and renders SVG cards into assets/metrics/.
 * Runs locally or via GitHub Actions on a schedule.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT_DIR = join(ROOT, "assets", "metrics");

const USERNAME = process.env.GITHUB_USERNAME || "vanchungnguyxn";
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";

const THEME = {
  bg: "#0b1220",
  panel: "#111827",
  border: "#1f2a3d",
  text: "#e5eefc",
  muted: "#8b9bb4",
  accent: "#2dd4bf",
  accent2: "#38bdf8",
  warn: "#fbbf24",
  grid: "#162033",
};

const LANG_COLORS = {
  Python: "#3572A5",
  Java: "#b07219",
  JavaScript: "#f1e05a",
  TypeScript: "#3178c6",
  Go: "#00ADD8",
  Rust: "#dea584",
  Shell: "#89e051",
  HTML: "#e34c26",
  CSS: "#563d7c",
  Dockerfile: "#384d54",
  C: "#555555",
  "C++": "#f34b7d",
  Ruby: "#701516",
  PHP: "#4F5D95",
  Kotlin: "#A97BFF",
  Swift: "#F05138",
};

async function gh(query, variables = {}) {
  const headers = {
    "Content-Type": "application/json",
    "User-Agent": "vanchungnguyxn-profile-metrics",
    Accept: "application/vnd.github+json",
  };
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;

  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers,
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub GraphQL ${res.status}: ${body}`);
  }

  const json = await res.json();
  if (json.errors?.length) {
    throw new Error(json.errors.map((e) => e.message).join("; "));
  }
  return json.data;
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function formatNumber(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function yearsSince(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  return Math.max(0, Math.floor(ms / (365.25 * 24 * 60 * 60 * 1000)));
}

async function fetchMetrics() {
  const query = `
    query($login: String!) {
      user(login: $login) {
        name
        login
        createdAt
        followers { totalCount }
        following { totalCount }
        repositories(
          first: 100
          ownerAffiliations: OWNER
          isFork: false
          orderBy: { field: UPDATED_AT, direction: DESC }
        ) {
          totalCount
          nodes {
            name
            stargazerCount
            forkCount
            primaryLanguage { name }
            languages(first: 10, orderBy: { field: SIZE, direction: DESC }) {
              edges { size node { name } }
            }
          }
        }
        contributionsCollection {
          contributionCalendar { totalContributions }
          totalCommitContributions
          totalPullRequestContributions
          totalIssueContributions
          totalPullRequestReviewContributions
        }
        pullRequests(states: MERGED) { totalCount }
        issues { totalCount }
      }
    }
  `;

  const { user } = await gh(query, { login: USERNAME });
  if (!user) throw new Error(`User not found: ${USERNAME}`);

  const repos = user.repositories.nodes;
  const stars = repos.reduce((s, r) => s + r.stargazerCount, 0);
  const forks = repos.reduce((s, r) => s + r.forkCount, 0);

  const langBytes = new Map();
  for (const repo of repos) {
    for (const edge of repo.languages.edges) {
      const name = edge.node.name;
      langBytes.set(name, (langBytes.get(name) || 0) + edge.size);
    }
  }

  const languages = [...langBytes.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([name, size]) => ({ name, size }));

  const totalLang = languages.reduce((s, l) => s + l.size, 0) || 1;

  const c = user.contributionsCollection;

  return {
    name: user.name || user.login,
    login: user.login,
    createdAt: user.createdAt,
    followers: user.followers.totalCount,
    following: user.following.totalCount,
    publicRepos: user.repositories.totalCount,
    stars,
    forks,
    contributions: c.contributionCalendar.totalContributions,
    commits: c.totalCommitContributions,
    prs: c.totalPullRequestContributions,
    issues: c.totalIssueContributions,
    reviews: c.totalPullRequestReviewContributions,
    mergedPrs: user.pullRequests.totalCount,
    languages: languages.map((l) => ({
      ...l,
      pct: Math.round((l.size / totalLang) * 100),
    })),
    updatedAt: new Date().toISOString(),
  };
}

function cardShell({ width, height, title, children }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(title)}">
  <defs>
    <linearGradient id="bgGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${THEME.bg}"/>
      <stop offset="100%" stop-color="#0a1628"/>
    </linearGradient>
    <linearGradient id="accentGrad" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${THEME.accent}"/>
      <stop offset="100%" stop-color="${THEME.accent2}"/>
    </linearGradient>
    <pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse">
      <path d="M 24 0 L 0 0 0 24" fill="none" stroke="${THEME.grid}" stroke-width="1"/>
    </pattern>
    <style>
      .title { font: 700 16px 'Segoe UI', Ubuntu, Sans-Serif; fill: ${THEME.text}; }
      .label { font: 500 12px 'Segoe UI', Ubuntu, Sans-Serif; fill: ${THEME.muted}; }
      .value { font: 700 22px 'Segoe UI', Ubuntu, Sans-Serif; fill: ${THEME.text}; }
      .small { font: 500 11px 'Segoe UI', Ubuntu, Sans-Serif; fill: ${THEME.muted}; }
      .accent { fill: ${THEME.accent}; }
      .pulse { animation: pulse 2.4s ease-in-out infinite; }
      @keyframes pulse { 0%,100% { opacity: .55 } 50% { opacity: 1 } }
      .barGrow { animation: grow .9s ease-out both; }
      @keyframes grow { from { transform: scaleX(0) } to { transform: scaleX(1) } }
    </style>
  </defs>
  <rect width="${width}" height="${height}" rx="14" fill="url(#bgGrad)" stroke="${THEME.border}" stroke-width="1"/>
  <rect width="${width}" height="${height}" rx="14" fill="url(#grid)" opacity=".35"/>
  <rect x="0" y="0" width="6" height="${height}" rx="3" fill="url(#accentGrad)"/>
  <circle cx="${width - 18}" cy="18" r="4" class="pulse" fill="${THEME.accent}"/>
  <text x="22" y="28" class="title">${escapeXml(title)}</text>
  ${children}
</svg>`;
}

function renderOverview(m) {
  const years = yearsSince(m.createdAt);
  const tiles = [
    { label: "Repos", value: m.publicRepos, color: THEME.accent },
    { label: "Stars", value: m.stars, color: THEME.warn },
    { label: "Commits", value: m.commits, color: THEME.accent2 },
    { label: "Contribs", value: m.contributions, color: THEME.accent },
    { label: "PRs", value: m.prs, color: THEME.accent2 },
    { label: "Followers", value: m.followers, color: THEME.warn },
  ];

  const tileW = 118;
  const tileH = 72;
  const gap = 12;
  const startX = 22;
  const startY = 48;

  const tilesSvg = tiles
    .map((t, i) => {
      const col = i % 3;
      const row = Math.floor(i / 3);
      const x = startX + col * (tileW + gap);
      const y = startY + row * (tileH + gap);
      return `
      <g transform="translate(${x},${y})">
        <rect width="${tileW}" height="${tileH}" rx="10" fill="${THEME.panel}" stroke="${THEME.border}"/>
        <text x="14" y="24" class="label">${escapeXml(t.label)}</text>
        <text x="14" y="52" class="value" fill="${t.color}">${escapeXml(formatNumber(t.value))}</text>
      </g>`;
    })
    .join("");

  const footer = `
    <text x="22" y="228" class="small">${escapeXml(m.login)} · ${years}+ yrs on GitHub · updated ${escapeXml(m.updatedAt.slice(0, 10))}</text>
    <text x="22" y="246" class="small">forks ${m.forks} · merged PRs ${m.mergedPrs} · reviews ${m.reviews}</text>
  `;

  return cardShell({
    width: 400,
    height: 260,
    title: "Live Metrics",
    children: tilesSvg + footer,
  });
}

function renderLanguages(m) {
  const maxPct = Math.max(...m.languages.map((l) => l.pct), 1);
  const rows = m.languages
    .map((l, i) => {
      const y = 52 + i * 34;
      const barW = Math.max(8, Math.round((l.pct / maxPct) * 250));
      const color = LANG_COLORS[l.name] || THEME.accent;
      return `
      <g transform="translate(22,${y})">
        <text x="0" y="12" class="label">${escapeXml(l.name)}</text>
        <text x="330" y="12" class="label" text-anchor="end">${l.pct}%</text>
        <rect x="0" y="18" width="330" height="8" rx="4" fill="${THEME.panel}"/>
        <g style="transform-origin: 0px 22px">
          <rect class="barGrow" x="0" y="18" width="${barW}" height="8" rx="4" fill="${color}" style="animation-delay:${i * 0.08}s"/>
        </g>
      </g>`;
    })
    .join("");

  const empty =
    m.languages.length === 0
      ? `<text x="22" y="80" class="label">No language data yet</text>`
      : "";

  return cardShell({
    width: 400,
    height: 260,
    title: "Top Languages",
    children: rows + empty,
  });
}

function renderActivity(m) {
  const items = [
    { label: "Commits this year", value: m.commits },
    { label: "Pull requests", value: m.prs },
    { label: "Issues opened", value: m.issues },
    { label: "Code reviews", value: m.reviews },
    { label: "Total contributions", value: m.contributions },
    { label: "Merged PRs (all time)", value: m.mergedPrs },
  ];

  const rows = items
    .map((item, i) => {
      const y = 52 + i * 30;
      return `
      <text x="22" y="${y}" class="label">${escapeXml(item.label)}</text>
      <text x="378" y="${y}" class="value" style="font-size:16px" text-anchor="end" fill="${THEME.accent}">${escapeXml(formatNumber(item.value))}</text>
      <line x1="22" y1="${y + 10}" x2="378" y2="${y + 10}" stroke="${THEME.border}" stroke-width="1" opacity=".7"/>`;
    })
    .join("");

  return cardShell({
    width: 400,
    height: 260,
    title: "Activity Pulse",
    children: rows,
  });
}

async function main() {
  console.log(`Rendering metrics for @${USERNAME}...`);
  const metrics = await fetchMetrics();
  await mkdir(OUT_DIR, { recursive: true });

  const files = {
    "overview.svg": renderOverview(metrics),
    "languages.svg": renderLanguages(metrics),
    "activity.svg": renderActivity(metrics),
    "metrics.json": JSON.stringify(metrics, null, 2) + "\n",
  };

  for (const [name, content] of Object.entries(files)) {
    const path = join(OUT_DIR, name);
    await writeFile(path, content, "utf8");
    console.log(`  wrote ${path}`);
  }

  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
