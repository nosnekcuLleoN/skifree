const path = require("path");
const PW = "C:\\Users\\lucke\\AppData\\Local\\npm-cache\\_npx\\af752b90495482d7\\node_modules\\rea-agents\\node_modules\\playwright-core";
const { chromium } = require(PW);

const CHROME = "C:\\Users\\lucke\\AppData\\Local\\ms-playwright\\chromium-1254\\chrome-win64\\chrome.exe";
const URL = "file:///C:/Users/lucke/skifree/index.html";
const OUT = "C:\\Users\\lucke\\skifree\\tests";

const results = [];
function check(name, cond, extra) {
  results.push({ name, ok: !!cond, extra: extra === undefined ? "" : String(extra) });
  console.log((cond ? "PASS  " : "FAIL  ") + name + (extra !== undefined ? "   [" + extra + "]" : ""));
}

(async () => {
  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--allow-file-access-from-files", "--autoplay-policy=no-user-gesture-required", "--mute-audio"]
  });
  const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });

  const errors = [];
  const requests = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("request", (r) => requests.push(r.url()));

  await page.goto(URL, { waitUntil: "load" });
  await page.waitForFunction(() => !!window.__SKIFREE__, null, { timeout: 5000 });

  const S = () => page.evaluate(() => window.__SKIFREE__.stats);
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const canvasShot = (n) => page.locator("#game").screenshot({ path: path.join(OUT, n) });
  // advance with a guaranteed clear lane (spawner still runs) for speed measurements
  const advClear = async (sec) => {
    const n = Math.max(1, Math.round(sec / 0.1));
    for (let i = 0; i < n; i++) {
      await ev(() => { window.__SKIFREE__.clearObstacles(); window.__SKIFREE__.advance(0.1); });
    }
  };

  // ---------- 1. boot ----------
  let s = await S();
  check("boots into ready state", s.state === "ready", s.state);
  check("starts at 0 distance", s.dist === 0, s.dist);
  check("starts with 0 style", s.style === 0, s.style);
  check("terrain pre-generated ahead", s.obstacles > 0, s.obstacles);
  check("no ski tracks at boot", s.tracks === 0, s.tracks);
  check("pixel smoothing disabled", await page.evaluate(() => document.getElementById("game").getContext("2d").imageSmoothingEnabled === false), "imageSmoothingEnabled");
  check("window title is SkiFree", (await page.title()) === "SkiFree", await page.title());
  check("title bar text", /SkiFree/.test(await page.locator(".titlebar .title").textContent()), await page.locator(".titlebar .title").textContent());
  check("credits in status bar", /Synapsespiral \| Copyright 2026 Synapse/.test(await page.locator("#statusMsg").textContent()), await page.locator("#statusMsg").textContent());

  await canvasShot("01-ready.png");
  await page.screenshot({ path: path.join(OUT, "00-page.png"), fullPage: false });

  // canvas actually painted (white snow + dark pixels)
  const paint = await page.evaluate(() => {
    const c = document.getElementById("game");
    const g = c.getContext("2d");
    const d = g.getImageData(0, 0, 640, 480).data;
    let white = 0, dark = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] > 250 && d[i + 1] > 250 && d[i + 2] > 250) white++;
      if (d[i] < 40 && d[i + 1] < 40 && d[i + 2] < 40) dark++;
    }
    return { white, dark, total: d.length / 4 };
  });
  check("snow background painted white", paint.white > paint.total * 0.5, paint.white + "/" + paint.total);
  check("sprite/text pixels rendered", paint.dark > 500, paint.dark);

  // HUD box has pixels
  const hud = await page.evaluate(() => {
    const g = document.getElementById("game").getContext("2d");
    const d = g.getImageData(416, 8, 216, 86).data;
    let dark = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] < 40 && d[i + 1] < 40 && d[i + 2] < 40) dark++;
    return dark;
  });
  check("HUD box drawn with black text", hud > 200, hud);

  const logo = await page.evaluate(() => {
    const g = document.getElementById("game").getContext("2d");
    const d = g.getImageData(150, 16, 260, 90).data;
    let blue = 0, yellow = 0, dark = 0;
    for (let i = 0; i < d.length; i += 4) {
      const [r, gg, b] = [d[i], d[i + 1], d[i + 2]];
      if (b > 120 && r < 60 && gg < 60) blue++;
      else if (r > 220 && gg > 180 && b < 60) yellow++;
      else if (r < 40 && gg < 40 && b < 40) dark++;
    }
    return { blue, yellow, dark };
  });
  check("in-world blue/yellow pixel logo", logo.blue > 100 && logo.yellow > 100, JSON.stringify(logo));
  check("in-world credit bitmap text", logo.dark > 200, logo.dark);

  // ---------- 2. start + movement ----------
  await ev(() => window.__SKIFREE__.pause());
  await page.keyboard.press("ArrowDown");
  await ev(() => window.__SKIFREE__.advance(0.05));
  s = await S();
  check("ArrowDown starts the run", s.state === "skiing", s.state);
  check("initial timer running", s.time > 0, s.time);

  await ev(() => window.__SKIFREE__.advance(1.0));
  s = await S();
  check("distance increases while skiing", s.dist > 0, s.dist);
  check("speed is positive", s.speed > 0, s.speed);
  check("ski tracks are left behind", s.tracks > 0, s.tracks);

  // ---------- 3. steering ----------
  await ev(() => { window.__SKIFREE__.setAngle(0); });
  const x0 = (await S()).x;
  await page.keyboard.down("ArrowLeft");
  await ev(() => window.__SKIFREE__.advance(0.6));
  await page.keyboard.up("ArrowLeft");
  let sl = await S();
  check("left steers negative x", sl.x < x0, sl.x + " < " + x0);
  check("left angle applied", sl.angle <= -1, sl.angle);

  const x1 = sl.x;
  await page.keyboard.down("ArrowRight");
  await ev(() => window.__SKIFREE__.advance(0.6));
  await page.keyboard.up("ArrowRight");
  let sr = await S();
  check("right steers positive x", sr.x > x1, sr.x + " > " + x1);
  check("right angle applied", sr.angle >= 0, sr.angle);

  // ---------- 4. boost ----------
  await ev(() => { window.__SKIFREE__.restart(); window.__SKIFREE__.pause(); });
  await page.keyboard.press("ArrowDown");
  await ev(() => window.__SKIFREE__.setAngle(0));
  await advClear(2.0);
  const cruise = (await S()).speed;
  await page.keyboard.down("f");
  await advClear(1.6);
  const boosted = (await S()).speed;
  await page.keyboard.up("f");
  check("boost increases speed", boosted > cruise + 40, cruise.toFixed(1) + " -> " + boosted.toFixed(1));
  check("boost below runaway cap", boosted < 500, boosted.toFixed(1));

  // ---------- 4b. braking / WASD / shift / space / R ----------
  await ev(() => window.__SKIFREE__.setAngle(0));
  await advClear(1.2);
  const preBrake = (await S()).speed;
  await page.keyboard.down("ArrowUp");
  await advClear(1.0);
  await page.keyboard.up("ArrowUp");
  const postBrake = (await S()).speed;
  check("Up/W brakes hard", postBrake < preBrake - 40, preBrake.toFixed(1) + " -> " + postBrake.toFixed(1));

  await ev(() => window.__SKIFREE__.setAngle(0));
  await page.keyboard.press("a");
  await ev(() => window.__SKIFREE__.advance(0.05));
  check("A key steers left", (await S()).angle < 0, (await S()).angle);
  await page.keyboard.press("d");
  await ev(() => window.__SKIFREE__.advance(0.05));
  check("D key steers right", (await S()).angle >= 0, (await S()).angle);

  await ev(() => window.__SKIFREE__.setAngle(0));
  await advClear(1.6);
  const preShift = (await S()).speed;
  await page.keyboard.down("Shift");
  await advClear(1.2);
  const postShift = (await S()).speed;
  await page.keyboard.up("Shift");
  check("Shift boosts", postShift > preShift + 30, preShift.toFixed(1) + " -> " + postShift.toFixed(1));

  await advClear(1.2);
  await page.keyboard.press("Space");
  await ev(() => window.__SKIFREE__.advance(0.05));
  const spJump = await S();
  check("Space jumps", spJump.air === true, "air=" + spJump.air);
  await ev(() => window.__SKIFREE__.advance(1.2));

  // ---------- 5. crash + style deduction ----------
  await ev(() => { window.__SKIFREE__.restart(); window.__SKIFREE__.pause(); });
  await page.keyboard.press("ArrowDown");
  await ev(() => {
    window.__SKIFREE__.advance(0.15);
    window.__SKIFREE__.setStyle(100);
    window.__SKIFREE__.setAngle(0);
    window.__SKIFREE__.clearObstacles();
    window.__SKIFREE__.spawnObstacle("tree", 0, 70);
    window.__SKIFREE__.advance(0.9);
  });
  let sc = await S();
  check("tree collision crashes skier", sc.state === "crashed", sc.state);
  check("crash deducts 25 style", sc.style === 75, sc.style);
  check("crash stops motion", sc.speed === 0, sc.speed);
  await canvasShot("05-crash.png");

  await ev(() => window.__SKIFREE__.advance(1.2));
  sc = await S();
  check("recovers from crash", sc.state === "skiing", sc.state);

  // ---------- 5b. collision with a procedurally generated obstacle ----------
  let naturalCrash = false, natType = "none";
  for (let attempt = 0; attempt < 4 && !naturalCrash; attempt++) {
    await ev(() => { window.__SKIFREE__.restart(); window.__SKIFREE__.pause(); });
    await page.keyboard.press("ArrowDown");
    const target = await page.evaluate(() => {
      const api = window.__SKIFREE__;
      api.setAngle(0);
      api.advance(0.6);
      const list = api.obstacleList
        .filter((o) => o.type !== "ramp" && o.screenY > 210 && o.screenY < 720)
        .sort((a, b) => a.screenY - b.screenY);
      if (!list.length) return null;
      api.setX(list[0].x);
      return list[0];
    });
    if (!target) continue;
    natType = target.type;
    for (let i = 0; i < 35 && !naturalCrash; i++) {
      await ev(() => window.__SKIFREE__.advance(0.1));
      const st = await S();
      if (st.state === "crashed") naturalCrash = true;
      if (st.state === "gameover") break;
    }
  }
  check("generated obstacle crashes skier", naturalCrash, "hit " + natType);

  // ---------- 6. jump ramp + airborne clearance ----------
  await ev(() => { window.__SKIFREE__.restart(); window.__SKIFREE__.pause(); });
  await page.keyboard.press("ArrowDown");
  await ev(() => {
    window.__SKIFREE__.setStyle(0);
    window.__SKIFREE__.setAngle(0);
    window.__SKIFREE__.clearObstacles();
    window.__SKIFREE__.spawnObstacle("ramp", 0, 90);
    window.__SKIFREE__.advance(0.9);
  });
  let sj = await S();
  check("ramp launches skier", sj.air === true, "air=" + sj.air);
  check("ramp awards 50 style", sj.style === 50, sj.style);

  await ev(() => {
    window.__SKIFREE__.spawnObstacle("tree", 0, 22);
    window.__SKIFREE__.advance(0.3);
  });
  let sa = await S();
  check("airborne skier clears obstacle", sa.state === "skiing", sa.state);
  check("still airborne mid-jump", sa.air === true, sa.air);

  await ev(() => window.__SKIFREE__.advance(0.8));
  sa = await S();
  check("lands safely", sa.air === false && sa.state === "skiing", sa.state + " air=" + sa.air);
  check("style retained after landing", sa.style === 50, sa.style);

  await ev(() => {
    const api = window.__SKIFREE__;
    api.setDistance(300);
    api.clearObstacles();
    api.setAngle(0);
    api.advance(1.0);
    api.jump();
    api.advance(0.4);
  });
  await canvasShot("06-jump.png");

  // ---------- 7. yeti chase ----------
  await ev(() => { window.__SKIFREE__.restart(); window.__SKIFREE__.pause(); });
  await page.keyboard.press("ArrowDown");
  await ev(() => window.__SKIFREE__.setAngle(0));
  await advClear(2.5);
  let sy = await S();
  check("yeti dormant before 500m", sy.yetiActive === false, "dist=" + sy.dist.toFixed(1) + " active=" + sy.yetiActive);

  await ev(() => { window.__SKIFREE__.setDistance(499); window.__SKIFREE__.setInvuln(60); window.__SKIFREE__.advance(2.0); });
  sy = await S();
  check("yeti spawns after 500m", sy.yetiActive === true, "dist=" + sy.dist.toFixed(1) + " active=" + sy.yetiActive);
  check("yeti visibly on screen during chase", sy.yetiY > 30 && sy.yetiY < 160 && sy.state === "skiing", "yetiY=" + sy.yetiY.toFixed(0) + " state=" + sy.state);
  const yetiPixels = await page.evaluate(() => {
    const g = document.getElementById("game").getContext("2d");
    const s = window.__SKIFREE__.stats;
    const x = Math.max(0, Math.round(s.x - 70));
    const y = Math.max(0, Math.round(s.yetiY - 80));
    const w = Math.min(140, 640 - x), h = Math.min(140, 480 - y);
    const d = g.getImageData(x, y, w, h).data;
    let grey = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] === 138 && d[i + 1] === 138 && d[i + 2] === 138) grey++;
    }
    return grey;
  });
  check("yeti grey sprite rendered", yetiPixels > 150, yetiPixels + " px");
  console.log("  pre-shot stats:", JSON.stringify(await S()));
  await canvasShot("02-chase.png");

  await page.keyboard.down("f");
  await ev(() => window.__SKIFREE__.advance(4.0));
  sy = await S();
  check("boost outruns the yeti", sy.yetiActive === true && sy.yetiCaught === false && sy.state === "skiing" && sy.yetiY < 20, "yetiY=" + sy.yetiY.toFixed(0) + " state=" + sy.state);
  await page.keyboard.up("f");

  let caughtState = null;
  for (let i = 0; i < 100; i++) {
    await ev(() => window.__SKIFREE__.advance(0.2));
    const st = await S();
    if (st.state === "eaten" || st.state === "gameover") { caughtState = st; break; }
  }
  check("yeti catches the skier", caughtState && caughtState.yetiCaught === true, caughtState ? "caught=" + caughtState.yetiCaught + " state=" + caughtState.state : "no catch");
  await ev(() => window.__SKIFREE__.advance(0.4));
  await canvasShot("07-chomp.png");

  await ev(() => window.__SKIFREE__.advance(3.0));
  sy = await S();
  check("game-over dialog reached", sy.state === "gameover", sy.state);
  await canvasShot("03-gameover.png");

  // ---------- 8. instant restart ----------
  const btn = await page.evaluate(() => {
    const r = document.getElementById("game").getBoundingClientRect();
    const b = window.__SKIFREE__.PLAY_BTN;
    return { x: r.left + (b.x + b.w / 2) * (r.width / 640), y: r.top + (b.y + b.h / 2) * (r.height / 480) };
  });
  await page.mouse.click(btn.x, btn.y);
  let sr2 = await S();
  check("PLAY AGAIN button restarts", sr2.state === "ready", sr2.state);
  check("restart clears distance", sr2.dist === 0, sr2.dist);
  check("restart clears style", sr2.style === 0, sr2.style);
  check("restart clears time", sr2.time === 0, sr2.time);
  check("restart resets yeti", sr2.yetiActive === false, sr2.yetiActive);
  check("restart clears tracks", sr2.tracks === 0, sr2.tracks);
  check("restart regenerates terrain", sr2.obstacles > 0, sr2.obstacles);

  // game over again, then Space restart
  await ev(() => { window.__SKIFREE__.eatNow(); window.__SKIFREE__.advance(3.0); });
  const preSpace = await S();
  check("debug eat path reaches gameover", preSpace.state === "gameover", preSpace.state);
  await page.keyboard.press("Space");
  let sr3 = await S();
  check("Space restarts after game over", sr3.state === "ready" && sr3.dist === 0, sr3.state);

  await ev(() => { window.__SKIFREE__.eatNow(); window.__SKIFREE__.advance(3.0); });
  await page.keyboard.press("Enter");
  const srEnter = await S();
  check("Enter restarts after game over", srEnter.state === "ready" && srEnter.dist === 0, srEnter.state);

  await page.keyboard.press("ArrowLeft");
  const sr4 = await S();
  check("controls work after restart", sr4.state === "skiing", sr4.state);

  await page.keyboard.press("F2");
  const sr5 = await S();
  check("F2 restarts instantly", sr5.state === "ready" && sr5.dist === 0, sr5.state);
  await page.keyboard.press("r");
  check("R restarts instantly", (await S()).state === "ready", (await S()).state);

  // ---------- 9. mute ----------
  const m1 = await ev(() => window.__SKIFREE__.mute());
  const label1 = await page.locator("#btnMute").textContent();
  check("mute toggles on", m1 === true && /OFF/.test(label1), label1);
  await page.click("#btnMute");
  const labelClick = await page.locator("#btnMute").textContent();
  check("mute button click toggles", /ON/.test(labelClick) && (await S()).muted === false, labelClick);
  await page.click("#btnMute");
  const labelClick2 = await page.locator("#btnMute").textContent();
  check("mute button re-mutes", /OFF/.test(labelClick2) && (await S()).muted === true, labelClick2);
  await ev(() => window.__SKIFREE__.mute());

  // ---------- 9b. natural 12s run ----------
  await page.keyboard.press("F2");
  await page.keyboard.press("ArrowDown");
  await ev(() => window.__SKIFREE__.advance(12));
  const nat = await S();
  check("12s natural run progresses", nat.dist > 100, nat.dist.toFixed(1));
  check("natural run state healthy", nat.state === "skiing" || nat.state === "crashed", nat.state);
  check("natural terrain keeps spawning", nat.obstacles > 3, nat.obstacles);
  check("natural ski tracks accumulate", nat.tracks > 40, nat.tracks);
  await canvasShot("04-skiing.png");

  // ---------- 9c. window chrome ----------
  await page.click("#btnMin");
  const collapsed = await page.evaluate(() => getComputedStyle(document.querySelector(".canvas-wrap")).display);
  check("minimize button collapses window", collapsed === "none", collapsed);
  await page.click("#btnMin");
  const restored = await page.evaluate(() => getComputedStyle(document.querySelector(".canvas-wrap")).display);
  check("minimize button restores window", restored !== "none", restored);
  await page.click("#btnClose");
  check("close button is decorative (no unload)", /CANNOT BE CLOSED/.test(await page.locator("#statusMsg").textContent()), await page.locator("#statusMsg").textContent());

  // ---------- 10. resize / fit ----------
  const dims = await page.evaluate(() => {
    const r = document.getElementById("game").getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height) };
  });
  check("canvas fits viewport", dims.w <= 1000 && dims.h <= 900 && dims.w > 0, dims.w + "x" + dims.h);

  await page.setViewportSize({ width: 1600, height: 1200 });
  await page.waitForTimeout(150);
  const big = await page.evaluate(() => {
    const r = document.getElementById("game").getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height) };
  });
  check("integer 2x scaling on large screens", big.w === 1280 && big.h === 960, big.w + "x" + big.h);

  // ---------- 11. console health ----------
  check("zero console/page errors", errors.length === 0, errors.join(" | "));
  check("self-contained (no external requests)", requests.every((u) => u.startsWith("file://")), requests.length + " local requests");

  await browser.close();

  const failed = results.filter((r) => !r.ok);
  console.log("\n" + (results.length - failed.length) + "/" + results.length + " checks passed");
  if (failed.length) {
    console.log("FAILED:");
    failed.forEach((f) => console.log(" - " + f.name + " [" + f.extra + "]"));
    process.exit(1);
  }
})().catch((e) => { console.error("HARNESS ERROR:", e); process.exit(2); });
