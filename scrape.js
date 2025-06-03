const { chromium } = require("playwright");
require("dotenv").config();

(async () => {
  const token = process.env.TOKEN;
  const gistId = process.env.GIST_ID;

  const { Octokit } = await import("@octokit/core");
  const octokit = new Octokit({ auth: token });

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  console.log("🚀 Launching browser...");
  await page.goto(
    "https://wbtenders.gov.in/nicgep/app?page=FrontEndTendersByOrganisation&service=page",
    {
      waitUntil: "domcontentloaded",
      timeout: 100000,
    }
  );

  console.log("✅ WB Tender Page loaded");

  await page.waitForSelector("table.list_table", { timeout: 15000 });

  const orgs = await page.$$eval("table.list_table tr.odd, table.list_table tr.even", (rows) =>
    rows.map((row) => {
      const cells = row.querySelectorAll("td");
      return {
        org: cells[1]?.innerText.trim(),
        link:
          "https://wbtenders.gov.in" +
          cells[2]?.querySelector("a")?.getAttribute("href"),
      };
    })
  );

  console.log("🏢 Found organizations:", orgs.length);

  const allTenders = {};

  for (const org of orgs) {
    if (!org.link) continue;

    try {
      await page.goto(org.link, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForSelector("table.list_table", { timeout: 15000 });

      const tenders = await page.$$eval(
        "table.list_table tr.odd, table.list_table tr.even",
        (rows, orgName) =>
          Array.from(rows)
            .map((row) => {
              const cells = row.querySelectorAll("td");
              const titleText = cells[4]?.innerText.trim() || "";
              const title = titleText.split("] [")[0]?.slice(1) ?? "";
              const tenderID = titleText.split("][")[1]?.slice(0, -1) ?? "";

              if (orgName === "Zilla Parishad") {
                const location = cells[5]?.innerText.trim().split("||")[2]?.trim();
                if (!["PASCHIM BARDHAMAN", "BARDHAMAN"].includes(location)) return null;
              }

              return {
                title,
                tendernumber: tenderID,
                lastdateofsub: cells[2]?.innerText.trim(),
                dateofopening: cells[3]?.innerText.trim(),
              };
            })
            .filter(Boolean),
        org.org
      );

      allTenders[org.org] = tenders;
      console.log(`✅ Scraped ${tenders.length} tenders from ${org.org}`);
    } catch (err) {
      console.warn(`⚠️ Failed to scrape ${org.org}:`, err.message);
      allTenders[org.org] = [];
    }
  }

  await browser.close();
  console.log("✅ Browser closed.");

  // Optionally update Gist:
  await octokit.request("PATCH /gists/{gist_id}", {
    gist_id: gistId,
    description: "Latest WB tenders",
    files: {
      "alltenders.json": {
        content: JSON.stringify(allTenders, null, 2),
      },
    },
    headers: {
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  console.log("✅ Gist updated successfully");
})();
