const STATIONS = [
  "本通", "県庁前", "城北", "新白島", "白島", "牛田", "不動院前", "祇園新橋北",
  "西原", "中筋", "古市", "大町", "毘沙門台", "安東", "上安", "高取",
  "長楽寺", "伴", "大原", "伴中央", "大塚", "広域公園前"
];

const KILOPOSTS = {
  "本通": 0.0,
  "県庁前": 0.3,
  "城北": 1.4,
  "新白島": 1.7,
  "白島": 2.1,
  "牛田": 2.9,
  "不動院前": 4.0,
  "祇園新橋北": 5.0,
  "西原": 6.0,
  "中筋": 7.0,
  "古市": 7.8,
  "大町": 8.4,
  "毘沙門台": 9.6,
  "安東": 10.6,
  "上安": 11.4,
  "高取": 12.0,
  "長楽寺": 12.7,
  "伴": 13.9,
  "大原": 14.9,
  "伴中央": 16.0,
  "大塚": 17.6,
  "広域公園前": 18.4
};

const FARE_BRACKETS = [
  [2, 220, 110],
  [4, 260, 130],
  [6, 300, 150],
  [9, 350, 180],
  [12, 400, 200],
  [15, 430, 220],
  [18, 460, 230],
  [19, 490, 250]
];

const DIRECTION_HONDORI = "本通方面";
const DIRECTION_KOIKI = "広域公園前方面";
const SERVICE_WEEKDAY = "weekday";
const SERVICE_HOLIDAY = "holiday";

let trips = [];
let holidays = {};
let deferredInstallPrompt = null;

const $ = id => document.getElementById(id);

function stationIndex(station) {
  return STATIONS.indexOf(station);
}

function getDirection(from, to) {
  if (from === to) return null;
  return stationIndex(to) < stationIndex(from)
    ? DIRECTION_HONDORI
    : DIRECTION_KOIKI;
}

function distanceKm(from, to) {
  return Math.round(Math.abs(KILOPOSTS[to] - KILOPOSTS[from]) * 10) / 10;
}

function fareFor(from, to) {
  if (from === to) {
    return {
      adult: 0,
      child: 0,
      km: 0
    };
  }

  const km = distanceKm(from, to);
  const bracket = FARE_BRACKETS.find(item => km <= item[0]);

  if (!bracket) {
    return {
      adult: "--",
      child: "--",
      km
    };
  }

  return {
    adult: bracket[1],
    child: bracket[2],
    km
  };
}

function parseHHMM(value) {
  const s = String(value ?? "").trim().replace("：", ":");

  if (!s) return null;

  let hour;
  let minute;

  if (s.includes(":")) {
    const parts = s.split(":");
    hour = Number(parts[0]);
    minute = Number(parts[1]);
  } else {
    const digits = s.replace(/\D/g, "");

    if (digits.length <= 2) return null;

    hour = Number(digits.slice(0, -2));
    minute = Number(digits.slice(-2));
  }

  if (
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    minute < 0 ||
    minute > 59 ||
    hour < 0 ||
    hour > 29
  ) {
    return null;
  }

  return hour * 60 + minute;
}

function formatHHMM(minutes) {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;

  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function todayKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function serviceType(date) {
  const day = date.getDay();

  if (day === 0 || day === 6 || holidays[todayKey(date)]) {
    return SERVICE_HOLIDAY;
  }

  return SERVICE_WEEKDAY;
}

function serviceLabel(date) {
  if (serviceType(date) === SERVICE_WEEKDAY) {
    return "平日ダイヤ";
  }

  const name = holidays[todayKey(date)];

  return name
    ? `土曜・休日ダイヤ（${name}）`
    : "土曜・休日ダイヤ";
}

function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem("astramSettings") || "{}");
  } catch {
    return {};
  }
}

function saveSettings() {
  const fromStation = $("fromStation");
  const toStation = $("toStation");

  if (!fromStation || !toStation) return;

  const settings = loadSettings();

  settings.from = fromStation.value;
  settings.to = toStation.value;

  localStorage.setItem("astramSettings", JSON.stringify(settings));
}

function setupStations() {
  const fromStation = $("fromStation");
  const toStation = $("toStation");

  if (!fromStation || !toStation) return;

  fromStation.innerHTML = "";
  toStation.innerHTML = "";

  for (const station of STATIONS) {
    fromStation.append(new Option(station, station));
    toStation.append(new Option(station, station));
  }

  const settings = loadSettings();

  fromStation.value = settings.from || "不動院前";
  toStation.value = settings.to || "本通";
}

async function loadHolidays() {
  try {
    const response = await fetch("https://holidays-jp.github.io/api/v1/date.json", {
      cache: "force-cache"
    });

    holidays = await response.json();

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

  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (ch === '"' && inQuotes && next === '"') {
      cell += '"';
      i++;
    } else if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      row.push(cell);
      cell = "";
    } else if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (ch === "\r" && next === "\n") i++;

      row.push(cell);
      cell = "";

      if (row.some(value => value.trim() !== "")) {
        rows.push(row);
      }

      row = [];
    } else {
      cell += ch;
    }
  }

  row.push(cell);

  if (row.some(value => value.trim() !== "")) {
    rows.push(row);
  }

  return rows;
}

async function loadTrips() {
  try {
    const response = await fetch("./astram_trips.csv", {
      cache: "no-store"
    });

    const text = await response.text();
    const rows = parseCSV(text);

    if (rows.length <= 1) {
      trips = [];
      return;
    }

    const headers = rows[0].map(header =>
      header.trim().replace(/^\uFEFF/, "")
    );

    trips = rows
      .slice(1)
      .map((cols, index) => {
        const row = {};

        headers.forEach((header, i) => {
          row[header] = cols[i] ?? "";
        });

        const times = {};

        for (const station of STATIONS) {
          const time = parseHHMM(row[station]);

          if (time !== null) {
            times[station] = time;
          }
        }

        return {
          tripId: row.trip_id || `row${index + 2}`,
          service: row.service,
          direction: row.direction,
          destination: row.destination,
          times
        };
      })
      .filter(trip =>
        [SERVICE_WEEKDAY, SERVICE_HOLIDAY].includes(trip.service) &&
        [DIRECTION_HONDORI, DIRECTION_KOIKI].includes(trip.direction)
      );
  } catch (error) {
    console.warn(error);
    trips = [];
  }
}

function getSearchDateTime() {
  const now = new Date();
  const timeInput = $("searchTime");

  if (!timeInput || !timeInput.value) {
    return now;
  }

  const [hour, minute] = timeInput.value.split(":").map(Number);

  const searchDate = new Date();
  searchDate.setHours(hour);
  searchDate.setMinutes(minute);
  searchDate.setSeconds(0);
  searchDate.setMilliseconds(0);

  return searchDate;
}

function isUsingCustomTime() {
  const timeInput = $("searchTime");
  return Boolean(timeInput && timeInput.value);
}

function findNextTrains(from, to, now, count = 3) {
  const direction = getDirection(from, to);
  const service = serviceType(now);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  return trips
    .filter(trip =>
      trip.service === service &&
      trip.direction === direction &&
      trip.times[from] != null &&
      trip.times[to] != null
    )
    .map(trip => ({
      trip,
      depart: trip.times[from],
      arrive: trip.times[to]
    }))
    .filter(item =>
      item.arrive >= item.depart &&
      item.depart >= nowMinutes
    )
    .sort((a, b) => a.depart - b.depart)
    .slice(0, count);
}

function render() {
  const now = getSearchDateTime();
  const realNow = new Date();

  if ($("clock")) {
    $("clock").textContent = realNow.toLocaleString("ja-JP", {
      hour12: false
    });
  }

  const fromStation = $("fromStation");
  const toStation = $("toStation");

  if (!fromStation || !toStation) return;

  const from = fromStation.value;
  const to = toStation.value;

  saveSettings();

  const fare = fareFor(from, to);

  if ($("fareText")) {
    $("fareText").textContent =
      `運賃: 大人 ${fare.adult}円 / 小児・割引 ${fare.child}円`;
  }

  if ($("serviceBadge")) {
    $("serviceBadge").textContent = serviceLabel(now);
  }

  if ($("dataStatus")) {
    $("dataStatus").textContent =
      `収録列車: ${trips.length}本（平日/休日・上り/下り 完全収録）`;
  }

  if (from === to) {
    if ($("directionText")) $("directionText").textContent = "同じ駅";
    if ($("mainTrain")) $("mainTrain").textContent = "出発駅と到着駅が同じです";
    if ($("subInfo")) $("subInfo").textContent = "";
    if ($("nextList")) $("nextList").innerHTML = "";
    return;
  }

  const direction = getDirection(from, to);

  if ($("directionText")) {
    $("directionText").textContent = direction;
  }

  const next = findNextTrains(from, to, now, 3);

  if (trips.length === 0) {
    if ($("mainTrain")) $("mainTrain").textContent = "時刻表CSVにデータがありません";
    if ($("subInfo")) $("subInfo").textContent = "";
    if ($("nextList")) $("nextList").innerHTML = "";
    return;
  }

  if (next.length === 0) {
    if ($("mainTrain")) $("mainTrain").textContent = "この条件の列車が見つかりません";
    if ($("subInfo")) {
      $("subInfo").textContent =
        "終電後、またはCSVにこの区間のデータがない可能性があります。";
    }
    if ($("nextList")) $("nextList").innerHTML = "";
    return;
  }

  const first = next[0];
  const baseMinutes = now.getHours() * 60 + now.getMinutes();
  const until = first.depart - baseMinutes;

  if ($("mainTrain")) {
    $("mainTrain").textContent =
      `${formatHHMM(first.depart)} 発 → ${formatHHMM(first.arrive)} 着`;
  }

  if ($("subInfo")) {
    if (isUsingCustomTime()) {
      $("subInfo").textContent =
        `指定時刻以降 / 所要${first.arrive - first.depart}分 / 行先 ${first.trip.destination}`;
    } else {
      $("subInfo").textContent =
        `あと${until}分 / 所要${first.arrive - first.depart}分 / 行先 ${first.trip.destination}`;
    }
  }

  if ($("nextList")) {
    $("nextList").innerHTML = next
      .map((item, index) => {
        const label = index === 0 ? "次" : `${index + 1}本目`;

        return `
          <div class="next-item">
            <strong>${label}: ${formatHHMM(item.depart)} → ${formatHHMM(item.arrive)}</strong><br>
            <span class="muted">所要${item.arrive - item.depart}分 / 行先 ${item.trip.destination}</span>
          </div>
        `;
      })
      .join("");
  }
}

function renderFavorites() {
  const favoritesArea = $("favorites");
  if (!favoritesArea) return;

  const settings = loadSettings();
  const favorites = settings.favorites || [];

  favoritesArea.innerHTML = favorites.length
    ? favorites
        .map((favorite, index) => {
          return `
            <button class="favorite-chip" data-index="${index}">
              ${favorite.from} → ${favorite.to}
            </button>
          `;
        })
        .join("")
    : '<p class="muted">まだ登録されていません。</p>';

  document.querySelectorAll(".favorite-chip").forEach(button => {
    button.addEventListener("click", () => {
      const favorite = favorites[Number(button.dataset.index)];

      $("fromStation").value = favorite.from;
      $("toStation").value = favorite.to;

      render();
    });
  });
}

function addFavorite() {
  const fromStation = $("fromStation");
  const toStation = $("toStation");

  if (!fromStation || !toStation) return;

  const settings = loadSettings();

  settings.favorites = settings.favorites || [];

  const favorite = {
    from: fromStation.value,
    to: toStation.value
  };

  const exists = settings.favorites.some(item =>
    item.from === favorite.from &&
    item.to === favorite.to
  );

  if (!exists) {
    settings.favorites.push(favorite);
  }

  localStorage.setItem("astramSettings", JSON.stringify(settings));

  renderFavorites();
}

async function init() {
  setupStations();

  await loadHolidays();
  await loadTrips();

  renderFavorites();
  render();

  if ($("fromStation")) {
    $("fromStation").addEventListener("change", render);
  }

  if ($("toStation")) {
    $("toStation").addEventListener("change", render);
  }

  if ($("searchTime")) {
    $("searchTime").addEventListener("change", render);
  }

  if ($("useNowButton")) {
    $("useNowButton").addEventListener("click", () => {
      if ($("searchTime")) {
        $("searchTime").value = "";
      }
      render();
    });
  }

  if ($("swapButton")) {
    $("swapButton").addEventListener("click", () => {
      const fromStation = $("fromStation");
      const toStation = $("toStation");

      if (!fromStation || !toStation) return;

      const temp = fromStation.value;
      fromStation.value = toStation.value;
      toStation.value = temp;

      render();
    });
  }

  if ($("favoriteButton")) {
    $("favoriteButton").addEventListener("click", addFavorite);
  }

  if ($("reloadButton")) {
    $("reloadButton").addEventListener("click", async () => {
      await loadTrips();
      render();
    });
  }

  setInterval(render, 30000);
}

window.addEventListener("beforeinstallprompt", event => {
  event.preventDefault();
  deferredInstallPrompt = event;

  if ($("installButton")) {
    $("installButton").classList.remove("hidden");
  }
});

if ($("installButton")) {
  $("installButton").addEventListener("click", async () => {
    if (!deferredInstallPrompt) return;

    deferredInstallPrompt.prompt();

    await deferredInstallPrompt.userChoice;

    deferredInstallPrompt = null;

    if ($("installButton")) {
      $("installButton").classList.add("hidden");
    }
  });
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js");
  });
}

init();
