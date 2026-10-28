// Pulls Slaymar FC data from GameDay + YouTube and writes data/site.json.
// Usage: node scripts/scrape.mjs [--fixtures dir] [--out file]
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import * as cheerio from "cheerio";

const CONFIG = JSON.parse(await readFile(new URL("../config.json", import.meta.url), "utf8"));
const BASE = "https://websites.mygameday.app/";
const TZ = "Australia/Adelaide";

const args = process.argv.slice(2);
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const FIXTURES = opt("--fixtures");
const OUT = opt("--out") || new URL("../data/site.json", import.meta.url).pathname;

// ---------- fetching ----------
async function get(url) {
  if (FIXTURES) {
    const map = [
      [/youtube\.com/, null],
      [/a=COMPS/, "comps.html"],
      [/a=LADDER/, "ladder.html"],
      [/a=SFIX/, "team_sfix.html"],
      [/team_info\.cgi\?id=/, "team.html"],
    ];
    const hit = map.find(([re]) => re.test(url));
    if (!hit || !hit[1]) throw new Error("no fixture for " + url);
    return readFile(path.join(FIXTURES, hit[1]), "utf8");
  }
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; slaymar-site/1.0; +https://github.com/caleidiot/slaymar-site)" } });
      if (!res.ok) throw new Error(`${res.status} ${url}`);
      return await res.text();
    } catch (e) {
      if (attempt >= 3) throw e;
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
}
const abs = (href) => new URL(href.replace(/&amp;/g, "&"), BASE).href;
const clean = (s) => s.replace(/ /g, " ").replace(/\s+/g, " ").trim();
const int = (s) => (/^-?\d+$/.test(clean(s)) ? parseInt(clean(s), 10) : null);

// Adelaide wall-clock -> ISO string with the correct +09:30/+10:30 offset.
function adelaideISO(y, mo, d, h = 12, mi = 0) {
  const guess = new Date(Date.UTC(y, mo - 1, d, h, mi));
  const off = new Intl.DateTimeFormat("en-AU", { timeZone: TZ, timeZoneName: "longOffset" })
    .formatToParts(guess).find((p) => p.type === "timeZoneName").value.replace("GMT", "") || "+00:00";
  const p2 = (n) => String(n).padStart(2, "0");
  return `${y}-${p2(mo)}-${p2(d)}T${p2(h)}:${p2(mi)}:00${off}`;
}

// ---------- parsers ----------
function parseComps(html) {
  const $ = cheerio.load(html);
  const comps = new Map();
  $('a[href*="comp_info.cgi"][href*="compID="]').each((_, a) => {
    const id = ($(a).attr("href").match(/compID=(\d+)/) || [])[1];
    const name = clean($(a).closest("tr").find("td").first().text());
    if (id && name && !comps.has(id)) comps.set(id, name);
  });
  return [...comps].map(([id, name]) => ({ id, name }));
}

function parseLadder(html) {
  const $ = cheerio.load(html);
  const rows = [];
  $("table tr").each((_, tr) => {
    const td = $(tr).find("td");
    const link = $(tr).find("td.ladder-team-col a");
    if (!link.length || td.length < 12) return;
    const n = (i) => int($(td[i]).text()) ?? 0;
    rows.push({
      pos: n(0), team: clean(link.text()), href: abs(link.attr("href")),
      p: n(2), w: n(3), b: n(4), d: n(5), l: n(6), f: n(8), a: n(9), gd: n(10), pts: n(11),
    });
  });
  // The team home page repeats the ladder; keep the first copy only.
  const seen = new Set();
  return rows.filter((r) => !seen.has(r.team) && seen.add(r.team));
}

function parseTeamPage(html) {
  const $ = cheerio.load(html);
  const sfix = $('a[href*="a=SFIX"]').first().attr("href");
  const comp = clean($('.teamhome-text:contains("Competition:") strong').first().text()) ||
    clean((html.match(/Competition:\s*<strong>([^<]+)<\/strong>/) || [])[1] || "");
  const squad = [];
  $("#teamhome-roster-content table tr").each((_, tr) => {
    const td = $(tr).find("td");
    if (td.length < 3) return;
    squad.push({ name: clean($(td[0]).text()), games: int($(td[2]).text()) ?? 0, last: clean($(td[3]).text()) || null });
  });
  return { sfixUrl: sfix ? abs(sfix) : null, comp, squad };
}

function parseSeasonFixture(html) {
  const $ = cheerio.load(html);
  const games = [];
  $("table tr").each((_, tr) => {
    const td = $(tr).find("td");
    if (td.length < 8) return;
    const [rnd, date, time, venue, us, , opp, them] = td.toArray().map((c) => clean($(c).text()));
    const dm = date.match(/(\d{2})\/(\d{2})\/(\d{2})/);
    if (!dm) return;
    const [hh, mm] = (time.match(/(\d{1,2}):(\d{2})/) || [null, 12, 0]).slice(1).map(Number);
    const y = 2000 + +dm[3], mo = +dm[2], d = +dm[1];
    const isBye = /\bbye\b/i.test(opp) || (!opp && !venue);
    games.push({
      round: int(rnd) ?? rnd,
      date: `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
      datetime: adelaideISO(y, mo, d, hh, mm),
      venue: venue || null,
      opponent: isBye ? null : opp,
      bye: isBye,
      us: int(us),
      them: int(them),
    });
  });
  return games;
}

function parseYouTube(xml) {
  const $ = cheerio.load(xml, { xmlMode: true });
  return $("entry").toArray().map((e) => ({
    id: $(e).find("yt\\:videoId").text(),
    title: $(e).find("title").first().text(),
    published: $(e).find("published").text(),
  })).filter((v) => v.id);
}

// ---------- main ----------
let previous = {};
try { previous = JSON.parse(await readFile(OUT, "utf8")); } catch {}

const prevComp = previous.comp?.id || CONFIG.fallbackCompId;
const compsHtml = await get(`${BASE}assoc_page.cgi?c=${CONFIG.assocPrefix}-0-${prevComp}-0&a=COMPS`);
const candidates = parseComps(compsHtml).filter((c) => c.name.toLowerCase().includes(CONFIG.compFilter.toLowerCase()));
if (!candidates.length) throw new Error("No competitions matched filter: " + CONFIG.compFilter);

// Find every candidate comp that has our team, then pick the one with the latest game.
const found = [];
for (const c of candidates) {
  const ladderUrl = `${BASE}comp_info.cgi?c=${CONFIG.assocPrefix}-0-${c.id}-0&pool=1&a=LADDER`;
  let ladder;
  try { ladder = parseLadder(await get(ladderUrl)); } catch (e) { console.warn("skip", c.name, e.message); continue; }
  const ours = ladder.find((r) => r.team.toLowerCase() === CONFIG.teamName.toLowerCase());
  if (!ours) continue;
  const team = parseTeamPage(await get(ours.href));
  const games = team.sfixUrl ? parseSeasonFixture(await get(team.sfixUrl)) : [];
  const latest = games.reduce((m, g) => (g.datetime > m ? g.datetime : m), "");
  found.push({ comp: c, ladderUrl, ladder, ours, team, games, latest });
  console.log(`found ${CONFIG.teamName} in "${c.name}" (${c.id}), ${games.length} games, latest ${latest || "none"}`);
}
if (!found.length) throw new Error(`${CONFIG.teamName} not found in any matching competition`);
found.sort((a, b) => b.latest.localeCompare(a.latest) || Number(b.comp.id) - Number(a.comp.id));
const cur = found[0];

const now = Date.now();
const played = cur.games.filter((g) => !g.bye && g.us !== null && g.them !== null);
const next = cur.games.find((g) => g.us === null && new Date(g.datetime).getTime() > now - 3 * 3600e3) || null;

let videos = previous.videos || [];
try {
  videos = parseYouTube(await get(`https://www.youtube.com/feeds/videos.xml?channel_id=${CONFIG.youtubeChannelId}`));
} catch (e) {
  console.warn("YouTube feed unavailable, keeping previous videos:", e.message);
}

const out = {
  updated: new Date().toISOString(),
  team: { name: CONFIG.teamName, id: (cur.ours.href.match(/id=(\d+)/) || [])[1] || null },
  comp: { id: cur.comp.id, name: cur.comp.name, url: cur.ladderUrl },
  next: next && { datetime: next.datetime, opponent: next.bye ? "Bye" : next.opponent, venue: next.venue, round: next.round },
  fixtures: cur.games,
  results: played.map((g) => ({ date: g.date, round: g.round, opponent: g.opponent, us: g.us, them: g.them, venue: g.venue })),
  ladder: cur.ladder.map(({ href, ...r }) => r),
  squad: cur.team.squad,
  channel: { id: CONFIG.youtubeChannelId, url: CONFIG.youtubeUrl },
  videos,
};
if (!out.ladder.length) throw new Error("Ladder parsed empty; refusing to overwrite data");
await writeFile(OUT, JSON.stringify(out, null, 2) + "\n");
console.log(`wrote ${OUT}: ${out.results.length} results, next ${out.next ? out.next.opponent + " " + out.next.datetime : "none"}, ${videos.length} videos`);
