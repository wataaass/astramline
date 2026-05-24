const STATIONS = ["本通", "県庁前", "城北", "新白島", "白島", "牛田", "不動院前", "祇園新橋北", "西原", "中筋", "古市", "大町", "毘沙門台", "安東", "上安", "高取", "長楽寺", "伴", "大原", "伴中央", "大塚", "広域公園前"];
const KILOPOSTS = { "本通": 0.0, "県庁前": 0.3, "城北": 1.4, "新白島": 1.7, "白島": 2.1, "牛田": 2.9, "不動院前": 4.0, "祇園新橋北": 5.0, "西原": 6.0, "中筋": 7.0, "古市": 7.8, "大町": 8.4, "毘沙門台": 9.6, "安東": 10.6, "上安": 11.4, "高取": 12.0, "長楽寺": 12.7, "伴": 13.9, "大原": 14.9, "伴中央": 16.0, "大塚": 17.6, "広域公園前": 18.4 };
const FARE_BRACKETS = [[2, 220, 110], [4, 260, 130], [6, 300, 150], [9, 350, 180], [12, 400, 200], [15, 430, 220], [18, 460, 230], [19, 490, 250]];
const DIRECTION_HONDORI = "本通方面";
const DIRECTION_KOIKI = "広域公園前方面";
const SERVICE_WEEKDAY = "weekday";
const SERVICE_HOLIDAY = "holiday";
const MODE_ROUTE = "route";
const MODE_STATION = "station";

let trips = [];
let holidays = {};
let deferredInstallPrompt = null;
const $ = (id) => document.getElementById(id);

function stationIndex(s) {
  return STATIONS.indexOf(s);
}

function getDirection(f, t) {
  if (f === t) return null;
  return stationIndex(t) < stationIndex(f) ? DIRECTION_HONDORI : DIRECTION_KOIKI;
}

function distanceKm(f, t) {
  return Math.round(Math.abs(KILOPOSTS[t] - KILOPOSTS[f]) * 10) / 10;
}

function fareFor(f, t) {
  if (f === t) return { adult: 0, child: 0, km: 0 };
  const km = distanceKm(f, t);
  const b = FARE_BRACKETS.find((x) => km <= x[0]);
  return { adult: b[1], child: b[2], km };
}

function parseHHMM(v) {
  const s = String(v ?? "").trim().replace("：", ":");
  if (!s) return null;
  let h, m;
  if (s.includes(":")) {
    const p = s.split(":");
    h = Number(p[0]);
    m = Number(p[1]);
  } else {
    const d = s.replace(/\D/g, "");
    if (d.length <= 2) return null;
    h = Number(d.slice(0, -2));
    m = Number(d.slice(-2));
  }
  if (!Number.isInteger(h) || !Number.isInteger(m) || m < 0 || m > 59 || h < 0 || h > 29) return null;
  return h * 60 + m;
}

function formatHHMM(min) {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

function todayKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function serviceType(d) {
  const day = d.getDay();
  return day === 0 || day === 6 || holidays[todayKey(d)] ? SERVICE_HOLIDAY : SERVICE_WEEKDAY;
}

function serviceLabel(d) {
  if (serviceType(d) === SERVICE_WEEKDAY) return "平日ダイヤ";
  const name = holidays[todayKey(d)];
  return name ? `土曜・休日ダイヤ（${name}）` : "土曜・休日ダイヤ";
}

function nowMinutes(now) {
  return now.getHours() * 60 + now.getMinutes();
}

function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem("astramSettings") || "{}");
  } catch {
    return {};
  }
}

function saveSettingsObject(s) {
  localStorage.setItem("astramSettings", JSON.stringify(s));
}

function getSearchMode() {
  const s = loadSettings();
  return s.searchMode === MODE_STATION ? MODE_STATION : MODE_ROUTE;
}

function saveSettings() {
  const s = loadSettings();
  s.from = $("fromStation").value;
  s.to = $("toStation").value;
  s.searchMode = getSearchMode();
  saveSettingsObject(s);
}

function setSearchMode(mode) {
  const s = loadSettings();
  s.searchMode = mode;
  saveSettingsObject(s);
  syncModeUI();
  render();
}

function syncModeUI() {
  const stationMode = getSearchMode() === MODE_STATION;
  document.body.classList.toggle("station-mode", stationMode);
  $("fromStationLabel").textContent = "出発駅";
  $("modeRoute").classList.toggle("active", !stationMode);
  $("modeStation").classList.toggle("active", stationMode);
  $("modeRoute").setAttribute("aria-selected", String(!stationMode));
  $("modeStation").setAttribute("aria-selected", String(stationMode));
}

function setupStations() {
  for (const st of STATIONS) {
    $("fromStation").append(new Option(st, st));
    $("toStation").append(new Option(st, st));
  }
  const s = loadSettings();
  $("fromStation").value = s.from || "不動院前";
  $("toStation").value = s.to || "本通";
  syncModeUI();
}

async function loadHolidays() {
  try {
    const r = await fetch("https://holidays-jp.github.io/api/v1/date.json", { cache: "force-cache" });
    holidays = await r.json();
    localStorage.setItem("jpHolidays", JSON.stringify(holidays));
  } catch {
    try {
      holidays = JSON.parse(localStorage.getItem("jpHolidays") || "{}");
    } catch {
      holidays = {};
    }
  }
}

function parseCSV(text) {
  const rows = [];
  let row = [],
    cell = "",
    q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i],
      nx = text[i + 1];
    if (ch === '"' && q && nx === '"') {
      cell += '"';
      i++;
    } else if (ch === '"') {
      q = !q;
    } else if (ch === "," && !q) {
      row.push(cell);
      cell = "";
    } else if ((ch === "\n" || ch === "\r") && !q) {
      if (ch === "\r" && nx === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((v) => v.trim() !== "")) rows.push(row);
      row = [];
    } else {
      cell += ch;
    }
  }
  row.push(cell);
  if (row.some((v) => v.trim() !== "")) rows.push(row);
  return rows;
}

async function loadTrips() {
  try {
    const r = await fetch("./astram_trips.csv", { cache: "no-store" });
    const text = await r.text();
    const rows = parseCSV(text);
    if (rows.length <= 1) {
      trips = [];
      return;
    }
    const headers = rows[0].map((h) => h.trim().replace(/^\uFEFF/, ""));
    trips = rows
      .slice(1)
      .map((cols, idx) => {
        const o = {};
        headers.forEach((h, i) => (o[h] = cols[i] ?? ""));
        const times = {};
        for (const st of STATIONS) {
          const t = parseHHMM(o[st]);
          if (t !== null) times[st] = t;
        }
        return {
          tripId: o.trip_id || `row${idx + 2}`,
          service: o.service,
          direction: o.direction,
          destination: o.destination,
          times,
        };
      })
      .filter(
        (t) =>
          [SERVICE_WEEKDAY, SERVICE_HOLIDAY].includes(t.service) &&
          [DIRECTION_HONDORI, DIRECTION_KOIKI].includes(t.direction)
      );
  } catch (e) {
    console.warn(e);
    trips = [];
  }
}

function findNextTrains(f, t, now, count = 3) {
  const dir = getDirection(f, t);
  const svc = serviceType(now);
  const nowMin = nowMinutes(now);
  return trips
    .filter((x) => x.service === svc && x.direction === dir && x.times[f] != null && x.times[t] != null)
    .map((x) => ({ trip: x, depart: x.times[f], arrive: x.times[t] }))
    .filter((x) => x.arrive >= x.depart && x.depart >= nowMin)
    .sort((a, b) => a.depart - b.depart)
    .slice(0, count);
}

function findNextTrainsAtStation(station, now, count = 3) {
  const svc = serviceType(now);
  const nowMin = nowMinutes(now);
  return trips
    .filter((x) => x.service === svc && x.times[station] != null)
    .map((x) => ({ trip: x, depart: x.times[station] }))
    .filter((x) => x.depart >= nowMin)
    .sort((a, b) => a.depart - b.depart)
    .slice(0, count);
}

function favoriteLabel(fav) {
  const f = normalizeFavorite(fav);
  if (f.type === MODE_STATION) return `${f.station}（出発駅のみ）`;
  return `${f.from} → ${f.to}`;
}

function normalizeFavorite(fav) {
  if (fav.type === MODE_STATION) return fav;
  if (fav.type === MODE_ROUTE) return fav;
  if (fav.station && !fav.from && !fav.to) return { type: MODE_STATION, station: fav.station };
  return { type: MODE_ROUTE, from: fav.from, to: fav.to };
}

function applyFavorite(fav) {
  const f = normalizeFavorite(fav);
  if (f.type === MODE_STATION) {
    $("fromStation").value = f.station;
    setSearchMode(MODE_STATION);
    return;
  }
  $("fromStation").value = f.from;
  $("toStation").value = f.to;
  setSearchMode(MODE_ROUTE);
}

function renderFavorites() {
  const s = loadSettings();
  const favs = (s.favorites || []).map(normalizeFavorite);
  const list = $("favorites");
  if (!favs.length) {
    list.innerHTML = '<li class="favorite-empty muted">まだ登録されていません。</li>';
    return;
  }
  list.innerHTML = favs
    .map(
      (fav, i) => `
<li class="favorite-item">
<button type="button" class="favorite-chip" data-index="${i}">${favoriteLabel(fav)}</button>
<div class="favorite-actions">
<button type="button" class="favorite-move" data-index="${i}" data-dir="up" aria-label="上へ">↑</button>
<button type="button" class="favorite-move" data-index="${i}" data-dir="down" aria-label="下へ">↓</button>
<button type="button" class="favorite-delete" data-index="${i}" aria-label="削除">×</button>
</div>
</li>`
    )
    .join("");

  list.querySelectorAll(".favorite-chip").forEach((btn) => {
    btn.addEventListener("click", () => applyFavorite(favs[Number(btn.dataset.index)]));
  });
  list.querySelectorAll(".favorite-delete").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteFavorite(Number(btn.dataset.index));
    });
  });
  list.querySelectorAll(".favorite-move").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      moveFavorite(Number(btn.dataset.index), btn.dataset.dir === "up" ? -1 : 1);
    });
  });
}

function deleteFavorite(index) {
  const s = loadSettings();
  const favs = s.favorites || [];
  if (index < 0 || index >= favs.length) return;
  favs.splice(index, 1);
  s.favorites = favs;
  saveSettingsObject(s);
  renderFavorites();
}

function moveFavorite(index, delta) {
  const s = loadSettings();
  const favs = s.favorites || [];
  const next = index + delta;
  if (index < 0 || index >= favs.length || next < 0 || next >= favs.length) return;
  const tmp = favs[index];
  favs[index] = favs[next];
  favs[next] = tmp;
  s.favorites = favs;
  saveSettingsObject(s);
  renderFavorites();
}

function addFavorite() {
  const s = loadSettings();
  s.favorites = s.favorites || [];
  const stationMode = getSearchMode() === MODE_STATION;
  const fav = stationMode
    ? { type: MODE_STATION, station: $("fromStation").value }
    : { type: MODE_ROUTE, from: $("fromStation").value, to: $("toStation").value };
  const key = stationMode
    ? (x) => normalizeFavorite(x).type === MODE_STATION && normalizeFavorite(x).station === fav.station
    : (x) => {
        const n = normalizeFavorite(x);
        return n.type === MODE_ROUTE && n.from === fav.from && n.to === fav.to;
      };
  if (!s.favorites.some(key)) s.favorites.push(fav);
  saveSettingsObject(s);
  renderFavorites();
}

function renderNoTrips(message, detail = "") {
  $("mainTrain").textContent = message;
  $("subInfo").textContent = detail;
  $("nextList").innerHTML = "";
}

function renderRoute(now) {
  const f = $("fromStation").value;
  const t = $("toStation").value;
  const fare = fareFor(f, t);
  $("fareText").textContent = `運賃: 大人 ${fare.adult}円 / 小児・割引 ${fare.child}円（${fare.km.toFixed(1)}km）`;

  if (f === t) {
    $("directionText").textContent = "同じ駅";
    renderNoTrips("出発駅と到着駅が同じです");
    return;
  }

  const dir = getDirection(f, t);
  $("directionText").textContent = dir;
  const next = findNextTrains(f, t, now, 3);

  if (trips.length === 0) {
    renderNoTrips("時刻表CSVにデータがありません");
    return;
  }
  if (next.length === 0) {
    renderNoTrips("この条件の列車が見つかりません", "終電後、またはCSVにこの区間のデータがない可能性があります。");
    return;
  }

  const nowMin = nowMinutes(now);
  const first = next[0];
  const until = first.depart - nowMin;
  $("mainTrain").textContent = `${formatHHMM(first.depart)} 発 → ${formatHHMM(first.arrive)} 着`;
  $("subInfo").textContent = `あと${until}分 / 所要${first.arrive - first.depart}分 / 行先 ${first.trip.destination}`;
  $("nextList").innerHTML = next
    .map(
      (x, i) => `<div class="next-item"><strong>${i === 0 ? "次" : `${i + 1}本目`}: ${formatHHMM(x.depart)} → ${formatHHMM(x.arrive)}</strong><br><span class="muted">所要${x.arrive - x.depart}分 / ${x.trip.destination}</span></div>`
    )
    .join("");
}

function renderStation(now) {
  const station = $("fromStation").value;
  $("directionText").textContent = `${station}駅`;
  const next = findNextTrainsAtStation(station, now, 3);

  if (trips.length === 0) {
    renderNoTrips("時刻表CSVにデータがありません");
    return;
  }
  if (next.length === 0) {
    renderNoTrips("この駅の列車が見つかりません", "終電後、またはCSVにこの駅のデータがない可能性があります。");
    return;
  }

  const nowMin = nowMinutes(now);
  const first = next[0];
  const until = first.depart - nowMin;
  $("mainTrain").textContent = `${formatHHMM(first.depart)} 発`;
  $("subInfo").textContent = `あと${until}分 / ${first.trip.direction} / 行先 ${first.trip.destination}`;
  $("nextList").innerHTML = next
    .map(
      (x, i) =>
        `<div class="next-item"><strong>${i === 0 ? "次" : `${i + 1}本目`}: ${formatHHMM(x.depart)} 発</strong><br><span class="muted">${x.trip.direction} / 行先 ${x.trip.destination}</span></div>`
    )
    .join("");
}

function render() {
  const now = new Date();
  $("clock").textContent = now.toLocaleString("ja-JP", { hour12: false });
  saveSettings();
  $("serviceBadge").textContent = serviceLabel(now);

  if (getSearchMode() === MODE_STATION) {
    renderStation(now);
  } else {
    renderRoute(now);
  }
}

async function init() {
  setupStations();
  await loadHolidays();
  await loadTrips();
  renderFavorites();
  render();

  $("fromStation").addEventListener("change", render);
  $("toStation").addEventListener("change", render);
  $("modeRoute").addEventListener("click", () => setSearchMode(MODE_ROUTE));
  $("modeStation").addEventListener("click", () => setSearchMode(MODE_STATION));
  $("swapButton").addEventListener("click", () => {
    const a = $("fromStation").value;
    $("fromStation").value = $("toStation").value;
    $("toStation").value = a;
    render();
  });
  $("favoriteButton").addEventListener("click", addFavorite);
  $("reloadButton").addEventListener("click", async () => {
    await loadTrips();
    render();
  });
  setInterval(render, 30000);
}

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  $("installButton").classList.remove("hidden");
});
$("installButton").addEventListener("click", async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  $("installButton").classList.add("hidden");
});
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./service-worker.js"));
}
init();
