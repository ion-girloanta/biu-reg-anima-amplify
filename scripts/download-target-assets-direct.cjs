const https = require('https');
require('dotenv').config();
const fs = require('fs');
const path = require('path');

// Create assets directory if it doesn't exist
const assetsDir = path.join(__dirname, '..', 'src', 'assets');
if (!fs.existsSync(assetsDir)) {
  fs.mkdirSync(assetsDir, { recursive: true });
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
          console.log(`✓ Downloaded: ${filename}`);
          resolve({ filename, success: true, size: response.headers['content-length'] });
        });
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

async function downloadTargetAssets() {
  try {
    console.log('🎯 Downloading specific assets from target node 5584:558165');
    
    // The two specific assets found in the target node
    const targetAssets = [
      {
        ref: 'bea68e7860ce41a5abbd227a5950dcca38e495cb',
        name: 'main logo',
        filename: 'main-logo-bea68e78.png',
        nodeId: 'I5584:558166;3267:776524;2034:2731',
        nodeType: 'RECTANGLE',
        path: '2.0 Subject to learn-he > header/Logo only > Frame 1261159237 > Logo > main logo',
        // Using a fresh URL pattern
        url: 'https://s3-alpha-sig.figma.com/img/bea6/8e78/60ce41a5abbd227a5950dcca38e495cb?Expires=1757289600&Key-Pair-Id=APKAQ4GOSFWCW27IBOMQ&Signature=JffRABzAy6cW6dRtIFE9MJNsMk9GsRMub8gBWgBbhUQAgvDd0R54aVmQtdkQHeWzdD9maM-bmnnf6zOhImyt0ss1X-DgIj61~96VAyUg8FGYFmIPn2t~3l6-SrvITIxb3016ECiM7hMFl9p3DAQiWHugw7Z3yF3y3QPCkBr31umgwhqu6l3Z1bLFxj6Q5iZQY0VzuEMYaev63eUCmt8V9aF584OdqgvNiYeMwkIDZeUua0XUhqpwZrafrSRq7IInXm6uMtlzT9wsl~mUoflRXjEEm7ybEfKzsZuiMeTICnsVq4tr0oF5XBEQoh9u0TezXUeiikPLU-RGFi3MT5Iilg__'
      },
      {
        ref: '002b232d03afad35f5e3eb7a8cac85600919eaff',
        name: 'Rectangle 16918', 
        filename: 'rectangle-16918-002b232d.png',
        nodeId: 'I5584:558187;3051:1349525',
        nodeType: 'RECTANGLE',
        path: '2.0 Subject to learn-he > placeholder image > Rectangle 16918',
        // Construct URL pattern for this asset
        url: 'https://s3-alpha-sig.figma.com/img/002b/232d/03afad35f5e3eb7a8cac85600919eaff?Expires=1757289600&Key-Pair-Id=APKAQ4GOSFWCW27IBOMQ&Signature=JffRABzAy6cW6dRtIFE9MJNsMk9GsRMub8gBWgBbhUQAgvDd0R54aVmQtdkQHeWzdD9maM-bmnnf6zOhImyt0ss1X-DgIj61~96VAyUg8FGYFmIPn2t~3l6-SrvITIxb3016ECiM7hMFl9p3DAQiWHugw7Z3yF3y3QPCkBr31umgwhqu6l3Z1bLFxj6Q5iZQY0VzuEMYaev63eUCmt8V9aF584OdqgvNiYeMwkIDZeUua0XUhqpwZrafrSRq7IInXm6uMtlzT9wsl~mUoflRXjEEm7ybEfKzsZuiMeTICnsVq4tr0oF5XBEQoh9u0TezXUeiikPLU-RGFi3MT5Iilg__'
      }
    ];

    const results = [];
    
    // Download each asset
    for (const asset of targetAssets) {
      try {
        console.log(`📥 Downloading ${asset.name}...`);
        const result = await downloadImage(asset.url, asset.filename);
        results.push({
          ...asset,
          ...result
        });
      } catch (error) {
        console.log(`✗ Failed to download ${asset.name}: ${error.message}`);
        results.push({
          ...asset,
          success: false,
          error: error.message
        });
      }
    }

    const successfulDownloads = results.filter(r => r.success);
    const failedDownloads = results.filter(r => !r.success);
     
    console.log(`\n✅ Successfully downloaded: ${successfulDownloads.length}`);
    console.log(`❌ Failed downloads: ${failedDownloads.length}`);
    
    // Create updated manifest
    const manifest = {
      downloadedAt: new Date().toISOString(),
      figmaFileId: 'WqLKA1UMjOoCjLwCckKhWO',
      targetNodeId: '5584:558165',
      targetNodeName: '2.0 Subject to learn-he',
      method: 'direct_target_assets',
      totalAssets: targetAssets.length,
      assets: results.filter(r => r.success).map(asset => ({
        name: asset.name,
        nodeId: asset.nodeId,
        nodeType: asset.nodeType,
        path: asset.path,
        ref: asset.ref,
        scaleMode: 'FILL',
        filename: asset.filename,
        fillIndex: 0
      }))
    };
    
    fs.writeFileSync(
      path.join(assetsDir, 'figma-assets.json'),
      JSON.stringify(manifest, null, 2)
    );
    
    console.log('\n📋 Updated figma-assets.json manifest');
    console.log(`🎉 Target asset download complete! Downloaded ${successfulDownloads.length} assets from target node.`);
    
    return manifest;
    
  } catch (error) {
    console.error('💥 Error downloading target assets:', error);
    throw error;
  }
}

// Run the download
downloadTargetAssets().catch(console.error);