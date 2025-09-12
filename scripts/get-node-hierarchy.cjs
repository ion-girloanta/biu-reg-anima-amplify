const https = require('https');
require('dotenv').config();
const fs = require('fs');
const path = require('path');

// Figma API configuration
const FIGMA_TOKEN = process.env.FIGMA_TOKEN;
const FILE_ID = process.env.FIGMA_FILE_ID;
const TARGET_NODE_ID = '5584:558165';

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

// Function to build hierarchy tree from node
function buildHierarchyTree(node, depth = 0) {
  const indent = '  '.repeat(depth);
  const nodeType = node.type || 'UNKNOWN';
  const nodeName = node.name || `${nodeType}-${node.id}`;
  
  let tree = `${indent}├─ ${nodeName} (${nodeType})`;
  if (node.id) {
    tree += ` [ID: ${node.id}]`;
  }
  tree += '\n';
  
  // Add properties info
  if (depth === 0 && node.absoluteBoundingBox) {
    const bounds = node.absoluteBoundingBox;
    tree += `${indent}   📐 Size: ${bounds.width}×${bounds.height} at (${bounds.x}, ${bounds.y})\n`;
  }
  
  // Process children
  if (node.children && Array.isArray(node.children) && node.children.length > 0) {
    tree += `${indent}   📁 Children: ${node.children.length}\n`;
    
    node.children.forEach((child, index) => {
      const isLast = index === node.children.length - 1;
      const childIndent = '  '.repeat(depth + 1);
      
      if (isLast) {
        tree += buildHierarchyTree(child, depth + 1).replace('├─', '└─');
      } else {
        tree += buildHierarchyTree(child, depth + 1);
      }
    });
  } else if (depth < 3) {
    tree += `${indent}   📄 No children\n`;
  }
  
  return tree;
}

// Function to count nodes by type
function countNodesByType(node, counts = {}) {
  const type = node.type || 'UNKNOWN';
  counts[type] = (counts[type] || 0) + 1;
  
  if (node.children && Array.isArray(node.children)) {
    node.children.forEach(child => {
      countNodesByType(child, counts);
    });
  }
  
  return counts;
}

// Function to collect all node paths
function collectNodePaths(node, paths = [], currentPath = []) {
  const nodeName = node.name || `${node.type}-${node.id}`;
  const fullPath = [...currentPath, nodeName];
  
  if (node.id) {
    paths.push({
      nodeId: node.id,
      nodeName,
      nodeType: node.type,
      path: fullPath.join(' > '),
      depth: fullPath.length - 1
    });
  }
  
  if (node.children && Array.isArray(node.children)) {
    node.children.forEach(child => {
      collectNodePaths(child, paths, fullPath);
    });
  }
  
  return paths;
}

// Main function to get node hierarchy
async function getNodeHierarchy() {
  try {
    console.log(`🏗️ Fetching hierarchy structure for node: ${TARGET_NODE_ID}`);
    console.log(`🌐 Target: https://www.figma.com/design/${FILE_ID}/?node-id=${TARGET_NODE_ID.replace(':', '-')}&m=dev`);
    
    // Get the target node with maximum depth
    console.log('\n📋 Fetching complete node hierarchy...');
    const nodeData = await makeFigmaRequest(`/v1/files/${FILE_ID}/nodes?ids=${TARGET_NODE_ID}&depth=100`);
    
    if (!nodeData.nodes || !nodeData.nodes[TARGET_NODE_ID]) {
      console.error('❌ Target node not found');
      return;
    }
    
    const targetNode = nodeData.nodes[TARGET_NODE_ID].document;
    console.log(`📁 Target Node: "${targetNode.name}" (${targetNode.type})`);
    
    // Build hierarchy tree
    console.log('\n🌳 HIERARCHY STRUCTURE:');
    console.log('='.repeat(80));
    const hierarchyTree = buildHierarchyTree(targetNode);
    console.log(hierarchyTree);
    
    // Count nodes by type
    const nodeCounts = countNodesByType(targetNode);
    console.log('\n📊 NODE TYPE STATISTICS:');
    console.log('='.repeat(50));
    Object.entries(nodeCounts)
      .sort(([,a], [,b]) => b - a)
      .forEach(([type, count]) => {
        console.log(`   ${type.padEnd(20)} : ${count.toString().padStart(4)}`);
      });
    
    // Collect all paths
    const allPaths = collectNodePaths(targetNode);
    console.log(`\n📍 TOTAL NODES: ${allPaths.length}`);
    console.log(`📏 MAX DEPTH: ${Math.max(...allPaths.map(p => p.depth))}`);
    
    // Show some example paths
    console.log('\n🗂️ EXAMPLE NODE PATHS:');
    console.log('='.repeat(80));
    allPaths.slice(0, 10).forEach((item, index) => {
      console.log(`${(index + 1).toString().padStart(2)}. [Depth ${item.depth}] ${item.path}`);
      console.log(`    └─ ${item.nodeType} | ID: ${item.nodeId}`);
      console.log('');
    });
    
    if (allPaths.length > 10) {
      console.log(`    ... and ${allPaths.length - 10} more nodes`);
    }
    
    // Save hierarchy data
    const assetsDir = path.join(__dirname, '..', 'src', 'assets');
    if (!fs.existsSync(assetsDir)) {
      fs.mkdirSync(assetsDir, { recursive: true });
    }
    
    const hierarchyData = {
      generatedAt: new Date().toISOString(),
      figmaFileId: FILE_ID,
      targetNodeId: TARGET_NODE_ID,
      targetNodeName: targetNode.name,
      targetNodeType: targetNode.type,
      hierarchyTree: hierarchyTree,
      nodeTypeStatistics: nodeCounts,
      totalNodes: allPaths.length,
      maxDepth: Math.max(...allPaths.map(p => p.depth)),
      allNodePaths: allPaths,
      targetNodeData: targetNode
    };
    
    fs.writeFileSync(
      path.join(assetsDir, 'node-hierarchy.json'),
      JSON.stringify(hierarchyData, null, 2)
    );
    
    console.log('\n💾 Hierarchy data saved to: node-hierarchy.json');
    console.log(`🎯 Analysis complete for node "${targetNode.name}"`);
    
    return hierarchyData;
    
  } catch (error) {
    console.error('💥 Error fetching node hierarchy:', error);
    throw error;
  }
}

// Run the hierarchy analysis
getNodeHierarchy().catch(console.error);