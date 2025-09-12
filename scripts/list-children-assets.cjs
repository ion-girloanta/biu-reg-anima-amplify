const https = require('https');
require('dotenv').config();
const fs = require('fs');
const path = require('path');

// Figma API configuration
const FIGMA_TOKEN = process.env.FIGMA_TOKEN;
const FILE_ID = process.env.FIGMA_FILE_ID;
const TARGET_NODE_ID = '5584:558165'; // Target node from URL

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

// Function to collect ALL child node IDs and their info
function collectChildNodeInfo(node, childNodes = [], depth = 0, path = []) {
  const currentPath = [...path, node.name || `${node.type}-${node.id}`];
  
  // Process children (not the root node itself)
  if (node.children && Array.isArray(node.children)) {
    node.children.forEach(child => {
      if (child.id) {
        childNodes.push({
          id: child.id,
          name: child.name || `${child.type}-${child.id}`,
          type: child.type,
          path: currentPath.concat([child.name || `${child.type}-${child.id}`]).join(' > '),
          depth: depth + 1
        });
      }
      // Recursively collect grandchildren
      collectChildNodeInfo(child, childNodes, depth + 1, currentPath);
    });
  }
  
  return childNodes;
}

// Function to collect image references from node structure
function collectStructureImages(node, images = [], depth = 0, path = []) {
  const currentPath = [...path, node.name || `${node.type}-${node.id}`];
  
  // Only collect from children, not the root node
  if (depth > 0) {
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
  }

  // Process children recursively
  if (node.children && Array.isArray(node.children)) {
    node.children.forEach(child => {
      collectStructureImages(child, images, depth + 1, currentPath);
    });
  }

  return images;
}

// Main function to list all assets from children
async function listChildrenAssets() {
  try {
    console.log(`📋 Listing all assets from children of node: ${TARGET_NODE_ID}`);
    console.log(`🌐 Target: https://www.figma.com/design/${FILE_ID}/?node-id=${TARGET_NODE_ID.replace(':', '-')}&m=dev`);
    
    // Step 1: Get the target node with deep hierarchy
    console.log('\n🔍 Fetching target node with complete hierarchy...');
    const nodeData = await makeFigmaRequest(`/v1/files/${FILE_ID}/nodes?ids=${TARGET_NODE_ID}&depth=100`);
    
    if (!nodeData.nodes || !nodeData.nodes[TARGET_NODE_ID]) {
      console.error('❌ Target node not found');
      return;
    }
    
    const targetNode = nodeData.nodes[TARGET_NODE_ID].document;
    console.log(`📁 Target: "${targetNode.name}" (${targetNode.type})`);
    
    // Step 2: Collect all child node information
    console.log('\n🗂️ Analyzing complete child hierarchy...');
    const childNodes = collectChildNodeInfo(targetNode);
    console.log(`👶 Total child nodes: ${childNodes.length}`);
    
    // Step 3: Collect image references from structure
    console.log('🖼️ Scanning structure for image references...');
    const structureImages = collectStructureImages(targetNode);
    console.log(`🎨 Images from structure analysis: ${structureImages.length}`);
    
    // Step 4: Query API for assets from child nodes
    console.log('\n🔍 Querying Figma API for assets from child nodes...');
    const batchSize = 200;
    const childNodeIds = childNodes.map(node => node.id);
    const allAssets = new Map();
    
    for (let i = 0; i < childNodeIds.length; i += batchSize) {
      const batch = childNodeIds.slice(i, i + batchSize);
      const batchNum = Math.floor(i/batchSize) + 1;
      const totalBatches = Math.ceil(childNodeIds.length/batchSize);
      
      console.log(`📦 API query batch ${batchNum}/${totalBatches} (${batch.length} nodes)...`);
      
      try {
        const batchIds = batch.join(',');
        const imageData = await makeFigmaRequest(`/v1/images/${FILE_ID}?ids=${batchIds}&format=png&scale=2`);
        
        if (imageData && imageData.images) {
          const validAssets = Object.entries(imageData.images).filter(([_, url]) => url);
          console.log(`  🖼️ Found ${validAssets.length} assets with URLs`);
          
          validAssets.forEach(([nodeId, url]) => {
            const nodeInfo = childNodes.find(n => n.id === nodeId);
            if (nodeInfo) {
              allAssets.set(nodeId, {
                nodeId,
                url,
                nodeName: nodeInfo.name,
                nodeType: nodeInfo.type,
                path: nodeInfo.path,
                depth: nodeInfo.depth,
                source: 'api_discovery'
              });
            }
          });
        } else {
          console.log(`  ⚠️ No assets found in batch`);
        }
        
        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
        
      } catch (error) {
        console.log(`  ❌ Batch error: ${error.message}`);
      }
    }
    
    // Step 5: Combine and deduplicate all found assets
    const allUniqueAssets = new Map();
    
    // Add structure-found images
    structureImages.forEach(img => {
      allUniqueAssets.set(img.ref, {
        ref: img.ref,
        nodeId: img.nodeId,
        nodeName: img.nodeName,
        nodeType: img.nodeType,
        path: img.path,
        depth: img.depth,
        source: img.source,
        scaleMode: img.scaleMode
      });
    });
    
    // Add API-discovered assets
    allAssets.forEach((asset, nodeId) => {
      allUniqueAssets.set(nodeId, asset);
    });
    
    // Step 6: Generate comprehensive report
    console.log(`\n📊 ASSET DISCOVERY SUMMARY:`);
    console.log(`   🎯 Target node: "${targetNode.name}" (${TARGET_NODE_ID})`);
    console.log(`   👶 Total child nodes: ${childNodes.length}`);
    console.log(`   🖼️ Images from structure: ${structureImages.length}`);
    console.log(`   🔍 Assets from API: ${allAssets.size}`);
    console.log(`   🎨 Total unique assets: ${allUniqueAssets.size}`);
    
    if (allUniqueAssets.size === 0) {
      console.log('\n❌ No assets found in children');
      return;
    }
    
    // Step 7: Display detailed asset list
    console.log(`\n📋 DETAILED ASSET LIST:`);
    console.log(`${'='.repeat(80)}`);
    
    const assetsByDepth = new Map();
    allUniqueAssets.forEach(asset => {
      const depth = asset.depth || 0;
      if (!assetsByDepth.has(depth)) {
        assetsByDepth.set(depth, []);
      }
      assetsByDepth.get(depth).push(asset);
    });
    
    // Sort by depth and display
    const sortedDepths = Array.from(assetsByDepth.keys()).sort((a, b) => a - b);
    
    sortedDepths.forEach(depth => {
      const assets = assetsByDepth.get(depth);
      console.log(`\n📂 Depth ${depth} (${assets.length} assets):`);
      
      assets.forEach((asset, index) => {
        const truncatedPath = asset.path.length > 60 ? 
          asset.path.substring(0, 57) + '...' : asset.path;
        console.log(`   ${(index + 1).toString().padStart(2)}. ${asset.nodeName} (${asset.nodeType})`);
        console.log(`       Path: ${truncatedPath}`);
        console.log(`       ID: ${asset.nodeId || asset.ref}`);
        console.log(`       Source: ${asset.source || 'structure'}`);
      });
    });
    
    // Step 8: Create and save manifest
    const assetsDir = path.join(__dirname, '..', 'src', 'assets');
    if (!fs.existsSync(assetsDir)) {
      fs.mkdirSync(assetsDir, { recursive: true });
    }
    
    const manifest = {
      generatedAt: new Date().toISOString(),
      figmaFileId: FILE_ID,
      targetNodeId: TARGET_NODE_ID,
      targetNodeName: targetNode.name,
      targetNodeType: targetNode.type,
      method: 'children_asset_listing',
      statistics: {
        totalChildNodes: childNodes.length,
        imagesFromStructure: structureImages.length,
        assetsFromApiDiscovery: allAssets.size,
        totalUniqueAssets: allUniqueAssets.size,
        maxDepthFound: Math.max(...sortedDepths)
      },
      childNodeHierarchy: childNodes,
      structureImages: structureImages,
      apiDiscoveredAssets: Array.from(allAssets.values()),
      allUniqueAssets: Array.from(allUniqueAssets.values())
    };
    
    fs.writeFileSync(
      path.join(assetsDir, 'children-assets-list.json'),
      JSON.stringify(manifest, null, 2)
    );
    
    console.log(`\n💾 Asset list saved to: children-assets-list.json`);
    console.log(`📈 Summary: Found ${allUniqueAssets.size} unique assets across ${sortedDepths.length} depth levels`);
    
    return manifest;
    
  } catch (error) {
    console.error('💥 Error listing children assets:', error);
    throw error;
  }
}

// Run the asset listing
listChildrenAssets().catch(console.error);