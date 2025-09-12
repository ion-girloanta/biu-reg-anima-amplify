const https = require('https');
require('dotenv').config();
const fs = require('fs');
const path = require('path');

// Figma API configuration
const FIGMA_TOKEN = process.env.FIGMA_TOKEN;
const FILE_ID = process.env.FIGMA_FILE_ID;
const TARGET_NODE_ID = '5584:558165'; // Target node from URL

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
        } else if (response.statusCode === 403) {
          file.close();
          fs.unlink(path.join(assetsDir, filename), () => {});
          console.log(`⚠ URL expired for: ${filename}`);
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

// Function to collect image references from target node children (not deep traversal)
function collectImageReferencesFromChildren(node, images = [], path = [], nodeMap = new Map(), depth = 0) {
  const currentPath = [...path, node.name || `${node.type}-${node.id}`];
  
  // Store node information
  if (node.id) {
    nodeMap.set(node.id, {
      id: node.id,
      name: node.name,
      type: node.type,
      path: currentPath.join(' > '),
      depth: depth
    });
  }

  // Check for image fills in current node
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
          scaleMode: fill.scaleMode || 'FILL',
          depth: depth
        });
      }
    });
  }

  // Check for background images in current node
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
          scaleMode: bg.scaleMode || 'FILL',
          depth: depth
        });
      }
    });
  }

  // Check for stroke images in current node
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
          scaleMode: stroke.scaleMode || 'FILL',
          depth: depth
        });
      }
    });
  }

  // Process children (limited depth for focused approach)
  if (node.children && Array.isArray(node.children) && depth < 5) {
    node.children.forEach(child => {
      collectImageReferencesFromChildren(child, images, currentPath, nodeMap, depth + 1);
    });
  }

  return { images, nodeMap };
}

// Main function to download assets from target node children
async function downloadTargetNodeChildrenFocused() {
  try {
    console.log(`🎯 Starting focused download of children assets from node: ${TARGET_NODE_ID}`);
    
    // Step 1: Get the target node with moderate depth
    console.log('📋 Fetching target node children (depth 5)...');
    const nodeData = await makeFigmaRequest(`/v1/files/${FILE_ID}/nodes?ids=${TARGET_NODE_ID}&depth=5`);
    
    if (!nodeData.nodes || !nodeData.nodes[TARGET_NODE_ID]) {
      console.error('❌ Could not find target node');
      return;
    }
    
    const targetNode = nodeData.nodes[TARGET_NODE_ID].document;
    console.log(`📁 Found target node: "${targetNode.name}" (${targetNode.type})`);
    
    // Step 2: Collect image references from target node and its children
    console.log('🖼️ Scanning target node children for image references...');
    const result = collectImageReferencesFromChildren(targetNode);
    const imageReferences = result.images;
    const nodeMap = result.nodeMap;
    
    console.log(`📸 Found ${imageReferences.length} image references from target node children`);
    console.log(`📊 Total nodes scanned: ${nodeMap.size}`);
    
    if (imageReferences.length === 0) {
      console.log('🔍 No image references found in target node children');
      return;
    }

    // Step 3: Get unique image references
    const allRefs = new Set();
    imageReferences.forEach(img => allRefs.add(img.ref));
    console.log(`🎯 Total unique image references: ${allRefs.size}`);
    
    // Step 4: Download images in batches
    const batchSize = 10;
    const allImageRefs = Array.from(allRefs);
    const results = [];
    
    for (let i = 0; i < allImageRefs.length; i += batchSize) {
      const batch = allImageRefs.slice(i, i + batchSize);
      console.log(`\n📦 Download batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(allImageRefs.length/batchSize)} (${batch.length} images)...`);
      
      // Get fresh URLs for this batch
      let imageUrlData = {};
      try {
        const batchIds = batch.join(',');
        const urlResponse = await makeFigmaRequest(`/v1/images/${FILE_ID}?ids=${batchIds}&format=png&scale=2`);
        
        if (urlResponse && urlResponse.images) {
          imageUrlData = urlResponse.images;
          console.log(`  📋 Retrieved URLs for ${Object.keys(urlResponse.images).length} images`);
        }
      } catch (error) {
        console.log('  ⚠ Could not get URLs for batch');
      }
      
      // Download images from this batch
      const batchPromises = batch.map(async (ref, index) => {
        const imageUrl = imageUrlData[ref];
        
        if (imageUrl) {
          const filename = `target-child-${ref.substring(0, 12).replace(/[^a-zA-Z0-9]/g, '-')}-${index}.png`;
          try {
            return await downloadImage(imageUrl, filename);
          } catch (error) {
            console.log(`✗ Failed to download ${ref}: ${error.message}`);
            return { filename, success: false, error: error.message, ref };
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
    
    // Step 5: Create manifest with results
    const successfulDownloads = results.filter(r => r.success);
    const failedDownloads = results.filter(r => !r.success);
    
    console.log(`\n📊 DOWNLOAD RESULTS:`);
    console.log(`✅ Successfully downloaded: ${successfulDownloads.length}`);
    console.log(`❌ Failed downloads: ${failedDownloads.length}`);
    console.log(`📈 Success rate: ${successfulDownloads.length > 0 ? ((successfulDownloads.length / results.length) * 100).toFixed(1) : 0}%`);
    
    const manifest = {
      downloadedAt: new Date().toISOString(),
      figmaFileId: FILE_ID,
      targetNodeId: TARGET_NODE_ID,
      targetNodeName: targetNode.name,
      targetNodeType: targetNode.type,
      method: 'focused_children_assets',
      totalAssets: successfulDownloads.length,
      statistics: {
        totalNodesScanned: nodeMap.size,
        totalImageRefsFound: allRefs.size,
        successfulDownloads: successfulDownloads.length,
        failedDownloads: failedDownloads.length,
        maxDepthScanned: 5
      },
      assets: successfulDownloads.map(result => {
        const imgRef = imageReferences.find(img => img.ref === result.ref);
        return {
          name: imgRef ? imgRef.nodeName : `Asset-${result.ref}`,
          nodeId: imgRef ? imgRef.nodeId : 'unknown',
          nodeType: imgRef ? imgRef.nodeType : 'unknown',
          path: imgRef ? imgRef.path : 'unknown',
          ref: result.ref || result.filename.split('-').slice(2, 5).join(''),
          scaleMode: imgRef ? imgRef.scaleMode : 'FILL',
          filename: result.filename,
          fillIndex: imgRef ? imgRef.fillIndex : 0,
          source: imgRef ? imgRef.source : 'unknown',
          depth: imgRef ? imgRef.depth : 0
        };
      }),
      nodeMap: Object.fromEntries(nodeMap),
      imageReferences: imageReferences,
      downloadResults: results
    };
    
    fs.writeFileSync(
      path.join(assetsDir, 'figma-assets.json'),
      JSON.stringify(manifest, null, 2)
    );
    
    console.log('\n📋 Updated figma-assets.json with focused children assets');
    console.log(`🎉 COMPLETE! Downloaded ${successfulDownloads.length} assets from target node children.`);
    
    return manifest;
    
  } catch (error) {
    console.error('💥 Error in focused children download:', error);
    throw error;
  }
}

// Run the focused download
downloadTargetNodeChildrenFocused().catch(console.error);