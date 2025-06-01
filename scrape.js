const puppeteer = require("puppeteer");
require('dotenv').config();


(async () => {
  const token = process.env.TOKEN;
  const gistId = process.env.GIST_ID;

  const { Octokit } = await import("@octokit/core");
  const octokit = new Octokit({
    auth: token,
  });

  // 1. Scrape logic
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();

  await page.goto(
    "https://wbtenders.gov.in/nicgep/app?page=FrontEndTendersByOrganisation&service=page",
    {
      waitUntil: "networkidle2",
    }
  );

  await page.waitForSelector("table.list_table");

  const orgs = await page.evaluate(() => {
    const rows = document.querySelectorAll(
      "table.list_table tr.odd, table.list_table tr.even"
    );
    return Array.from(rows).map((row) => {
      const cells = row.querySelectorAll("td");
      return {
        org: cells[1]?.innerText.trim(),
        link:
          "https://wbtenders.gov.in" +
          cells[2]?.querySelector("a")?.getAttribute("href"),
      };
    });
  });

  const allTenders = {};

  for (const org of orgs) {
    if (!org.link) continue;

    if (org.org === "Zilla Parishad") {
      await page.goto(org.link, { waitUntil: "networkidle2" });
      await page.waitForSelector("table.list_table").catch(() => null);

      const tenders = await page.evaluate(() => {
        const rows = document.querySelectorAll(
          "table.list_table tr.odd, table.list_table tr.even"
        );
        return Array.from(rows)
          .map((row) => {
            const cells = row.querySelectorAll("td");
            const location = cells[5]?.innerText.trim().split("||")[2]?.trim();
            const titleText = cells[4]?.innerText.trim();
            const title = titleText?.split("] [")[0]?.slice(1) ?? "";
            const tenderID = titleText?.split("][")[1]?.slice(0, -1) ?? "";
            if (["PASCHIM BARDHAMAN", "BARDHAMAN"].includes(location)) {
              return {
                title,
                tenderID,
                closingdate: cells[2]?.innerText.trim(),
                openingdate: cells[3]?.innerText.trim(),
              };
            }
          })
          .filter(Boolean);
      });

      allTenders[org.org] = tenders;
    } else {
      await page.goto(org.link, { waitUntil: "networkidle2" });
      await page.waitForSelector("table.list_table").catch(() => null);

      const tenders = await page.evaluate(() => {
        const rows = document.querySelectorAll(
          "table.list_table tr.odd, table.list_table tr.even"
        );
        return Array.from(rows).map((row) => {
          const cells = row.querySelectorAll("td");
          const titleText = cells[4]?.innerText.trim();
          const title = titleText?.split("] [")[0]?.slice(1) ?? "";
          const tenderID = titleText?.split("][")[1]?.slice(0, -1) ?? "";
          return {
            tenderID,
            title,
            closingdate: cells[2]?.innerText.trim(),
            openingdate: cells[3]?.innerText.trim(),
          };
        });
      });
      allTenders[org.org] = tenders;
    }
  }

  await browser.close();

  // 2. Update Gist
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
