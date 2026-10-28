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
  const outcome = (r) => (r.us > r.them ? "W" : r.us < r.them ? "L" : "D");
  const fmtDate = (d, opts) => new Date(d).toLocaleDateString("en-AU", { timeZone: TZ, ...opts });

  // Videos matched to a result: first upload from game day up to 10 days after.
  const videos = (data.videos || []).slice().sort((a, b) => new Date(a.published) - new Date(b.published));
  const used = new Set();
  const videoFor = (date) => {
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
  $("results").innerHTML = results.length
    ? results
        .map((r) => {
          const o = outcome(r);
          return `<li><span class="badge ${o}" aria-label="${{ W: "Win", L: "Loss", D: "Draw" }[o]}">${o}</span>` +
            `<span class="r-date">${fmtDate(r.date + "T12:00:00+10:30", { day: "numeric", month: "short" })}${r.stage === "Grading" ? ", Grading" : r.round ? ", Rd " + esc(r.round) : ""}</span>` +
            `<span class="r-opp">vs ${esc(r.opponent)}</span>` +
            `<span class="r-score">${r.us}–${r.them}</span>` +
            (r.video ? `<a class="r-watch" href="https://www.youtube.com/watch?v=${esc(r.video.id)}">Watch the match</a>` : "") +
            `</li>`;
        })
        .join("")
    : `<li class="empty">No results yet this season.</li>`;

  $("recent").innerHTML = $("results").innerHTML.split("</li>").slice(0, 3).join("</li>") + (results.length ? "</li>" : "");

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

  // ---- Squad ----
  $("squad").innerHTML = (data.squad || [])
    .slice()
    .sort((a, b) => b.games - a.games || a.name.localeCompare(b.name))
    .map((p) => `<li><span>${esc(p.name)}</span><span class="g">${p.games}</span></li>`)
    .join("");

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
            .flatMap((f) => f.fixtures.filter((g) => g.us !== null && g.them !== null)
              .map((g) => ({ ...g, label: isGrading(f.comp) && f !== main ? "Grading" : (/regular/i.test(g.stage || "") ? "" : g.stage) })))
            .sort((a, b) => a.datetime.localeCompare(b.datetime));
          const squad = new Map();
          files.forEach((f) => (f.squad || []).forEach((p) => squad.set(p.name, (squad.get(p.name) || 0) + p.games)));
          body.innerHTML =
            `<div class="table-scroll"><table class="ladder"><thead><tr><th class="num">#</th><th>Team</th><th class="num">P</th><th class="num">W</th><th class="num">D</th><th class="num">L</th><th class="num">GD</th><th class="num pts">Pts</th></tr></thead><tbody>` +
            main.ladder.map((t) => `<tr class="${t.team === us ? "us" : ""}"><td class="num">${t.pos}</td><td>${esc(t.team)}</td><td class="num">${t.p}</td><td class="num">${t.w}</td><td class="num">${t.d}</td><td class="num">${t.l}</td><td class="num">${t.gd > 0 ? "+" + t.gd : t.gd}</td><td class="num pts">${t.pts}</td></tr>`).join("") +
            `</tbody></table></div><ol class="results">` +
            games.map((g) => {
              const o = outcome(g);
              return `<li><span class="badge ${o}">${o}</span><span class="r-date">${fmtDate(g.date + "T12:00:00+10:30", { day: "numeric", month: "short" })}${g.label ? ", " + esc(g.label) : ""}</span><span class="r-opp">vs ${esc(g.opponent)}</span><span class="r-score">${g.us}–${g.them}</span></li>`;
            }).join("") + `</ol>` +
            (squad.size ? `<p class="h-squad">Squad: ${[...squad].sort((a, b) => b[1] - a[1]).map(([n, g]) => esc(n) + " (" + g + ")").join(", ")}</p>` : "");
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
