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

// Function to collect ALL child node IDs recursively (excluding root)
function collectChildNodeIds(node, nodeIds = [], depth = 0, nodeMap = new Map(), path = []) {
  const currentPath = [...path, node.name || `${node.type}-${node.id}`];
  
  // Store node info (including root for reference)
  if (node.id) {
    nodeMap.set(node.id, {
      id: node.id,
      name: node.name,
      type: node.type,
      path: currentPath.join(' > '),
      depth: depth
    });
  }
  
  // Add child node IDs (not the root node itself)
  if (node.children && Array.isArray(node.children)) {
    node.children.forEach(child => {
      if (child.id) {
        nodeIds.push(child.id);
      }
      // Recursively collect from grandchildren
      collectChildNodeIds(child, nodeIds, depth + 1, nodeMap, currentPath);
    });
  }
  
  return { nodeIds, nodeMap };
}

// Main function to download assets from deep children
async function downloadDeepChildrenAssets() {
  try {
    console.log(`🎯 Starting download of assets from ALL children of node: ${TARGET_NODE_ID}`);
    console.log(`🌐 Target: https://www.figma.com/design/${FILE_ID}/?node-id=${TARGET_NODE_ID.replace(':', '-')}&m=dev`);
    
    // Step 1: Get the target node with maximum depth
    console.log('\n📋 Fetching target node with deep hierarchy...');
    const nodeData = await makeFigmaRequest(`/v1/files/${FILE_ID}/nodes?ids=${TARGET_NODE_ID}&depth=100`);
    
    if (!nodeData.nodes || !nodeData.nodes[TARGET_NODE_ID]) {
      console.error('❌ Target node not found');
      return;
    }
    
    const targetNode = nodeData.nodes[TARGET_NODE_ID].document;
    console.log(`📁 Target: "${targetNode.name}" (${targetNode.type})`);
    
    // Step 2: Collect ALL child node IDs (excluding the root target node)
    console.log('\n🗂️ Collecting child node IDs from complete hierarchy...');
    const { nodeIds: childNodeIds, nodeMap } = collectChildNodeIds(targetNode);
    console.log(`👶 Total child nodes found: ${childNodeIds.length}`);
    
    if (childNodeIds.length === 0) {
      console.log('❌ No child nodes found');
      return;
    }
    
    // Step 3: Query for assets from child nodes in optimized batches
    console.log('\n🔍 Querying for assets from child nodes...');
    const batchSize = 200; // Larger batches for efficiency
    const allAssets = new Map();
    
    for (let i = 0; i < childNodeIds.length; i += batchSize) {
      const batch = childNodeIds.slice(i, i + batchSize);
      const batchNum = Math.floor(i/batchSize) + 1;
      const totalBatches = Math.ceil(childNodeIds.length/batchSize);
      
      console.log(`📦 Processing batch ${batchNum}/${totalBatches} (${batch.length} child nodes)...`);
      
      try {
        const batchIds = batch.join(',');
        const imageData = await makeFigmaRequest(`/v1/images/${FILE_ID}?ids=${batchIds}&format=png&scale=2`);
        
        if (imageData && imageData.images) {
          const validAssets = Object.entries(imageData.images).filter(([_, url]) => url);
          console.log(`  🖼️ Found ${validAssets.length} assets with URLs`);
          
          validAssets.forEach(([nodeId, url]) => {
            const nodeInfo = nodeMap.get(nodeId);
            allAssets.set(nodeId, {
              nodeId,
              url,
              nodeName: nodeInfo?.name || `Node-${nodeId}`,
              nodeType: nodeInfo?.type || 'UNKNOWN',
              path: nodeInfo?.path || 'Unknown path',
              depth: nodeInfo?.depth || 0
            });
          });
        }
        
        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
        
      } catch (error) {
        console.log(`  ❌ Batch error: ${error.message}`);
      }
    }
    
    console.log(`\n🎯 DISCOVERY COMPLETE:`);
    console.log(`   👶 Child nodes processed: ${childNodeIds.length}`);
    console.log(`   🖼️ Assets found: ${allAssets.size}`);
    
    if (allAssets.size === 0) {
      console.log('❌ No assets found in children');
      return;
    }
    
    // Step 4: Download all assets
    console.log(`\n📥 Starting download of ${allAssets.size} assets...`);
    const downloadBatchSize = 20;
    const assetEntries = Array.from(allAssets.entries());
    const results = [];
    
    for (let i = 0; i < assetEntries.length; i += downloadBatchSize) {
      const batch = assetEntries.slice(i, i + downloadBatchSize);
      const batchNum = Math.floor(i/downloadBatchSize) + 1;
      const totalBatches = Math.ceil(assetEntries.length/downloadBatchSize);
      
      console.log(`\n📦 Download batch ${batchNum}/${totalBatches} (${batch.length} assets)...`);
      
      const batchPromises = batch.map(async ([nodeId, asset], index) => {
        try {
          // Create meaningful filename
          const shortId = nodeId.substring(0, 8).replace(/[^a-zA-Z0-9]/g, '-');
          const safeName = asset.nodeName.replace(/[^a-zA-Z0-9]/g, '-').substring(0, 15);
          const filename = `child-d${asset.depth}-${shortId}-${safeName}-${index}.png`;
          
          const result = await downloadImage(asset.url, filename);
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
    
    // Step 5: Create final manifest
    const successfulDownloads = results.filter(r => r.success);
    const failedDownloads = results.filter(r => !r.success);
    
    console.log(`\n📊 DOWNLOAD RESULTS:`);
    console.log(`✅ Successfully downloaded: ${successfulDownloads.length}`);
    console.log(`❌ Failed downloads: ${failedDownloads.length}`);
    console.log(`📈 Success rate: ${((successfulDownloads.length / results.length) * 100).toFixed(1)}%`);
    
    // Create comprehensive manifest
    const manifest = {
      downloadedAt: new Date().toISOString(),
      figmaFileId: FILE_ID,
      targetNodeId: TARGET_NODE_ID,
      targetNodeName: targetNode.name,
      targetNodeType: targetNode.type,
      method: 'deep_children_only',
      totalAssets: successfulDownloads.length,
      statistics: {
        targetNodeProcessed: 1,
        childNodesProcessed: childNodeIds.length,
        assetsDiscovered: allAssets.size,
        successfulDownloads: successfulDownloads.length,
        failedDownloads: failedDownloads.length,
        maxDepthFound: Math.max(...Array.from(nodeMap.values()).map(n => n.depth))
      },
      assets: successfulDownloads.map(result => ({
        name: result.asset.nodeName,
        nodeId: result.asset.nodeId,
        nodeType: result.asset.nodeType,
        path: result.asset.path,
        ref: result.asset.nodeId,
        scaleMode: 'FILL',
        filename: result.filename,
        source: 'child_node',
        depth: result.asset.depth,
        fillIndex: 0
      })),
      childNodeHierarchy: Object.fromEntries(nodeMap),
      downloadResults: results
    };
    
    // Write manifest
    fs.writeFileSync(
      path.join(assetsDir, 'figma-assets.json'),
      JSON.stringify(manifest, null, 2)
    );
    
    console.log('\n📋 Updated figma-assets.json');
    console.log(`🎉 SUCCESS! Downloaded ${successfulDownloads.length} assets from children of "${targetNode.name}"`);
    console.log(`📁 Assets location: ${assetsDir}`);
    
    // List some example files
    if (successfulDownloads.length > 0) {
      console.log(`\n📄 Sample downloaded files:`);
      successfulDownloads.slice(0, 3).forEach(result => {
        console.log(`   • ${result.filename}`);
      });
      if (successfulDownloads.length > 3) {
        console.log(`   • ... and ${successfulDownloads.length - 3} more`);
      }
    }
    
    return manifest;
    
  } catch (error) {
    console.error('💥 Error in deep children download:', error);
    throw error;
  }
}

// Run the deep children download
downloadDeepChildrenAssets().catch(console.error);