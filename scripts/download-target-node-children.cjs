const https = require('https');
require('dotenv').config();
const fs = require('fs');
const path = require('path');

// Figma API configuration
const FIGMA_TOKEN = process.env.FIGMA_TOKEN;
const FILE_ID = process.env.FIGMA_FILE_ID;
const TARGET_NODE_ID = '5584:558165'; // Specific node from URL

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
            console.log('Rate limited, waiting 2 seconds...');
            setTimeout(() => {
              makeFigmaRequest(endpoint, retries - 1).then(resolve).catch(reject);
            }, 2000);
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
        console.log(`Request failed, retrying... (${retries} attempts left)`);
        setTimeout(() => {
          makeFigmaRequest(endpoint, retries - 1).then(resolve).catch(reject);
        }, 1000);
      } else {
        reject(error);
      }
    });

    req.end();
  });
}

// Function to download an image from URL
function downloadImage(url, filename, maxRetries = 3) {
  return new Promise((resolve, reject) => {
    let retries = 0;
    
    function attemptDownload() {
      const file = fs.createWriteStream(path.join(assetsDir, filename));
      
      https.get(url, (response) => {
        if (response.statusCode === 200) {
          response.pipe(file);
          file.on('finish', () => {
            file.close();
            console.log(`✓ Downloaded: ${filename}`);
            resolve({ filename, success: true, size: response.headers['content-length'] });
          });
        } else if (response.statusCode === 403 && retries < maxRetries) {
          file.close();
          fs.unlink(path.join(assetsDir, filename), () => {});
          console.log(`⚠ Skipped expired URL: ${filename}`);
          resolve({ filename, success: false, reason: 'expired_url' });
        } else {
          file.close();
          fs.unlink(path.join(assetsDir, filename), () => {});
          reject(new Error(`HTTP ${response.statusCode} for ${filename}`));
        }
      }).on('error', (error) => {
        file.close();
        fs.unlink(path.join(assetsDir, filename), () => {});
        
        if (retries < maxRetries) {
          retries++;
          console.log(`Retrying download for ${filename} (attempt ${retries})`);
          setTimeout(attemptDownload, 1000);
        } else {
          reject(error);
        }
      });
    }
    
    attemptDownload();
  });
}

// Function to traverse children of target node and collect images
function traverseTargetNodeChildren(node, images = [], path = [], nodeMap = new Map()) {
  const currentPath = [...path, node.name || `${node.type}-${node.id}`];
  
  // Store node information
  if (node.id) {
    nodeMap.set(node.id, {
      id: node.id,
      name: node.name,
      type: node.type,
      path: currentPath.join(' > ')
    });
  }

  // Check for image fills
  if (node.fills && Array.isArray(node.fills)) {
    node.fills.forEach((fill, fillIndex) => {
      if (fill.type === 'IMAGE' && fill.imageRef) {
        images.push({
          ref: fill.imageRef,
          nodeId: node.id,
          nodeName: node.name || `${node.type}-${node.id}`,
          nodeType: node.type,
          path: currentPath.join(' > '),
          fillIndex,
          source: 'fills',
          scaleMode: fill.scaleMode || 'FILL'
        });
      }
    });
  }

  // Check for background images
  if (node.background && Array.isArray(node.background)) {
    node.background.forEach((bg, bgIndex) => {
      if (bg.type === 'IMAGE' && bg.imageRef) {
        images.push({
          ref: bg.imageRef,
          nodeId: node.id,
          nodeName: node.name || `${node.type}-${node.id}`,
          nodeType: node.type,
          path: currentPath.join(' > '),
          backgroundIndex: bgIndex,
          source: 'background',
          scaleMode: bg.scaleMode || 'FILL'
        });
      }
    });
  }

  // Check for stroke images
  if (node.strokes && Array.isArray(node.strokes)) {
    node.strokes.forEach((stroke, strokeIndex) => {
      if (stroke.type === 'IMAGE' && stroke.imageRef) {
        images.push({
          ref: stroke.imageRef,
          nodeId: node.id,
          nodeName: node.name || `${node.type}-${node.id}`,
          nodeType: node.type,
          path: currentPath.join(' > '),
          strokeIndex,
          source: 'strokes',
          scaleMode: stroke.scaleMode || 'FILL'
        });
      }
    });
  }

  // Recursively process children
  if (node.children && Array.isArray(node.children)) {
    node.children.forEach(child => {
      traverseTargetNodeChildren(child, images, currentPath, nodeMap);
    });
  }

  return { images, nodeMap };
}

// Main function to download assets from target node children
async function downloadTargetNodeAssets() {
  try {
    console.log(`🎯 Starting targeted asset download for node: ${TARGET_NODE_ID}`);
    
    // Get the specific target node
    console.log('📋 Fetching target node and its children...');
    const nodeData = await makeFigmaRequest(`/v1/files/${FILE_ID}/nodes?ids=${TARGET_NODE_ID}&depth=10`);
    
    if (!nodeData.nodes || !nodeData.nodes[TARGET_NODE_ID]) {
      console.error('❌ Could not find target node');
      return;
    }
    
    const targetNode = nodeData.nodes[TARGET_NODE_ID].document;
    console.log(`📁 Found target node: "${targetNode.name}" (${targetNode.type})`);
    
    // Traverse children and collect images
    console.log('🌳 Traversing children for images...');
    const result = traverseTargetNodeChildren(targetNode);
    const allImages = result.images;
    const nodeMap = result.nodeMap;
    
    console.log(`📸 Found ${allImages.length} images from target node children`);
    console.log(`📊 Total child nodes processed: ${nodeMap.size}`);
    
    if (allImages.length === 0) {
      console.log('🔍 No images found in target node children');
      return;
    }

    // Get unique image references
    const allRefs = new Set();
    allImages.forEach(img => allRefs.add(img.ref));
    console.log(`🎯 Total unique image references: ${allRefs.size}`);
    
    // Download images in batches
    const batchSize = 10;
    const allImageRefs = Array.from(allRefs);
    const results = [];
    
    for (let i = 0; i < allImageRefs.length; i += batchSize) {
      const batch = allImageRefs.slice(i, i + batchSize);
      console.log(`\n📦 Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(allImageRefs.length/batchSize)} (${batch.length} images)...`);
      
      // Get fresh URLs for this batch
      let imageUrlData = {};
      try {
        const batchIds = batch.join(',');
        const urlResponse = await makeFigmaRequest(`/v1/images/${FILE_ID}?ids=${batchIds}&format=png&scale=2`);
        
        if (urlResponse && urlResponse.images) {
          imageUrlData = urlResponse.images;
        }
      } catch (error) {
        console.log('⚠ Could not get URLs for batch, skipping...');
        continue;
      }
      
      // Download images from this batch
      const batchPromises = batch.map(async (ref, index) => {
        const imageUrl = imageUrlData[ref];
        
        if (imageUrl) {
          const filename = `target-node-asset-${ref.substring(0, 12)}-${index}.png`;
          try {
            return await downloadImage(imageUrl, filename);
          } catch (error) {
            console.log(`✗ Failed to download ${ref}: ${error.message}`);
            return { filename, success: false, error: error.message };
          }
        } else {
          console.log(`⚠ No URL available for ${ref}`);
          return { ref, success: false, reason: 'no_url' };
        }
      });
      
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
      
      // Rate limiting between batches
      if (i + batchSize < allImageRefs.length) {
        console.log('⏱ Waiting 2 seconds before next batch...');
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    
    // Create manifest
    const successfulDownloads = results.filter(r => r.success);
    const failedDownloads = results.filter(r => !r.success);
    
    console.log(`\n✅ Successfully downloaded: ${successfulDownloads.length}`);
    console.log(`❌ Failed downloads: ${failedDownloads.length}`);
    
    const manifest = {
      downloadedAt: new Date().toISOString(),
      figmaFileId: FILE_ID,
      targetNodeId: TARGET_NODE_ID,
      targetNodeName: targetNode.name,
      targetNodeType: targetNode.type,
      method: 'target_node_children_traversal',
      statistics: {
        totalImageRefsFound: allRefs.size,
        successfulDownloads: successfulDownloads.length,
        failedDownloads: failedDownloads.length,
        totalChildNodes: nodeMap.size
      },
      nodeMap: Object.fromEntries(nodeMap),
      imageReferences: allImages,
      downloadResults: results,
      downloadedAssets: successfulDownloads.map(result => ({
        filename: result.filename,
        size: result.size,
        downloadedAt: new Date().toISOString()
      }))
    };
    
    fs.writeFileSync(
      path.join(assetsDir, 'target-node-assets-manifest.json'),
      JSON.stringify(manifest, null, 2)
    );
    
    console.log('\n📋 Target node assets manifest created: target-node-assets-manifest.json');
    console.log(`🎉 Target node asset download complete! Downloaded ${successfulDownloads.length} out of ${allRefs.size} assets from node "${targetNode.name}".`);
    
    return manifest;
    
  } catch (error) {
    console.error('💥 Error in target node asset download:', error);
    throw error;
  }
}

// Run the targeted download
downloadTargetNodeAssets().catch(console.error);