const https = require('https');
require('dotenv').config();
const fs = require('fs');
const path = require('path');

// Figma API configuration
const FIGMA_TOKEN = process.env.FIGMA_TOKEN;
const FILE_ID = process.env.FIGMA_FILE_ID;
const TARGET_NODE_ID = '5584:558165';

// Function to make Figma API requests
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

// Function to determine if a node is a meaningful icon or image
function isMeaningfulVisualAsset(node, path) {
  const name = (node.name || '').toLowerCase();
  const type = node.type;
  const pathStr = path.join(' > ').toLowerCase();
  
  // Image fills - these are actual images
  const hasImageFill = node.fills && node.fills.some(fill => fill.type === 'IMAGE' && fill.imageRef);
  if (hasImageFill) return true;
  
  // Background images
  const hasBackgroundImage = node.background && node.background.some(bg => bg.type === 'IMAGE' && bg.imageRef);
  if (hasBackgroundImage) return true;
  
  // Named icons or images
  if (name.includes('icon') || name.includes('logo') || name.includes('image') || 
      name.includes('photo') || name.includes('picture')) return true;
  
  // Icon-related keywords in path
  if (pathStr.includes('icon') || pathStr.includes('logo') || pathStr.includes('image')) return true;
  
  // Specific meaningful names
  const meaningfulNames = [
    'main logo', 'logo', 'arrow', 'check', 'clock', 'plus', 'star', 
    'flag', 'ellipse', 'circle', 'badge', 'avatar', 'profile'
  ];
  if (meaningfulNames.some(keyword => name.includes(keyword))) return true;
  
  // Rectangle with meaningful name or context
  if (type === 'RECTANGLE' && (name.includes('logo') || name.includes('image') || name.includes('photo'))) {
    return true;
  }
  
  // Ellipses that might be avatars or badges
  if (type === 'ELLIPSE' && path.length > 3) return true;
  
  // Groups that contain icons (like flag components)
  if (type === 'GROUP' && pathStr.includes('flag')) return true;
  
  // Instance components that might be icons
  if (type === 'INSTANCE' && (name.includes('icon') || name.includes('card') || name.includes('badge'))) {
    return true;
  }
  
  return false;
}

// Function to collect meaningful visual assets from structure
function collectMeaningfulAssets(node, assets = [], depth = 0, path = []) {
  const currentPath = [...path, node.name || `${node.type}-${node.id}`];
  
  // Only collect from children, not the root node
  if (depth > 0 && isMeaningfulVisualAsset(node, currentPath)) {
    const asset = {
      nodeId: node.id,
      nodeName: node.name || `${node.type}-${node.id}`,
      nodeType: node.type,
      path: currentPath.join(' > '),
      depth: depth
    };
    
    // Check for image fills
    if (node.fills && Array.isArray(node.fills)) {
      node.fills.forEach((fill, fillIndex) => {
        if (fill.type === 'IMAGE' && fill.imageRef) {
          assets.push({
            ...asset,
            ref: fill.imageRef,
            source: 'fills',
            scaleMode: fill.scaleMode || 'FILL',
            fillIndex,
            assetType: 'image'
          });
        }
      });
    }
    
    // Check for background images
    if (node.background && Array.isArray(node.background)) {
      node.background.forEach((bg, bgIndex) => {
        if (bg.type === 'IMAGE' && bg.imageRef) {
          assets.push({
            ...asset,
            ref: bg.imageRef,
            source: 'background',
            scaleMode: bg.scaleMode || 'FILL',
            backgroundIndex: bgIndex,
            assetType: 'image'
          });
        }
      });
    }
    
    // If no image refs but still meaningful, mark as icon
    if ((!node.fills || !node.fills.some(f => f.type === 'IMAGE')) && 
        (!node.background || !node.background.some(b => b.type === 'IMAGE'))) {
      assets.push({
        ...asset,
        source: 'structure',
        assetType: 'icon'
      });
    }
  }

  // Process children recursively
  if (node.children && Array.isArray(node.children)) {
    node.children.forEach(child => {
      collectMeaningfulAssets(child, assets, depth + 1, currentPath);
    });
  }

  return assets;
}

// Function to collect child node IDs for API queries
function collectChildNodeIds(node, nodeIds = [], depth = 0) {
  if (node.children && Array.isArray(node.children)) {
    node.children.forEach(child => {
      if (child.id) {
        nodeIds.push({
          id: child.id,
          name: child.name,
          type: child.type,
          depth: depth + 1
        });
      }
      collectChildNodeIds(child, nodeIds, depth + 1);
    });
  }
  return nodeIds;
}

// Main function to list icons and images
async function listIconsAndImages() {
  try {
    console.log(`🎨 Listing icons and images from children of node: ${TARGET_NODE_ID}`);
    console.log(`🌐 Target: https://www.figma.com/design/${FILE_ID}/?node-id=${TARGET_NODE_ID.replace(':', '-')}&m=dev`);
    
    // Step 1: Get the target node
    console.log('\n🔍 Fetching target node with hierarchy...');
    const nodeData = await makeFigmaRequest(`/v1/files/${FILE_ID}/nodes?ids=${TARGET_NODE_ID}&depth=100`);
    
    if (!nodeData.nodes || !nodeData.nodes[TARGET_NODE_ID]) {
      console.error('❌ Target node not found');
      return;
    }
    
    const targetNode = nodeData.nodes[TARGET_NODE_ID].document;
    console.log(`📁 Target: "${targetNode.name}" (${targetNode.type})`);
    
    // Step 2: Collect meaningful visual assets from structure
    console.log('\n🖼️ Scanning for meaningful icons and images...');
    const structureMeaningfulAssets = collectMeaningfulAssets(targetNode);
    console.log(`🎨 Meaningful assets from structure: ${structureMeaningfulAssets.length}`);
    
    // Step 3: Get child nodes for API discovery
    const childNodes = collectChildNodeIds(targetNode);
    console.log(`👶 Total child nodes: ${childNodes.length}`);
    
    // Step 4: Query API for assets from selected nodes (focus on likely icon/image nodes)
    console.log('\n🔍 Querying API for visual assets...');
    const iconKeywords = ['icon', 'logo', 'image', 'photo', 'badge', 'avatar', 'ellipse', 'card'];
    const likelyVisualNodes = childNodes.filter(node => 
      iconKeywords.some(keyword => node.name.toLowerCase().includes(keyword)) ||
      ['RECTANGLE', 'ELLIPSE', 'INSTANCE'].includes(node.type)
    );
    
    console.log(`🎯 Focusing on ${likelyVisualNodes.length} likely visual nodes`);
    
    const batchSize = 100;
    const discoveredAssets = new Map();
    
    for (let i = 0; i < likelyVisualNodes.length; i += batchSize) {
      const batch = likelyVisualNodes.slice(i, i + batchSize);
      const batchNum = Math.floor(i/batchSize) + 1;
      const totalBatches = Math.ceil(likelyVisualNodes.length/batchSize);
      
      console.log(`📦 API query batch ${batchNum}/${totalBatches} (${batch.length} nodes)...`);
      
      try {
        const batchIds = batch.map(n => n.id).join(',');
        const imageData = await makeFigmaRequest(`/v1/images/${FILE_ID}?ids=${batchIds}&format=png&scale=2`);
        
        if (imageData && imageData.images) {
          const validAssets = Object.entries(imageData.images).filter(([_, url]) => url);
          console.log(`  🖼️ Found ${validAssets.length} assets with URLs`);
          
          validAssets.forEach(([nodeId, url]) => {
            const nodeInfo = batch.find(n => n.id === nodeId);
            if (nodeInfo) {
              discoveredAssets.set(nodeId, {
                nodeId,
                url,
                nodeName: nodeInfo.name || `${nodeInfo.type}-${nodeId}`,
                nodeType: nodeInfo.type,
                depth: nodeInfo.depth,
                source: 'api_discovery',
                assetType: 'icon_or_image'
              });
            }
          });
        }
        
        await new Promise(resolve => setTimeout(resolve, 1000));
        
      } catch (error) {
        console.log(`  ❌ Batch error: ${error.message}`);
      }
    }
    
    // Step 5: Combine and categorize all meaningful assets
    const allMeaningfulAssets = new Map();
    
    // Add structure-found assets
    structureMeaningfulAssets.forEach(asset => {
      const key = asset.ref || asset.nodeId;
      allMeaningfulAssets.set(key, asset);
    });
    
    // Add API-discovered assets
    discoveredAssets.forEach((asset, nodeId) => {
      if (!allMeaningfulAssets.has(nodeId)) {
        allMeaningfulAssets.set(nodeId, asset);
      }
    });
    
    // Step 6: Categorize assets
    const images = [];
    const icons = [];
    const other = [];
    
    allMeaningfulAssets.forEach(asset => {
      if (asset.assetType === 'image' || asset.ref) {
        images.push(asset);
      } else if (asset.assetType === 'icon' || 
                 asset.nodeName.toLowerCase().includes('icon') ||
                 asset.nodeName.toLowerCase().includes('logo') ||
                 asset.nodeType === 'ELLIPSE' ||
                 asset.nodeType === 'VECTOR') {
        icons.push(asset);
      } else {
        other.push(asset);
      }
    });
    
    // Step 7: Display results
    console.log(`\n📊 ICONS AND IMAGES SUMMARY:`);
    console.log(`   🎯 Target node: "${targetNode.name}" (${TARGET_NODE_ID})`);
    console.log(`   🖼️ Images (with image refs): ${images.length}`);
    console.log(`   🎨 Icons and visual elements: ${icons.length}`);
    console.log(`   📦 Other visual assets: ${other.length}`);
    console.log(`   🎪 Total meaningful assets: ${allMeaningfulAssets.size}`);
    
    console.log(`\n🖼️ IMAGES (${images.length}):`);
    console.log(`${'='.repeat(60)}`);
    images.forEach((asset, index) => {
      console.log(`${(index + 1).toString().padStart(2)}. ${asset.nodeName} (${asset.nodeType})`);
      console.log(`    Path: ${asset.path.length > 50 ? asset.path.substring(0, 47) + '...' : asset.path}`);
      console.log(`    Depth: ${asset.depth} | Source: ${asset.source} | Ref: ${asset.ref || 'N/A'}`);
      console.log('');
    });
    
    console.log(`\n🎨 ICONS (${icons.length}):`);
    console.log(`${'='.repeat(60)}`);
    icons.forEach((asset, index) => {
      console.log(`${(index + 1).toString().padStart(2)}. ${asset.nodeName} (${asset.nodeType})`);
      console.log(`    Path: ${asset.path.length > 50 ? asset.path.substring(0, 47) + '...' : asset.path}`);
      console.log(`    Depth: ${asset.depth} | Source: ${asset.source}`);
      console.log('');
    });
    
    if (other.length > 0) {
      console.log(`\n📦 OTHER VISUAL ASSETS (${other.length}):`);
      console.log(`${'='.repeat(60)}`);
      other.slice(0, 10).forEach((asset, index) => {
        console.log(`${(index + 1).toString().padStart(2)}. ${asset.nodeName} (${asset.nodeType})`);
        console.log(`    Path: ${asset.path.length > 50 ? asset.path.substring(0, 47) + '...' : asset.path}`);
        console.log(`    Depth: ${asset.depth} | Source: ${asset.source}`);
        console.log('');
      });
      if (other.length > 10) {
        console.log(`    ... and ${other.length - 10} more assets`);
      }
    }
    
    // Step 8: Save manifest
    const assetsDir = path.join(__dirname, '..', 'src', 'assets');
    if (!fs.existsSync(assetsDir)) {
      fs.mkdirSync(assetsDir, { recursive: true });
    }
    
    const manifest = {
      generatedAt: new Date().toISOString(),
      figmaFileId: FILE_ID,
      targetNodeId: TARGET_NODE_ID,
      targetNodeName: targetNode.name,
      method: 'icons_and_images_focused',
      statistics: {
        totalMeaningfulAssets: allMeaningfulAssets.size,
        images: images.length,
        icons: icons.length,
        otherVisualAssets: other.length,
        totalChildNodesScanned: childNodes.length,
        likelyVisualNodesProcessed: likelyVisualNodes.length
      },
      images: images,
      icons: icons,
      otherVisualAssets: other,
      allMeaningfulAssets: Array.from(allMeaningfulAssets.values())
    };
    
    fs.writeFileSync(
      path.join(assetsDir, 'icons-images-list.json'),
      JSON.stringify(manifest, null, 2)
    );
    
    console.log(`\n💾 Icons and images list saved to: icons-images-list.json`);
    console.log(`📈 Found ${images.length} images and ${icons.length} icons from children of "${targetNode.name}"`);
    
    return manifest;
    
  } catch (error) {
    console.error('💥 Error listing icons and images:', error);
    throw error;
  }
}

// Run the focused listing
listIconsAndImages().catch(console.error);