const { chromium } = require("playwright");
const { generateMaskedID, uploadToAppwrite, chunkArray } = require("./utils");

(async () => {
  const browser = await chromium.launch({ headless: true });
  // We use a persistent context so our API requests share the browser's cookies!
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });

  const page = await context.newPage();

  console.log("🚀 Launching browser to bypass GeM security...");
  await page.goto("https://bidplus.gem.gov.in/advance-search", {
    waitUntil: "domcontentloaded",
    timeout: 100000,
  });

  console.log("✅ GeM Advance Search Page loaded");

  // 1. Extract the hidden CSRF Token AND its dynamic name right out of the DOM
  const csrfName = await page.$eval('#cname', el => el.value);
  const csrfToken = await page.$eval('#chash', el => el.value);
  console.log(`🔑 Extracted CSRF Token: ${csrfName} = ${csrfToken}`);

  // 2. Helper function to fetch a specific page using GeM's internal API
  async function fetchGemPage(pageNum) {
    const payloadObj = {
      searchType: "con",
      state_name_con: "WEST BENGAL",
      city_name_con: "",
      bidEndFromCon: "",
      bidEndToCon: "",
      page: pageNum
    };

    // Playwright needs 'form' to URL-encode the request exactly like a real browser!
    const formData = {
      payload: JSON.stringify(payloadObj),
    };
    formData[csrfName] = csrfToken; // Dynamically attach the security token

    const response = await context.request.post("https://bidplus.gem.gov.in/search-bids", {
      form: formData, // <--- This was the magic fix!
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        'Referer': 'https://bidplus.gem.gov.in/advance-search'
      }
    });
    
    const text = await response.text();
    
    // Safely try to parse it so the script doesn't explode if the server hiccups
    try {
      const json = JSON.parse(text);
      return json.response?.response || { numFound: 0, docs: [] };
    } catch (err) {
      console.error(`❌ Server rejected API call for page ${pageNum}. Returned HTML instead of JSON.`);
      // console.log("HTML returned:", text.substring(0, 200)); // Uncomment this if it fails again to see the exact error
      return { numFound: 0, docs: [] };
    }
  }

  // 3. Fetch Page 1 to get the total number of records
  console.log("⏱️ Fetching Page 1 to determine total bids...");
  const firstPageData = await fetchGemPage(1);
  const totalRecords = firstPageData.numFound;
  const totalPages = Math.ceil(totalRecords / 10);
  
  console.log(`📊 Found ${totalRecords} total bids across ${totalPages} pages.`);

  let allGemBids = [...firstPageData.docs];

  // 4. Create an array of the remaining pages to fetch [2, 3, 4 ... totalPages]
  const pagesToFetch = [];
  for (let i = 2; i <= totalPages; i++) {
    pagesToFetch.push(i);
  }

  // 5. Batch the parallel requests so we don't crash the GeM server
  const CONCURRENCY_LIMIT = 10;
  const batches = chunkArray(pagesToFetch, CONCURRENCY_LIMIT);
  
  console.log(`🚀 Fetching remaining ${pagesToFetch.length} pages in ${batches.length} parallel batches...`);

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    console.log(`⏱️ Processing Batch ${i + 1} of ${batches.length}...`);
    
    // Fire off up to 10 API requests at the exact same time
    const batchPromises = batch.map(async (pageNum) => {
      try {
        const pageData = await fetchGemPage(pageNum);
        return pageData.docs;
      } catch (e) {
        console.warn(`⚠️ Failed to fetch page ${pageNum}:`, e.message);
        return [];
      }
    });

    // Wait for the batch to finish, then flatten the JSON results into our main array
    const batchResults = await Promise.all(batchPromises);
    allGemBids.push(...batchResults.flat());
  }

  await browser.close();
  console.log(`✅ GeM API Scraping Complete! Total Bids Extracted: ${allGemBids.length}`);

  // 6. Clean up the raw JSON into your standardized App format
  const formattedBids = allGemBids.map(bid => {
    // Safely extract the string since GeM's Solr DB returns fields inside arrays
    const originalID = Array.isArray(bid.b_bid_number) ? bid.b_bid_number[0] : (bid.b_bid_number || "");
    const titleStr = Array.isArray(bid.b_category_name) ? bid.b_category_name[0] : (bid.b_category_name || "");
    
    const dept = (bid.ba_official_details_minName ? bid.ba_official_details_minName + " | " : "") + 
                 (bid.ba_official_details_deptName || "");
                 
    return {
      title: titleStr,
      originalTenderNumber: originalID,
      maskedTenderNumber: generateMaskedID("GEM", originalID),
      dateofopening: new Date(bid.final_start_date_sort).toISOString(),
      lastdateofsub: new Date(bid.final_end_date_sort).toISOString(),
      department: dept,
      quantity: bid.b_total_quantity
    };
  });

  // 7. Push to Appwrite using our shared utility
  await uploadToAppwrite(formattedBids, "gem_tenders_latest");
})();