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

// Function to make Figma API requests
function makeFigmaRequest(endpoint) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.figma.com',
      path: endpoint,
      method: 'GET',
      headers: {
        'X-FIGMA-TOKEN': FIGMA_TOKEN
      }
    };

    console.log(`Making request to: https://api.figma.com${endpoint}`);

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          if (response.status === 400 || response.err) {
            console.log('API Response:', response);
          }
          resolve(response);
        } catch (error) {
          reject(error);
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.end();
  });
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

async function downloadFileImages() {
  try {
    console.log('Getting all file images using the file images endpoint...');
    
    // Use the file images endpoint to get all images
    const imageData = await makeFigmaRequest(`/v1/files/${FILE_ID}/images`);
    
    console.log('Response received:', JSON.stringify(imageData, null, 2));
    
    if (!imageData || imageData.err) {
      console.error('Error getting file images:', imageData.err);
      return;
    }
    
    if (!imageData.meta || !imageData.meta.images) {
      console.log('No images found in file metadata');
      return;
    }
    
    const imageRefs = imageData.meta.images;
    console.log(`Found ${imageRefs.length} image references in file`);
    
    if (imageRefs.length === 0) {
      console.log('No images to download');
      return;
    }
    
    // Get the actual image URLs
    const imageIds = imageRefs.join(',');
    console.log('Getting image URLs for refs:', imageIds);
    
    const urlData = await makeFigmaRequest(`/v1/images/${FILE_ID}?ids=${imageIds}&format=png&scale=2`);
    
    if (!urlData || !urlData.images) {
      console.error('Could not get image URLs');
      return;
    }
    
    console.log(`Received URLs for ${Object.keys(urlData.images).length} images`);
    
    // Download each image
    const downloads = [];
    let index = 0;
    
    for (const [ref, imageUrl] of Object.entries(urlData.images)) {
      if (imageUrl) {
        const filename = `figma-image-${ref.substring(0, 8)}-${index++}.png`;
        downloads.push(downloadImage(imageUrl, filename));
      }
    }
    
    if (downloads.length > 0) {
      await Promise.all(downloads);
      console.log(`Successfully downloaded ${downloads.length} images!`);
      
      // Create manifest
      const manifest = {
        downloadedAt: new Date().toISOString(),
        figmaFileId: FILE_ID,
        method: 'file_images_endpoint',
        totalImages: downloads.length,
        imageRefs: imageRefs,
        images: Object.entries(urlData.images).map(([ref, url], idx) => ({
          ref,
          filename: `figma-image-${ref.substring(0, 8)}-${idx}.png`,
          url: url || null
        }))
      };
      
      fs.writeFileSync(
        path.join(assetsDir, 'all-figma-images.json'),
        JSON.stringify(manifest, null, 2)
      );
      
      console.log('Created manifest: all-figma-images.json');
    } else {
      console.log('No images to download');
    }
    
  } catch (error) {
    console.error('Error downloading file images:', error);
  }
}

// Run the download
downloadFileImages();