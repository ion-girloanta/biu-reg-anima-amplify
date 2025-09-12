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

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
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

// Function to collect all node IDs that might contain images
function collectAllNodeIds(node, nodeIds = new Set()) {
  if (node.id) {
    nodeIds.add(node.id);
  }
  
  // Look for nodes with images
  if (node.fills && node.fills.some(fill => fill.type === 'IMAGE')) {
    nodeIds.add(node.id);
  }
  
  if (node.background && node.background.some(bg => bg.type === 'IMAGE')) {
    nodeIds.add(node.id);
  }
  
  if (node.children) {
    node.children.forEach(child => {
      collectAllNodeIds(child, nodeIds);
    });
  }
  
  return Array.from(nodeIds);
}

async function downloadAllFigmaAssets() {
  try {
    console.log('Fetching complete Figma file structure...');
    
    // First, get the file structure to find all potential image nodes
    console.log('Getting file metadata...');
    const fileData = await makeFigmaRequest(`/v1/files/${FILE_ID}?geometry=paths`);
    
    if (!fileData || fileData.status === 400) {
      console.log('File too large, trying with specific pages...');
      
      // Get just the file info to see pages
      const fileInfo = await makeFigmaRequest(`/v1/files/${FILE_ID}`);
      if (!fileInfo.document || !fileInfo.document.children) {
        console.error('Could not access file structure');
        return;
      }
      
      // Get all page IDs
      const pageIds = fileInfo.document.children
        .filter(child => child.type === 'CANVAS')
        .map(page => page.id);
        
      console.log(`Found ${pageIds.length} pages, downloading from each...`);
      
      // Download from each page separately
      for (const pageId of pageIds.slice(0, 3)) { // Limit to first 3 pages to avoid rate limits
        try {
          console.log(`\nProcessing page: ${pageId}`);
          const pageData = await makeFigmaRequest(`/v1/files/${FILE_ID}/nodes?ids=${pageId}`);
          
          if (pageData.nodes && pageData.nodes[pageId]) {
            const page = pageData.nodes[pageId].document;
            const nodeIds = collectAllNodeIds(page);
            
            console.log(`Found ${nodeIds.length} total nodes in page`);
            
            // Try to get images in batches of 50 nodes
            const batchSize = 50;
            for (let i = 0; i < nodeIds.length; i += batchSize) {
              const batch = nodeIds.slice(i, i + batchSize);
              const batchIds = batch.join(',');
              
              try {
                console.log(`Trying batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(nodeIds.length/batchSize)} (${batch.length} nodes)...`);
                const imageData = await makeFigmaRequest(`/v1/images/${FILE_ID}?ids=${batchIds}&format=png&scale=1`);
                
                if (imageData && imageData.images) {
                  const imageUrls = Object.entries(imageData.images).filter(([_, url]) => url);
                  console.log(`  Found ${imageUrls.length} images in this batch`);
                  
                  // Download each image
                  const downloads = [];
                  for (const [nodeId, imageUrl] of imageUrls) {
                    const filename = `figma-asset-${nodeId.replace(/[^a-zA-Z0-9]/g, '-')}.png`;
                    downloads.push(downloadImage(imageUrl, filename));
                  }
                  
                  if (downloads.length > 0) {
                    await Promise.all(downloads);
                  }
                }
                
                // Add delay to respect rate limits
                await new Promise(resolve => setTimeout(resolve, 1000));
                
              } catch (error) {
                console.log(`  Error in batch: ${error.message}`);
              }
            }
          }
        } catch (error) {
          console.log(`Error processing page ${pageId}: ${error.message}`);
        }
      }
      
    } else {
      console.log('Successfully got file data, collecting all node IDs...');
      
      const allNodeIds = collectAllNodeIds(fileData.document);
      console.log(`Found ${allNodeIds.length} total nodes`);
      
      // Process in smaller batches
      const batchSize = 100;
      for (let i = 0; i < allNodeIds.length; i += batchSize) {
        const batch = allNodeIds.slice(i, i + batchSize);
        const batchIds = batch.join(',');
        
        try {
          console.log(`Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(allNodeIds.length/batchSize)}...`);
          const imageData = await makeFigmaRequest(`/v1/images/${FILE_ID}?ids=${batchIds}&format=png&scale=1`);
          
          if (imageData && imageData.images) {
            const imageUrls = Object.entries(imageData.images).filter(([_, url]) => url);
            console.log(`Found ${imageUrls.length} images in this batch`);
            
            // Download each image
            const downloads = [];
            for (const [nodeId, imageUrl] of imageUrls) {
              const filename = `figma-asset-${nodeId.replace(/[^a-zA-Z0-9]/g, '-')}.png`;
              downloads.push(downloadImage(imageUrl, filename));
            }
            
            if (downloads.length > 0) {
              await Promise.all(downloads);
            }
          }
          
          // Rate limiting
          await new Promise(resolve => setTimeout(resolve, 1000));
          
        } catch (error) {
          console.log(`Error in batch: ${error.message}`);
        }
      }
    }
    
    console.log('Finished downloading all available assets!');
    
  } catch (error) {
    console.error('Error downloading all Figma assets:', error);
  }
}

// Run the download
downloadAllFigmaAssets();