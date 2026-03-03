const { chromium } = require("playwright");
require("dotenv").config();

(async () => {
  const token = process.env.TOKEN;
  const gistId = process.env.GIST_ID;

  if (!gistId || !token) {
    console.warn("⚠️ TOKEN or GIST_ID missing. Ensure they are in your .env file.");
    return;
  }

  const { Octokit } = await import("@octokit/core");
  const octokit = new Octokit({ auth: token });

  // --- STEP 1: Fetch existing data from GitHub Gist ---
  let existingTendersMap = new Map();
  console.log("📥 Downloading existing tenders from Gist...");
  try {
    const gist = await octokit.request("GET /gists/{gist_id}", { gist_id: gistId });
    const fileContent = gist.data.files["gemTenders.json"]?.content;
    
    if (fileContent) {
      const existingTenders = JSON.parse(fileContent);
      // Map them by bidNumber to prevent duplicates and allow easy updates
      existingTenders.forEach(t => existingTendersMap.set(t.bidNumber, t));
      console.log(`✅ Loaded ${existingTendersMap.size} existing tenders from memory.`);
    }
  } catch (error) {
    console.log("⚠️ No existing data found or error fetching. Starting fresh.");
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    // --- STEP 2: Find total pages ---
    console.log(`📄 Loading initial page to calculate pagination...`);
    await page.goto("https://eprocure.gov.in/cppp/gemtender?page=1", {
      waitUntil: "domcontentloaded",
      timeout: 100000,
    });
    await page.waitForSelector("table#table.list_table", { timeout: 15000 });

    let totalPages = await page.evaluate(() => {
      const divs = document.querySelectorAll('div');
      for (const div of divs) {
        if (div.innerText && div.innerText.includes('Total Bid(s)')) {
          const match = div.innerText.match(/Total Bid\(s\)\s*:\s*(\d+)/i);
          if (match && match[1]) {
            return Math.ceil(parseInt(match[1], 10) / 10);
          }
        }
      }
      return 1;
    });

    console.log(`📊 Total pages available: ${totalPages}. Starting Reverse Incremental Scrape...`);

    // --- STEP 3: Loop Backwards (Newest to Oldest) ---
    let newTendersCount = 0;

    for (let currentPage = totalPages; currentPage >= 1; currentPage--) {
      const url = `https://eprocure.gov.in/cppp/gemtender?page=${currentPage}`;
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 100000 });
      await page.waitForSelector("table#table.list_table", { timeout: 15000 });

      const pageTenders = await page.$$eval(
        "table#table.list_table tbody tr",
        (rows) => {
          return rows.map((row) => {
            const cells = row.querySelectorAll("td");
            if (cells.length < 7) return null;

            const slNo = cells[0]?.innerText.trim() || "";
            const bidStartDate = cells[1]?.innerText.trim() || "";
            const bidEndDate = cells[2]?.innerText.trim() || "";
            const productCategory = cells[4]?.innerText.trim() || "";
            const organisation = cells[5]?.innerText.trim() || "";
            const department = cells[6]?.innerText.trim() || "";

            const bidLinkElement = cells[3]?.querySelector("a");
            const bidNumber = bidLinkElement ? bidLinkElement.innerText.trim() : "";
            const link = bidLinkElement ? bidLinkElement.getAttribute("href") : "";

            const fullBidText = cells[3]?.innerText.trim() || "";
            let quantity = fullBidText.replace(bidNumber, "").replace(/^\//, "").trim();

            return { slNo, bidNumber, quantity, bidStartDate, bidEndDate, productCategory, organisation, department, link };
          }).filter(Boolean);
        }
      );

      let existingCountInPage = 0;

      // Check each scraped tender against our memory Map
      for (const tender of pageTenders) {
        if (existingTendersMap.has(tender.bidNumber)) {
          existingCountInPage++;
        } else {
          newTendersCount++;
        }
        // Add to map (this adds new ones, and updates existing ones if details changed)
        existingTendersMap.set(tender.bidNumber, tender);
      }

      console.log(`✅ Page ${currentPage}: Scraped ${pageTenders.length} items. (${existingCountInPage} already existed)`);

      // THE KILL SWITCH: If every single tender on this page was already in our database, stop scraping.
      if (existingCountInPage === pageTenders.length && pageTenders.length > 0) {
        console.log(`🛑 Reached familiar data on page ${currentPage}. Stopping scraper to save time and bandwidth!`);
        break; 
      }

      await page.waitForTimeout(2000); // 2 sec delay to avoid IP ban
    }

    console.log(`🎉 Scraping complete! Added/Updated ${newTendersCount} new tenders.`);

    // --- STEP 4: Save & Upload ---
    // Convert the Map back to an Array
    const updatedTendersList = Array.from(existingTendersMap.values());

    console.log(`Updating Gist: ${gistId} with ${updatedTendersList.length} total active tenders...`);
    
    await octokit.request("PATCH /gists/{gist_id}", {
      gist_id: gistId,
      description: "Latest GeM active tenders from CPPP",
      files: {
        "gemTenders.json": {
          content: JSON.stringify(updatedTendersList, null, 2),
        },
      },
      headers: {
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    console.log("✅ Gist updated successfully!");

  } catch (err) {
    console.error(`⚠️ Error while scraping:`, err.message);
  } finally {
    await browser.close();
  }
})();