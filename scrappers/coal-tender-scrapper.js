const { chromium } = require("playwright");
const { generateMaskedID, uploadToAppwrite } = require("./utils");

(async () => {
  // 1. Stealth mode to bypass NICGEP Firewalls
  const browser = await chromium.launch({ headless: true }); // Change to false if you want to watch it run!
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    extraHTTPHeaders: {
      "Accept-Language": "en-US,en;q=0.9",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    }
  });

  const page = await context.newPage();

  console.log("🚀 Launching browser for Coal India...");
  await page.goto(
    "https://coalindiatenders.nic.in/nicgep/app?page=FrontEndTendersByOrganisation&service=page",
    { waitUntil: "domcontentloaded", timeout: 100000 },
  );

  console.log("✅ Coal India Tender Page loaded");
  await page.waitForSelector("table.list_table", { timeout: 60000 });

  // 2. Extract ALL organizations
  const allOrgs = await page.$$eval(
    "table.list_table tr.odd, table.list_table tr.even",
    (rows) =>
      rows.map((row) => {
        const cells = row.querySelectorAll("td");
        return {
          org: cells[1]?.innerText.trim(),
          link: "https://coalindiatenders.nic.in" + cells[2]?.querySelector("a")?.getAttribute("href"),
        };
      }),
  );

  // 3. Filter ONLY for ECL and WCL
  const targetOrgs = allOrgs.filter(o => 
    o.org === "Eastern Coalfields Limited" || 
    o.org === "Western Coalfields Limited"
  );

  console.log(`🏢 Found ${targetOrgs.length} targeted organizations (ECL & WCL).`);

  // 4. Process ECL and WCL in parallel since there are only 2!
  const scrapePromises = targetOrgs.map(async (org) => {
    if (!org.link) return;

    const orgPage = await context.newPage();

    try {
      console.log(`⏱️ Navigating to ${org.org}...`);
      await orgPage.goto(org.link, { waitUntil: "domcontentloaded", timeout: 100000 });
      
      const tableExists = await orgPage.waitForSelector("table.list_table", {
        timeout: 15000,
      }).catch(() => null);

      if (!tableExists) {
        console.log(`ℹ️ No active tenders found for ${org.org}`);
        return; 
      }

      // Scrape the data from this specific tab
      const rawTenders = await orgPage.$$eval(
        "table.list_table tr.odd, table.list_table tr.even",
        (rows) =>
          Array.from(rows).map((row) => {
            const cells = row.querySelectorAll("td");
            const titleCellText = cells[4]?.innerText.trim() || "";
            
            // Extract all brackets into an array
            const brackets = titleCellText.match(/\[(.*?)\]/g) || [];
            
            // Map the specific brackets based on the ECL layout
            const title = brackets.length > 0 ? brackets[0].replace(/[\[\]]/g, "") : titleCellText;
            const referenceNumber = brackets.length > 1 ? brackets[1].replace(/[\[\]]/g, "") : "";
            const tenderID = brackets.length > 0 ? brackets[brackets.length - 1].replace(/[\[\]]/g, "") : "";

            return {
              title,
              referenceNumber, // Now capturing the middle bracket!
              tendernumber: tenderID,
              dateofopening: cells[3]?.innerText.trim(),
              lastdateofsub: cells[2]?.innerText.trim(),
            };
          }).filter(Boolean)
      );

      const prefix = org.org === "Eastern Coalfields Limited" ? "ECL" : "WCL";

      // Destructure 'tendernumber' out so it doesn't get copied by the spread operator
      const maskedTenders = rawTenders.map(({ tendernumber, ...rest }) => ({
        ...rest, // This now only contains title, referenceNumber, dateofopening, lastdateofsub
        maskedTenderNumber: generateMaskedID(prefix, tendernumber),
        originalTenderNumber: tendernumber,
      }));

      console.log(`✅ Scraped ${maskedTenders.length} tenders from ${org.org}`);

      // 5. Instantly upload to Appwrite under their specific file names!
      if (prefix === "ECL") {
        await uploadToAppwrite(maskedTenders, "ecl_tenders_latest");
      } else {
        await uploadToAppwrite(maskedTenders, "wcl_tenders_latest");
      }

    } catch (err) {
      console.warn(`⚠️ Failed to scrape ${org.org}:`, err.message);
    } finally {
      await orgPage.close();
    }
  });

  // Wait for both ECL and WCL to finish scraping and uploading
  await Promise.all(scrapePromises);

  await browser.close();
  console.log("✅ Browser closed. Coal India extraction complete!");
})();