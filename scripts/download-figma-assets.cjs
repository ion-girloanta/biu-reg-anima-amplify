const https = require('https');
require('dotenv').config();
const fs = require('fs');
const path = require('path');
  
// Figma API configuration
const FIGMA_TOKEN = process.env.FIGMA_TOKEN;
const FILE_ID = process.env.FIGMA_FILE_ID;
// Download from multiple nodes to get all assets
const NODE_IDS = [
  '5584:558188', // Main page (2.1 Subject to learn-he)
  '5584:558189', // Header/Logo only
  '5584:558191', // ActionsMenu
  '5584:558190', // Main content
  '5584:558192', // ProgressSteps
  '5584:558194', // ContentContainer
  '5584:558204'  // placeholder image
];

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

// Function to extract image references from Figma data
function extractImageReferences(node, images = [], path = []) {
  const currentPath = [...path, node.name];
  
  // Check if this node has fills with images
  if (node.fills) {
    node.fills.forEach((fill, index) => {
      if (fill.type === 'IMAGE' && fill.imageRef) {
        images.push({
          ref: fill.imageRef,
          nodeName: node.name,
          nodeId: node.id,
          nodeType: node.type,
          path: currentPath.join(' > '),
          fillIndex: index,
          scaleMode: fill.scaleMode || 'FILL'
        });
      }
    });
  }

  // Check background images
  if (node.background) {
    node.background.forEach((bg, index) => {
      if (bg.type === 'IMAGE' && bg.imageRef) {
        images.push({
          ref: bg.imageRef,
          nodeName: node.name + ' (background)',
          nodeId: node.id,
          nodeType: node.type,
          path: currentPath.join(' > '),
          backgroundIndex: index,
          scaleMode: bg.scaleMode || 'FILL'
        });
      }
    });
  }

  // Check children recursively
  if (node.children) {
    node.children.forEach(child => {
      extractImageReferences(child, images, currentPath);
    });
  }

  return images;
}

async function downloadFigmaAssets() {
  try {
    console.log('Fetching Figma file data...');
    
    // Get multiple nodes to find all assets
    const nodeIds = NODE_IDS.join(',');
    const nodeData = await makeFigmaRequest(`/v1/files/${FILE_ID}/nodes?ids=${nodeIds}`);
    
    console.log('Successfully fetched node data');
    
    if (!nodeData || !nodeData.nodes) {
      console.error('Node data not found');
      if (nodeData && nodeData.error) {
        console.error('API Error:', nodeData.error);
      }
      return;
    }
    
    console.log(`Found ${Object.keys(nodeData.nodes).length} nodes`);
    
    // Combine all images from all nodes
    let allImageRefs = [];
    
    for (const nodeId of NODE_IDS) {
      if (nodeData.nodes[nodeId] && nodeData.nodes[nodeId].document) {
        const node = nodeData.nodes[nodeId].document;
        console.log(`Processing node: ${node.name} (${node.type})`);
        
        const nodeImageRefs = extractImageReferences(node);
        allImageRefs = allImageRefs.concat(nodeImageRefs);
        
        if (nodeImageRefs.length > 0) {
          console.log(`  Found ${nodeImageRefs.length} images in this node`);
        }
      }
    }

    // Remove duplicates based on ref
    const uniqueImageRefs = allImageRefs.filter((img, index, self) => 
      index === self.findIndex(i => i.ref === img.ref)
    );

    console.log(`\nTotal unique image references found: ${uniqueImageRefs.length}`);
    uniqueImageRefs.forEach((img, index) => {
      console.log(`${index + 1}. ${img.nodeName} (${img.nodeType}) - Path: ${img.path}`);
    });

    if (uniqueImageRefs.length === 0) {
      console.log('No images found in any of the specified nodes');
      return;
    }

    const imageRefs = uniqueImageRefs;

    // Get unique node IDs for the API call
    const uniqueNodeIds = [...new Set(imageRefs.map(img => img.nodeId))];
    const imageIds = uniqueNodeIds.join(',');
    
    console.log(`Requesting images for ${uniqueNodeIds.length} unique nodes...`);
    
    // Try different formats and scales
    const formats = ['png', 'jpg', 'svg'];
    const scales = [1, 2];
    
    let imageData = null;
    
    // Try PNG first at scale 2
    for (const format of formats) {
      for (const scale of scales) {
        try {
          console.log(`Trying ${format} format at ${scale}x scale...`);
          imageData = await makeFigmaRequest(`/v1/images/${FILE_ID}?ids=${imageIds}&format=${format}&scale=${scale}`);
          
          if (imageData && imageData.images && Object.keys(imageData.images).length > 0) {
            console.log(`Success with ${format} format at ${scale}x scale`);
            break;
          }
        } catch (error) {
          console.log(`Failed with ${format} format at ${scale}x scale:`, error.message);
        }
      }
      if (imageData && imageData.images && Object.keys(imageData.images).length > 0) {
        break;
      }
    }
    
    if (!imageData || !imageData.images) {
      console.error('Failed to get image URLs from Figma');
      return;
    }

    console.log(`Received ${Object.keys(imageData.images).length} image URLs`);

    // Download each image
    const downloads = [];
    for (const imageRef of imageRefs) {
      const imageUrl = imageData.images[imageRef.nodeId];
      if (imageUrl) {
        const safeName = imageRef.nodeName.toLowerCase().replace(/[^a-z0-9]/g, '-');
        const filename = `${safeName}-${imageRef.ref.substring(0, 8)}.png`;
        downloads.push(downloadImage(imageUrl, filename));
      } else {
        console.log(`No URL found for node: ${imageRef.nodeName} (${imageRef.nodeId})`);
      }
    }

    if (downloads.length === 0) {
      console.log('No images to download');
      return;
    }

    await Promise.all(downloads);
    console.log(`Successfully downloaded ${downloads.length} assets!`);

    // Create an enhanced asset manifest
    const manifest = {
      downloadedAt: new Date().toISOString(),
      figmaFileId: FILE_ID,
      nodeIds: NODE_IDS,
      totalAssets: imageRefs.length,
      assets: imageRefs.map(imageRef => ({
        name: imageRef.nodeName,
        nodeId: imageRef.nodeId,
        nodeType: imageRef.nodeType,
        path: imageRef.path,
        ref: imageRef.ref,
        scaleMode: imageRef.scaleMode,
        filename: `${imageRef.nodeName.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${imageRef.ref.substring(0, 8)}.png`,
        fillIndex: imageRef.fillIndex,
        backgroundIndex: imageRef.backgroundIndex
      }))
    };

    fs.writeFileSync(
      path.join(assetsDir, 'figma-assets.json'), 
      JSON.stringify(manifest, null, 2)
    );
    console.log('Asset manifest created: src/assets/figma-assets.json');

  } catch (error) {
    console.error('Error downloading Figma assets:', error);
  }
}

// Run the download
downloadFigmaAssets();