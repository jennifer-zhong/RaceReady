/**
 * RaceReady - Modern & Minimalist Race Training Platform
 * 
 * Integrated APIs:
 * 1. OpenAI Chat API (Data API - tailored running coach and plan explanations)
 * 2. Open-Meteo Weather API (Data API - real-time temperature, precipitation, best running windows)
 * 3. Browser Geolocation API (Browser API - auto-detects user latitude and longitude with graceful denial fallback)
 * 4. LocalStorage API (Browser API - multi-plan storage library, checklists, night mode, and settings)
 */

// =========================================================================
// OPENAI API KEY CONFIGURATION
// =========================================================================
/**
 * Class assignment key. Replace PLACEHOLDER with your personal key.
 */
const CSE2004_API_KEY = "g6gpi9zhofot";
// =========================================================================
// APPLICATION STATE & STORAGE
// =========================================================================
const STORAGE_KEYS = {
  ACTIVE_PLAN: 'paceplan_active_plan',
  ACTIVE_INPUTS: 'paceplan_active_inputs',
  ACTIVE_CHECKS: 'paceplan_active_checks',
  PLAN_LIBRARY: 'paceplan_saved_library', // Multi-plan library in LocalStorage
  THEME: 'paceplan_theme'
};

const AppState = {
  theme: 'light', // 'light' | 'dark'
  plan: null,
  completedTasks: {}, // { [taskId]: boolean }
  inputs: null,
  savedLibrary: [], // Array of { id, name, createdAt, inputs, plan, completedTasks }
  weather: null,
  userLocation: {
    lat: 42.3601,
    lon: -71.0589,
    name: "Boston, MA (Default)"
  }
};

const Storage = {
  init() {
    try {
      const savedTheme = localStorage.getItem(STORAGE_KEYS.THEME);
      if (savedTheme) AppState.theme = savedTheme;

      const savedInputs = localStorage.getItem(STORAGE_KEYS.ACTIVE_INPUTS);
      if (savedInputs) AppState.inputs = JSON.parse(savedInputs);

      const savedPlan = localStorage.getItem(STORAGE_KEYS.ACTIVE_PLAN);
      if (savedPlan) AppState.plan = JSON.parse(savedPlan);

      const savedChecks = localStorage.getItem(STORAGE_KEYS.ACTIVE_CHECKS);
      if (savedChecks) AppState.completedTasks = JSON.parse(savedChecks);

      const libraryData = localStorage.getItem(STORAGE_KEYS.PLAN_LIBRARY);
      if (libraryData) AppState.savedLibrary = JSON.parse(libraryData);
    } catch (e) {
      console.warn("Storage read error:", e);
    }
  },

  setTheme(theme) {
    AppState.theme = theme;
    try {
      localStorage.setItem(STORAGE_KEYS.THEME, theme);
    } catch (e) {
      console.warn("Storage save theme error:", e);
    }
  },

  saveActivePlan(plan, inputs) {
    AppState.plan = plan;
    AppState.inputs = inputs;
    try {
      localStorage.setItem(STORAGE_KEYS.ACTIVE_PLAN, JSON.stringify(plan));
      localStorage.setItem(STORAGE_KEYS.ACTIVE_INPUTS, JSON.stringify(inputs));
    } catch (e) {
      console.warn("Storage save plan error:", e);
    }
  },

  toggleTask(taskId) {
    const isDone = !AppState.completedTasks[taskId];
    if (isDone) {
      AppState.completedTasks[taskId] = true;
    } else {
      delete AppState.completedTasks[taskId];
    }
    try {
      localStorage.setItem(STORAGE_KEYS.ACTIVE_CHECKS, JSON.stringify(AppState.completedTasks));
    } catch (e) {
      console.warn("Storage save checklist error:", e);
    }
    return isDone;
  },

  // -------------------------------------------------------------
  // MULTI-PLAN LOCALSTORAGE LIBRARY MANAGEMENT
  // -------------------------------------------------------------
  savePlanToLibrary(customName) {
    if (!AppState.plan || !AppState.inputs) return false;

    const newEntry = {
      id: `plan_${Date.now()}`,
      name: customName.trim(),
      createdAt: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      raceDistance: AppState.inputs.raceDistance,
      raceDate: AppState.inputs.raceDate,
      inputs: AppState.inputs,
      plan: AppState.plan,
      completedTasks: { ...AppState.completedTasks }
    };

    AppState.savedLibrary.unshift(newEntry);
    try {
      localStorage.setItem(STORAGE_KEYS.PLAN_LIBRARY, JSON.stringify(AppState.savedLibrary));
    } catch (e) {
      console.warn("Storage save library error:", e);
    }
    return true;
  },

  loadPlanFromLibrary(planId) {
    const entry = AppState.savedLibrary.find(p => p.id === planId);
    if (!entry) return false;

    AppState.plan = entry.plan;
    AppState.inputs = entry.inputs;
    AppState.completedTasks = { ...entry.completedTasks };

    try {
      localStorage.setItem(STORAGE_KEYS.ACTIVE_PLAN, JSON.stringify(AppState.plan));
      localStorage.setItem(STORAGE_KEYS.ACTIVE_INPUTS, JSON.stringify(AppState.inputs));
      localStorage.setItem(STORAGE_KEYS.ACTIVE_CHECKS, JSON.stringify(AppState.completedTasks));
    } catch (e) {
      console.warn("Storage activate error:", e);
    }
    return entry;
  },

  deletePlanFromLibrary(planId) {
    AppState.savedLibrary = AppState.savedLibrary.filter(p => p.id !== planId);
    try {
      localStorage.setItem(STORAGE_KEYS.PLAN_LIBRARY, JSON.stringify(AppState.savedLibrary));
    } catch (e) {
      console.warn("Storage delete library error:", e);
    }
  },

  clearActivePlan() {
    try {
      localStorage.removeItem(STORAGE_KEYS.ACTIVE_PLAN);
      localStorage.removeItem(STORAGE_KEYS.ACTIVE_CHECKS);
      localStorage.removeItem(STORAGE_KEYS.ACTIVE_INPUTS);
    } catch (e) {
      console.warn("Storage clear error:", e);
    }
    AppState.plan = null;
    AppState.inputs = null;
    AppState.completedTasks = {};
  }
};

// =========================================================================
// RACE TIME PREDICTOR (Pete Riegel Formula)
// =========================================================================
const Predictor = {
  distMeters: {
    '5k': 5000,
    '10k': 10000,
    '15k': 15000,
    'half': 21097.5,
    'marathon': 42195
  },

  distMiles: {
    '5k': 3.1068,
    '10k': 6.2137,
    '15k': 9.3205,
    'half': 13.1094,
    'marathon': 26.2188
  },

  /**
   * Pete Riegel formula: T2 = T1 * (D2 / D1)^1.06
   */
  predict(benchType, benchMinutes, benchSeconds, targetRace) {
    const t1Secs = (parseInt(benchMinutes, 10) * 60) + parseInt(benchSeconds, 10);
    const d1 = this.distMeters[benchType] || 5000;
    const d2 = this.distMeters[targetRace] || 21097.5;

    const t2Secs = t1Secs * Math.pow(d2 / d1, 1.06);

    const targetMiles = this.distMiles[targetRace] || 13.1;
    const paceSecsPerMile = Math.round(t2Secs / targetMiles);

    return {
      predictedTimeStr: this.formatTime(t2Secs),
      paceStr: `${this.formatPace(paceSecsPerMile)} /mi`,
      paceSecs: paceSecsPerMile,
      predictedSeconds: t2Secs
    };
  },

  formatTime(totalSecs) {
    const s = Math.round(totalSecs);
    const hrs = Math.floor(s / 3600);
    const mins = Math.floor((s % 3600) / 60);
    const secs = s % 60;
    const pad = (n) => String(n).padStart(2, '0');

    if (hrs > 0) {
      return `${hrs}:${pad(mins)}:${pad(secs)}`;
    }
    return `${mins}:${pad(secs)}`;
  },

  formatPace(secs) {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }
};

// =========================================================================
// WEATHER CONTROLLER (Open-Meteo & Browser Geolocation API)
// =========================================================================
const Weather = {
  detectLocation() {
    UI.showToast("Locating your coordinates...", "info");

    const fallbackBox = document.getElementById('locationFallbackBox');

    if (!navigator.geolocation) {
      UI.showToast("Geolocation is not supported by your browser. Please select a city.", "warning");
      if (fallbackBox) fallbackBox.classList.remove('hidden');
      this.fetchForecast();
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = parseFloat(pos.coords.latitude.toFixed(4));
        const lon = parseFloat(pos.coords.longitude.toFixed(4));
        AppState.userLocation = {
          lat,
          lon,
          name: `Local Coordinates (${lat}°, ${lon}°)`
        };
        if (fallbackBox) fallbackBox.classList.add('hidden');
        UI.showToast("Location updated successfully", "success");
        this.fetchForecast();
      },
      (err) => {
        // Handle browser API permission denial gracefully
        console.warn("Geolocation permission error:", err);
        let userMessage = "Location access was denied. Please select your city below.";
        if (err.code === err.TIMEOUT) {
          userMessage = "Location request timed out. Please pick a city from the list.";
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          userMessage = "Position unavailable. Please select your city below.";
        }

        UI.showToast(userMessage, "warning");
        if (fallbackBox) fallbackBox.classList.remove('hidden');
        this.fetchForecast();
      },
      { timeout: 7000, maximumAge: 600000 }
    );
  },

  setManualCity(cityVal) {
    const [lat, lon, cityName] = cityVal.split(',');
    AppState.userLocation = {
      lat: parseFloat(lat),
      lon: parseFloat(lon),
      name: cityName
    };
    UI.showToast(`Updated location to ${cityName}`, "success");
    this.fetchForecast();
  },

  async fetchForecast() {
    const { lat, lon, name } = AppState.userLocation;
    const locEl = document.getElementById('weatherLocationName');
    if (locEl) locEl.textContent = `Location: ${name}`;

    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m&hourly=temperature_2m,precipitation_probability&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=auto`;

    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      this.renderWeather(data);
    } catch (e) {
      console.warn("Weather fetch error, using fallback:", e);
      const statusEl = document.getElementById('weatherStatus');
      if (statusEl) {
        statusEl.textContent = "Live weather is unavailable. Showing estimated conditions.";
        statusEl.classList.remove('hidden');
      }
      this.renderFallbackWeather();
    }
  },

  renderWeather(data) {
    const statusEl = document.getElementById('weatherStatus');
    if (statusEl) statusEl.classList.add('hidden');
    const cur = data.current;
    const temp = Math.round(cur.temperature_2m);
    const feels = Math.round(cur.apparent_temperature);
    const wind = Math.round(cur.wind_speed_10m);
    const precip = cur.precipitation;
    const code = cur.weather_code;

    // Running condition recommendation
    let verdict = "Optimal Conditions";
    let isWarning = false;

    if (temp > 80 || temp < 25 || wind > 20 || precip > 0.15) {
      isWarning = true;
      if (temp > 80) verdict = "Caution: High Heat";
      else if (temp < 25) verdict = "Caution: Freezing";
      else if (precip > 0.15) verdict = "Caution: Rain / Storm";
      else verdict = "Caution: High Winds";
    } else if (temp > 72) {
      verdict = "Fair: Run in Morning";
    }

    // Best Running Window Today from hourly data
    let bestWindow = "Morning (7:00 AM – 9:00 AM)";
    if (data.hourly && data.hourly.temperature_2m) {
      const temps = data.hourly.temperature_2m.slice(6, 21);
      const minTemp = Math.min(...temps);
      if (minTemp <= 65) {
        bestWindow = "Morning 7:00 AM – 9:00 AM (Coolest)";
      } else {
        bestWindow = "Evening 6:30 PM – 8:00 PM";
      }
    }

    // Practical Gear guidance
    let gear = "T-shirt and running shorts";
    if (temp < 40) gear = "Thermal layers, running tights, gloves";
    else if (temp < 55) gear = "Long-sleeve shirt or light windbreaker";
    else if (temp > 75) gear = "Lightweight singlet, shorts, and handheld hydration";

    // Update Header Pill
    const hTemp = document.getElementById('weatherTemp');
    const hVerdict = document.getElementById('weatherVerdict');
    const hIcon = document.getElementById('weatherIcon');

    if (hTemp) hTemp.textContent = `${temp}°F`;
    if (hVerdict) {
      hVerdict.textContent = verdict;
      hVerdict.className = `verdict-pill ${isWarning ? 'warning' : ''}`;
    }
    if (hIcon) hIcon.textContent = (code >= 51 && code <= 67) ? '🌧️' : (temp > 75 ? '☀️' : '⛅');

    // Update Weather Card
    const cardTemp = document.getElementById('cardTemp');
    const cardDesc = document.getElementById('cardCondition');
    const cardVerdict = document.getElementById('cardVerdict');
    const cardBest = document.getElementById('bestTimeToday');
    const cardPrecip = document.getElementById('cardPrecip');
    const cardWind = document.getElementById('cardWind');
    const cardGear = document.getElementById('cardGear');

    if (cardTemp) cardTemp.textContent = `${temp}°F`;
    if (cardDesc) cardDesc.textContent = `Feels like ${feels}°F`;
    if (cardVerdict) {
      cardVerdict.textContent = verdict;
      cardVerdict.className = `badge-verdict ${isWarning ? 'warning' : ''}`;
    }
    if (cardBest) cardBest.textContent = bestWindow;
    if (cardPrecip) cardPrecip.textContent = `${precip > 0 ? (precip * 100).toFixed(0) : 0}%`;
    if (cardWind) cardWind.textContent = `${wind} mph`;
    if (cardGear) cardGear.textContent = gear;

    AppState.weather = {
      temperatureF: temp,
      feelsLikeF: feels,
      precipitationPercent: precip > 0 ? Math.round(precip * 100) : 0,
      windMph: wind,
      condition: verdict,
      bestWindow,
      gearTip: gear,
      estimated: false
    };
  },

  renderFallbackWeather() {
    const hTemp = document.getElementById('weatherTemp');
    const hVerdict = document.getElementById('weatherVerdict');
    const cardTemp = document.getElementById('cardTemp');
    const cardDesc = document.getElementById('cardCondition');
    const cardVerdict = document.getElementById('cardVerdict');
    const cardBest = document.getElementById('bestTimeToday');
    const cardPrecip = document.getElementById('cardPrecip');
    const cardWind = document.getElementById('cardWind');
    const cardGear = document.getElementById('cardGear');

    if (hTemp) hTemp.textContent = "62°F";
    if (hVerdict) hVerdict.textContent = "Optimal Conditions";
    if (cardTemp) cardTemp.textContent = "62°F";
    if (cardDesc) cardDesc.textContent = "Mild & Clear (Estimated)";
    if (cardVerdict) cardVerdict.textContent = "Optimal Conditions";
    if (cardBest) cardBest.textContent = "7:00 AM – 9:00 AM";
    if (cardPrecip) cardPrecip.textContent = "0%";
    if (cardWind) cardWind.textContent = "6 mph";
    if (cardGear) cardGear.textContent = "T-shirt and running shorts";

    AppState.weather = {
      temperatureF: 62,
      feelsLikeF: 62,
      precipitationPercent: 0,
      windMph: 6,
      condition: "Optimal Conditions",
      bestWindow: "7:00 AM - 9:00 AM",
      gearTip: "T-shirt and running shorts",
      estimated: true
    };
  }
};

// =========================================================================
// PLAN GENERATOR & OPENAI AI COACH
// =========================================================================
const PlanEngine = {
  /**
   * Generates a day-to-day plan from today up until race date
   */
  async generate(inputs) {
    const [raceYear, raceMonth, raceDay] = inputs.raceDate.split('-').map(Number);
    const raceDate = new Date(raceYear, raceMonth - 1, raceDay);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const diffDays = Math.ceil((raceDate - today) / (1000 * 60 * 60 * 24));
    if (diffDays <= 0) {
      throw new Error("Please select a future race date.");
    }

    // Predict race pace
    const pred = Predictor.predict(inputs.benchType, inputs.benchMinutes, inputs.benchSeconds, inputs.raceDistance);

    // Build day-to-day schedule
    const days = [];

    const maxLongRun = {
      '5k': 4,
      '10k': 7,
      '15k': 10,
      'half': 12,
      'marathon': 20
    }[inputs.raceDistance] || 10;

    // Include race day in the checklist so its date matches the form input.
    for (let i = 0; i <= diffDays; i++) {
      const currentDay = new Date(today);
      currentDay.setDate(today.getDate() + i);

      const dayOfWeek = currentDay.getDay(); // 0 is Sun, 6 is Sat
      const dateStr = currentDay.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      const taskId = `day_${i}_${currentDay.getTime()}`;

      const daysUntilRace = diffDays - i;
      const isRaceDay = (daysUntilRace === 0);

      let item = null;

      if (isRaceDay) {
        // Race Day
        item = {
          id: taskId,
          dateStr: dateStr,
          type: 'race',
          badgeText: 'Race Day',
          badgeClass: 'badge-race',
          title: `RACE DAY: ${inputs.raceDistance.toUpperCase()} TARGET EVENT`,
          desc: `Execute your pacing plan. Target pace: ${pred.paceStr}. Warm up with a 10-minute easy jog and dynamic mobility, then race with focus and confidence!`
        };
      } else if (dayOfWeek === 6) {
        // Saturday: Key Long Run
        const currentLongRunDist = Math.max(3, Math.min(maxLongRun, Math.round(3 + (maxLongRun - 3) * (i / diffDays))));
        item = {
          id: taskId,
          dateStr: dateStr,
          type: 'run',
          badgeText: 'Long Run',
          badgeClass: 'badge-run',
          title: `Long Run (${currentLongRunDist} Miles)`,
          desc: `Run at a steady, conversational aerobic effort (approx. ${Predictor.formatPace(pred.paceSecs + 60)} /mi). Practice your race hydration and fueling strategy.`
        };
      } else if (dayOfWeek === 2) {
        // Tuesday: Speed / Intervals or Tempo
        item = {
          id: taskId,
          dateStr: dateStr,
          type: 'run',
          badgeText: 'Threshold / Tempo',
          badgeClass: 'badge-run',
          title: 'Tempo & Threshold Intervals (4-5 Miles total)',
          desc: `Warm up 1 mile, then maintain steady threshold pace (${pred.paceStr}) for the working set, followed by a 1-mile cool down jog.`
        };
      } else if (dayOfWeek === 4) {
        // Thursday: Easy Run + Strides
        item = {
          id: taskId,
          dateStr: dateStr,
          type: 'run',
          badgeText: 'Easy Run',
          badgeClass: 'badge-run',
          title: 'Easy Aerobic Run + Strides (3-4 Miles)',
          desc: 'Keep effort conversational and relaxed in Zone 2. Finish with 4x 20-second strides to maintain leg turnover.'
        };
      } else if (dayOfWeek === 3) {
        // Wednesday: Runner Strength Training
        item = {
          id: taskId,
          dateStr: dateStr,
          type: 'strength',
          badgeText: 'Strength',
          badgeClass: 'badge-strength',
          title: 'Runner Functional Strength & Core',
          desc: '3 sets of: 10 single-leg deadlifts per leg, 15 calf raises, and 45-second core planks to build joint stability and running economy.'
        };
      } else if (dayOfWeek === 0) {
        // Sunday: Mobility & Foam Rolling
        item = {
          id: taskId,
          dateStr: dateStr,
          type: 'strength',
          badgeText: 'Mobility',
          badgeClass: 'badge-strength',
          title: 'Post-Run Mobility & Foam Rolling Flow',
          desc: 'Gentle foam rolling for calves, quads, and hamstrings, followed by hip flexor stretches to promote active recovery.'
        };
      } else {
        // Monday / Friday: Rest
        item = {
          id: taskId,
          dateStr: dateStr,
          type: 'rest',
          badgeText: 'Rest Day',
          badgeClass: 'badge-rest',
          title: 'Scheduled Rest & Recovery',
          desc: 'Allow your muscles and joints to adapt and rebuild glycogen stores. Prioritize hydration and 8 hours of quality sleep.'
        };
      }

      days.push(item);
    }

    // Call OpenAI for personalized coach advice
    let coachAdvice = "";
    let aiPowered = false;
    let aiPredictionSeconds = null;
    try {
      coachAdvice = await this.fetchOpenAiAdvice(inputs, pred, diffDays);
      aiPowered = true;
    } catch (e) {
      console.warn("AI proxy call failed, using built-in coach:", e);
      coachAdvice = this.getLocalCoachAdvice(inputs, pred, diffDays);
    }

    try {
      aiPredictionSeconds = await this.fetchAiPrediction(inputs, pred, diffDays);
    } catch (e) {
      console.warn("AI prediction failed, using local improvement model:", e);
    }

    const plan = {
      createdAt: new Date().toISOString(),
      diffDays,
      predictedTime: pred.predictedTimeStr,
      targetPace: pred.paceStr,
      aiPredictionSeconds,
      coachAdvice,
      aiPowered,
      days
    };

    return plan;
  },

  async fetchOpenAiAdvice(inputs, pred, diffDays) {
    const coachContext = this.getCoachContext();
    const prompt = `You are a professional distance running coach for RaceReady.
Runner parameters:
- Target Event: ${inputs.raceDistance.toUpperCase()} in ${diffDays} days
- Benchmark Race: ${inputs.benchMinutes}m ${inputs.benchSeconds}s (${inputs.benchType})
- Predicted Finish: ${pred.predictedTimeStr} (Target Pace: ${pred.paceStr})
- Experience Level: ${inputs.currentFitness}

Current location and running conditions:
${coachContext}

Provide 3 short, actionable coaching paragraphs:
1. Pacing and aerobic development roadmap for this event.
2. How to balance easy aerobic mileage with the prescribed strength and recovery sessions.
3. One key race-day execution rule (e.g., negative splitting and early discipline).
Adjust today's workout guidance for the current weather when appropriate.`;

    const data = await this.requestResponsesApi(prompt);
    if (!data.text) throw new Error("The AI proxy returned no coaching text.");
    return data.text;
  },

  async fetchAiPrediction(inputs, pred, diffDays) {
    const schema = {
      type: "json_schema",
      name: "race_prediction",
      schema: {
        type: "object",
        properties: {
          predictedSeconds: { type: "number" },
          reasoning: { type: "string" }
        },
        required: ["predictedSeconds", "reasoning"],
        additionalProperties: false
      },
      strict: true
    };
    const prompt = `Estimate this runner's finish time after completing the full ${diffDays}-day training plan. Return only the requested JSON.
Target race: ${inputs.raceDistance}
Race date: ${inputs.raceDate}
Experience: ${inputs.currentFitness}
Recent ${inputs.benchType} time: ${inputs.benchMinutes}:${String(inputs.benchSeconds).padStart(2, '0')}
Current formula baseline: ${pred.predictedTimeStr} (${pred.predictedSeconds} seconds)
Be conservative and realistic; do not promise a dramatic improvement.
${this.getCoachContext()}`;

    const data = await this.requestResponsesApi(prompt, { text: { format: schema } });
    const result = JSON.parse(data.text || "{}");
    const seconds = Number(result.predictedSeconds);
    if (!Number.isFinite(seconds)) throw new Error("The AI returned an invalid prediction.");
    return Math.round(Math.min(pred.predictedSeconds * 1.1, Math.max(pred.predictedSeconds * 0.8, seconds)));
  },

  async requestResponsesApi(prompt, options = {}) {
    const res = await fetch("https://cse2004.com/api/openai/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${CSE2004_API_KEY}`
      },
      body: JSON.stringify({
        input: prompt,
        model: "gpt-6-luna",
        ...options
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || `OpenAI proxy HTTP ${res.status}`);
    return data;
  },

  getCoachContext() {
    const location = AppState.userLocation;
    const weather = AppState.weather || {
      temperatureF: "unknown",
      feelsLikeF: "unknown",
      precipitationPercent: "unknown",
      windMph: "unknown",
      condition: "weather unavailable",
      bestWindow: "unknown",
      gearTip: "use normal running layers",
      estimated: true
    };

    return `Location: ${location.name} (${location.lat}, ${location.lon})
Temperature: ${weather.temperatureF} F, feels like ${weather.feelsLikeF} F
Precipitation: ${weather.precipitationPercent}%
Wind: ${weather.windMph} mph
Conditions: ${weather.condition}
Best running window: ${weather.bestWindow}
Gear guidance: ${weather.gearTip}
Weather source: ${weather.estimated ? "estimated fallback" : "live forecast"}`;
  },

  async askOpenAi(question, inputs, prediction, completionPercent) {
    const coachContext = this.getCoachContext();
    const prompt = `You are a professional distance running coach. Answer this runner's question in under 180 words. Do not diagnose injuries; recommend a medical professional for pain or concerning symptoms.
Runner: ${inputs.currentFitness}, training for ${inputs.raceDistance}, race date ${inputs.raceDate}.
Benchmark: ${inputs.benchMinutes}:${String(inputs.benchSeconds).padStart(2, '0')} (${inputs.benchType}).
Current projected finish after ${completionPercent}% of the recommended plan: ${prediction}.
Current location and running conditions:
${coachContext}
Question: ${question}`;

    const data = await this.requestResponsesApi(prompt);
    return data.text || "No answer was returned.";
  },

  getLocalCoachAdvice(inputs, pred, diffDays) {
    const distMap = {
      '5k': '5K Speed & Lactate Threshold',
      '10k': '10K Aerobic Strength',
      '15k': '15K Mid-Distance Endurance',
      'half': 'Half Marathon Pacing & Fueling',
      'marathon': 'Marathon Long Run Periodization'
    };

    return `Welcome to your ${diffDays}-day ${distMap[inputs.raceDistance] || 'Race'} Training Plan.

Based on your benchmark time of ${inputs.benchMinutes}:${String(inputs.benchSeconds).padStart(2, '0')}, your projected race finish is ${pred.predictedTimeStr} (${pred.paceStr}).

Core Training Principles:
• Keep Easy Runs Easy: 80% of your total weekly mileage should be at a conversational, relaxed effort in Zone 2.
• Functional Strength: The scheduled mid-week strength and mobility routines build joint resilience and protect your calves, knees, and hips.
• Race Day Discipline: Start the first mile 10-15 seconds slower than your target pace to conserve glycogen for a strong finish.`;
  }
};

// =========================================================================
// UI CONTROLLER
// =========================================================================
const UI = {
  init() {
    this.applyTheme(AppState.theme);
    this.updateLibraryCountBadge();
    this.bindEvents();

    // Auto-detect weather on load
    Weather.detectLocation();

    // Set default race date in input to 8 weeks ahead
    const dateInput = document.getElementById('raceDate');
    if (dateInput && !dateInput.value) {
      const defaultDate = new Date();
      defaultDate.setDate(defaultDate.getDate() + 56);
      dateInput.value = defaultDate.toISOString().split('T')[0];
    }

    // Restore saved active plan if exists
    if (AppState.plan && AppState.inputs) {
      this.populateSavedForm(AppState.inputs);
      this.renderPlan(AppState.plan, AppState.inputs);
    }
  },

  applyTheme(theme) {
    AppState.theme = theme;
    document.documentElement.setAttribute('data-theme', theme);
    Storage.setTheme(theme);

    const iconEl = document.getElementById('themeToggleIcon');
    if (iconEl) {
      iconEl.textContent = (theme === 'dark') ? '☀️' : '🌙';
    }
  },

  updateLibraryCountBadge() {
    const countEl = document.getElementById('savedPlansCount');
    if (countEl) {
      countEl.textContent = AppState.savedLibrary.length;
    }
  },

  bindEvents() {
    const coachQuestionForm = document.getElementById('coachQuestionForm');
    if (coachQuestionForm) coachQuestionForm.addEventListener('submit', (e) => this.handleCoachQuestion(e));

    // Night Mode Toggle
    const themeBtn = document.getElementById('themeToggleBtn');
    if (themeBtn) {
      themeBtn.addEventListener('click', () => {
        const nextTheme = (AppState.theme === 'dark') ? 'light' : 'dark';
        this.applyTheme(nextTheme);
        UI.showToast(nextTheme === 'dark' ? "Night mode enabled" : "Daylight mode enabled", "info");
      });
    }

    // Form submit
    const form = document.getElementById('planForm');
    if (form) {
      form.addEventListener('submit', (e) => this.handleFormSubmit(e));
    }

    // Weather refresh & Fallback City Buttons
    const detectBtn = document.getElementById('detectLocationBtn');
    if (detectBtn) {
      detectBtn.addEventListener('click', () => Weather.detectLocation());
    }

    const applyCityBtn = document.getElementById('applyCityBtn');
    const citySelectFallback = document.getElementById('citySelectFallback');
    if (applyCityBtn && citySelectFallback) {
      applyCityBtn.addEventListener('click', () => {
        Weather.setManualCity(citySelectFallback.value);
      });
    }

    // Multi-Plan LocalStorage Library Handlers
    const saveCurrentPlanBtn = document.getElementById('saveCurrentPlanBtn');
    const saveCurrentFromLibraryBtn = document.getElementById('saveCurrentFromLibraryBtn');
    const openLibraryBtn = document.getElementById('openLibraryBtn');
    const heroOpenLibraryBtn = document.getElementById('heroOpenLibraryBtn');
    const closeLibraryModalBtn = document.getElementById('closeLibraryModalBtn');
    const doneLibraryBtn = document.getElementById('doneLibraryBtn');
    const libraryBackdrop = document.getElementById('libraryBackdrop');

    const triggerSaveDialog = () => {
      if (!AppState.plan || !AppState.inputs) {
        UI.showToast("Please generate a plan first before saving to library.", "warning");
        return;
      }

      const defaultName = `${AppState.inputs.raceDistance.toUpperCase()} (${AppState.inputs.raceDate})`;
      const chosenName = window.prompt("Do you want to save this training plan to your browser's LocalStorage library?\n\nEnter a plan name:", defaultName);

      if (chosenName && chosenName.trim()) {
        Storage.savePlanToLibrary(chosenName.trim());
        this.updateLibraryCountBadge();
        this.renderLibraryModal();
        UI.showToast(`Plan '${chosenName.trim()}' saved to your LocalStorage library!`, "success");
      }
    };

    if (saveCurrentPlanBtn) saveCurrentPlanBtn.addEventListener('click', triggerSaveDialog);
    if (saveCurrentFromLibraryBtn) saveCurrentFromLibraryBtn.addEventListener('click', triggerSaveDialog);

    const openLibrary = () => {
      this.renderLibraryModal();
      const modal = document.getElementById('plansLibraryModal');
      if (modal) {
        if (typeof modal.showModal === 'function') {
          modal.showModal();
        } else {
          modal.setAttribute('open', 'true');
        }
      }
    };

    const closeLibrary = () => {
      const modal = document.getElementById('plansLibraryModal');
      if (modal) {
        if (typeof modal.close === 'function') {
          modal.close();
        } else {
          modal.removeAttribute('open');
        }
      }
    };

    if (openLibraryBtn) openLibraryBtn.addEventListener('click', openLibrary);
    if (heroOpenLibraryBtn) heroOpenLibraryBtn.addEventListener('click', openLibrary);
    if (closeLibraryModalBtn) closeLibraryModalBtn.addEventListener('click', closeLibrary);
    if (doneLibraryBtn) doneLibraryBtn.addEventListener('click', closeLibrary);
    if (libraryBackdrop) libraryBackdrop.addEventListener('click', closeLibrary);

    // Reset current active plan
    const resetBtn = document.getElementById('resetPlanBtn');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        if (confirm("Reset current active plan and checklist? (Your saved library plans will not be deleted)")) {
          Storage.clearActivePlan();
          document.getElementById('summaryCard').classList.add('hidden');
          document.getElementById('coachCard').classList.add('hidden');
          document.getElementById('planSection').classList.add('hidden');
          const coachQuestion = document.getElementById('coachQuestion');
          const coachAnswer = document.getElementById('coachAnswer');
          if (coachQuestion) coachQuestion.value = '';
          if (coachAnswer) {
            coachAnswer.textContent = '';
            coachAnswer.classList.add('hidden');
          }
          UI.showToast("Active plan reset", "info");
        }
      });
    }

    // Print plan
    const printBtn = document.getElementById('printPlanBtn');
    if (printBtn) {
      printBtn.addEventListener('click', () => window.print());
    }
  },

  getTrainingProjection(plan, inputs) {
    const completed = Object.keys(AppState.completedTasks).length;
    const completionPercent = plan?.days?.length ? Math.round((completed / plan.days.length) * 100) : 0;
    const baseline = Predictor.predict(inputs.benchType, inputs.benchMinutes, inputs.benchSeconds, inputs.raceDistance);
    const maxImprovement = { beginner: 0.025, intermediate: 0.04, advanced: 0.055 }[inputs.currentFitness] || 0.03;
    const projectedSeconds = baseline.predictedSeconds * (1 - maxImprovement * completionPercent / 100);
    const paceSeconds = Math.round(projectedSeconds / Predictor.distMiles[inputs.raceDistance]);
    return { completionPercent, time: Predictor.formatTime(projectedSeconds), pace: `${Predictor.formatPace(paceSeconds)} /mi` };
  },

  updatePredictionDisplay() {
    if (!AppState.plan || !AppState.inputs) return;
    const projection = this.getTrainingProjection(AppState.plan, AppState.inputs);
    const timeEl = document.getElementById('summaryPredictedTime');
    const paceEl = document.getElementById('summaryTargetPace');
    const noteEl = document.getElementById('summaryPredictionNote');
    if (timeEl) timeEl.textContent = projection.time;
    if (paceEl) paceEl.textContent = projection.pace;
    if (noteEl) noteEl.textContent = projection.completionPercent ? `After ${projection.completionPercent}% of plan` : 'Before training';
  },

  async handleCoachQuestion(e) {
    e.preventDefault();
    if (!AppState.inputs || !AppState.plan) return this.showToast("Generate a plan before asking the coach.", "warning");
    const input = document.getElementById('coachQuestion');
    const answer = document.getElementById('coachAnswer');
    const button = document.getElementById('askCoachBtn');
    const projection = this.getTrainingProjection(AppState.plan, AppState.inputs);
    if (button) button.disabled = true;
    if (answer) { answer.textContent = 'Thinking...'; answer.classList.remove('hidden'); }
    try {
      const response = await PlanEngine.askOpenAi(input.value.trim(), AppState.inputs, projection.time, projection.completionPercent);
      if (answer) answer.textContent = response;
      input.value = '';
    } catch (error) {
      if (answer) answer.textContent = `Coach unavailable: ${error.message}`;
      this.showToast("OpenAI could not answer. Check your key and try again.", "error");
    } finally {
      if (button) button.disabled = false;
    }
  },

  renderLibraryModal() {
    const container = document.getElementById('libraryListContainer');
    if (!container) return;
    container.innerHTML = '';

    if (AppState.savedLibrary.length === 0) {
      container.innerHTML = `
        <div class="empty-library-note">
          <p>No saved plans in your library yet.</p>
          <p class="empty-library-sub">Generate a training plan and click "Save Plan to Library" to store different schedules here!</p>
        </div>
      `;
      return;
    }

    AppState.savedLibrary.forEach((entry) => {
      const card = document.createElement('div');
      card.className = 'saved-plan-entry';

      const totalDays = entry.plan?.days?.length || 0;
      const completedCount = Object.keys(entry.completedTasks || {}).length;
      const pct = totalDays > 0 ? Math.round((completedCount / totalDays) * 100) : 0;

      card.innerHTML = `
        <div class="saved-plan-meta">
          <span class="saved-plan-name">${entry.name}</span>
          <span class="saved-plan-sub">${entry.raceDistance.toUpperCase()} • Race Date: ${entry.raceDate} • Saved ${entry.createdAt}</span>
          <span class="saved-plan-sub font-mono saved-plan-progress">${completedCount}/${totalDays} Days Completed (${pct}%)</span>
        </div>
        <div class="saved-plan-actions">
          <button type="button" class="btn btn-primary btn-sm load-plan-btn" data-id="${entry.id}">Load Plan</button>
          <button type="button" class="btn btn-danger btn-sm delete-plan-btn" data-id="${entry.id}">Delete</button>
        </div>
      `;

      // Event listener to Load Plan
      const loadBtn = card.querySelector('.load-plan-btn');
      loadBtn.addEventListener('click', () => {
        if (confirm(`Do you want to switch to "${entry.name}"? It will become your active checklist.`)) {
          const loaded = Storage.loadPlanFromLibrary(entry.id);
          if (loaded) {
            this.populateSavedForm(loaded.inputs);
            this.renderPlan(loaded.plan, loaded.inputs);
            const modal = document.getElementById('plansLibraryModal');
            if (modal && typeof modal.close === 'function') modal.close();
            UI.showToast(`Loaded plan: "${loaded.name}"`, "success");
            const summaryCard = document.getElementById('summaryCard');
            if (summaryCard) summaryCard.scrollIntoView({ behavior: 'smooth' });
          }
        }
      });

      // Event listener to Delete Plan
      const delBtn = card.querySelector('.delete-plan-btn');
      delBtn.addEventListener('click', () => {
        if (confirm(`Are you sure you want to delete "${entry.name}" from your LocalStorage library?`)) {
          Storage.deletePlanFromLibrary(entry.id);
          this.updateLibraryCountBadge();
          this.renderLibraryModal();
          UI.showToast("Plan removed from library", "info");
        }
      });

      container.appendChild(card);
    });
  },

  populateSavedForm(inputs) {
    if (!inputs) return;
    const raceDistance = document.getElementById('raceDistance');
    const raceDate = document.getElementById('raceDate');
    const currentFitness = document.getElementById('currentFitness');
    const benchMinutes = document.getElementById('benchMinutes');
    const benchSeconds = document.getElementById('benchSeconds');
    const benchType = document.getElementById('benchType');

    if (raceDistance && inputs.raceDistance) raceDistance.value = inputs.raceDistance;
    if (raceDate && inputs.raceDate) raceDate.value = inputs.raceDate;
    if (currentFitness && inputs.currentFitness) currentFitness.value = inputs.currentFitness;
    if (benchMinutes && inputs.benchMinutes) benchMinutes.value = inputs.benchMinutes;
    if (benchSeconds && inputs.benchSeconds) benchSeconds.value = inputs.benchSeconds;
    if (benchType && inputs.benchType) benchType.value = inputs.benchType;
  },

  async handleFormSubmit(e) {
    e.preventDefault();

    const generateBtn = document.getElementById('generateBtn');
    const btnText = document.getElementById('btnText');
    if (generateBtn) generateBtn.disabled = true;
    if (btnText) btnText.textContent = "Generating Your Plan...";

    const inputs = {
      raceDistance: document.getElementById('raceDistance').value,
      raceDate: document.getElementById('raceDate').value,
      currentFitness: document.getElementById('currentFitness').value,
      benchMinutes: parseInt(document.getElementById('benchMinutes').value, 10) || 25,
      benchSeconds: parseInt(document.getElementById('benchSeconds').value, 10) || 0,
      benchType: document.getElementById('benchType').value
    };

    try {
      const plan = await PlanEngine.generate(inputs);
      Storage.saveActivePlan(plan, inputs);
      this.renderPlan(plan, inputs);
      UI.showToast("Training plan generated and saved", "success");
      if (!plan.aiPowered) {
        UI.showToast("AI coach unavailable. Showing built-in coaching advice.", "warning");
      }

      // Smooth scroll to summary
      const planSec = document.getElementById('summaryCard');
      if (planSec) planSec.scrollIntoView({ behavior: 'smooth' });
    } catch (err) {
      console.error(err);
      UI.showToast(err.message || "Failed to generate plan", "error");
    } finally {
      if (generateBtn) generateBtn.disabled = false;
      if (btnText) btnText.textContent = "Generate Daily Plan";
    }
  },

  renderPlan(plan, inputs) {
    const coachQuestion = document.getElementById('coachQuestion');
    const coachAnswer = document.getElementById('coachAnswer');
    if (coachQuestion) coachQuestion.value = '';
    if (coachAnswer) {
      coachAnswer.textContent = '';
      coachAnswer.classList.add('hidden');
    }

    // 1. Race Predictor Summary Banner
    const summaryCard = document.getElementById('summaryCard');
    const raceNameEl = document.getElementById('summaryRaceName');
    const countdownEl = document.getElementById('summaryCountdown');
    const predTimeEl = document.getElementById('summaryPredictedTime');
    const targetPaceEl = document.getElementById('summaryTargetPace');

    const distDisplay = {
      '5k': '5K Race',
      '10k': '10K Race',
      '15k': '15K Race',
      'half': 'Half Marathon (13.1 mi)',
      'marathon': 'Full Marathon (26.2 mi)'
    }[inputs.raceDistance] || inputs.raceDistance;

    if (raceNameEl) raceNameEl.textContent = distDisplay;
    if (countdownEl) countdownEl.textContent = `${plan.diffDays} Days`;
    if (predTimeEl) predTimeEl.textContent = plan.predictedTime;
    if (targetPaceEl) targetPaceEl.textContent = plan.targetPace;
    if (summaryCard) summaryCard.classList.remove('hidden');

    // 2. AI Coach Advice Card
    const coachCard = document.getElementById('coachCard');
    const coachText = document.getElementById('coachText');
    const coachSource = document.getElementById('coachSource');

    if (coachText) coachText.textContent = plan.coachAdvice;
    if (coachSource) {
      coachSource.textContent = plan.aiPowered
        ? "Powered by OpenAI"
        : "Built-in advice (AI unavailable)";
    }
    if (coachCard) coachCard.classList.remove('hidden');

    // 3. Day-to-Day Checklist
    const planSection = document.getElementById('planSection');
    const container = document.getElementById('checklistContainer');
    if (!container) return;
    container.innerHTML = '';

    // Group days into weeks of 7
    let currentWeekEl = null;
    let weekIndex = 1;

    plan.days.forEach((day, idx) => {
      if (idx % 7 === 0) {
        currentWeekEl = document.createElement('div');
        currentWeekEl.className = 'week-group';
        const title = document.createElement('h3');
        title.className = 'week-title';
        title.textContent = `Week ${weekIndex}`;
        currentWeekEl.appendChild(title);
        container.appendChild(currentWeekEl);
        weekIndex++;
      }

      const isCompleted = !!AppState.completedTasks[day.id];

      const checkItem = document.createElement('label');
      checkItem.className = `check-item ${isCompleted ? 'is-done' : ''}`;
      checkItem.htmlFor = `input_${day.id}`;

      checkItem.innerHTML = `
        <input type="checkbox" id="input_${day.id}" class="check-input" ${isCompleted ? 'checked' : ''}>
        <div class="check-body">
          <div class="check-meta-row">
            <span class="check-date">${day.dateStr}</span>
            <span class="check-badge ${day.badgeClass}">${day.badgeText}</span>
          </div>
          <div class="check-title">${day.title}</div>
          <div class="check-desc">${day.desc}</div>
        </div>
      `;

      // Event listener for checkbox
      const inputEl = checkItem.querySelector('.check-input');
      inputEl.addEventListener('change', () => {
        const done = Storage.toggleTask(day.id);
        checkItem.classList.toggle('is-done', done);
        this.updateProgress(plan.days.length);
        this.updatePredictionDisplay();
        if (done) UI.showToast("Workout marked complete", "success");
      });

      currentWeekEl.appendChild(checkItem);
    });

    if (planSection) planSection.classList.remove('hidden');
    this.updateProgress(plan.days.length);
  },

  updateProgress(totalDays) {
    const completedCount = Object.keys(AppState.completedTasks).length;
    const percent = totalDays > 0 ? Math.round((completedCount / totalDays) * 100) : 0;

    const textEl = document.getElementById('progressText');
    const fillEl = document.getElementById('progressFill');

    if (textEl) textEl.textContent = `${completedCount} of ${totalDays} Completed (${percent}%)`;
    if (fillEl) fillEl.style.width = `${percent}%`;
    this.updatePredictionDisplay();
  },

  updatePredictionDisplay() {
    if (!AppState.plan || !AppState.inputs) return;

    const completedCount = Object.keys(AppState.completedTasks).length;
    const totalDays = AppState.plan.days?.length || 0;
    const completionPercent = totalDays > 0 ? Math.min(100, Math.round((completedCount / totalDays) * 100)) : 0;
    const baseline = Predictor.predict(
      AppState.inputs.benchType,
      AppState.inputs.benchMinutes,
      AppState.inputs.benchSeconds,
      AppState.inputs.raceDistance
    );
    const improvement = { beginner: 0.025, intermediate: 0.04, advanced: 0.055 }[AppState.inputs.currentFitness] || 0.03;
    const localTargetSeconds = baseline.predictedSeconds * (1 - improvement);
    const targetSeconds = AppState.plan.aiPredictionSeconds || localTargetSeconds;
    const progressFactor = completionPercent === 0 ? 1 : completionPercent / 100;
    const projectedSeconds = baseline.predictedSeconds + (targetSeconds - baseline.predictedSeconds) * progressFactor;
    const paceSeconds = Math.round(projectedSeconds / Predictor.distMiles[AppState.inputs.raceDistance]);

    const timeEl = document.getElementById('summaryPredictedTime');
    const paceEl = document.getElementById('summaryTargetPace');
    const noteEl = document.getElementById('summaryPredictionNote');
    if (timeEl) timeEl.textContent = Predictor.formatTime(projectedSeconds);
    if (paceEl) paceEl.textContent = `${Predictor.formatPace(paceSeconds)} /mi`;
    if (noteEl) {
      noteEl.textContent = completionPercent
        ? `After ${completionPercent}% of plan`
        : AppState.plan.aiPredictionSeconds ? 'AI estimate after full plan' : 'Estimated after full plan';
    }
  },

  showToast(msg, type = "info") {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = msg;

    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 220ms ease';
      setTimeout(() => toast.remove(), 250);
    }, 3200);
  }
};

// =========================================================================
// START APPLICATION
// =========================================================================
document.addEventListener('DOMContentLoaded', () => {
  Storage.init();
  UI.init();
});
