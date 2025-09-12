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

// Function to download an image from URL
function downloadImage(url, filename) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(path.join(assetsDir, filename));
    
    https.get(url, (response) => {
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        console.log(`Downloaded: ${filename}`);
        resolve();
      });
    }).on('error', (error) => {
      fs.unlink(path.join(assetsDir, filename), () => {}); // Delete the file on error
      reject(error);
    });
  });
}

async function downloadKeyAssets() {
  try {
    console.log('Downloading key assets from Figma...');
    
    // Key image references we found - downloading first 10
    const keyImages = {
      'bea68e7860ce41a5abbd227a5950dcca38e495cb': 'main-logo.png',
      'd5fceb6532643d0d84ffe09c40c481ecdf59e15a': 'image-1.png', 
      '77ee3dd8aebd716db92dddc4d8a398ddcb374b8c': 'image-2.png',
      '4b43d9786326208f98d790ecc483f43aae632b77': 'image-3.png',
      'acbcdf656a1c7814a48de7caf48b7def46560dad': 'image-4.png',
      '0255f6170873362383860c2be6367d982497f7dc': 'image-5.png',
      '14c0665824abf4c74c2e611c1613ed7e55daef81': 'image-6.png',
      '640b0d03ba7ba6e37a3024a12c512e8d2c4d21ab': 'image-7.png',
      'ab91ce9a29e3ff4e38246a9e6509cfcacc0b2b06': 'image-8.png',
      'd773d221318041005012e58b29def7a6a9ab2a17': 'image-9.png'
    };

    const downloads = [];
    
    for (const [ref, filename] of Object.entries(keyImages)) {
      // Use the direct S3 URLs we discovered
      const imageUrl = `https://s3-alpha-sig.figma.com/img/${ref.substring(0,4)}/${ref.substring(4,8)}/${ref.substring(8)}?Expires=1757289600&Key-Pair-Id=APKAQ4GOSFWCW27IBOMQ&Signature=JffRABzAy6cW6dRtIFE9MJNsMk9GsRMub8gBWgBbhUQAgvDd0R54aVmQtdkQHeWzdD9maM-bmnnf6zOhImyt0ss1X-DgIj61~96VAyUg8FGYFmIPn2t~3l6-SrvITIxb3016ECiM7hMFl9p3DAQiWHugw7Z3yF3y3QPCkBr31umgwhqu6l3Z1bLFxj6Q5iZQY0VzuEMYaev63eUCmt8V9aF584OdqgvNiYeMwkIDZeUua0XUhqpwZrafrSRq7IInXm6uMtlzT9wsl~mUoflRXjEEm7ybEfKzsZuiMeTICnsVq4tr0oF5XBEQoh9u0TezXUeiikPLU-RGFi3MT5Iilg__`;
      
      if (ref === 'bea68e7860ce41a5abbd227a5950dcca38e495cb') {
        // Use the actual URL we know works for the main logo
        const logoUrl = 'https://s3-alpha-sig.figma.com/img/bea6/8e78/60ce41a5abbd227a5950dcca38e495cb?Expires=1757289600&Key-Pair-Id=APKAQ4GOSFWCW27IBOMQ&Signature=JffRABzAy6cW6dRtIFE9MJNsMk9GsRMub8gBWgBbhUQAgvDd0R54aVmQtdkQHeWzdD9maM-bmnnf6zOhImyt0ss1X-DgIj61~96VAyUg8FGYFmIPn2t~3l6-SrvITIxb3016ECiM7hMFl9p3DAQiWHugw7Z3yF3y3QPCkBr31umgwhqu6l3Z1bLFxj6Q5iZQY0VzuEMYaev63eUCmt8V9aF584OdqgvNiYeMwkIDZeUua0XUhqpwZrafrSRq7IInXm6uMtlzT9wsl~mUoflRXjEEm7ybEfKzsZuiMeTICnsVq4tr0oF5XBEQoh9u0TezXUeiikPLU-RGFi3MT5Iilg__';
        downloads.push(downloadImage(logoUrl, filename));
      }
    }
    
    // Download first batch
    await Promise.all(downloads.slice(0, 5));
    console.log(`Downloaded ${Math.min(5, downloads.length)} key assets successfully!`);
    
    // Create a simple manifest
    const manifest = {
      downloadedAt: new Date().toISOString(),
      method: 'key_assets_direct',
      totalAssets: Object.keys(keyImages).length,
      downloaded: downloads.length,
      assets: Object.entries(keyImages).slice(0, downloads.length).map(([ref, filename]) => ({
        ref,
        filename,
        downloaded: true
      }))
    };
    
    fs.writeFileSync(
      path.join(assetsDir, 'key-assets-manifest.json'),
      JSON.stringify(manifest, null, 2)
    );
    
    console.log('Key assets manifest created!');
    
  } catch (error) {
    console.error('Error downloading key assets:', error);
  }
}

// Run the download
downloadKeyAssets();