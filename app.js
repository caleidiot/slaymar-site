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
    $("next-when").textContent =
      fmtDate(next.datetime, { weekday: "long", day: "numeric", month: "short" }) + ", " +
      new Date(next.datetime).toLocaleTimeString("en-AU", { timeZone: TZ, hour: "numeric", minute: "2-digit" }) +
      (next.venue ? ", " + next.venue : "");
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

  // ---- Ladder ----
  $("comp-name").innerHTML = `<a href="${esc(data.comp.url)}">${esc(data.comp.name)}</a>`;
  $("ladder-body").innerHTML = (data.ladder || [])
    .map((t) => {
      const cls = [t.team === us ? "us" : "", next && t.team === next.opponent ? "next-opp" : ""].join(" ").trim();
      const gd = t.gd > 0 ? `<span class="gd-pos">+${t.gd}</span>` : t.gd < 0 ? `<span class="gd-neg">${t.gd}</span>` : "0";
      return `<tr class="${cls}"><td class="num">${t.pos}</td><td>${esc(t.team)}</td><td class="num">${t.p}</td><td class="num">${t.w}</td><td class="num">${t.d}</td><td class="num">${t.l}</td><td class="num opt">${t.f}</td><td class="num opt">${t.a}</td><td class="num">${gd}</td><td class="num pts">${t.pts}</td></tr>`;
    })
    .join("");

  // ---- Results ----
  const tally = results.reduce((acc, r) => ((acc[outcome(r)] += 1), acc), { W: 0, D: 0, L: 0 });
  $("record").textContent = `Won ${tally.W}, drew ${tally.D}, lost ${tally.L}`;
  $("results").innerHTML = results.length
    ? results
        .map((r) => {
          const o = outcome(r);
          return `<li><span class="badge ${o}" aria-label="${{ W: "Win", L: "Loss", D: "Draw" }[o]}">${o}</span>` +
            `<span class="r-date">${fmtDate(r.date + "T12:00:00+10:30", { day: "numeric", month: "short" })}</span>` +
            `<span class="r-opp">vs ${esc(r.opponent)}</span>` +
            `<span class="r-score">${r.us}–${r.them}</span>` +
            (r.video ? `<a class="r-watch" href="https://www.youtube.com/watch?v=${esc(r.video.id)}">Watch the match</a>` : "") +
            `</li>`;
        })
        .join("")
    : `<li class="empty">No results yet this season.</li>`;

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

  // ---- Footer ----
  $("updated").textContent = "Updated " + new Date(data.updated).toLocaleString("en-AU", { timeZone: TZ, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  $("source-link").href = data.comp.url;
})();
