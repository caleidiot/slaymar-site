"""One-off import of the 'Awards & Stats Mastersheet' (per-game scorers, MVPs) into data/history-goals.json.
Matches each sheet game to a GameDay fixture in data/archive by order, score and opponent."""
import openpyxl, json, re, glob, sys, datetime
from difflib import SequenceMatcher

wb = openpyxl.load_workbook(sys.argv[1] if len(sys.argv) > 1 else 'imports/mastersheet.xlsx', data_only=True)
TABS = ['~202223 Summer~ Gameweeks + Goa', '~2023 Winter~Gameweeks + Goals', '~202324 Summer~ Gameweeks + Goa', '~2024 Winter~ Gameweeks + Goals']

def norm(s): return re.sub(r'[^a-z]', '', str(s).lower())

def parse_tab(ws):
    rows = [list(r) for r in ws.iter_rows(values_only=True)]
    games = []
    i = 0
    while i < len(rows):
        r = rows[i]
        if any(isinstance(v, str) and re.match(r'^\s*GW\s*\d', v) for v in r):
            # block header row; block continues until next header
            j = i + 1
            while j < len(rows) and not any(isinstance(v, str) and re.match(r'^\s*GW\s*\d', v) for v in rows[j]): j += 1
            block = rows[i:j]
            for c, h in enumerate(r):
                if not (isinstance(h, str) and re.match(r'^\s*GW', h)): continue
                col = [b[c] if c < len(b) else None for b in block]
                g = {'label': h.strip(), 'score': None, 'opp': None, 'scorers': [], 'mvp': None, 'bye': False, 'ff': False}
                after_goals = False
                for v in col[1:]:
                    if v is None or isinstance(v, (datetime.datetime, datetime.date)): continue
                    s = str(v).strip()
                    if not s or s == 'Slaymar': continue
                    if s.upper() in ('BYE',): g['bye'] = True; continue
                    if s.upper() == 'FF' or 'forfeit' in s.lower(): g['ff'] = True; continue
                    m = re.match(r'^(\d+)-(\d+)', s)
                    if m and not after_goals: g['score'] = (int(m[1]), int(m[2])); continue
                    if s.lower().startswith('vs'): g['opp'] = re.sub(r'^vs\.?\s*', '', s, flags=re.I); continue
                    if s == 'Goals': after_goals = True; continue
                    if 'MVP' in s: g['mvp'] = s.replace('MVP', '').strip(); continue
                    if s.lower().startswith('sit') or s.lower() in ('not filmed', 'na', 'no mvp vote') or 'match' in s.lower(): continue
                    if after_goals:
                        m = re.match(r'^(.*?)(?:\s*x\s*(\d+))?\s*$', s)
                        g['scorers'].append((m[1].strip(), int(m[2] or 1)))
                games.append(g)
            i = j
        else:
            i += 1
    return games

# archive fixtures
fx = []
for f in glob.glob('data/archive/*.json'):
    if f.endswith('index.json'): continue
    a = json.load(open(f))
    for g in a['fixtures']:
        if g.get('us') is not None and g.get('them') is not None and not g.get('bye'):
            fx.append({**g, 'season': a['season']['name'], 'comp': a['comp']['id']})
fx.sort(key=lambda g: g['datetime'])
seen = set(); fx = [g for g in fx if not ((g['datetime'], g['opponent']) in seen or seen.add((g['datetime'], g['opponent'])))]

def opp_sim(a, b):
    a, b = norm(a), norm(b)
    if not a or not b: return 0
    if a in b or b in a: return 1
    return SequenceMatcher(None, a, b).ratio()

RANGES = {TABS[0]: ('2022-05-01', '2023-04-15'), TABS[1]: ('2023-04-15', '2023-10-01'),
          TABS[2]: ('2023-10-01', '2024-04-20'), TABS[3]: ('2024-04-20', '2024-10-01')}

def pair_score(g, f):
    total = sum(n for _, n in g['scorers'])
    sc = 0
    if g['score']:
        if g['score'] == (f['us'], f['them']): sc += 6
        elif abs(g['score'][0] - f['us']) <= 1 and abs(g['score'][1] - f['them']) <= 3: sc += 2
        else: sc -= 4
    if total:
        sc += 3 if total == f['us'] else (1 if abs(total - f['us']) == 1 else -3)
    if g['opp']:
        o = opp_sim(g['opp'], f['opponent'])
        sc += 2 if o >= 0.7 else (0 if o >= 0.45 else -0.5)
    return sc

out = {}; report = []
for tab in TABS:
    games = [g for g in parse_tab(wb[tab]) if not g['bye'] and not (g['ff'] and not g['scorers'])]
    lo, hi = RANGES[tab]
    fs = [f for f in fx if lo <= f['date'] < hi]
    n, m = len(games), len(fs)
    SKIP = -1.0
    dp = [[0.0] * (m + 1) for _ in range(n + 1)]; bt = [[None] * (m + 1) for _ in range(n + 1)]
    for i in range(1, n + 1): dp[i][0] = dp[i-1][0] + SKIP; bt[i][0] = 'g'
    for j in range(1, m + 1): dp[0][j] = dp[0][j-1] + SKIP * 0.5; bt[0][j] = 'f'
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            opts = [(dp[i-1][j-1] + pair_score(games[i-1], fs[j-1]), 'm'), (dp[i-1][j] + SKIP, 'g'), (dp[i][j-1] + SKIP * 0.5, 'f')]
            dp[i][j], bt[i][j] = max(opts)
    i, j, pairs = n, m, []
    while i > 0 or j > 0:
        b = bt[i][j]
        if b == 'm': pairs.append((i-1, j-1)); i -= 1; j -= 1
        elif b == 'g': report.append(f"UNMATCHED {tab[:16]} {games[i-1]['label']} opp={games[i-1]['opp']} goals={sum(c for _, c in games[i-1]['scorers'])}"); i -= 1
        else: j -= 1
    for gi, fj in reversed(pairs):
        g, f = games[gi], fs[fj]
        total = sum(c for _, c in g['scorers'])
        flag = ''
        if pair_score(g, f) < 1: flag = '  <-- weak match, skipped'; report.append(f"{tab[:16]:16} {g['label']:<14} -> {f['date']} {f['opponent'][:24]:24} {f['us']}-{f['them']} sheetgoals={total}{flag}"); continue
        if total > f['us'] + 1: flag = '  <-- more sheet goals than GameDay score, scorers skipped'
        elif total != f['us']: flag = '  <-- goal count differs'
        key = f"{f['datetime']}|{f['opponent']}"
        rec = {'mvp': g['mvp'], 'source': 'mastersheet'}
        if total and total <= f['us'] + 1: rec['scorers'] = [{'player': nm, 'min': None} for nm, c in g['scorers'] for _ in range(c)]
        if not total: rec['note'] = 'Scorers not recorded'
        out[key] = rec
        report.append(f"{tab[:16]:16} {g['label']:<14} -> {f['date']} {f['opponent'][:24]:24} {f['us']}-{f['them']} sheetgoals={total}{flag}")
json.dump(out, open('data/history-goals.json', 'w'), indent=1, ensure_ascii=False)
print('\n'.join(report)); print(len(out), 'games imported')
