const { spawn } = require("child_process");

// Define your scraper scripts and a prefix for their logs
const scripts = [
  { file: "./scrappers/wb-tender-scrapper.js", prefix: "[WB TENDERS]" },
  { file: "./scrappers/coal-tender-scrapper.js", prefix: "[COAL INDIA]" },
  { file: "./scrappers/gem-bid-scrapper.js", prefix: "[GeM BIDS]" }
];

// Helper function to run a script and stream its output
function runScript({ file, prefix }) {
  return new Promise((resolve, reject) => {
    console.log(`🚀 Starting ${prefix}...`);
    
    const process = spawn("node", [file]);

    // Capture standard output (console.logs)
    process.stdout.on("data", (data) => {
      const lines = data.toString().trim().split('\n');
      lines.forEach(line => console.log(`${prefix} ${line}`));
    });

    // Capture error output (console.errors / crashes)
    process.stderr.on("data", (data) => {
      const lines = data.toString().trim().split('\n');
      lines.forEach(line => console.error(`${prefix} ❌ ERROR: ${line}`));
    });

    // Handle process completion
    process.on("close", (code) => {
      if (code === 0) {
        console.log(`✅ ${prefix} completed successfully.`);
        resolve();
      } else {
        console.error(`⚠️ ${prefix} exited with code ${code}.`);
        reject(new Error(`${prefix} failed.`));
      }
    });
  });
}

(async () => {
  console.log("🔥 LAUNCHING ALL SCRAPERS IN PARALLEL 🔥\n");
  const startTime = Date.now();

  try {
    // Promise.all fires them all at the exact same time
    await Promise.all(scripts.map(runScript));
    
    const timeTaken = ((Date.now() - startTime) / 1000 / 60).toFixed(2);
    console.log(`\n🎉 MASSIVE SUCCESS: All scrapers finished perfectly in ${timeTaken} minutes!`);
    process.exit(0);
  } catch (error) {
    console.error("\n❌ ALARM: One or more scrapers failed to complete.");
    process.exit(1);
  }
})();