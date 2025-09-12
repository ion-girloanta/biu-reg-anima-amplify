const https = require('https');
require('dotenv').config();
const fs = require('fs');
const path = require('path');
 
// Figma API configuration
const FIGMA_TOKEN = process.env.FIGMA_TOKEN;
const FILE_ID = process.env.FIGMA_FILE_ID;

// Create assets directory if it doesn't exist
const assetsDir = path.join(__dirname, '..', 'src', 'assets');
if (!fs.existsSync(assetsDir)) {
  fs.mkdirSync(assetsDir, { recursive: true });
}

// Function to make Figma API requests with retry logic
function makeFigmaRequest(endpoint, retries = 3) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.figma.com',
      path: endpoint,
      method: 'GET',
      headers: {
        'X-FIGMA-TOKEN': FIGMA_TOKEN
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          if (response.status === 429 && retries > 0) {
            console.log(`⏳ Rate limited, waiting 3 seconds...`);
            setTimeout(() => {
              makeFigmaRequest(endpoint, retries - 1).then(resolve).catch(reject);
            }, 3000);
          } else {
            resolve(response);
          }
        } catch (error) {
          reject(error);
        }
      });
    });

    req.on('error', (error) => {
      if (retries > 0) {
        setTimeout(() => {
          makeFigmaRequest(endpoint, retries - 1).then(resolve).catch(reject);
        }, 2000);
      } else {
        reject(error);
      }
    });

    req.end();
  });
}

// Function to download an image from URL
function downloadImage(url, filename) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(path.join(assetsDir, filename));
    
    https.get(url, (response) => {
      if (response.statusCode === 200) {
        response.pipe(file);
        file.on('finish', () => {
          file.close();
          console.log(`✅ Downloaded: ${filename}`);
          resolve({ filename, success: true, size: response.headers['content-length'] });
        });
      } else if (response.statusCode === 403) {
        file.close();
        fs.unlink(path.join(assetsDir, filename), () => {});
        console.log(`⚠️ Expired URL: ${filename}`);
        resolve({ filename, success: false, reason: 'expired_url' });
      } else {
        file.close();
        fs.unlink(path.join(assetsDir, filename), () => {});
        reject(new Error(`HTTP ${response.statusCode} for ${filename}`));
      }
    }).on('error', (error) => {
      file.close();
      fs.unlink(path.join(assetsDir, filename), () => {});
      reject(error);
    });
  });
}

// Main function to download selected assets
async function downloadSelectedAssets() {
  try {
    console.log(`🎯 Downloading selected assets: images and keyIcons from icons-images-list.json`);
    
    // Step 1: Read the manifest file
    const manifestPath = path.join(assetsDir, 'icons-images-list.json');
    if (!fs.existsSync(manifestPath)) {
      console.error('❌ icons-images-list.json not found');
      return;
    }
    
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    console.log(`📋 Loaded manifest: ${manifest.images.length} images, ${manifest.keyIcons.length} keyIcons`);
    
    // Step 2: Collect all assets to download
    const nodesToDownload = new Set();
    const imageRefsToDownload = new Set();
    const assetInfo = new Map();
    
    // Add images - use their nodeIds (refs don't work with images API)
    manifest.images.forEach(image => {
      nodesToDownload.add(image.nodeId);
      assetInfo.set(image.nodeId, {
        ...image,
        type: 'image',
        filename: `image-${image.nodeId.replace(/[^a-zA-Z0-9]/g, '-')}-${image.nodeName.replace(/[^a-zA-Z0-9]/g, '-')}.png`
      });
    });
    
    // Add keyIcons - use their nodeIds
    manifest.keyIcons.forEach(icon => {
      nodesToDownload.add(icon.nodeId);
      assetInfo.set(icon.nodeId, {
        ...icon,
        type: 'icon',
        filename: `icon-${icon.nodeId.replace(/[^a-zA-Z0-9]/g, '-')}-${icon.nodeName.replace(/[^a-zA-Z0-9]/g, '-')}.png`
      });
    });
    
    console.log(`🎯 Collected ${nodesToDownload.size} unique assets to download`);
    
    // Step 3: Query Figma API for download URLs
    console.log('\n🔍 Querying Figma API for download URLs...');
    const downloadableAssets = new Map();
    
    const nodeIds = Array.from(nodesToDownload);
    const batchSize = 50;
    
    for (let i = 0; i < nodeIds.length; i += batchSize) {
      const batch = nodeIds.slice(i, i + batchSize);
      const batchNum = Math.floor(i/batchSize) + 1;
      const totalBatches = Math.ceil(nodeIds.length/batchSize);
      
      console.log(`📦 API batch ${batchNum}/${totalBatches} (${batch.length} assets)...`);
      
      try {
        const batchIds = batch.join(',');
        const imageData = await makeFigmaRequest(`/v1/images/${FILE_ID}?ids=${batchIds}&format=png&scale=2`);
        
        if (imageData && imageData.images) {
          const validAssets = Object.entries(imageData.images).filter(([_, url]) => url);
          console.log(`  🖼️ Found ${validAssets.length} assets with URLs`);
          
          validAssets.forEach(([nodeId, url]) => {
            const info = assetInfo.get(nodeId);
            if (info) {
              downloadableAssets.set(nodeId, {
                ...info,
                url
              });
            }
          });
        }
        
        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
        
      } catch (error) {
        console.log(`  ❌ Batch error: ${error.message}`);
      }
    }
    
    console.log(`\n🎯 Ready to download ${downloadableAssets.size} assets`);
    
    // Step 4: Download all assets
    console.log(`\n📥 Starting downloads...`);
    const downloadBatchSize = 10;
    const assetEntries = Array.from(downloadableAssets.entries());
    const results = [];
    
    for (let i = 0; i < assetEntries.length; i += downloadBatchSize) {
      const batch = assetEntries.slice(i, i + downloadBatchSize);
      const batchNum = Math.floor(i/downloadBatchSize) + 1;
      const totalBatches = Math.ceil(assetEntries.length/downloadBatchSize);
      
      console.log(`\n📦 Download batch ${batchNum}/${totalBatches} (${batch.length} assets)...`);
      
      const batchPromises = batch.map(async ([nodeId, asset]) => {
        try {
          const result = await downloadImage(asset.url, asset.filename);
          return {
            ...result,
            nodeId,
            asset
          };
        } catch (error) {
          console.log(`❌ Download failed for ${nodeId}: ${error.message}`);
          return { 
            nodeId, 
            success: false, 
            error: error.message,
            asset 
          };
        }
      });
      
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
      
      // Brief pause between download batches
      if (i + downloadBatchSize < assetEntries.length) {
        console.log('⏱️ Pausing 1 second...');
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    // Step 5: Create download manifest
    const successfulDownloads = results.filter(r => r.success);
    const failedDownloads = results.filter(r => !r.success);
    
    console.log(`\n📊 DOWNLOAD RESULTS:`);
    console.log(`✅ Successfully downloaded: ${successfulDownloads.length}`);
    console.log(`❌ Failed downloads: ${failedDownloads.length}`);
    console.log(`📈 Success rate: ${((successfulDownloads.length / results.length) * 100).toFixed(1)}%`);
    
    // Create download manifest
    const downloadManifest = {
      downloadedAt: new Date().toISOString(),
      figmaFileId: FILE_ID,
      sourceManifest: 'icons-images-list.json',
      method: 'selected_images_and_key_icons',
      statistics: {
        imagesRequested: manifest.images.length,
        keyIconsRequested: manifest.keyIcons.length,
        totalAssetsRequested: nodesToDownload.size,
        successfulDownloads: successfulDownloads.length,
        failedDownloads: failedDownloads.length
      },
      downloadedAssets: successfulDownloads.map(result => ({
        filename: result.filename,
        nodeId: result.asset.nodeId,
        nodeName: result.asset.nodeName,
        nodeType: result.asset.nodeType,
        assetType: result.asset.type,
        path: result.asset.path,
        category: result.asset.category,
        ref: result.asset.ref
      })),
      failedAssets: failedDownloads.map(result => ({
        nodeId: result.asset.nodeId,
        nodeName: result.asset.nodeName,
        reason: result.error || result.reason
      }))
    };
    
    // Save download manifest
    fs.writeFileSync(
      path.join(assetsDir, 'downloaded-assets.json'),
      JSON.stringify(downloadManifest, null, 2)
    );
    
    console.log('\n📋 Created downloaded-assets.json');
    console.log(`🎉 SUCCESS! Downloaded ${successfulDownloads.length} selected assets`);
    console.log(`📁 Assets location: ${assetsDir}`);
    
    // List downloaded files by type
    const images = successfulDownloads.filter(r => r.asset.type === 'image');
    const icons = successfulDownloads.filter(r => r.asset.type === 'icon');
    
    if (images.length > 0) {
      console.log(`\n🖼️ Downloaded Images (${images.length}):`);
      images.forEach(result => {
        console.log(`   • ${result.filename} - ${result.asset.nodeName}`);
      });
    }
    
    if (icons.length > 0) {
      console.log(`\n🎨 Downloaded Key Icons (${icons.length}):`);
      icons.slice(0, 5).forEach(result => {
        console.log(`   • ${result.filename} - ${result.asset.nodeName}`);
      });
      if (icons.length > 5) {
        console.log(`   • ... and ${icons.length - 5} more icons`);
      }
    }
    
    return downloadManifest;
    
  } catch (error) {
    console.error('💥 Error downloading selected assets:', error);
    throw error;
  }
}

// Run the selected asset download
downloadSelectedAssets().catch(console.error);