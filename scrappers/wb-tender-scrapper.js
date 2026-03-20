const { chromium } = require("playwright");
const { generateMaskedID, uploadToAppwrite, chunkArray } = require("./utils");

(async () => {
  const browser = await chromium.launch({ headless: true });
  
  // 1. ADD STEALTH MODE (Bypass the firewall)
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    extraHTTPHeaders: {
      "Accept-Language": "en-US,en;q=0.9",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    }
  });

  const page = await context.newPage();

  console.log("🚀 Launching browser...");
  await page.goto(
    "https://wbtenders.gov.in/nicgep/app?page=FrontEndTendersByOrganisation&service=page",
    { waitUntil: "domcontentloaded", timeout: 100000 },
  );

  console.log("✅ WB Tender Page loaded");
  await page.waitForSelector("table.list_table", { timeout: 60000 });

  const orgs = await page.$$eval(
    "table.list_table tr.odd, table.list_table tr.even",
    (rows) =>
      rows.map((row) => {
        const cells = row.querySelectorAll("td");
        return {
          org: cells[1]?.innerText.trim(),
          link:
            "https://wbtenders.gov.in" +
            cells[2]?.querySelector("a")?.getAttribute("href"),
        };
      }),
  );

  console.log("🏢 Found organizations:", orgs.length);
  const wbTenders = {};

  // 2. LOWER CONCURRENCY TO 3 (Prevent DDoS blocks)
  const CONCURRENCY_LIMIT = 5;
  const batches = chunkArray(orgs, CONCURRENCY_LIMIT);
  console.log(`🚀 Processing in ${batches.length} batches of ${CONCURRENCY_LIMIT}...`);

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    console.log(`⏱️ Starting Batch ${i + 1} of ${batches.length}...`);

    const batchPromises = batch.map(async (org) => {
      if (!org.link) return;

      const batchPage = await context.newPage();

      try {
        await batchPage.goto(org.link, {
          waitUntil: "domcontentloaded",
          timeout: 60000,
        });

        // 3. THE "ZERO TENDERS" BYPASS (Prevents the 5-minute timeout crash)
        const tableExists = await batchPage.waitForSelector("table.list_table", {
          timeout: 15000, 
        }).catch(() => null);

        if (!tableExists) {
          console.log(`ℹ️ 0 Tenders found for ${org.org} (Skipping)`);
          wbTenders[org.org] = [];
          return; // Exit this tab immediately!
        }

        const rawTenders = await batchPage.$$eval(
          "table.list_table tr.odd, table.list_table tr.even",
          (rows, orgName) =>
            Array.from(rows)
              .map((row) => {
                const cells = row.querySelectorAll("td");
                const titleText = cells[4]?.innerText.trim() || "";
                
                // Better parsing logic to handle brackets
                const brackets = titleText.match(/\[(.*?)\]/g) || [];
                const title = brackets.length > 0 ? brackets[0].replace(/[\[\]]/g, "") : titleText;
                const tenderID = brackets.length > 0 ? brackets[brackets.length - 1].replace(/[\[\]]/g, "") : "";

                if (orgName === "Zilla Parishad") {
                  const location = cells[5]?.innerText
                    .trim()
                    .split("||")[2]
                    ?.trim();
                  if (!["PASCHIM BARDHAMAN", "BARDHAMAN"].includes(location))
                    return null;
                }

                return {
                  title,
                  tendernumber: tenderID,
                  dateofopening: cells[2]?.innerText.trim(),
                  lastdateofsub: cells[3]?.innerText.trim(),
                };
              })
              .filter(Boolean),
          org.org,
        );

        // Hash the IDs and remove duplicates
        const maskedTenders = rawTenders.map(({ tendernumber, ...rest }) => ({
          ...rest,
          maskedTenderNumber: generateMaskedID("WB", tendernumber),
          originalTenderNumber: tendernumber,
        }));

        wbTenders[org.org] = maskedTenders;
        console.log(`✅ Scraped ${maskedTenders.length} tenders from ${org.org}`);
      } catch (err) {
        console.warn(`⚠️ Failed to scrape ${org.org}:`, err.message);
        wbTenders[org.org] = [];
      } finally {
        await batchPage.close().catch(() => {});
      }
    });

    await Promise.all(batchPromises);
  }

  await browser.close();
  console.log("✅ Browser closed. WB extraction complete!");

  await uploadToAppwrite(wbTenders, "wb_tenders_latest");
})();