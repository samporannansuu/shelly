// CONFIGURATION
const CONFIG = {
  // Uses 60-minute resolution to minimize memory usage across Gen2/Gen3
  url: "https://api.spot-hinta.fi/TodayAndDayForward?priceResolution=60",
  // Evaluation clock loop: Checks every 1 minute
  checkIntervalMs: 60 * 1000, 
  brightness: 100,
  
  // --- PARAMETER TOGGLES ---
  // Set to true to print the detailed text dashboard into the console logs
  debugLogs: false,
  // Set to true ONLY if running on a Gen3 device with created virtual components
  useVirtualComponents: false, 
  
  cheapPriceColor: [0, 100, 0], // Green
  expensivePriceColor: [100, 0, 0] // Red
};

let lastUpdatedHour = -1;
let currentLedColor = ""; 

function checkPricesAndSetLED(forced) {
  let now = new Date();
  let currentHour = now.getHours();
  
  // Enforce precise top-of-the-hour changes
  if (now.getMinutes() !== 0 && !forced)
  {
       console.log("Return not being first minute or forced");
       return;
  }
  
  if (currentHour === lastUpdatedHour && !forced) 
  {
       console.log("Return not being new hour or forced");
       return;
  }

   console.log("Read prices and update led status");
  
  Shelly.call("HTTP.GET", { url: CONFIG.url }, function (response, error_code, error_msg) {
    if (error_code !== 0 || !response || response.code !== 200) {
      if (CONFIG.debugLogs) console.log("PRICE SCRIPT ERROR: Could not reach price API.");
      return;
    }

    let body = response.body;
    if (!body || body.length < 10) return;

    let currentYear = now.getFullYear();
    let currentMonth = now.getMonth() + 1;
    let currentDay = now.getDate();
    
    if (currentMonth < 10) currentMonth = "0" + currentMonth;
    if (currentDay < 10) currentDay = "0" + currentDay;
    let todayStr = currentYear + "-" + currentMonth + "-" + currentDay;

    let dailySum = 0;
    let dailyCount = 0;
    let currentHourPrice = null;
    let nextHourPrice = null;
    let nextHour = (currentHour + 1) % 24;

    let searchIdx = 0;
    
    // Low-memory sequential text crawler safely replaces JSON.parse()
    while (true) {
      searchIdx = body.indexOf('"DateTime":', searchIdx);
      if (searchIdx === -1) break;

      let dtStart = body.indexOf('"', searchIdx + 11) + 1;
      let dtEnd = body.indexOf('"', dtStart);
      let entryTime = body.substring(dtStart, dtEnd);

      let priceMatchIdx = body.indexOf('"PriceWithTax":', dtEnd);
      let priceEndIdx = body.indexOf(',', priceMatchIdx);
      if (priceEndIdx === -1 || priceEndIdx > body.indexOf('}', priceMatchIdx)) {
        priceEndIdx = body.indexOf('}', priceMatchIdx);
      }
      let priceVal = parseFloat(body.substring(priceMatchIdx + 15, priceEndIdx));

      if (entryTime.indexOf(todayStr) === 0) {
        dailySum += priceVal;
        dailyCount++;
      }

      let entryHour = parseInt(entryTime.substring(11, 13), 10);
      if (entryHour === currentHour && entryTime.indexOf(todayStr) === 0) {
        currentHourPrice = priceVal;
      }
      if (entryHour === nextHour) {
        if (nextHour === 0 || entryTime.indexOf(todayStr) === 0) {
          nextHourPrice = priceVal;
        }
      }

      searchIdx = priceEndIdx;
    }

    if (dailyCount === 0 || currentHourPrice === null || nextHourPrice === null) {
      if (CONFIG.debugLogs) console.log("PRICE SCRIPT ERROR: Failed to isolate time frames.");
      return;
    }

    let dailyAverage = dailySum / dailyCount;
    
    // --- INDIVIDUAL HOUR EVALUATION ---
    // Both hours must be strictly cheaper than the daily average to stay green
    let isCurrentHourCheap = currentHourPrice < dailyAverage;
    let isNextHourCheap = nextHourPrice < dailyAverage;
    let isCheapWindow = isCurrentHourCheap && isNextHourCheap;
    let targetColor = isCheapWindow ? "GREEN" : "RED";

    let statusText = isCheapWindow ? "CHEAP (Both hours below average)" : "EXPENSIVE (One or both hours above average)";

    // --- 1. SYSTEM CONSOLE LOGGING ---
    if (CONFIG.debugLogs) {
      console.log("ELECTRICITY MONITOR DASHBOARD (" + currentHour + ":00)");
      console.log("Today's Daily Avg:  ", dailyAverage);
      console.log("Current Hour Price: ", currentHourPrice, isCurrentHourCheap ? "(CHEAP)" : "(PRICEY)");
      console.log("Next Hour Price:    ", nextHourPrice, isNextHourCheap ? "(CHEAP)" : "(PRICEY)");
      console.log("LED Status Applied: ", statusText);
    }

    // --- 2. GEN3 VIRTUAL COMPONENTS DASHBOARD OVERLAY ---
    if (CONFIG.useVirtualComponents) {
      Shelly.call("Number.Set", { id: "number:daily_avg", value: dailyAverage });
      // We pass the current hour price to the virtual component component
      Shelly.call("Number.Set", { id: "number:two_hour_avg", value: currentHourPrice }); 
      Shelly.call("Text.Set", { id: "text:led_status", value: statusText });
    }

    if (targetColor === currentLedColor) {
       if (CONFIG.debugLogs) console.log("Color is already " + targetColor + ". Skipping physical API call to protect flash storage.");
    }   
    else {
       if (CONFIG.debugLogs) console.log("State change detected! Changing LED to " + targetColor);
      
       if (targetColor === "GREEN") {
         setPlugLedColor(CONFIG.cheapPriceColor); // Pure Green
       } else {
        setPlugLedColor(CONFIG.expensivePriceColor); // Pure Red
       }      
      // Update the RAM state tracker
      currentLedColor = targetColor;
    }

    lastUpdatedHour = currentHour;
  });
}

function setPlugLedColor(rgbArray) {
  console.log("SettingLed");
  Shelly.call("PLUGS_UI.SetConfig", {
    config: {
      leds: { mode: "switch", colors: { "switch:0": {
        on: { rgb: rgbArray, brightness: CONFIG.brightness },
        off: { rgb: rgbArray, brightness: CONFIG.brightness }
      }}}
    }
  });
}

// Initial execution call
checkPricesAndSetLED(true);

Timer.set(CONFIG.checkIntervalMs, true, function () {
  checkPricesAndSetLED(false);
});