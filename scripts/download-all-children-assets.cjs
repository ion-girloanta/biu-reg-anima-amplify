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
            console.log('⏳ Rate limited, waiting 3 seconds...');
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
        console.log(`🔄 Request failed, retrying... (${retries} attempts left)`);
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
            console.log(`✅ Downloaded: ${filename}`);
            resolve({ filename, success: true, size: response.headers['content-length'] });
          });
        } else if (response.statusCode === 403) {
          file.close();
          fs.unlink(path.join(assetsDir, filename), () => {});
          console.log(`⚠️ URL expired for: ${filename}`);
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
          console.log(`🔄 Retrying download for ${filename} (attempt ${retries})`);
          setTimeout(attemptDownload, 2000);
        } else {
          reject(error);
        }
      });
    }
    
    attemptDownload();
  });
}

// Function to recursively collect ALL node IDs from target and children
function collectAllNodeIds(node, nodeIds = new Set(), nodeMap = new Map(), path = [], depth = 0) {
  const currentPath = [...path, node.name || `${node.type}-${node.id}`];
  
  if (node.id) {
    nodeIds.add(node.id);
    nodeMap.set(node.id, {
      id: node.id,
      name: node.name,
      type: node.type,
      path: currentPath.join(' > '),
      depth: depth
    });
  }
  
  // Recursively process all children
  if (node.children && Array.isArray(node.children)) {
    node.children.forEach(child => {
      collectAllNodeIds(child, nodeIds, nodeMap, currentPath, depth + 1);
    });
  }
  
  return { nodeIds: Array.from(nodeIds), nodeMap };
}

// Function to collect image references from node structure
function collectImageReferences(node, images = [], path = [], depth = 0) {
  const currentPath = [...path, node.name || `${node.type}-${node.id}`];
  
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
          scaleMode: fill.scaleMode || 'FILL',
          depth: depth
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
          scaleMode: bg.scaleMode || 'FILL',
          depth: depth
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
          scaleMode: stroke.scaleMode || 'FILL',
          depth: depth
        });
      }
    });
  }

  // Process children recursively
  if (node.children && Array.isArray(node.children)) {
    node.children.forEach(child => {
      collectImageReferences(child, images, currentPath, depth + 1);
    });
  }

  return images;
}

// Main function to download ALL assets from target node children
async function downloadAllChildrenAssets() {
  try {
    console.log(`🎯 Starting comprehensive download of ALL children assets from node: ${TARGET_NODE_ID}`);
    console.log(`🌐 Target URL: https://www.figma.com/design/${FILE_ID}/?node-id=${TARGET_NODE_ID.replace(':', '-')}&m=dev`);
    
    // Step 1: Get the target node with maximum depth
    console.log('\n📋 Fetching target node with ALL children (maximum depth)...');
    const nodeData = await makeFigmaRequest(`/v1/files/${FILE_ID}/nodes?ids=${TARGET_NODE_ID}&depth=50`);
    
    if (!nodeData.nodes || !nodeData.nodes[TARGET_NODE_ID]) {
      console.error('❌ Could not find target node');
      return;
    }
    
    const targetNode = nodeData.nodes[TARGET_NODE_ID].document;
    console.log(`📁 Target node found: "${targetNode.name}" (${targetNode.type})`);
    
    // Step 2: Collect ALL node IDs recursively
    console.log('\n🗂️ Collecting ALL node IDs from complete hierarchy...');
    const { nodeIds: allNodeIds, nodeMap } = collectAllNodeIds(targetNode);
    console.log(`📊 Total nodes in hierarchy: ${allNodeIds.length}`);
    
    // Step 3: Collect image references from node structure
    console.log('🖼️ Scanning complete structure for image references...');
    const structureImageReferences = collectImageReferences(targetNode);
    console.log(`🎨 Image references from structure: ${structureImageReferences.length}`);
    
    // Step 4: Query Figma API for images from ALL node IDs
    console.log('\n🔍 Querying Figma API for images from ALL nodes...');
    const batchSize = 100; // Larger batches for efficiency
    const allImageRefs = new Set();
    const apiDiscoveredImages = new Map();
    
    // Add structure-found images
    structureImageReferences.forEach(img => allImageRefs.add(img.ref));
    
    // Query API for images in batches
    for (let i = 0; i < allNodeIds.length; i += batchSize) {
      const batch = allNodeIds.slice(i, i + batchSize);
      console.log(`📦 API query batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(allNodeIds.length/batchSize)} (${batch.length} nodes)...`);
      
      try {
        const batchIds = batch.join(',');
        const imageData = await makeFigmaRequest(`/v1/images/${FILE_ID}?ids=${batchIds}&format=png&scale=2`);
        
        if (imageData && imageData.images) {
          const validImages = Object.entries(imageData.images).filter(([_, url]) => url);
          console.log(`  🖼️ Found ${validImages.length} images with URLs`);
          
          validImages.forEach(([nodeId, url]) => {
            allImageRefs.add(nodeId);
            apiDiscoveredImages.set(nodeId, {
              nodeId,
              url,
              nodeName: nodeMap.get(nodeId)?.name || `Node-${nodeId}`,
              nodeType: nodeMap.get(nodeId)?.type || 'UNKNOWN',
              path: nodeMap.get(nodeId)?.path || 'Unknown path',
              depth: nodeMap.get(nodeId)?.depth || 0,
              source: 'api_discovery'
            });
          });
        } else {
          console.log(`  ⚠️ No images returned for batch`);
        }
        
        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 1500));
        
      } catch (error) {
        console.log(`  ❌ Error in batch: ${error.message}`);
      }
    }
    
    console.log(`\n🎯 DISCOVERY SUMMARY:`);
    console.log(`   📁 Total nodes processed: ${allNodeIds.length}`);
    console.log(`   🖼️ Images from structure scan: ${structureImageReferences.length}`);
    console.log(`   🔍 Images from API discovery: ${apiDiscoveredImages.size}`);
    console.log(`   🎨 Total unique image references: ${allImageRefs.size}`);
    
    if (allImageRefs.size === 0) {
      console.log('❌ No images found to download');
      return;
    }
    
    // Step 5: Download all discovered images
    console.log(`\n📥 Starting download of ${allImageRefs.size} unique images...`);
    const downloadBatchSize = 15;
    const allImageRefsArray = Array.from(allImageRefs);
    const results = [];
    
    for (let i = 0; i < allImageRefsArray.length; i += downloadBatchSize) {
      const batch = allImageRefsArray.slice(i, i + downloadBatchSize);
      console.log(`\n📦 Download batch ${Math.floor(i/downloadBatchSize) + 1}/${Math.ceil(allImageRefsArray.length/downloadBatchSize)} (${batch.length} images)...`);
      
      // Get fresh URLs for this batch
      let imageUrlData = {};
      try {
        const batchIds = batch.join(',');
        const urlResponse = await makeFigmaRequest(`/v1/images/${FILE_ID}?ids=${batchIds}&format=png&scale=2`);
        
        if (urlResponse && urlResponse.images) {
          imageUrlData = urlResponse.images;
          console.log(`  📋 Fresh URLs retrieved for ${Object.keys(urlResponse.images).length} images`);
        }
      } catch (error) {
        console.log('  ⚠️ Could not get fresh URLs for batch');
      }
      
      // Download images from this batch
      const batchPromises = batch.map(async (ref, index) => {
        const imageUrl = imageUrlData[ref];
        
        if (imageUrl) {
          // Create meaningful filename
          const refShort = ref.substring(0, 12).replace(/[^a-zA-Z0-9]/g, '-');
          const nodeInfo = apiDiscoveredImages.get(ref) || 
                          structureImageReferences.find(img => img.ref === ref);
          const nodeName = nodeInfo?.nodeName?.replace(/[^a-zA-Z0-9]/g, '-').substring(0, 20) || 'unknown';
          const filename = `child-${refShort}-${nodeName}-${index}.png`;
          
          try {
            const result = await downloadImage(imageUrl, filename);
            return {
              ...result,
              ref,
              nodeInfo: nodeInfo || { nodeName: 'Unknown', path: 'Unknown' }
            };
          } catch (error) {
            console.log(`❌ Failed to download ${ref}: ${error.message}`);
            return { filename, success: false, error: error.message, ref };
          }
        } else {
          console.log(`⚠️ No URL available for ${ref}`);
          return { ref, success: false, reason: 'no_url' };
        }
      });
      
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
      
      // Rate limiting between download batches
      if (i + downloadBatchSize < allImageRefsArray.length) {
        console.log('⏱️ Waiting 2 seconds before next download batch...');
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    
    // Step 6: Create comprehensive manifest
    const successfulDownloads = results.filter(r => r.success);
    const failedDownloads = results.filter(r => !r.success);
    
    console.log(`\n📊 FINAL RESULTS:`);
    console.log(`✅ Successfully downloaded: ${successfulDownloads.length}`);
    console.log(`❌ Failed downloads: ${failedDownloads.length}`);
    console.log(`📈 Success rate: ${successfulDownloads.length > 0 ? ((successfulDownloads.length / results.length) * 100).toFixed(1) : 0}%`);
    
    // Create detailed manifest
    const manifest = {
      downloadedAt: new Date().toISOString(),
      figmaFileId: FILE_ID,
      targetNodeId: TARGET_NODE_ID,
      targetNodeName: targetNode.name,
      targetNodeType: targetNode.type,
      method: 'comprehensive_all_children',
      totalAssets: successfulDownloads.length,
      statistics: {
        totalNodesInHierarchy: allNodeIds.length,
        totalImageRefsFound: allImageRefs.size,
        successfulDownloads: successfulDownloads.length,
        failedDownloads: failedDownloads.length,
        imagesFromStructure: structureImageReferences.length,
        imagesFromApiDiscovery: apiDiscoveredImages.size,
        maxDepthProcessed: Math.max(...Array.from(nodeMap.values()).map(n => n.depth))
      },
      assets: successfulDownloads.map(result => ({
        name: result.nodeInfo?.nodeName || `Asset-${result.ref}`,
        nodeId: result.nodeInfo?.nodeId || result.ref,
        nodeType: result.nodeInfo?.nodeType || 'UNKNOWN',
        path: result.nodeInfo?.path || 'Unknown path',
        ref: result.ref,
        scaleMode: result.nodeInfo?.scaleMode || 'FILL',
        filename: result.filename,
        source: result.nodeInfo?.source || 'unknown',
        depth: result.nodeInfo?.depth || 0,
        fillIndex: result.nodeInfo?.fillIndex || 0
      })),
      nodeHierarchy: Object.fromEntries(nodeMap),
      structureImageReferences: structureImageReferences,
      apiDiscoveredImages: Array.from(apiDiscoveredImages.values()),
      downloadResults: results
    };
    
    // Write manifest
    fs.writeFileSync(
      path.join(assetsDir, 'figma-assets.json'),
      JSON.stringify(manifest, null, 2)
    );
    
    console.log('\n📋 Updated figma-assets.json with ALL children assets');
    console.log(`🎉 COMPLETE! Downloaded ${successfulDownloads.length} assets from ALL children of target node "${targetNode.name}"`);
    console.log(`📁 Assets stored in: ${assetsDir}`);
    
    return manifest;
    
  } catch (error) {
    console.error('💥 Error in comprehensive children download:', error);
    throw error;
  }
}

// Run the comprehensive download
downloadAllChildrenAssets().catch(console.error);