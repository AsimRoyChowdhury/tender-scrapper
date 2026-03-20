const crypto = require("crypto");
const { Client, Storage } = require("node-appwrite");
const { InputFile } = require("node-appwrite/file");
require("dotenv").config();

// --- 1. THE CRYPTO HASHING FUNCTION ---
function generateMaskedID(sourcePrefix, originalID) {
  if (!originalID) return "";
  
  const hash = crypto.createHash("sha256").update(originalID).digest("hex");
  const shortHash = hash.slice(0, 12).toUpperCase();
  
  return `TA_${sourcePrefix.toUpperCase()}_${shortHash}`;
}

// --- 2. THE APPWRITE UPLOADER FUNCTION ---
async function uploadToAppwrite(jsonData, fileId) {
  const endpoint = process.env.APPWRITE_ENDPOINT; 
  const projectId = process.env.APPWRITE_PROJECT_ID;
  const apiKey = process.env.APPWRITE_API_KEY;
  const bucketId = process.env.APPWRITE_BUCKET_ID;

  const client = new Client()
    .setEndpoint(endpoint)
    .setProject(projectId)
    .setKey(apiKey);

  const storage = new Storage(client);

  console.log(`🚀 Uploading ${fileId} to Appwrite Storage...`);
  try {
    const jsonString = JSON.stringify(jsonData, null, 2);
    const inputFile = InputFile.fromPlainText(jsonString, `${fileId}.json`);

    try {
      await storage.deleteFile(bucketId, fileId);
      console.log(`🗑️ Deleted old file: ${fileId}`);
    } catch (e) {
      console.log(`ℹ️ No existing file found to delete for ${fileId}.`);
    }

    await storage.createFile(bucketId, fileId, inputFile);
    console.log(`🎉 SUCCESS: Uploaded ${fileId} to Appwrite!`);

  } catch (error) {
    console.error(`❌ Appwrite Upload Failed for ${fileId}:`, error.message);
  }
}

// Helper function to split array into smaller batches
function chunkArray(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

// --- 3. EXPORT THEM SO OTHER FILES CAN USE THEM ---
module.exports = {
  generateMaskedID,
  uploadToAppwrite,
  chunkArray
};