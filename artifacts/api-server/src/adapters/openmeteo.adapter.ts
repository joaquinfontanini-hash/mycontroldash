export interface OpenMeteoDay {
  date: string;
  dayName: string;
  condition: string;
  conditionIcon: string;
  tempMin: number;
  tempMax: number;
  rainProbability: number;
  windSpeed: number;
  windDirection: string;
  humidity?: number;
  wmoCode: number;
}

const WMO_CODES: Record<number, { condition: string; icon: string }> = {
  0: { condition: "Cielo despejado", icon: "sun" },
  1: { condition: "Principalmente despejado", icon: "sun" },
  2: { condition: "Parcialmente nublado", icon: "cloud-sun" },
  3: { condition: "Nublado", icon: "cloud" },
  45: { condition: "Niebla", icon: "cloud" },
  48: { condition: "Niebla con escarcha", icon: "cloud" },
  51: { condition: "Llovizna leve", icon: "cloud-rain" },
  53: { condition: "Llovizna moderada", icon: "cloud-rain" },
  55: { condition: "Llovizna intensa", icon: "cloud-rain" },
  61: { condition: "Lluvia leve", icon: "cloud-rain" },
  63: { condition: "Lluvia moderada", icon: "cloud-rain" },
  65: { condition: "Lluvia intensa", icon: "cloud-rain" },
  71: { condition: "Nieve leve", icon: "cloud" },
  73: { condition: "Nieve moderada", icon: "cloud" },
  75: { condition: "Nevada intensa", icon: "cloud" },
  80: { condition: "Chubascos leves", icon: "cloud-rain" },
  81: { condition: "Chubascos moderados", icon: "cloud-rain" },
  82: { condition: "Chubascos fuertes", icon: "cloud-rain" },
  95: { condition: "Tormenta eléctrica", icon: "cloud-rain" },
  96: { condition: "Tormenta con granizo", icon: "cloud-rain" },
  99: { condition: "Tormenta fuerte", icon: "cloud-rain" },
};

const WIND_DIRECTIONS = ["N", "NE", "E", "SE", "S", "SO", "O", "NO"];
const DAY_NAMES = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

function degToCompass(deg: number): string {
  const idx = Math.round(deg / 45) % 8;
  return WIND_DIRECTIONS[idx] ?? "N";
}

function getCondition(code: number): { condition: string; icon: string } {
  if (WMO_CODES[code]) return WMO_CODES[code];
  const closest = Object.keys(WMO_CODES)
    .map(Number)
    .filter(k => k <= code)
    .sort((a, b) => b - a)[0];
  return WMO_CODES[closest ?? 0] ?? { condition: "Parcialmente nublado", icon: "cloud-sun" };
}

export async function fetchOpenMeteoForecast(
  latitude: string,
  longitude: string,
  days = 3
): Promise<OpenMeteoDay[]> {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", latitude);
  url.searchParams.set("longitude", longitude);
  url.searchParams.set("daily", [
    "temperature_2m_max",
    "temperature_2m_min",
    "weathercode",
    "precipitation_probability_max",
    "windspeed_10m_max",
    "winddirection_10m_dominant",
  ].join(","));
  url.searchParams.set("timezone", "America/Argentina/Buenos_Aires");
  url.searchParams.set("forecast_days", String(days));

  const res = await fetch(url.toString(), {
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) {
    throw new Error(`Open-Meteo error: ${res.status} ${res.statusText}`);
  }

  const data = await res.json() as {
    daily: {
      time: string[];
      temperature_2m_max: number[];
      temperature_2m_min: number[];
      weathercode: number[];
      precipitation_probability_max: number[];
      windspeed_10m_max: number[];
      winddirection_10m_dominant: number[];
    };
  };

  return data.daily.time.map((dateStr, i) => {
    const code = data.daily.weathercode[i] ?? 0;
    const { condition, icon } = getCondition(code);
    const date = new Date(dateStr + "T12:00:00");
    const dayOfWeek = date.getDay();

    return {
      date: dateStr,
      dayName: i === 0 ? "Hoy" : DAY_NAMES[dayOfWeek] ?? dateStr,
      condition,
      conditionIcon: icon,
      tempMin: Math.round(data.daily.temperature_2m_min[i] ?? 0),
      tempMax: Math.round(data.daily.temperature_2m_max[i] ?? 0),
      rainProbability: data.daily.precipitation_probability_max[i] ?? 0,
      windSpeed: Math.round(data.daily.windspeed_10m_max[i] ?? 0),
      windDirection: degToCompass(data.daily.winddirection_10m_dominant[i] ?? 0),
      wmoCode: code,
    };
  });
}
