const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Configuration
const FIGMA_TOKEN = process.env.FIGMA_TOKEN;
const FILE_ID = process.env.FIGMA_FILE_ID;
const TARGET_NODE_ID = '5584:552731'; // Can be overridden by command line argument
 
// Get nodeId from command line argument if provided
const nodeId = process.argv[2] || TARGET_NODE_ID;

// API headers
const headers = {
  'X-FIGMA-TOKEN': FIGMA_TOKEN,
  'Content-Type': 'application/json'
};

/**
 * Fetch node data from Figma API
 */
async function fetchNodeData(nodeId) {
  const url = `https://api.figma.com/v1/files/${FILE_ID}/nodes?ids=${nodeId}`;
  
  try {
    const response = await fetch(url, { headers });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    return data.nodes[nodeId];
  } catch (error) {
    console.error('❌ Error fetching node data:', error.message);
    process.exit(1);
  }
}

/**
 * Extract hierarchy data from a node
 */
function extractNodeHierarchy(node, depth = 0) {
  if (!node || depth > 9) return null;
  
  const hierarchy = {
    name: node.document.name,
    type: node.document.type,
    id: node.document.id
  };
  
  // Add position and size if available
  if (node.document.absoluteBoundingBox) {
    hierarchy.position = {
      x: node.document.absoluteBoundingBox.x,
      y: node.document.absoluteBoundingBox.y
    };
    
    hierarchy.size = {
      width: node.document.absoluteBoundingBox.width,
      height: node.document.absoluteBoundingBox.height
    };
  }
  
  // Process children recursively
  if (node.document.children && node.document.children.length > 0) {
    hierarchy.children = node.document.children.map(child => extractNodeHierarchy({ document: child }, depth + 1)).filter(child => child !== null);
  }
  
  return hierarchy;
}

/**
 * Main function
 */
async function main() {
  console.log('🏗️ Building Figma hierarchy structure...');
  console.log(`🎯 Target node ID: ${nodeId}`);
  console.log(`🌐 Figma file: https://www.figma.com/design/${FILE_ID}/?node-id=${nodeId.replace(':', '-')}&m=dev`);
  
  try {
    // Create output directory if it doesn't exist
    const outputDir = path.join(__dirname, '..', 'src', 'data');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    const outputPath = path.join(outputDir, 'figma-hierarchy.json');
    
    // Load existing data or create new structure
    let output = {};
    if (fs.existsSync(outputPath)) {
      try {
        const existingData = fs.readFileSync(outputPath, 'utf8');
        output = JSON.parse(existingData);
        console.log('📄 Loading existing hierarchy file...');
      } catch (error) {
        console.log('⚠️  Could not parse existing file, creating new one...');
        output = {};
      }
    }
    
    // Fetch node data
    console.log('📡 Fetching node data from Figma API...');
    const nodeData = await fetchNodeData(nodeId);
    
    if (!nodeData || !nodeData.document) {
      console.error('❌ Node not found or has no document');
      process.exit(1);
    }
    
    console.log(`📋 Found node: "${nodeData.document.name}" (${nodeData.document.type})`);
    
    // Extract hierarchy
    console.log('🌳 Extracting hierarchy structure...');
    const hierarchy = extractNodeHierarchy(nodeData);
    
    // Add entry for this target node
    output[nodeId] = {
      targetNodeId: nodeId,
      targetNodeName: hierarchy.name,
      targetNodeType: hierarchy.type,
      hierarchy: hierarchy,
      lastUpdated: new Date().toISOString()
    };
    
    // Write to file with custom formatting
    const jsonString = JSON.stringify(output, null, 2);
    const compactPositionSize = jsonString
      .replace(/("position":\s*{\s*"x":\s*[^,]+,\s*"y":\s*[^}]+\s*}),?\s*("size":\s*{\s*"width":\s*[^,]+,\s*"height":\s*[^}]+\s*})/g, (match, pos, size) => {
        const cleanPos = pos.replace(/\s+/g, '').replace(/,/g, ', ').replace(/:/g, ': ');
        const cleanSize = size.replace(/\s+/g, '').replace(/,/g, ', ').replace(/:/g, ': ');
        return `${cleanPos}, ${cleanSize}`;
      });
    
    fs.writeFileSync(outputPath, compactPositionSize);
    
    console.log(`✅ Hierarchy structure saved to: ${outputPath}`);
    console.log(`📊 Total nodes processed: ${countNodes(hierarchy)}`);
    console.log(`🗂️  Total target nodes in file: ${Object.keys(output).length}`);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

/**
 * Count total number of nodes in hierarchy
 */
function countNodes(node) {
  if (!node) return 0;
  
  let count = 1;
  if (node.children) {
    count += node.children.reduce((sum, child) => sum + countNodes(child), 0);
  }
  
  return count;
}

// Run the script
main().catch(error => {
  console.error('❌ Unexpected error:', error);
  process.exit(1);
});