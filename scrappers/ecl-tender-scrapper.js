const cheerio = require("cheerio");
require("dotenv").config();


async function fetchTenderLocations() {
  const url = "https://secureloginecl.co.in/tenders/tender_list_adv_search.php?pid=6";

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load page, status: ${response.status}`);
  }

  const html = await response.text();
  const $ = cheerio.load(html);

  const select = $('select[name="tndr_loca"]');
  if (!select.length) {
    throw new Error("Location dropdown not found");
  }

  const locations = [];
  select.find("option").each((_, option) => {
    const text = $(option).text().trim();
    if (text && text.toLowerCase() !== "select location") {
      locations.push(text);
    }
  });

  return locations;
}


(async () => {
  const eclTenders = [];
  const locations = await fetchTenderLocations();
  console.log(`Got ${locations.length} locations`);

  for (const location of locations) {
    body = "";
    if (location == "All Locations"){
      body = `rd1=All&strt_dt=&end_dt=&srch_opt=Active&tndr_cate=&tndr_loca=`;
    } else {
      body = `rd1=All&strt_dt=&end_dt=&srch_opt=Active&tndr_cate=&tndr_loca=${encodeURIComponent(location)}`;
    }

    const response = await fetch(
      "https://secureloginecl.co.in/tenders/tender_list_adv_search.php?pid=6",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      }
    );

    const html = await response.text();
    const $ = cheerio.load(html);

    $("table tr").each((_, tr) => {
      const cells = $(tr).find("td.data");
      if (cells.length === 7) {
        const tendernumber = $(cells[1]).text().trim();
        const title = $(cells[2]).text().trim();
        const lastdateofsub = $(cells[4]).text().trim();
        const dateofopening = $(cells[5]).text().trim();

        const onclickAttr = $(cells[6]).find("input").attr("onclick") ?? "";
        const urlMatch = onclickAttr.match(/window\.open\('([^']+)'/);
        const relativeUrl = urlMatch ? urlMatch[1].replace(/&amp;/g, "&") : "";
        const fullUrl = relativeUrl
          ? `https://secureloginecl.co.in/tenders/${relativeUrl}`
          : "";

        eclTenders.push({
          tendernumber,
          title,
          lastdateofsub,
          dateofopening,
          link: fullUrl,
          location,
        });
      }
    });
  }

  console.log(`Got ${eclTenders.length} tenders`);

  const token = process.env.TOKEN;
  const gistId = process.env.GIST_ID;

  const { Octokit } = await import("@octokit/core");
  const octokit = new Octokit({ auth: token });

  await octokit.request("PATCH /gists/{gist_id}", {
    gist_id: gistId,
    description: "Latest ECL tenders",
    files: {
      "eclTenders.json": {
        content: JSON.stringify(eclTenders, null, 2),
      },
    },
    headers: {
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  console.log("✅ Gist updated successfully");
})();
