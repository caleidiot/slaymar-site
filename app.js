(async function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const TZ = "Australia/Adelaide";

  let data;
  try {
    const res = await fetch("data/site.json", { cache: "no-store" });
    data = await res.json();
  } catch (e) {
    $("next-opp").textContent = "Data unavailable";
    return;
  }

  const us = data.team.name;

  // Kit names: map every GameDay spelling to the name in data/players.json.
  let roster = [];
  try { roster = (await (await fetch("data/players.json", { cache: "no-store" })).json()).players || []; } catch (e) {}
  const nkey = (n) => String(n).toLowerCase().replace(/[^a-z]/g, "");
  const kitByGd = new Map();
  roster.forEach((p) => [p.name, ...[].concat(p.gameday || []), ...[].concat(p.aliases || [])].forEach((g) => kitByGd.set(nkey(g), p)));
  const kit = (n) => {
    const k = nkey(n);
    const hit = kitByGd.get(k) || (k.length >= 3 && roster.find((p) => nkey(p.name).startsWith(k) || k.startsWith(nkey(p.name))));
    return hit ? hit.name : n;
  };
  // Historical scorers/MVPs imported from the old stats sheet, keyed "datetime|opponent".
  let histGoals = {}, awards = { seasons: [] };
  try { histGoals = await (await fetch("data/history-goals.json", { cache: "no-store" })).json(); } catch (e) {}
  try { awards = await (await fetch("data/awards.json", { cache: "no-store" })).json(); } catch (e) {}
  const withGoals = (g) => {
    if (g.goals && (g.goals.scorers || []).length) return g;
    const h = histGoals[`${g.datetime}|${g.opponent}`];
    return h ? { ...g, goals: { scorers: h.scorers || [], conceded: [], historic: true, note: h.note }, mvp: h.mvp || g.mvp } : g;
  };
  const isOG = (n) => /own\s*goal/i.test(n || "");
  const BALL = `<img class="ball" src="assets/ball.png" alt="" width="64" height="64">`;
  // Group goals by player: [{name, mins:[..]}], in order of first goal.
  const groupScorers = (list) => {
    const m = new Map();
    list.forEach((g) => { const n = isOG(g.player) ? "Own goal" : g.player ? kit(g.player) : "Unknown"; if (!m.has(n)) m.set(n, []); m.get(n).push(g.min); });
    return [...m].map(([name, mins]) => ({ name, mins }));
  };
  const mins = (arr) => {
    const t = arr.filter((x) => x != null);
    if (t.length) return t.map((x) => `${x}'`).join(" ");
    return arr.length > 1 ? `×${arr.length}` : "";
  };
  const matchCard = (r) => {
    const g = r.goals;
    const ours = g ? groupScorers(g.scorers || []) : [];
    const theirs = g ? (g.conceded || []) : [];
    const missUs = g ? r.us - (g.scorers || []).length : r.us;
    const missThem = g && !g.historic ? r.them - theirs.length : 0;
    const complete = g && missUs === 0 && missThem === 0 && [...g.scorers, ...theirs].every((x) => x.min != null);
    const ht = complete ? `HT ${g.scorers.filter((x) => x.min <= 20).length}–${theirs.filter((x) => x.min <= 20).length}` : "";
    const o = outcome(r);
    return `<div class="mc mc-${o}">` +
      `<div class="mc-top"><span class="mc-team">Slaymar FC</span><span class="mc-score"><b>${r.us}–${r.them}</b>${ht ? `<small>${ht}</small>` : ""}</span><span class="mc-team">${esc(r.opponent)}</span></div>` +
      ((ours.length || theirs.length || missUs > 0 || missThem > 0) ? `<div class="mc-goals">` +
        `<ul class="mc-us">${ours.map((s) => `<li><span class="mc-n">${esc(s.name)}</span><span class="mc-m">${mins(s.mins)}</span></li>`).join("")}${missUs > 0 ? `<li class="mc-miss">${g && g.note && !ours.length ? esc(g.note) : missUs + " not logged"}</li>` : ""}</ul>` +
        `<span class="mc-ball">${BALL}</span>` +
        `<ul class="mc-them">${theirs.map((x) => `<li><span class="mc-m">${x.min != null ? x.min + "'" : ""}</span></li>`).join("")}${missThem > 0 ? `<li class="mc-miss">${missThem} not logged</li>` : ""}</ul>` +
      `</div>` : "") +
      (r.mvp ? `<p class="mc-mvp">MVP <b>${esc(kit(r.mvp))}</b></p>` : "") +
      `<p class="mc-meta">${[r.stage === "Grading" ? "Grading" : r.round ? "Round " + esc(r.round) : "", fmtDate(r.date + "T12:00:00+10:30", { weekday: "short", day: "numeric", month: "short" }), r.venue ? esc(r.venue) : ""].filter(Boolean).join(" &nbsp;/&nbsp; ")}</p>` +
      (r.video ? `<a class="mc-watch" href="https://www.youtube.com/watch?v=${esc(r.video.id)}">Watch the match</a>` : "") +
      `</div>`;
  };
  const outcome = (r) => (r.us > r.them ? "W" : r.us < r.them ? "L" : "D");
  const fmtDate = (d, opts) => new Date(d).toLocaleDateString("en-AU", { timeZone: TZ, ...opts });

  // Videos matched to a result: by the dd/mm/yy date in the title, else first upload within 10 days.
  const videos = (data.videos || []).slice().sort((a, b) => new Date(a.published) - new Date(b.published));
  const titleDate = (t) => {
    const m = String(t).match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if (!m) return null;
    const y = m[3].length === 2 ? "20" + m[3] : m[3];
    return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  };
  const byTitle = new Map();
  videos.forEach((v) => { const d = titleDate(v.title); if (d && !byTitle.has(d)) byTitle.set(d, v); });
  const used = new Set([...byTitle.values()].map((v) => v.id));
  const videoFor = (date) => {
    if (byTitle.has(date)) return byTitle.get(date);
    const start = new Date(date + "T00:00:00+10:30").getTime();
    const v = videos.find((v) => {
      const t = new Date(v.published).getTime();
      return !used.has(v.id) && t >= start && t < start + 10 * 864e5;
    });
    if (v) used.add(v.id);
    return v;
  };
  const results = (data.results || []).slice().sort((a, b) => b.date.localeCompare(a.date));
  results.slice().reverse().forEach((r) => (r.video = videoFor(r.date)));

  // ---- Next game ----
  const next = data.next;
  if (next && new Date(next.datetime) > Date.now() - 2 * 3600e3) {
    $("next-opp").textContent = next.opponent;
    if (next.opponent === "Bye") document.querySelector(".opp").classList.add("bye");
    $("next-when").textContent =
      fmtDate(next.datetime, { weekday: "long", day: "numeric", month: "short" }) + ", " +
      new Date(next.datetime).toLocaleTimeString("en-AU", { timeZone: TZ, hour: "numeric", minute: "2-digit" }) +
      (next.venue ? ", " + next.venue : "") +
      (next.round ? ". Round " + next.round : "");
    const tick = () => {
      const ms = new Date(next.datetime) - Date.now();
      if (ms <= 0) return ($("next-count").textContent = ms > -50 * 60e3 ? "On now" : "");
      const d = Math.floor(ms / 864e5), h = Math.floor((ms % 864e5) / 3600e3), m = Math.floor((ms % 3600e3) / 60e3);
      $("next-count").textContent = d > 0 ? `${d}d ${h}h to kick-off` : `${h}h ${m}m to kick-off`;
    };
    tick();
    setInterval(tick, 30e3);
  } else {
    $("next-opp").textContent = "TBC";
    document.querySelector(".opp").classList.add("tbc");
    $("next-when").textContent = "Next fixture not published yet.";
  }

  // ---- Last result ----
  const last = results[0];
  if (last) {
    const o = outcome(last);
    $("last-score").textContent = `${last.us}–${last.them}`;
    $("last-opp").innerHTML =
      `<span class="result-tag">${{ W: "Won", L: "Lost", D: "Drew" }[o]}</span> vs ${esc(last.opponent)}` +
      (last.video ? `. <a href="https://www.youtube.com/watch?v=${esc(last.video.id)}">Watch it</a>` : "");
    if (last.goals?.scorers?.length) {
      $("last-opp").insertAdjacentHTML("afterend", `<p class="last-scorers">${BALL}<span>${groupScorers(last.goals.scorers).map((s) => esc(s.name) + (s.mins.length > 1 ? " ×" + s.mins.length : "")).join(", ")}</span></p>`);
    }
  }

  // ---- Head to head ----
  const opps = data.opponents || [];
  if (opps.length) {
    const nextKey = next && next.opponent ? next.opponent.toLowerCase().trim() : null;
    const vs = nextKey && opps.find((o) => o.team.toLowerCase().trim() === nextKey);
    const winPct = (o) => Math.round((o.w / o.p) * 100);
    if (vs) {
      $("h2h-sub").textContent = `vs ${vs.team}, all time`;
      $("h2h-rec").innerHTML =
        `<span><b>${vs.p}</b> played</span><span class="w"><b>${vs.w}</b> won</span><span><b>${vs.d}</b> drawn</span><span class="l"><b>${vs.l}</b> lost</span><span><b>${vs.f}–${vs.a}</b> goals</span>`;
      $("h2h-games").innerHTML = vs.games.slice(0, 5).map((g) => {
        const o = outcome(g);
        return `<li class="${o}" title="${esc(g.season || "")}"><span class="s">${g.us}–${g.them}</span><span class="d">${fmtDate(g.date + "T12:00:00+10:30", { month: "short", year: "2-digit" })}</span></li>`;
      }).join("");
    } else if (next && next.opponent && next.opponent !== "Bye") {
      $("h2h-sub").textContent = `vs ${next.opponent}`;
      $("h2h-rec").textContent = "First meeting.";
    } else {
      $("h2h-sub").textContent = "All opponents";
    }
    $("h2h-table").innerHTML = opps.map((o) =>
      `<tr class="${vs && o === vs ? "us" : ""}"><td>${esc(o.team)}</td><td class="num">${o.p}</td><td class="num">${o.w}</td><td class="num">${o.d}</td><td class="num">${o.l}</td><td class="num">${o.f}</td><td class="num">${o.a}</td></tr>`).join("");
    $("h2h-block").hidden = false;
  }

  // ---- Ladder ----
  $("comp-name").innerHTML = `<a href="${esc(data.comp.url)}">${esc(data.comp.name)}</a>`;
  $("ladder-body").innerHTML = (data.ladder || [])
    .map((t) => {
      const cls = [t.team === us ? "us" : "", next && t.team === next.opponent ? "next-opp" : ""].join(" ").trim();
      const gd = t.gd > 0 ? `<span class="gd-pos">+${t.gd}</span>` : t.gd < 0 ? `<span class="gd-neg">${t.gd}</span>` : "0";
      return `<tr class="${cls}"><td class="num">${t.pos}</td><td>${esc(t.team)}</td><td class="num">${t.p}</td><td class="num">${t.w}</td><td class="num">${t.d}</td><td class="num">${t.l}</td><td class="num opt">${t.f}</td><td class="num opt">${t.a}</td><td class="num">${gd}</td><td class="num pts">${t.pts}</td></tr>`;
    })
    .join("");

  // ---- Overview: ladder slice around us + last 3 results ----
  {
    const lad = data.ladder || [];
    const i = Math.max(0, lad.findIndex((t) => t.team === us));
    const from = Math.max(0, Math.min(i - 2, lad.length - 5));
    $("mini-ladder").innerHTML = lad.slice(from, from + 5).map((t) =>
      `<tr class="${t.team === us ? "us" : ""}${next && t.team === next.opponent ? " next-opp" : ""}"><td class="num">${t.pos}</td><td>${esc(t.team)}</td><td class="num">${t.p}</td><td class="num">${t.gd > 0 ? "+" + t.gd : t.gd}</td><td class="num pts">${t.pts}</td></tr>`).join("");
  }

  // ---- Results ----
  const tally = results.reduce((acc, r) => ((acc[outcome(r)] += 1), acc), { W: 0, D: 0, L: 0 });
  $("record").textContent = `Won ${tally.W}, drew ${tally.D}, lost ${tally.L}`;
  const resultRow = (r) => {
    const o = outcome(r);
    return `<li class="r-item"><details><summary>` +
      `<span class="badge ${o}" aria-label="${{ W: "Win", L: "Loss", D: "Draw" }[o]}">${o}</span>` +
      `<span class="r-date">${fmtDate(r.date + "T12:00:00+10:30", { day: "numeric", month: "short" })}${r.stage === "Grading" ? ", Grading" : r.round ? ", Rd " + esc(r.round) : ""}</span>` +
      `<span class="r-opp">vs ${esc(r.opponent)}</span>` +
      `<span class="r-score">${r.us}–${r.them}</span>` +
      `</summary>${matchCard(r)}</details></li>`;
  };
  $("results").innerHTML = results.length ? results.map(resultRow).join("") : `<li class="empty">No results yet this season.</li>`;
  $("recent").innerHTML = results.length ? results.slice(0, 3).map(resultRow).join("") : `<li class="empty">No results yet this season.</li>`;

  // Season goals per player (from the goals sheet)
  const seasonGoals = new Map();
  results.forEach((r) => (r.goals?.scorers || []).forEach((g) => { if (!g.player || /^other$/i.test(g.player)) return; const n = kit(g.player); seasonGoals.set(n, (seasonGoals.get(n) || 0) + 1); }));
  const top = [...seasonGoals].sort((a, b) => b[1] - a[1]);
  if (top.length) {
    document.querySelector('[data-panel="results"] .head').insertAdjacentHTML("afterend",
      `<p class="scorers-line">${BALL}<span>${top.map(([n, c]) => `${esc(n)} <b>${c}</b>`).join(", ")}</span></p>`);
  }

  // ---- Video ----
  const latest = (data.videos || [])[0];
  if (data.channel && data.channel.url) $("channel-link").href = data.channel.url;
  if (latest) {
    $("video").innerHTML =
      `<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/${esc(latest.id)}" title="${esc(latest.title)}" loading="lazy" allow="encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe></div>` +
      `<p class="video-title">${esc(latest.title)}</p>`;
    $("more-videos").innerHTML = data.videos
      .slice(1, 5)
      .map((v) => `<li><a href="https://www.youtube.com/watch?v=${esc(v.id)}"><img src="https://i.ytimg.com/vi/${esc(v.id)}/mqdefault.jpg" alt="" loading="lazy"><span>${esc(v.title)}</span></a></li>`)
      .join("");
  } else {
    $("video").innerHTML = `<p class="empty">No uploads yet. New match videos on the <a href="${esc(data.channel.url)}">Slaymar FC channel</a> show up here automatically.</p>`;
  }

  // ---- Squad: leaderboards, player cards, player detail ----
  {
    const toKit = (n) => kit(n);
    const byName = new Map(roster.map((p) => [p.name, p]));
    const thumb = (n) => { const p = byName.get(n); const f = p && (p.photo || p.image); return f ? `<img src="assets/players/thumbs/${esc(f)}.webp" alt="" width="48" height="48" loading="lazy">` : `<span class="t-init">${esc(n.slice(0, 1))}</span>`; };

    // Season games (GameDay) and goals (sheet)
    const games = new Map();
    (data.squad || []).forEach((p) => { const k = toKit(p.name); games.set(k, (games.get(k) || 0) + p.games); });
    const goalLog = new Map();
    results.forEach((r) => (r.goals?.scorers || []).forEach((g) => {
      if (!g.player || /^other$/i.test(g.player)) return;
      const k = toKit(g.player);
      if (!goalLog.has(k)) goalLog.set(k, []);
      goalLog.get(k).push({ min: g.min, opp: r.opponent, date: r.date });
    }));

    // All-time games and per-season games (archive)
    // bySeason: name -> Map(season -> {games, goals, mvps}); seasonsWithGoals: seasons that have any scorer data
    const career = new Map(), careerGoals = new Map(), careerMvps = new Map(), bySeason = new Map(), seasonsWithGoals = new Set();
    const seasonStart = new Map();
    const bump = (name, season, field, n) => {
      if (!bySeason.has(name)) bySeason.set(name, new Map());
      const m = bySeason.get(name);
      if (!m.has(season)) m.set(season, { games: 0, goals: 0, mvps: 0 });
      m.get(season)[field] += n;
    };
    try {
      const idx = await (await fetch("data/archive/index.json", { cache: "no-store" })).json();
      const files = await Promise.all(idx.map((c) => fetch(`data/archive/${c.id}.json`).then((r) => r.json()).catch(() => null)));
      const seenGame = new Set();
      files.filter(Boolean).forEach((f) => {
        const season = f.season?.name || "Unknown";
        const st = (f.fixtures[0] || {}).date || "";
        if (!seasonStart.has(season) || st < seasonStart.get(season)) seasonStart.set(season, st);
        (f.squad || []).forEach((p) => { const k = toKit(p.name); career.set(k, (career.get(k) || 0) + p.games); bump(k, season, "games", p.games); });
        f.fixtures.forEach((raw) => {
          const g = withGoals(raw), key = g.datetime + "|" + g.opponent;
          if (seenGame.has(key) || g.us == null) return;
          seenGame.add(key);
          (g.goals?.scorers || []).forEach((sc) => {
            if (!sc.player || /^other$/i.test(sc.player) || isOG(sc.player)) return;
            const k = toKit(sc.player); seasonsWithGoals.add(season);
            careerGoals.set(k, (careerGoals.get(k) || 0) + 1); bump(k, season, "goals", 1);
          });
          if (g.mvp) String(g.mvp).split(/\s*&\s*/).forEach((n) => { const k = toKit(n); careerMvps.set(k, (careerMvps.get(k) || 0) + 1); bump(k, season, "mvps", 1); });
        });
      });
    } catch (e) {}
    // Season awards from the old stats sheet (Golden Shoe / most MVPs per season)
    const honours = new Map();
    (awards.seasons || []).forEach((a) => {
      const add = (list, label) => { if (!list || !list.length) return; const top = list[0][1]; list.filter((x) => x[1] === top && top > 0).forEach((x) => { const k = toKit(x[0]); if (!honours.has(k)) honours.set(k, []); honours.get(k).push(`${label}, ${a.season}`); }); };
      add(a.goals, "Golden Shoe"); add(a.mvps, "Most MVPs"); add(a.assists, "Most assists");
    });

    // Leaderboards with shared ranks (1, 2, 3, 3, 5)
    const board = (title, rows, sub, empty) => {
      rows.sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]));
      let rank = 0, prev = null;
      const lis = rows.slice(0, 10).map(([n, v], i) => {
        if (v !== prev) { rank = i + 1; prev = v; }
        return `<li><button type="button" data-player="${esc(n)}"><span class="b-rank">${rank}</span>${thumb(n)}<span class="b-name">${esc(n)}<small>${sub(n)}</small></span><span class="b-val">${v}</span></button></li>`;
      }).join("");
      return `<div class="lb"><h3>${title}</h3>${rows.length ? `<ol>${lis}</ol>` : `<p class="lb-empty">${empty}</p>`}</div>`;
    };
    const goalsRows = [...goalLog].map(([n, l]) => [n, l.length]);
    const gamesTxt = (n) => { const g = games.get(n) || 0; return `${g} ${g === 1 ? "game" : "games"} this season`; };
    $("boards").innerHTML =
      board("Goals", goalsRows, gamesTxt, "No goals logged yet this season.") +
      board("Goals, all-time", [...careerGoals].filter(([n]) => byName.has(n) || careerGoals.get(n) > 5), (n) => `${career.get(n) || 0} games`, "No goals logged yet.") +
      board("Games, all-time", [...career].filter(([n]) => byName.has(n) || career.get(n) > 5), (n) => (byName.get(n)?.current ? "Current" : "Former"), "No games yet.");
    $("squad-sub").textContent = data.season ? `${data.season}` : "";

    // Cards
    const card = (p) => {
      const g = games.get(p.name), gl = (goalLog.get(p.name) || []).length, c = career.get(p.name);
      const line = p.current
        ? (g ? `<b>${g}</b> ${g === 1 ? "game" : "games"}${gl ? `, <b>${gl}</b> ${gl === 1 ? "goal" : "goals"}` : ""}` : "No games yet")
        : (c ? `<b>${c}</b> games${careerGoals.get(p.name) ? `, <b>${careerGoals.get(p.name)}</b> goals` : ""}` : "Former");
      return `<li class="card${p.current ? "" : " former"}"><button type="button" data-player="${esc(p.name)}">` +
        (p.image ? `<img src="assets/players/${esc(p.image)}.webp" alt="${esc(p.name)}" width="427" height="440" loading="lazy">`
          : p.photo ? `<span class="c-photo"><img src="assets/players/photos/${esc(p.photo)}.webp" alt="" loading="lazy"><span>${esc(p.name)}</span></span>`
          : `<span class="c-name">${esc(p.name)}</span>`) +
        `<span class="c-games">${line}</span></button></li>`;
    };
    const cur = roster.filter((p) => p.current);
    const old = roster.filter((p) => !p.current).sort((x, y) => (career.get(y.name) || 0) - (career.get(x.name) || 0));
    const others = [...games].filter(([k]) => !byName.has(k));
    $("squad").innerHTML =
      (cur.length ? `<ul class="cards">${cur.map(card).join("")}</ul>` : "") +
      (others.length ? `<h3 class="sq-h">Fill-ins this season</h3><ul class="squad">${others.sort((x, y) => y[1] - x[1]).map(([n, g]) => `<li><span>${esc(n)}</span><span class="g">${g}</span></li>`).join("")}</ul>` : "") +
      (old.length ? `<h3 class="sq-h">Former players</h3><ul class="cards small">${old.map(card).join("")}</ul>` : "");

    // Player detail
    const dlg = $("pdlg");
    const openPlayer = (name) => {
      const p = byName.get(name) || { name, current: false };
      const g = games.get(name) || 0, log = goalLog.get(name) || [], c = career.get(name) || 0;
      const seasons = [...(bySeason.get(name) || new Map())].sort((a, b) => (seasonStart.get(b[0]) || "").localeCompare(seasonStart.get(a[0]) || ""));
      const cg = careerGoals.get(name) || 0;
      const cm = (awards.seasons || []).reduce((t, a) => t + ((a.mvps || []).filter((x) => toKit(x[0]) === name).reduce((u, x) => u + x[1], 0)), 0);
      const stat = (v, l) => `<div class="p-stat"><b>${v}</b><span>${l}</span></div>`;
      const num = p.number != null ? `<span class="p-num">${p.number}</span>` : "";
      const hon = honours.get(name) || [];
      $("pdlg-body").innerHTML =
        `<div class="p-hero">${p.photo ? `<img class="p-photo" src="assets/players/photos/${esc(p.photo)}.webp" alt="">` : p.image ? `<img src="assets/players/${esc(p.image)}.webp" alt="" width="427" height="440">` : `<span class="c-name">${esc(name)}</span>`}` +
        `<div><h2 id="pdlg-name">${num}${esc(name)}</h2><p class="p-status">${p.current ? "Current squad" : "Former player"}</p>` +
        (p.current ? `<h3>This season</h3><div class="p-stats">${stat(g, g === 1 ? "game" : "games")}${stat(log.length, log.length === 1 ? "goal" : "goals")}${stat(g ? (log.length / g).toFixed(1) : "0.0", "per game")}</div>` : "") +
        `<h3>All-time</h3><div class="p-stats">${stat(c, "games")}${stat(cg, "goals")}${cm ? stat(cm, cm === 1 ? "MVP" : "MVPs") : ""}</div></div></div>` +
        (hon.length ? `<ul class="p-honours">${hon.map((h) => `<li>${esc(h)}</li>`).join("")}</ul>` : "") +
        (log.length ? `<h3>Goals this season</h3><ul class="p-goals">${(() => {
          const byGame = new Map();
          log.forEach((x) => { const k = x.date + "|" + x.opp; if (!byGame.has(k)) byGame.set(k, { ...x, mins: [] }); byGame.get(k).mins.push(x.min); });
          return [...byGame.values()].map((gm) =>
            `<li><span class="p-opp">vs ${esc(gm.opp)}<small>${fmtDate(gm.date + "T12:00:00+10:30", { day: "numeric", month: "short" })}</small></span>` +
            `<span class="p-mins">${mins(gm.mins)}</span>` +
            `<span class="p-count">${BALL}<b>${gm.mins.length}</b></span></li>`).join("");
        })()}</ul>` : "") +
        (seasons.length ? `<h3>Season by season</h3><table class="p-table"><thead><tr><th>Season</th><th class="num">Games</th><th class="num">Goals</th></tr></thead><tbody>` +
          seasons.map(([sn, v]) => { const has = seasonsWithGoals.has(sn); return `<tr><td>${esc(sn)}</td><td class="num">${v.games}</td><td class="num">${has ? v.goals : "–"}</td></tr>`; }).join("") +
          `</tbody></table><p class="p-foot">– means goals weren't tracked that season.</p>` : "");
      if (dlg.showModal) dlg.showModal(); else dlg.setAttribute("open", "");
    };
    document.querySelector('[data-panel="squad"]').addEventListener("click", (e) => {
      const b = e.target.closest("[data-player]");
      if (b) openPlayer(b.dataset.player);
    });
    dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
  }

  // ---- Match cards: opening one closes the others ----
  document.addEventListener("toggle", (e) => {
    const d = e.target;
    if (!(d instanceof HTMLDetailsElement) || !d.open || !d.parentElement?.classList.contains("r-item")) return;
    const sum = d.querySelector("summary");
    const before = sum.getBoundingClientRect().top;
    document.querySelectorAll(".r-item > details[open]").forEach((o) => { if (o !== d) o.open = false; });
    // Keep the tapped row where it was if a card above it just collapsed.
    const after = sum.getBoundingClientRect().top;
    if (Math.abs(after - before) > 2) window.scrollBy({ top: after - before, behavior: "instant" });
  }, true);

  // ---- Tabs ----
  const tabs = ["overview", "ladder", "results", "history", "squad"];
  const show = () => {
    const t = tabs.includes(location.hash.slice(1)) ? location.hash.slice(1) : "overview";
    document.querySelectorAll(".panel").forEach((p) => (p.hidden = p.dataset.panel !== t));
    document.querySelectorAll(".tabs a").forEach((a) => a.toggleAttribute("aria-current", a.dataset.tab === t));
    const nav = document.querySelector(".tabs");
    if (nav.getBoundingClientRect().top < 0) window.scrollTo({ top: nav.offsetTop, behavior: "instant" });
  };
  window.addEventListener("hashchange", show);
  show();

  // ---- Footer ----
  $("updated").textContent = "Checked " + new Date(data.updated).toLocaleString("en-AU", { timeZone: TZ, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  $("source-link").href = data.comp.url;

  // ---- History: one entry per season; grading comps fold into their season ----
  try {
    const res = await fetch("data/archive/index.json", { cache: "no-store" });
    const all = await res.json();
    const isGrading = (c) => /grading/i.test(c.name);
    const bySeason = new Map();
    for (const c of all) {
      if (c.seasonId === data.seasonId || c.season === data.season) continue;
      if (!bySeason.has(c.seasonId)) bySeason.set(c.seasonId, []);
      bySeason.get(c.seasonId).push(c);
    }
    const seasons = [...bySeason.values()].map((comps) => {
      const main = comps.find((c) => !isGrading(c)) || comps[0];
      const rec = comps.reduce((r, c) => ({ w: r.w + c.record.w, d: r.d + c.record.d, l: r.l + c.record.l, f: r.f + c.record.f, a: r.a + c.record.a }), { w: 0, d: 0, l: 0, f: 0, a: 0 });
      const start = comps.map((c) => c.start || "").sort()[0];
      return { comps, main, rec, start, season: main.season };
    }).sort((a, b) => b.start.localeCompare(a.start));
    const ord = (n) => n + (["th", "st", "nd", "rd"][((n % 100) - 20) % 10] || ["th", "st", "nd", "rd"][n % 100] || "th");
    const gradeName = (name) => name.replace(/^(Unley\/Immanuel|Unley|Immanuel)\s*[-–]?\s*/i, "").replace(/\s*[-–]\s*/g, " ").trim();

    $("history").innerHTML = seasons.length
      ? `<ul class="history">` + seasons.map((s, i) => {
          const m = s.main, r = s.rec;
          return `<li><details data-i="${i}"><summary>` +
            `<span class="h-season">${esc(s.season)}</span>` +
            `<span class="h-comp">${esc(gradeName(m.name))}</span>` +
            `<span class="h-pos">${m.position ? ord(m.position) + " of " + m.teams : ""}</span>` +
            `<span class="h-rec">W${r.w} D${r.d} L${r.l}, ${r.f}–${r.a}</span>` +
            `</summary><div class="h-body">Loading…</div></details></li>`;
        }).join("") + `</ul>`
      : `<p class="empty">Past seasons are saved here automatically when each season finishes.</p>`;

    document.querySelectorAll(".history details").forEach((d) =>
      d.addEventListener("toggle", async () => {
        if (!d.open || d.dataset.loaded) return;
        d.dataset.loaded = "1";
        const s = seasons[+d.dataset.i];
        const body = d.querySelector(".h-body");
        try {
          const files = await Promise.all(s.comps.map((c) => fetch(`data/archive/${c.id}.json`).then((r) => r.json())));
          const main = files.find((f) => f.comp.id === s.main.id);
          const games = files
            .flatMap((f) => f.fixtures.filter((g) => g.us !== null && g.them !== null).map(withGoals)
              .map((g) => ({ ...g, label: isGrading(f.comp) && f !== main ? "Grading" : (/regular/i.test(g.stage || "") ? "" : g.stage) })))
            .sort((a, b) => a.datetime.localeCompare(b.datetime));
          const squad = new Map();
          files.forEach((f) => (f.squad || []).forEach((p) => { const k = kit(p.name); squad.set(k, (squad.get(k) || 0) + p.games); }));
          const sg = new Map();
          games.forEach((g) => (g.goals?.scorers || []).forEach((sc) => { if (!sc.player || isOG(sc.player) || /^other$/i.test(sc.player)) return; const k = kit(sc.player); sg.set(k, (sg.get(k) || 0) + 1); }));
          body.innerHTML =
            `<div class="table-scroll"><table class="ladder"><thead><tr><th class="num">#</th><th>Team</th><th class="num">P</th><th class="num">W</th><th class="num">D</th><th class="num">L</th><th class="num">GD</th><th class="num pts">Pts</th></tr></thead><tbody>` +
            main.ladder.map((t) => `<tr class="${t.team === us ? "us" : ""}"><td class="num">${t.pos}</td><td>${esc(t.team)}</td><td class="num">${t.p}</td><td class="num">${t.w}</td><td class="num">${t.d}</td><td class="num">${t.l}</td><td class="num">${t.gd > 0 ? "+" + t.gd : t.gd}</td><td class="num pts">${t.pts}</td></tr>`).join("") +
            `</tbody></table></div><ol class="results">` +
            games.slice().reverse().map((g) => resultRow({ ...g, stage: g.label === "Grading" ? "Grading" : g.stage, round: g.label && g.label !== "Grading" ? g.label : g.round, video: videoFor(g.date) })).join("") + `</ol>` +
            (sg.size ? `<p class="scorers-line">${BALL}<span>${[...sg].sort((a, b) => b[1] - a[1]).map(([n, c]) => `${esc(n)} <b>${c}</b>`).join(", ")}</span></p>` : "") +
            (squad.size ? `<p class="h-squad">Games played: ${[...squad].sort((a, b) => b[1] - a[1]).map(([n, g]) => esc(n) + " " + g).join(", ")}</p>` : "");
        } catch (e) {
          body.textContent = "Couldn't load this season. Try again later.";
          delete d.dataset.loaded;
        }
      })
    );
  } catch (e) {
    $("history").innerHTML = `<p class="empty">History will appear here after the next data update.</p>`;
  }
})();
