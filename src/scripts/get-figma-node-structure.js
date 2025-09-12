import https from 'https';
import fs from 'fs';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

const FIGMA_TOKEN = process.env.FIGMA_TOKEN;
const FILE_KEY = process.env.FIGMA_FILE_ID;

// Default to the Bachelor's registration page, but allow command line override
const NODE_ID = process.argv[2] || '2033:13526';

function makeRequest(path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.figma.com',
      port: 443,
      path: path,
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
          const json = JSON.parse(data);
          if (json.status && json.status !== 200) {
            reject(new Error(`API Error: ${json.err || json.message}`));
          } else {
            resolve(json);
          }
        } catch (error) {
          reject(new Error(`JSON Parse Error: ${error.message}`));
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.end();
  });
}

function extractNodeStructure(node, depth = 0) {
  const structure = {
    id: node.id,
    name: node.name,
    type: node.type,
    depth: depth
  };

  // Add visible property if it exists
  if (node.visible !== undefined) {
    structure.visible = node.visible;
  }

  // Initialize tailwind definitions object
  const tailwind = {};

  // Add sizing and positioning info
  if (node.absoluteBoundingBox) {
    const width = Math.round(node.absoluteBoundingBox.width);
    const height = Math.round(node.absoluteBoundingBox.height);
    const x = Math.round(node.absoluteBoundingBox.x);
    const y = Math.round(node.absoluteBoundingBox.y);
    
    // Tailwind size classes
    tailwind.width = `w-[${width}px]`;
    tailwind.height = `h-[${height}px]`;
    
    if (depth > 0) { // Only add positioning for child elements
      tailwind.position = `absolute left-[${x}px] top-[${y}px]`;
    }
  }

  // Fill information
  if (node.fills && node.fills.length > 0) {
    const solidFill = node.fills.find(fill => fill.type === 'SOLID' && fill.visible !== false);
    if (solidFill && solidFill.color) {
      const { r, g, b } = solidFill.color;
      const alpha = solidFill.opacity || 1;
      const rgb = `${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)}`;
      
      // Try to map to common Tailwind colors first
      const commonColors = {
        '255 255 255': 'bg-white',
        '0 0 0': 'bg-black',
        '239 68 68': 'bg-red-500',
        '34 197 94': 'bg-green-500',
        '59 130 246': 'bg-blue-500',
        '168 85 247': 'bg-purple-500',
        '245 101 101': 'bg-red-400',
        '156 163 175': 'bg-gray-400'
      };
      
      if (alpha === 1 && commonColors[rgb]) {
        tailwind.backgroundColor = commonColors[rgb];
      } else if (alpha < 1) {
        tailwind.backgroundColor = `bg-[rgb(${rgb}/${alpha})]`;
      } else {
        tailwind.backgroundColor = `bg-[rgb(${rgb})]`;
      }
    }
  }

  // Stroke information
  if (node.strokes && node.strokes.length > 0) {
    if (node.strokeWeight) {
      // Map common border widths to Tailwind classes
      const borderWidthMap = {
        1: 'border',
        2: 'border-2',
        4: 'border-4',
        8: 'border-8'
      };
      
      tailwind.borderWidth = borderWidthMap[node.strokeWeight] || `border-[${node.strokeWeight}px]`;
    }
    
    // Convert stroke color
    const solidStroke = node.strokes.find(stroke => stroke.type === 'SOLID' && stroke.visible !== false);
    if (solidStroke && solidStroke.color) {
      const { r, g, b } = solidStroke.color;
      const alpha = solidStroke.opacity || 1;
      const rgb = `${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)}`;
      
      // Map common border colors
      const commonBorderColors = {
        '255 255 255': 'border-white',
        '0 0 0': 'border-black',
        '229 231 235': 'border-gray-200',
        '156 163 175': 'border-gray-400',
        '75 85 99': 'border-gray-600'
      };
      
      if (alpha === 1 && commonBorderColors[rgb]) {
        tailwind.borderColor = commonBorderColors[rgb];
      } else if (alpha < 1) {
        tailwind.borderColor = `border-[rgb(${rgb}/${alpha})]`;
      } else {
        tailwind.borderColor = `border-[rgb(${rgb})]`;
      }
    }
  }

  // Layout properties
  if (node.layoutMode) {
    if (node.layoutMode === 'VERTICAL') {
      tailwind.flexDirection = 'flex flex-col';
    } else if (node.layoutMode === 'HORIZONTAL') {
      tailwind.flexDirection = 'flex flex-row';
    }
  } else if (node.type === 'FRAME' || node.type === 'GROUP') {
    tailwind.display = 'block';
  }

  if (node.primaryAxisAlignItems) {
    const alignMap = {
      'MIN': node.layoutMode === 'HORIZONTAL' ? 'justify-start' : 'items-start',
      'CENTER': node.layoutMode === 'HORIZONTAL' ? 'justify-center' : 'items-center',
      'MAX': node.layoutMode === 'HORIZONTAL' ? 'justify-end' : 'items-end',
      'SPACE_BETWEEN': 'justify-between'
    };
    
    if (alignMap[node.primaryAxisAlignItems]) {
      tailwind.primaryAlignment = alignMap[node.primaryAxisAlignItems];
    }
  }

  if (node.counterAxisAlignItems) {
    const counterAlignMap = {
      'MIN': node.layoutMode === 'HORIZONTAL' ? 'items-start' : 'justify-start',
      'CENTER': node.layoutMode === 'HORIZONTAL' ? 'items-center' : 'justify-center',
      'MAX': node.layoutMode === 'HORIZONTAL' ? 'items-end' : 'justify-end'
    };
    
    if (counterAlignMap[node.counterAxisAlignItems]) {
      tailwind.counterAlignment = counterAlignMap[node.counterAxisAlignItems];
    }
  }

  if (node.itemSpacing !== undefined) {
    // Map common gap values to Tailwind classes
    const gapMap = {
      0: 'gap-0', 1: 'gap-0.5', 2: 'gap-0.5', 4: 'gap-1', 6: 'gap-1.5', 8: 'gap-2',
      10: 'gap-2.5', 12: 'gap-3', 16: 'gap-4', 20: 'gap-5', 24: 'gap-6', 32: 'gap-8'
    };
    
    tailwind.gap = gapMap[node.itemSpacing] || `gap-[${node.itemSpacing}px]`;
  }

  // Padding information
  if (node.paddingLeft !== undefined) {
    const { paddingTop, paddingRight, paddingBottom, paddingLeft } = node;
    
    // Map common spacing values to Tailwind classes
    const spacingMap = {
      0: '0', 1: '0.5', 2: '0.5', 4: '1', 6: '1.5', 8: '2', 10: '2.5', 
      12: '3', 14: '3.5', 16: '4', 20: '5', 24: '6', 28: '7', 32: '8',
      36: '9', 40: '10', 44: '11', 48: '12', 56: '14', 64: '16'
    };
    
    if (paddingTop === paddingRight && paddingRight === paddingBottom && paddingBottom === paddingLeft) {
      const spacing = spacingMap[paddingTop];
      tailwind.padding = spacing ? `p-${spacing}` : `p-[${paddingTop}px]`;
    } else {
      const topSpacing = spacingMap[paddingTop] ? `pt-${spacingMap[paddingTop]}` : `pt-[${paddingTop}px]`;
      const rightSpacing = spacingMap[paddingRight] ? `pr-${spacingMap[paddingRight]}` : `pr-[${paddingRight}px]`;
      const bottomSpacing = spacingMap[paddingBottom] ? `pb-${spacingMap[paddingBottom]}` : `pb-[${paddingBottom}px]`;
      const leftSpacing = spacingMap[paddingLeft] ? `pl-${spacingMap[paddingLeft]}` : `pl-[${paddingLeft}px]`;
      
      tailwind.padding = `${topSpacing} ${rightSpacing} ${bottomSpacing} ${leftSpacing}`;
    }
  }

  // Corner radius
  if (node.cornerRadius !== undefined) {
    // Map common border radius values
    const roundedMap = {
      0: 'rounded-none',
      2: 'rounded-sm',
      4: 'rounded',
      6: 'rounded-md',
      8: 'rounded-lg',
      12: 'rounded-xl',
      16: 'rounded-2xl',
      24: 'rounded-3xl',
      9999: 'rounded-full'
    };
    
    tailwind.borderRadius = roundedMap[node.cornerRadius] || `rounded-[${node.cornerRadius}px]`;
  }

  if (node.rectangleCornerRadii) {
    const [tl, tr, br, bl] = node.rectangleCornerRadii;
    
    if (tl === tr && tr === br && br === bl) {
      const roundedMap = {
        0: 'rounded-none', 2: 'rounded-sm', 4: 'rounded', 6: 'rounded-md',
        8: 'rounded-lg', 12: 'rounded-xl', 16: 'rounded-2xl', 24: 'rounded-3xl'
      };
      tailwind.borderRadius = roundedMap[tl] || `rounded-[${tl}px]`;
    } else {
      tailwind.borderRadius = `[border-radius:${tl}px_${tr}px_${br}px_${bl}px]`;
    }
  }

  // Text properties
  if (node.characters) {
    structure.text = node.characters;
  }

  if (node.fontSize) {
    tailwind.fontSize = `text-[${node.fontSize}px]`;
  }

  if (node.fontName) {
    // Convert font family to Tailwind class
    const fontMap = {
      'Inter': 'font-inter',
      'Roboto': 'font-roboto',
      'Arial': 'font-sans',
      'Helvetica': 'font-sans'
    };
    
    tailwind.fontFamily = fontMap[node.fontName.family] || `font-['${node.fontName.family}']`;
    
    // Font weight
    if (node.fontName.style) {
      const weightMap = {
        'Regular': 'font-normal',
        'Medium': 'font-medium',
        'SemiBold': 'font-semibold',
        'Bold': 'font-bold',
        'Light': 'font-light',
        'Thin': 'font-thin'
      };
      tailwind.fontWeight = weightMap[node.fontName.style] || 'font-normal';
    }
  }

  if (node.textAlignHorizontal) {
    const alignMap = {
      'LEFT': 'text-left',
      'CENTER': 'text-center',
      'RIGHT': 'text-right',
      'JUSTIFIED': 'text-justify'
    };
    tailwind.textAlign = alignMap[node.textAlignHorizontal] || 'text-left';
  }

  // Opacity
  if (node.opacity !== undefined && node.opacity !== 1) {
    const opacityPercent = Math.round(node.opacity * 100);
    tailwind.opacity = `opacity-[${opacityPercent}%]`;
  }

  // Effects
  if (node.effects && node.effects.length > 0) {
    const dropShadow = node.effects.find(effect => effect.type === 'DROP_SHADOW' && effect.visible);
    if (dropShadow) {
      const { offset, radius, color } = dropShadow;
      const { r, g, b } = color;
      const alpha = dropShadow.color.a || 1;
      const shadowColor = `${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)}`;
      
      if (alpha < 1) {
        tailwind.shadow = `shadow-[${offset.x}px_${offset.y}px_${radius}px_rgb(${shadowColor}/${alpha})]`;
      } else {
        tailwind.shadow = `shadow-[${offset.x}px_${offset.y}px_${radius}px_rgb(${shadowColor})]`;
      }
    }
  }

  // Add Tailwind classes if any exist
  if (Object.keys(tailwind).length > 0) {
    // Create combined Tailwind class string in logical order
    const tailwindClasses = [];
    
    // Layout & Display
    if (tailwind.display) tailwindClasses.push(tailwind.display);
    if (tailwind.position) tailwindClasses.push(tailwind.position);
    if (tailwind.flexDirection) tailwindClasses.push(tailwind.flexDirection);
    if (tailwind.primaryAlignment) tailwindClasses.push(tailwind.primaryAlignment);
    if (tailwind.counterAlignment) tailwindClasses.push(tailwind.counterAlignment);
    if (tailwind.gap) tailwindClasses.push(tailwind.gap);
    
    // Sizing
    if (tailwind.width) tailwindClasses.push(tailwind.width);
    if (tailwind.height) tailwindClasses.push(tailwind.height);
    
    // Spacing
    if (tailwind.padding) tailwindClasses.push(tailwind.padding);
    
    // Colors & Backgrounds
    if (tailwind.backgroundColor) tailwindClasses.push(tailwind.backgroundColor);
    
    // Borders
    if (tailwind.borderWidth) tailwindClasses.push(tailwind.borderWidth);
    if (tailwind.borderColor) tailwindClasses.push(tailwind.borderColor);
    if (tailwind.borderRadius) tailwindClasses.push(tailwind.borderRadius);
    
    // Typography
    if (tailwind.fontSize) tailwindClasses.push(tailwind.fontSize);
    if (tailwind.fontFamily) tailwindClasses.push(tailwind.fontFamily);
    if (tailwind.fontWeight) tailwindClasses.push(tailwind.fontWeight);
    if (tailwind.textAlign) tailwindClasses.push(tailwind.textAlign);
    
    // Effects
    if (tailwind.opacity) tailwindClasses.push(tailwind.opacity);
    if (tailwind.shadow) tailwindClasses.push(tailwind.shadow);
    
    structure.tailwindClasses = tailwindClasses.join(' ');
  }

  // Add children if they exist
  if (node.children && node.children.length > 0) {
    structure.children = node.children.map(child => extractNodeStructure(child, depth + 1));
    structure.childrenCount = node.children.length;
  }

  return structure;
}

async function getNodeStructure() {
  try {
    console.log(`🔍 Fetching node structure with design info for ID: ${NODE_ID}...`);
    
    // Get specific node using the nodes endpoint with depth limit
    const nodeData = await makeRequest(`/v1/files/${FILE_KEY}/nodes?ids=${NODE_ID}&depth=3`);
    
    if (!nodeData.nodes || !nodeData.nodes[NODE_ID]) {
      throw new Error(`Node with ID ${NODE_ID} not found`);
    }
    
    const node = nodeData.nodes[NODE_ID].document;
    
    console.log(`📄 Node: ${node.name}`);
    console.log(`🆔 ID: ${node.id}`);
    console.log(`📊 Type: ${node.type}`);
    
    // Extract the structure
    const structure = extractNodeStructure(node);
    
    // Count total children recursively
    function countAllChildren(node) {
      let count = 0;
      if (node.children) {
        count += node.children.length;
        node.children.forEach(child => {
          count += countAllChildren(child);
        });
      }
      return count;
    }
    
    const totalChildren = countAllChildren(structure);
    
    console.log(`\n👶 Direct Children: ${structure.children?.length || 0}`);
    console.log(`🌳 Total Descendants: ${totalChildren}`);
    
    if (structure.children && structure.children.length > 0) {
      console.log(`\n📋 Direct Children:`);
      structure.children.forEach((child, index) => {
        const childCount = child.children?.length || 0;
        console.log(`  ${index + 1}. ${child.name} (${child.id}) - Type: ${child.type} - ${childCount} children`);
      });
    }

    // Create output data
    const outputData = {
      nodeId: NODE_ID,
      nodeName: node.name,
      nodeType: node.type,
      directChildrenCount: structure.children?.length || 0,
      totalDescendants: totalChildren,
      structure: structure,
      extractedAt: new Date().toISOString()
    };

    // Ensure the files directory exists
    const filesDir = path.join(__dirname, '../files');
    if (!fs.existsSync(filesDir)) {
      fs.mkdirSync(filesDir, { recursive: true });
    }

    // Save to file
    const outputPath = path.join(filesDir, 'figma-node-structure.json');
    fs.writeFileSync(outputPath, JSON.stringify(outputData, null, 2));
    
    console.log(`\n✅ Node structure saved to: ${outputPath}`);
    
    // Get file size
    const stats = fs.statSync(outputPath);
    const fileSizeInBytes = stats.size;
    const fileSizeInMB = (fileSizeInBytes / (1024 * 1024)).toFixed(3);
    
    console.log(`📊 Summary:`);
    console.log(`   - Node: ${node.name}`);
    console.log(`   - Direct children: ${structure.children?.length || 0}`);
    console.log(`   - Total descendants: ${totalChildren}`);
    console.log(`   - File size: ${fileSizeInMB} MB`);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

getNodeStructure();