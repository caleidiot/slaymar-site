// Pulls Slaymar FC data from GameDay + YouTube and writes data/site.json.
// Usage: node scripts/scrape.mjs [--fixtures dir] [--out file]
import { readFile, writeFile, mkdir } from "node:fs/promises";
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
  let stage = "Regular Season";
  $("table tr").each((_, tr) => {
    const td = $(tr).find("td");
    const msg = $(tr).find("td.message-row");
    if (msg.length) { stage = clean(msg.text()) || stage; return; }
    if (td.length < 8) return;
    const [rnd, date, time, venue, us, , opp, them] = td.toArray().map((c) => clean($(c).text()));
    const dm = date.match(/(\d{2})\/(\d{2})\/(\d{2})/);
    if (!dm) return;
    const [hh, mm] = (time.match(/(\d{1,2}):(\d{2})/) || [null, 12, 0]).slice(1).map(Number);
    const y = 2000 + +dm[3], mo = +dm[2], d = +dm[1];
    const isBye = /\bbye\b/i.test(opp) || (!opp && !venue);
    games.push({
      round: int(rnd) ?? rnd,
      stage,
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

function parseSeasons(html) {
  const $ = cheerio.load(html);
  return $("#id_seasonID option").toArray().map((o) => ({
    id: ($(o).attr("value").match(/seasonID=(\d+)/) || [])[1],
    name: clean($(o).text()),
    selected: $(o).is("[selected]"),
  })).filter((s) => s.id);
}

// Goals sheet: row 1 holds each game's score as a pair of numeric cells (us, them);
// the cells below each pair list scorers like "Dougie 19'". Games run left to right in date order.
function parseCsv(text) {
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
function parseGoalsSheet(text) {
  const rows = parseCsv(text);
  const head = (rows[0] || []).map((c) => c.trim());
  const isNum = (c) => /^\d+$/.test(c || "");
  const blocks = [];
  for (let c = 0; c < head.length - 1; c++) if (isNum(head[c]) && isNum(head[c + 1])) { blocks.push(c); c++; }
  const cell = (raw) => {
    const s = clean(raw || "");
    if (!s) return null;
    const m = s.match(/^(.*?)\s*(\d{1,2})\s*['"’′`]*$/);
    return m ? { name: m[1].trim() || null, min: +m[2] } : { name: s, min: null };
  };
  return blocks.map((c) => {
    const us = [], them = [];
    for (const r of rows.slice(1)) { const a = cell(r[c]); if (a) us.push(a); const b = cell(r[c + 1]); if (b) them.push(b); }
    const byMin = (x, y) => (x.min ?? 99) - (y.min ?? 99);
    return { us: +head[c], them: +head[c + 1], scorers: us.sort(byMin).map((g) => ({ player: g.name, min: g.min })), conceded: them.sort(byMin).map((g) => ({ min: g.min })) };
  });
}

// ---------- main ----------
const BACKFILL = args.includes("--backfill");
const DATA_DIR = path.dirname(OUT);
const ARCHIVE_DIR = path.join(DATA_DIR, "archive");
await mkdir(ARCHIVE_DIR, { recursive: true });
const sleep = (ms) => (FIXTURES ? null : new Promise((r) => setTimeout(r, ms)));
const readJSON = async (f, fallback) => { try { return JSON.parse(await readFile(f, "utf8")); } catch { return fallback; } };

let previous = await readJSON(OUT, {});
const prevComp = previous.comp?.id || CONFIG.fallbackCompId;
const client = (compId) => `${CONFIG.assocPrefix}-0-${compId}-0`;

// Look through one season's comp list and return every comp Slaymar is in, fully scraped.
async function scanSeason(compsHtml, filter) {
  const comps = parseComps(compsHtml).filter(filter);
  const found = [];
  for (const c of comps) {
    let ladderUrl = `${BASE}comp_info.cgi?c=${client(c.id)}&pool=1&a=LADDER`;
    let ladder = [];
    try {
      ladder = parseLadder(await get(ladderUrl));
      if (!ladder.length) { ladderUrl = `${BASE}comp_info.cgi?c=${client(c.id)}&a=LADDER`; ladder = parseLadder(await get(ladderUrl)); }
    } catch (e) { console.warn("skip", c.name, e.message); continue; }
    await sleep(250);
    const ours = ladder.find((r) => r.team.toLowerCase() === CONFIG.teamName.toLowerCase());
    if (!ours) continue;
    const team = parseTeamPage(await get(ours.href));
    const games = team.sfixUrl ? parseSeasonFixture(await get(team.sfixUrl)) : [];
    const latest = games.reduce((m, g) => (g.datetime > m ? g.datetime : m), "");
    found.push({ comp: c, ladderUrl, ladder, ours, team, games, latest });
    console.log(`found ${CONFIG.teamName} in "${c.name}" (${c.id}), ${games.length} games`);
  }
  return found;
}

const played = (games) => games.filter((g) => !g.bye && g.us !== null && g.them !== null);
const record = (games) => played(games).reduce((r, g) => {
  r[g.us > g.them ? "w" : g.us < g.them ? "l" : "d"]++; r.f += g.us; r.a += g.them; return r;
}, { w: 0, d: 0, l: 0, f: 0, a: 0 });

// Archive: one file per competition, never deleted; index lists them all.
async function archive(entry, season) {
  const file = path.join(ARCHIVE_DIR, `${entry.comp.id}.json`);
  const data = {
    comp: { id: entry.comp.id, name: entry.comp.name, url: entry.ladderUrl },
    season,
    position: entry.ours.pos,
    teams: entry.ladder.length,
    record: record(entry.games),
    ladder: entry.ladder.map(({ href, ...r }) => r),
    fixtures: entry.games,
    squad: entry.team.squad,
    archived: new Date().toISOString(),
  };
  await writeFile(file, JSON.stringify(data, null, 2) + "\n");
  const index = await readJSON(path.join(ARCHIVE_DIR, "index.json"), []);
  const summary = {
    id: data.comp.id, name: data.comp.name, season: season.name, seasonId: season.id,
    position: data.position, teams: data.teams, record: data.record,
    start: entry.games[0]?.date || null, end: entry.games.at(-1)?.date || null,
  };
  const i = index.findIndex((x) => x.id === summary.id);
  if (i >= 0) index[i] = summary; else index.push(summary);
  index.sort((a, b) => (b.start || "").localeCompare(a.start || ""));
  await writeFile(path.join(ARCHIVE_DIR, "index.json"), JSON.stringify(index, null, 2) + "\n");
}

const compsUrl = (seasonId) => `${BASE}assoc_page.cgi?c=${client(prevComp)}&a=COMPS${seasonId ? "&seasonID=" + seasonId : ""}`;
const currentHtml = await get(compsUrl());
const seasons = parseSeasons(currentHtml);
const currentSeason = seasons.find((s) => s.selected) || { id: null, name: "Current season" };

if (BACKFILL) {
  // One-off: search every past season, every senior comp, for Slaymar.
  const notJunior = (c) => !/junior|youth|under \d+/i.test(c.name);
  for (const s of seasons.filter((s) => !s.selected)) {
    let html;
    try { html = await get(compsUrl(s.id)); } catch (e) { console.warn("season skip", s.name, e.message); continue; }
    const found = await scanSeason(html, notJunior);
    for (const f of found) await archive(f, { id: s.id, name: s.name });
    console.log(`${s.name}: ${found.length} comp(s)`);
  }
}

const filter = (c) => c.name.toLowerCase().includes(CONFIG.compFilter.toLowerCase());
const found = await scanSeason(currentHtml, filter);
if (!found.length) throw new Error(`${CONFIG.teamName} not found in any matching competition`);

// Attach goal scorers from the season's Google Sheet to this season's games.
{
  const seen = new Set();
  const seasonGames = found.flatMap((f) => played(f.games)).sort((a, b) => a.datetime.localeCompare(b.datetime))
    .filter((g) => { const k = g.datetime + g.opponent; return !seen.has(k) && seen.add(k); });
  // Fall back to goals already saved in the archive if the sheet can't be read.
  const saved = new Map();
  for (const f of found) {
    const a = await readJSON(path.join(ARCHIVE_DIR, `${f.comp.id}.json`), null);
    (a?.fixtures || []).forEach((g) => g.goals && saved.set(g.datetime, g.goals));
  }
  let sheet = null;
  if (CONFIG.goalsSheetCsv) {
    try { sheet = parseGoalsSheet(FIXTURES ? await readFile(path.join(FIXTURES, "goals.csv"), "utf8") : await get(CONFIG.goalsSheetCsv)); }
    catch (e) { console.warn("Goals sheet unavailable, keeping saved goals:", e.message); }
  }
  let gi = 0;
  for (const block of sheet || []) {
    // Match each sheet game to the next season game with the same score.
    while (gi < seasonGames.length && !(seasonGames[gi].us === block.us && seasonGames[gi].them === block.them)) gi++;
    if (gi >= seasonGames.length) { console.warn(`Sheet game ${block.us}-${block.them} has no matching result`); break; }
    seasonGames[gi].goals = { scorers: block.scorers, conceded: block.conceded };
    gi++;
  }
  for (const g of seasonGames) if (!g.goals && saved.has(g.datetime)) g.goals = saved.get(g.datetime);
  console.log(`goals attached to ${seasonGames.filter((g) => g.goals).length}/${seasonGames.length} games`);
}

for (const f of found) await archive(f, { id: currentSeason.id, name: currentSeason.name });
found.sort((a, b) => b.latest.localeCompare(a.latest) || Number(b.comp.id) - Number(a.comp.id));
const cur = found[0];

const now = Date.now();
const next = cur.games.find((g) => g.us === null && new Date(g.datetime).getTime() > now - 3 * 3600e3) || null;

let videos = previous.videos || [];
try {
  videos = parseYouTube(await get(`https://www.youtube.com/feeds/videos.xml?channel_id=${CONFIG.youtubeChannelId}`));
} catch (e) {
  console.warn("YouTube feed unavailable, keeping previous videos:", e.message);
}

// Head-to-head across every archived comp (current season included, since it's archived each run).
const h2h = new Map();
const norm = (n) => n.toLowerCase().replace(/\s+/g, " ").trim();
const archiveFiles = (await readJSON(path.join(ARCHIVE_DIR, "index.json"), [])).map((c) => c.id);
const seen = new Set();
for (const id of archiveFiles) {
  const a = await readJSON(path.join(ARCHIVE_DIR, `${id}.json`), null);
  if (!a) continue;
  for (const g of played(a.fixtures)) {
    if (!g.opponent) continue;
    const key = norm(g.opponent);
    if (seen.has(g.date + key)) continue;
    seen.add(g.date + key);
    if (!h2h.has(key)) h2h.set(key, { team: g.opponent.trim(), p: 0, w: 0, d: 0, l: 0, f: 0, a: 0, games: [] });
    const o = h2h.get(key);
    o.p++; o[g.us > g.them ? "w" : g.us < g.them ? "l" : "d"]++; o.f += g.us; o.a += g.them;
    o.games.push({ date: g.date, us: g.us, them: g.them, season: a.season?.name || null });
  }
}
for (const o of h2h.values()) o.games.sort((x, y) => y.date.localeCompare(x.date));
const opponents = [...h2h.values()].sort((x, y) => y.p - x.p || x.team.localeCompare(y.team));

const out = {
  updated: new Date().toISOString(),
  team: { name: CONFIG.teamName, id: (cur.ours.href.match(/id=(\d+)/) || [])[1] || null },
  season: currentSeason.name,
  seasonId: currentSeason.id,
  comp: { id: cur.comp.id, name: cur.comp.name, url: cur.ladderUrl },
  next: next && { datetime: next.datetime, opponent: next.bye ? "Bye" : next.opponent, venue: next.venue, round: next.round },
  fixtures: cur.games,
  // Grading is just the start of the season: fold every comp from this season into one results list.
  results: found
    .flatMap((f) => played(f.games).map((g) => ({ ...g, stage: /grading/i.test(f.comp.name) && f !== cur ? "Grading" : g.stage })))
    .sort((a, b) => a.datetime.localeCompare(b.datetime))
    .filter((g, i, arr) => {
      const same = arr.filter((x) => x.datetime === g.datetime && x.opponent === g.opponent);
      return (same.find((x) => x.goals) || same[0]) === g;
    })
    .map((g) => ({ date: g.date, round: g.round, stage: g.stage, opponent: g.opponent, us: g.us, them: g.them, venue: g.venue, goals: g.goals || null })),
  ladder: cur.ladder.map(({ href, ...r }) => r),
  squad: cur.team.squad,
  opponents,
  channel: { id: CONFIG.youtubeChannelId, url: CONFIG.youtubeUrl },
  videos,
};
if (!out.ladder.length) throw new Error("Ladder parsed empty; refusing to overwrite data");

// Calendar feed: every fixture this season, so people can subscribe once and stay updated.
{
  const z = (t) => new Date(t).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const esc = (t) => String(t).replace(/[,;\\]/g, (m) => "\\" + m);
  const where = (v) => esc((v ? v + ", " : "") + (/immanuel/i.test(v || "") ? "Immanuel College, Novar Gardens SA" : "Unley High School, Kitchener St, Netherby SA"));
  const events = cur.games.filter((g) => !g.bye && g.opponent).map((g) => {
    const start = new Date(g.datetime).getTime();
    const score = g.us != null && g.them != null ? ` (${g.us}-${g.them})` : "";
    return ["BEGIN:VEVENT", `UID:${z(start)}-${(g.opponent || "").replace(/[^A-Za-z0-9]/g, "")}@slaymar.com`, `DTSTAMP:${z(Date.now())}`,
      `DTSTART:${z(start)}`, `DTEND:${z(start + 40 * 60e3)}`, `SUMMARY:${esc("Slaymar FC vs " + g.opponent + score)}`,
      `LOCATION:${where(g.venue)}`, "DESCRIPTION:https://slaymar.com",
      ...(g.us == null ? ["BEGIN:VALARM", "TRIGGER:-PT2H", "ACTION:DISPLAY", `DESCRIPTION:${esc("Slaymar FC vs " + g.opponent)}`, "END:VALARM"] : []),
      "END:VEVENT"].join("\r\n");
  });
  const cal = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//slaymar.com//fixtures//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "X-WR-CALNAME:Slaymar FC", "X-WR-TIMEZONE:Australia/Adelaide", "REFRESH-INTERVAL;VALUE=DURATION:PT6H", "X-PUBLISHED-TTL:PT6H",
    ...events, "END:VCALENDAR"].join("\r\n") + "\r\n";
  await writeFile(path.join(DATA_DIR, "fixtures.ics"), cal);
}
await writeFile(OUT, JSON.stringify(out, null, 2) + "\n");
console.log(`wrote ${OUT}: ${out.results.length} results, next ${out.next ? out.next.opponent + " " + out.next.datetime : "none"}, ${videos.length} videos`);
