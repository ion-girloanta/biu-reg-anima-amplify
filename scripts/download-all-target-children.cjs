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
            console.log('Rate limited, waiting 3 seconds...');
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
        console.log(`Request failed, retrying... (${retries} attempts left)`);
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
          setTimeout(attemptDownload, 2000);
        } else {
          reject(error);
        }
      });
    }
    
    attemptDownload();
  });
}

// Function to collect ALL node IDs from target node and its children recursively
function collectAllNodeIds(node, nodeIds = new Set(), nodeMap = new Map(), path = []) {
  const currentPath = [...path, node.name || `${node.type}-${node.id}`];
  
  if (node.id) {
    nodeIds.add(node.id);
    nodeMap.set(node.id, {
      id: node.id,
      name: node.name,
      type: node.type,
      path: currentPath.join(' > ')
    });
  }
  
  // Recursively process all children
  if (node.children && Array.isArray(node.children)) {
    node.children.forEach(child => {
      collectAllNodeIds(child, nodeIds, nodeMap, currentPath);
    });
  }
  
  return { nodeIds: Array.from(nodeIds), nodeMap };
}

// Function to traverse and collect image references from nodes
function collectImageReferencesFromNodes(node, images = [], path = []) {
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
      collectImageReferencesFromNodes(child, images, currentPath);
    });
  }

  return images;
}

// Main function to download ALL assets from target node and its children
async function downloadAllTargetChildren() {
  try {
    console.log(`🎯 Starting comprehensive download of ALL children from node: ${TARGET_NODE_ID}`);
    
    // Step 1: Get the target node with full depth
    console.log('📋 Fetching target node and ALL its children (deep traversal)...');
    const nodeData = await makeFigmaRequest(`/v1/files/${FILE_ID}/nodes?ids=${TARGET_NODE_ID}&depth=20`);
    
    if (!nodeData.nodes || !nodeData.nodes[TARGET_NODE_ID]) {
      console.error('❌ Could not find target node');
      return;
    }
    
    const targetNode = nodeData.nodes[TARGET_NODE_ID].document;
    console.log(`📁 Found target node: "${targetNode.name}" (${targetNode.type})`);
    
    // Step 2: Collect ALL node IDs from the target and its children
    console.log('🗂️ Collecting ALL node IDs from target and children...');
    const { nodeIds: allNodeIds, nodeMap } = collectAllNodeIds(targetNode);
    console.log(`📊 Found ${allNodeIds.length} total nodes in target node hierarchy`);
    
    // Step 3: Collect image references from the node structure
    console.log('🖼️ Scanning node structure for image references...');
    const imageReferences = collectImageReferencesFromNodes(targetNode);
    console.log(`🎨 Found ${imageReferences.length} image references from node structure`);
    
    // Step 4: Try to get images from ALL collected node IDs
    console.log('🔍 Attempting to extract images from ALL node IDs...');
    const batchSize = 50; // Process nodes in batches to avoid API limits
    const allDiscoveredImages = new Set();
    const allImageRefs = new Set();
    
    // Add image references we found from structure
    imageReferences.forEach(img => allImageRefs.add(img.ref));
    
    // Process all node IDs in batches to discover more images
    for (let i = 0; i < allNodeIds.length; i += batchSize) {
      const batch = allNodeIds.slice(i, i + batchSize);
      console.log(`📦 Processing node batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(allNodeIds.length/batchSize)} (${batch.length} nodes)...`);
      
      try {
        const batchIds = batch.join(',');
        const imageData = await makeFigmaRequest(`/v1/images/${FILE_ID}?ids=${batchIds}&format=png&scale=2`);
        
        if (imageData && imageData.images) {
          const validImages = Object.entries(imageData.images).filter(([_, url]) => url);
          console.log(`  📸 Found ${validImages.length} valid image URLs in this batch`);
          
          validImages.forEach(([nodeId, url]) => {
            allDiscoveredImages.add(nodeId);
            allImageRefs.add(nodeId); // Use nodeId as ref for discovered images
          });
        } else {
          console.log(`  ⚠ No images found in batch`);
        }
        
        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 1500));
        
      } catch (error) {
        console.log(`  ⚠ Error processing batch: ${error.message}`);
      }
    }
    
    console.log(`\n🎯 DISCOVERY SUMMARY:`);
    console.log(`   📁 Total nodes processed: ${allNodeIds.length}`);
    console.log(`   🖼️ Images from structure: ${imageReferences.length}`);
    console.log(`   🎨 Images from API discovery: ${allDiscoveredImages.size}`);
    console.log(`   🔗 Total unique image references: ${allImageRefs.size}`);
    
    if (allImageRefs.size === 0) {
      console.log('❌ No images found to download');
      return;
    }
    
    // Step 5: Download all discovered images
    console.log(`\n📥 Starting download of ${allImageRefs.size} images...`);
    const downloadBatchSize = 10;
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
      
      // Rate limiting between download batches
      if (i + downloadBatchSize < allImageRefsArray.length) {
        console.log('⏱ Waiting 3 seconds before next download batch...');
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }
    
    // Step 6: Create comprehensive manifest
    const successfulDownloads = results.filter(r => r.success);
    const failedDownloads = results.filter(r => !r.success);
    
    console.log(`\n📊 DOWNLOAD RESULTS:`);
    console.log(`✅ Successfully downloaded: ${successfulDownloads.length}`);
    console.log(`❌ Failed downloads: ${failedDownloads.length}`);
    console.log(`📈 Success rate: ${((successfulDownloads.length / results.length) * 100).toFixed(1)}%`);
    
    const manifest = {
      downloadedAt: new Date().toISOString(),
      figmaFileId: FILE_ID,
      targetNodeId: TARGET_NODE_ID,
      targetNodeName: targetNode.name,
      targetNodeType: targetNode.type,
      method: 'comprehensive_children_traversal',
      statistics: {
        totalNodesProcessed: allNodeIds.length,
        totalImageRefsFound: allImageRefs.size,
        successfulDownloads: successfulDownloads.length,
        failedDownloads: failedDownloads.length,
        imageReferencesFromStructure: imageReferences.length,
        imagesFromApiDiscovery: allDiscoveredImages.size
      },
      nodeMap: Object.fromEntries(nodeMap),
      imageReferences: imageReferences,
      discoveredImages: Array.from(allDiscoveredImages),
      downloadResults: results,
      downloadedAssets: successfulDownloads.map(result => ({
        filename: result.filename,
        size: result.size,
        ref: result.ref || 'unknown',
        downloadedAt: new Date().toISOString()
      }))
    };
    
    fs.writeFileSync(
      path.join(assetsDir, 'all-target-children-manifest.json'),
      JSON.stringify(manifest, null, 2)
    );
    
    console.log('\n📋 Comprehensive manifest created: all-target-children-manifest.json');
    console.log(`🎉 COMPLETE! Downloaded ${successfulDownloads.length} out of ${allImageRefs.size} total assets from target node and ALL its children.`);
    
    return manifest;
    
  } catch (error) {
    console.error('💥 Error in comprehensive children download:', error);
    throw error;
  }
}

// Run the comprehensive download
downloadAllTargetChildren().catch(console.error);