// ==========================================
// 1. STATE MANAGEMENT & LOCAL STORAGE DEFAULTS
// ==========================================
const DEFAULT_CLUBS = [
  { name: "Driver", distance: 220, hits: 0 },
  { name: "5-Wood", distance: 200, hits: 0 },
  { name: "3-Hybrid", distance: 190, hits: 0 },
  { name: "5-Iron", distance: 170, hits: 0 },
  { name: "6-Iron", distance: 160, hits: 0 },
  { name: "7-Iron", distance: 150, hits: 0 },
  { name: "8-Iron", distance: 140, hits: 0 },
  { name: "9-Iron", distance: 130, hits: 0 },
  { name: "Pitching Wedge", distance: 120, hits: 0 },
  { name: "Gap Wedge", distance: 110, hits: 0 },
  { name: "Sand Wedge", distance: 80, hits: 0 },
  { name: "Lob Wedge", distance: 60, hits: 0 }
];

let clubDatabase = JSON.parse(localStorage.getItem('caddie_clubs')) || DEFAULT_CLUBS;
let playerProfile = JSON.parse(localStorage.getItem('caddie_profile')) || {
  handicap: 14,
  lateralBias: 0,
  distanceBias: 0
};
let roundHistory = JSON.parse(localStorage.getItem('caddie_rounds')) || [];

// Scorekeeping State
let currentHole = 1;
let currentHolePar = 4;
let currentHoleStrokes = 0;
let completedHoles = []; 

// GPS & Course State
let targetPin = { lat: 40.440624, lng: -79.995888 }; 
let currentCourseData = null; // Stored OSM course features

let currentPos = null;
let playsLikeDistYards = 0;
let recommendedClubObj = null;
let currentStrategy = "";
let wakeLock = null;

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognizer;

// ==========================================
// 2. INITIALIZATION & LISTENERS
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
  // --- REGISTER SERVICE WORKER EARLY ---
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => console.log('Service Worker registered successfully:', reg.scope))
      .catch(err => console.error('Service Worker registration failed:', err));
  }

  document.getElementById('startBtn').addEventListener('click', initCaddie);
  updateProfileUI();
  updateScoreUI();
  renderRoundHistory();
});

async function initCaddie() {
  document.getElementById('startBtn').style.display = 'none';
  updateStatus("Voice Listening Active", true);

  // 1. Activate Screen Wake Lock automatically
  await requestWakeLock();

  // 2. Continuous GPS Geolocation
  if ("geolocation" in navigator) {
    navigator.geolocation.watchPosition(
      onPositionUpdate, 
      (err) => console.error("GPS Error:", err),
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
    );
  } else {
    alert("Geolocation is not supported by your browser.");
  }

  // 3. Continuous Voice Engine
  initVoiceEngine();
}

// ==========================================
// 3. VOICE ENGINE & COMMAND PARSER
// ==========================================
function initVoiceEngine() {
  if (!SpeechRecognition) {
    alert("Web Speech API is not supported on this device/browser.");
    return;
  }

  recognizer = new SpeechRecognition();
  recognizer.continuous = true;
  recognizer.interimResults = false;
  recognizer.lang = 'en-US';

  recognizer.onresult = (event) => {
    const transcript = event.results[event.results.length - 1][0].transcript.toLowerCase().trim();
    console.log("Caddie Heard:", transcript);
    parseVoiceCommand(transcript);
  };

  recognizer.onend = () => recognizer.start();
  recognizer.start();
}

function parseVoiceCommand(speech) {
  // Par Settings
  if (speech.includes("par 3") || speech.includes("par three")) {
    currentHolePar = 3; updateScoreUI(); speakFeedback(`Hole ${currentHole} set to Par 3.`); return;
  }
  if (speech.includes("par 4") || speech.includes("par four")) {
    currentHolePar = 4; updateScoreUI(); speakFeedback(`Hole ${currentHole} set to Par 4.`); return;
  }
  if (speech.includes("par 5") || speech.includes("par five")) {
    currentHolePar = 5; updateScoreUI(); speakFeedback(`Hole ${currentHole} set to Par 5.`); return;
  }

  // Stroke Logging
  if (speech.includes("add stroke") || speech.includes("count shot") || speech.includes("add shot")) {
    currentHoleStrokes++;
    updateScoreUI();
    speakFeedback(`Stroke ${currentHoleStrokes} logged.`);
    return;
  }

  // Hole Completion
  if (speech.includes("next hole") || speech.includes("finish hole") || speech.includes("hole complete")) {
    completedHoles.push({ hole: currentHole, par: currentHolePar, strokes: currentHoleStrokes });
    const relText = getRelativeScoreSpeech(completedHoles);
    speakFeedback(`Hole ${currentHole} logged with ${currentHoleStrokes} strokes. You are currently ${relText}. Moving to hole ${currentHole + 1}.`);

    currentHole++;
    currentHoleStrokes = 0;
    currentHolePar = 4;
    updateScoreUI();
    return;
  }

  // Score Inquiry
  if (speech.includes("what's my score") || speech.includes("current score") || speech.includes("total score")) {
    const relText = getRelativeScoreSpeech(completedHoles, currentHoleStrokes, currentHolePar);
    speakFeedback(`You are on hole ${currentHole} with ${currentHoleStrokes} strokes. Overall you are ${relText}.`);
    return;
  }

  // Distance & Club Advice
  if (speech.includes("caddie") || speech.includes("club") || speech.includes("distance") || speech.includes("play")) {
    speakRecommendation();
    return;
  }

  // Shot Performance Logs
  if (speech.includes("good shot") || speech.includes("in target") || speech.includes("hit green")) {
    currentHoleStrokes++; logShot('hit'); updateScoreUI(); speakFeedback(`Target hit logged. Stroke ${currentHoleStrokes} counted.`);
  } else if (speech.includes("short")) {
    logShot('short'); speakFeedback("Logged short miss. Adjusting club yardages up.");
  } else if (speech.includes("long")) {
    logShot('long'); speakFeedback("Logged long miss. Adjusting club yardages down.");
  } else if (speech.includes("left")) {
    logShot('left'); speakFeedback("Logged left miss. Updating draw bias.");
  } else if (speech.includes("right")) {
    logShot('right'); speakFeedback("Logged right miss. Updating fade bias.");
  }
}

// ==========================================
// 4. GPS & TELEMETRY ENGINE
// ==========================================
async function onPositionUpdate(position) {
  currentPos = {
    lat: position.coords.latitude,
    lng: position.coords.longitude
  };

  // 1. Fetch dynamic OpenStreetMap course data once GPS locks on
  if (!currentCourseData) {
    currentCourseData = await fetchLocalCourseFeatures(currentPos.lat, currentPos.lng);
  }

  // 2. Compute Front, Center, & Back distances if green data is available
  if (currentCourseData && currentCourseData.nearestGreen) {
    const green = currentCourseData.nearestGreen;
    const distances = getGreenDistances(currentPos, green.boundary);

    if (distances) {
      targetPin = distances.centerPos;

      // Update UI distance elements if they exist
      const frontElem = document.getElementById('frontDist');
      const centerElem = document.getElementById('centerDist');
      const backElem = document.getElementById('backDist');
      
      if (frontElem) frontElem.innerText = `${distances.front} yd`;
      if (centerElem) centerElem.innerText = `${distances.center} yd`;
      if (backElem) backElem.innerText = `${distances.back} yd`;

      const rawYards = distances.center;
      const rawElem = document.getElementById('rawDistance');
      if (rawElem) rawElem.innerText = `${Math.round(rawYards)} yd`;

      try {
        const [elevDiff, windData] = await Promise.all([
          getElevationDiffMeters(currentPos, targetPin),
          getWindData(currentPos)
        ]);

        const elevAdjustYards = elevDiff * 1.09361; 
        const windAdjustYards = calculateWindAdjustment(currentPos, targetPin, windData, rawYards);

        playsLikeDistYards = Math.round(rawYards + elevAdjustYards + windAdjustYards + playerProfile.distanceBias);

        // Course-Aware Strategy Execution
        const strategy = runCourseManagementEngine(
          currentPos, 
          targetPin, 
          rawYards, 
          playsLikeDistYards, 
          currentCourseData
        );
        
        recommendedClubObj = getBestClub(strategy.targetDistance);
        currentStrategy = strategy.advice;

        document.getElementById('playsLike').innerText = `${playsLikeDistYards} yd`;
        document.getElementById('recommendedClub').innerText = `Club: ${recommendedClubObj.name}`;
        document.getElementById('strategyAdvice').innerText = strategy.advice;
        document.getElementById('elevDiff').innerText = `${Math.round(elevAdjustYards)} yd`;
        document.getElementById('windInfo').innerText = `${Math.round(windData.speed)} mph @ ${windData.direction}°`;

      } catch (err) {
        console.warn("API Error - Falling back to center distance strategy:", err);
        playsLikeDistYards = Math.round(rawYards);
        
        const strategy = runCourseManagementEngine(
          currentPos, 
          targetPin, 
          rawYards, 
          playsLikeDistYards, 
          currentCourseData
        );

        recommendedClubObj = getBestClub(strategy.targetDistance);
        currentStrategy = strategy.advice;
        
        document.getElementById('playsLike').innerText = `${playsLikeDistYards} yd`;
        document.getElementById('recommendedClub').innerText = `Club: ${recommendedClubObj.name}`;
        document.getElementById('strategyAdvice').innerText = strategy.advice;
      }
    }
  } else {
    // Fallback if no OpenStreetMap green boundary is mapped nearby
    const rawYards = calculateHaversineDistanceYards(currentPos, targetPin);
    document.getElementById('rawDistance').innerText = `${Math.round(rawYards)} yd`;
    playsLikeDistYards = Math.round(rawYards);
    
    const strategy = runCourseManagementEngine(
      currentPos, 
      targetPin, 
      rawYards, 
      playsLikeDistYards, 
      null
    );

    recommendedClubObj = getBestClub(strategy.targetDistance);
    currentStrategy = strategy.advice;

    document.getElementById('playsLike').innerText = `${playsLikeDistYards} yd`;
    document.getElementById('recommendedClub').innerText = `Club: ${recommendedClubObj.name}`;
    document.getElementById('strategyAdvice').innerText = strategy.advice;
  }
}

// ==========================================
// 5. SCREEN WAKE LOCK CONTROL
// ==========================================
async function requestWakeLock() {
  if ('wakeLock' in navigator) {
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      console.log('Screen Wake Lock active');
    } catch (err) {
      console.error(`Wake Lock Error: ${err.name}, ${err.message}`);
    }
  }
}

document.addEventListener('visibilitychange', async () => {
  if (wakeLock !== null && document.visibilityState === 'visible') {
    await requestWakeLock();
  }
});

// ==========================================
// 6. COURSE-AWARE STRATEGY & SHOT LOGGING
// ==========================================
function runCourseManagementEngine(userPos, targetPin, rawYards, playsLikeYards, courseData) {
  let targetDistance = playsLikeYards;
  let advice = [];

  // 1. Standard Distance Logic
  if (rawYards > 120) {
    advice.push("Aim for the center of the green to maximize your margin for error.");
  } else {
    advice.push("You're in wedge range — attack the pin directly.");
  }

  // 2. Dynamic Course Analysis (OpenStreetMap Hazard Data)
  if (courseData && userPos && targetPin) {
    const headingToPin = calculateHeading(userPos, targetPin);

    // Analyze Bunkers
    if (courseData.bunkers && courseData.bunkers.length > 0) {
      courseData.bunkers.forEach(bunker => {
        const distToBunker = calculateHaversineDistanceYards(userPos, bunker.center);
        // Look for bunkers near the approach target (within 30 yards)
        if (Math.abs(distToBunker - rawYards) < 30) {
          const bunkerHeading = calculateHeading(userPos, bunker.center);
          const relativeAngle = ((bunkerHeading - headingToPin + 540) % 360) - 180;

          if (relativeAngle < -10) {
            advice.push("Bunker guarding the left side — lean toward the right center.");
          } else if (relativeAngle > 10) {
            advice.push("Bunker guarding the right side — favor the left side of the green.");
          } else if (distToBunker < rawYards) {
            targetDistance += 5; // Add depth safety
            advice.push("Short bunker detected — take extra club to clear it safely.");
          }
        }
      });
    }

    // Analyze Water Hazards
    if (courseData.hazards && courseData.hazards.length > 0) {
      courseData.hazards.forEach(hazard => {
        const distToWater = calculateHaversineDistanceYards(userPos, hazard.center);
        if (Math.abs(distToWater - rawYards) < 40) {
          targetDistance += 7;
          advice.push("Water in play near the target — playing it conservative with extra yardage.");
        }
      });
    }
  }

  // 3. Player Bias Adjustments
  if (playerProfile.lateralBias > 2) {
    advice.push("Account for your stock fade: aim 8 yards left of your target.");
  } else if (playerProfile.lateralBias < -2) {
    advice.push("Account for your stock draw: aim 8 yards right of your target.");
  }

  return {
    targetDistance,
    advice: advice.join(" ")
  };
}

function logShot(type) {
  if (!recommendedClubObj) return;

  const club = clubDatabase.find(c => c.name === recommendedClubObj.name);
  if (!club) return;

  if (type === 'short') {
    club.distance += 2;
    playerProfile.distanceBias += 1;
  } else if (type === 'long') {
    club.distance -= 2;
    playerProfile.distanceBias -= 1;
  } else if (type === 'left') {
    playerProfile.lateralBias -= 1;
  } else if (type === 'right') {
    playerProfile.lateralBias += 1;
  } else if (type === 'hit') {
    club.hits += 1;
  }

  localStorage.setItem('caddie_clubs', JSON.stringify(clubDatabase));
  localStorage.setItem('caddie_profile', JSON.stringify(playerProfile));

  updateProfileUI();
}

// ==========================================
// 7. SCOREKEEPING & HISTORY UTILITIES
// ==========================================
function updateScoreUI() {
  const holeElem = document.getElementById('currentHoleDisplay');
  const strokesElem = document.getElementById('holeStrokesDisplay');
  const totalElem = document.getElementById('totalScoreDisplay');

  if (holeElem) holeElem.innerText = `Hole ${currentHole} (Par ${currentHolePar})`;
  if (strokesElem) strokesElem.innerText = `${currentHoleStrokes} strokes`;
  
  if (totalElem) {
    const relScore = calculateRelativeScore(completedHoles, currentHoleStrokes, currentHolePar);
    totalElem.innerText = relScore.formatted;
  }
}

function calculateRelativeScore(completed, activeStrokes = 0, activePar = 0) {
  let totalStrokes = completed.reduce((acc, h) => acc + h.strokes, 0) + activeStrokes;
  let totalPar = completed.reduce((acc, h) => acc + h.par, 0) + (activeStrokes > 0 ? activePar : 0);
  
  let diff = totalStrokes - totalPar;
  
  if (diff === 0) return { diff: 0, formatted: "E (0)" };
  if (diff > 0) return { diff: diff, formatted: `+${diff} (${totalStrokes})` };
  return { diff: diff, formatted: `${diff} (${totalStrokes})` };
}

function getRelativeScoreSpeech(completed, activeStrokes = 0, activePar = 0) {
  const score = calculateRelativeScore(completed, activeStrokes, activePar);
  if (score.diff === 0) return "even par";
  if (score.diff > 0) return `${score.diff} over par`;
  return `${Math.abs(score.diff)} under par`;
}

function saveRoundToHistory() {
  if (completedHoles.length === 0) return;

  const totalStrokes = completedHoles.reduce((acc, h) => acc + h.strokes, 0);
  const totalPar = completedHoles.reduce((acc, h) => acc + h.par, 0);
  const diff = totalStrokes - totalPar;

  const roundEntry = {
    date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    holesCount: completedHoles.length,
    strokes: totalStrokes,
    par: totalPar,
    relativeScore: diff > 0 ? `+${diff}` : (diff === 0 ? 'E' : `${diff}`)
  };

  roundHistory.unshift(roundEntry);
  localStorage.setItem('caddie_rounds', JSON.stringify(roundHistory));
  renderRoundHistory();
}

function renderRoundHistory() {
  const historyList = document.getElementById('historyList');
  if (!historyList) return;

  if (roundHistory.length === 0) {
    historyList.innerHTML = '<li>No saved rounds yet.</li>';
    return;
  }

  historyList.innerHTML = roundHistory.slice(0, 5).map(r => `
    <li>
      <span>${r.date} (${r.holesCount} holes)</span>
      <strong>${r.relativeScore} (${r.strokes})</strong>
    </li>
  `).join('');
}

function updateProfileUI() {
  let biasText = "Neutral";
  if (playerProfile.lateralBias > 2) biasText = "Fade / Slice";
  if (playerProfile.lateralBias < -2) biasText = "Draw / Hook";
  
  const biasElem = document.getElementById('playerBias');
  if (biasElem) biasElem.innerText = biasText;
}

function getBestClub(yards) {
  const sortedClubs = [...clubDatabase].sort((a,b) => Math.abs(a.distance - yards) - Math.abs(b.distance - yards));
  return sortedClubs[0];
}

function speakRecommendation() {
  if (!playsLikeDistYards || !recommendedClubObj) return;
  const speechText = `Plays like ${playsLikeDistYards} yards. I recommend your ${recommendedClubObj.name}. ${currentStrategy}`;
  const utterance = new SpeechSynthesisUtterance(speechText);
  window.speechSynthesis.speak(utterance);
}

function speakFeedback(message) {
  const utterance = new SpeechSynthesisUtterance(message);
  window.speechSynthesis.speak(utterance);
}

// ==========================================
// 8. MATH & TELEMETRY HELPERS
// ==========================================
function calculateHaversineDistanceYards(pos1, pos2) {
  const R = 6371e3;
  const rad = Math.PI / 180;
  const dLat = (pos2.lat - pos1.lat) * rad;
  const dLng = (pos2.lng - pos1.lng) * rad;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(pos1.lat * rad) * Math.cos(pos2.lat * rad) *
            Math.sin(dLng/2) * Math.sin(dLng/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return (R * c) * 1.09361;
}

function calculateHeading(pos1, pos2) {
  const rad = Math.PI / 180;
  const dLng = (pos2.lng - pos1.lng) * rad;
  const lat1 = pos1.lat * rad;
  const lat2 = pos2.lat * rad;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function calculateWindAdjustment(pos1, pos2, wind, rawDistance) {
  const targetHeading = calculateHeading(pos1, pos2);
  const relativeAngle = ((wind.direction - targetHeading + 540) % 360) - 180;
  const headwindComponent = wind.speed * Math.cos(relativeAngle * Math.PI / 180);
  return rawDistance * (headwindComponent * 0.01);
}

async function getElevationDiffMeters(pos1, pos2) {
  const res = await fetch(`https://api.open-elevation.com/api/v1/lookup?locations=${pos1.lat},${pos1.lng}|${pos2.lat},${pos2.lng}`);
  const data = await res.json();
  return data.results[1].elevation - data.results[0].elevation;
}

async function getWindData(pos) {
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${pos.lat}&longitude=${pos.lng}&current_weather=true`);
  const data = await res.json();
  return {
    speed: data.current_weather.windspeed * 0.621371,
    direction: data.current_weather.winddirection
  };
}

function updateStatus(text, isActive) {
  const badge = document.getElementById('status');
  if (badge) {
    badge.innerText = text;
    if (isActive) badge.classList.add('active');
    else badge.classList.remove('active');
  }
}

// ==========================================
// 9. OPENSTREETMAP & GREEN BOUNDARY FETCH
// ==========================================
async function fetchLocalCourseFeatures(lat, lng) {
  const overpassQuery = `
    [out:json][timeout:25];
    (
      node["golf"](around:3000, ${lat}, ${lng});
      
