// CurrentAndNextHourAreBelowDaily v2 - Gen3 memory rework.
// Same rule as v1: LED green while the current AND next hour are both below
// today's average. Run only ONE of v1/v2 at a time; both drive the same LED.
//
// Tuned for Plug S Gen3, where a script gets ~25KB and an mJS out-of-memory is
// an unrecoverable kill. The full day is fetched once, only to average it; the
// two hours that drive the LED come from single-object JustNow calls of ~116
// bytes. JustNow?lookForwardHours=1 rolls over midnight on its own, so there is
// no tomorrow-fetch, no hour indexing and no DST special case.

const CONFIG = {
  urlDay: "https://api.spot-hinta.fi/Today?priceResolution=60",            // 3.1KB, once a day
  urlNow: "https://api.spot-hinta.fi/JustNow?priceResolution=60",          // 116 bytes
  urlNext: "https://api.spot-hinta.fi/JustNow?priceResolution=60&lookForwardHours=1",
  checkIntervalMs: 60 * 1000,
  brightness: 100,

  debugLogs: false,
  logMemory: false,

  cheapPriceColor: [0, 100, 0],
  expensivePriceColor: [100, 0, 0]
};

// --- state
let avg = null;      // today's average price
let avgDay = "";     // day that avg belongs to
let nowPrice = null; // carried between the two JustNow calls
let doneHour = -1;
let led = "";
let busy = false;
let skip = 0;        // tick backoff after a failed fetch

function dayKey(d) {
  let m = d.getMonth() + 1;
  let n = d.getDate();
  return d.getFullYear() + "-" + (m < 10 ? "0" + m : "" + m) + "-" + (n < 10 ? "0" + n : "" + n);
}

function logMem() {
  let s = Shelly.getComponentStatus("script", Shelly.getCurrentScriptId());
  if (s) console.log("mem used=" + s.mem_used + " peak=" + s.mem_peak + " free=" + s.mem_free);
}

// Pull PriceWithTax out of a single-object JustNow response.
function onePrice(res, ec) {
  if (ec !== 0 || !res || res.code !== 200 || !res.body) {
    if (CONFIG.debugLogs) console.log("hour fetch failed " + ec);
    return null;
  }
  let p = res.body.indexOf('"PriceWithTax":');
  let e = p < 0 ? -1 : res.body.indexOf('}', p);
  if (p < 0 || e <= p) return null;
  return parseFloat(res.body.substring(p + 15, e));
}

// Average every PriceWithTax in the day payload. No DateTime parsing, so a
// 23 or 25 hour DST day averages correctly with no extra code. JSON.parse()
// on this payload does not fit the script budget.
function crawlAvg(body) {
  let i = 0;
  let sum = 0;
  let n = 0;
  let g = 0;

  while (g < 400) {
    g++;
    let p = body.indexOf('"PriceWithTax":', i);
    if (p < 0) break;
    let e = body.indexOf('}', p);
    if (e < 0) break;
    sum += parseFloat(body.substring(p + 15, e));
    n++;
    if (e <= i) break; // guarantee forward progress
    i = e;
  }

  return n > 0 ? sum / n : null;
}

// --- daily average
function fetchAvg(dayStr) {
  if (busy) return;
  busy = true;
  Shelly.call("HTTP.GET", { url: CONFIG.urlDay }, function (res, ec, em) {
    busy = false;

    let v = null;
    if (ec !== 0 || !res || res.code !== 200 || !res.body) {
      if (CONFIG.debugLogs) console.log("day fetch failed " + ec + " " + em);
    } else {
      v = crawlAvg(res.body);
      res.body = null; // release the 3KB string before anything else runs
    }

    if (v === null) {
      skip = 5;
      // Keep yesterday's average rather than going dark, so the LED still
      // tracks while the day fetch is retried.
      if (avg !== null) fetchPair();
      return;
    }

    avg = v;
    avgDay = dayStr;
    skip = 0;
    if (CONFIG.logMemory) logMem();
    fetchPair();
  });
}

// --- current + next hour, two 116 byte calls chained through named callbacks
// so nothing is nested (deep anonymous nesting crashes the parser)
function fetchPair() {
  if (busy || avg === null) return;
  busy = true;
  Shelly.call("HTTP.GET", { url: CONFIG.urlNow }, onNow);
}

function onNow(res, ec, em) {
  nowPrice = onePrice(res, ec);
  if (nowPrice === null) { busy = false; skip = 2; return; }
  Shelly.call("HTTP.GET", { url: CONFIG.urlNext }, onNext);
}

function onNext(res, ec, em) {
  busy = false;
  let nxt = onePrice(res, ec);
  if (nxt === null) { skip = 2; return; }
  apply(nowPrice, nxt);
}

function apply(cur, nxt) {
  // both hours must be strictly cheaper than the daily average to stay green
  let curCheap = cur < avg;
  let nxtCheap = nxt < avg;
  let cheap = curCheap && nxtCheap;
  let target = cheap ? "GREEN" : "RED";
  let text = cheap ? "Led : Green" : "Led: Red";

  if (CONFIG.debugLogs) {
    console.log("ELECTRICITY MONITOR");
    console.log("Daily Avg :", avg);
    console.log("This hour :", cur, curCheap ? "(CHEAP)" : "(PRICEY)");
    console.log("Next hour :", nxt, nxtCheap ? "(CHEAP)" : "(PRICEY)");
    console.log("LED       :", text);
  }

  if (target !== led) {
    if (CONFIG.debugLogs) console.log("changing LED to " + target);
    setLed(cheap ? CONFIG.cheapPriceColor : CONFIG.expensivePriceColor);
    led = target;
  }

  doneHour = new Date().getHours();
}

function setLed(rgb) {
  Shelly.call("PLUGS_UI.SetConfig", {
    config: {
      leds: { mode: "switch", colors: { "switch:0": {
        on: { rgb: rgb, brightness: CONFIG.brightness },
        off: { rgb: rgb, brightness: CONFIG.brightness }
      }}}
    }
  }, function (res, ec, em) {
    if (ec !== 0 && CONFIG.debugLogs) console.log("LED set failed " + ec + " " + em);
  });
}

// Acts on any hour change rather than requiring minute === 0, so a drifted or
// skipped tick no longer costs a whole hour.
function tick() {
  if (skip > 0) { skip--; return; }

  let now = new Date();
  let dayStr = dayKey(now);

  if (dayStr !== avgDay) { fetchAvg(dayStr); return; }
  if (now.getHours() !== doneHour) fetchPair();
}

// No fetch at startup on purpose. The first tick runs a minute from now, once
// the script has finished loading, so pressing Play cannot spike memory and
// kill the script again on a device that is already short of heap.
Timer.set(CONFIG.checkIntervalMs, true, tick, null);
