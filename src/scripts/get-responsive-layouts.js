import https from 'https';
import fs from 'fs';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

const FIGMA_TOKEN = process.env.FIGMA_TOKEN;
const FILE_KEY = process.env.FIGMA_FILE_ID;

// Common responsive breakpoints to check for
const RESPONSIVE_FRAMES = [
  'Mobile', 'mobile', 'iPhone', 'Android', '375', '320',
  'Tablet', 'tablet', 'iPad', '768', '1024',
  'Desktop', 'desktop', 'Web', '1440', '1920'
];

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

function categorizeByBreakpoint(width) {
  if (width <= 480) return 'mobile';
  if (width <= 768) return 'tablet';
  if (width <= 1200) return 'desktop';
  return 'large';
}

function extractResponsiveLayouts(node, responsive = {}) {
  if (node.type === 'FRAME') {
    const width = node.absoluteBoundingBox?.width;
    const name = node.name.toLowerCase();
    
    // Check if this looks like a responsive frame
    const isResponsive = RESPONSIVE_FRAMES.some(keyword => 
      name.includes(keyword.toLowerCase())
    );
    
    if (isResponsive && width) {
      const breakpoint = categorizeByBreakpoint(width);
      
      if (!responsive[breakpoint]) {
        responsive[breakpoint] = [];
      }
      
      responsive[breakpoint].push({
        id: node.id,
        name: node.name,
        width: width,
        height: node.absoluteBoundingBox?.height,
        constraints: {
          horizontal: node.constraints?.horizontal || 'LEFT_RIGHT',
          vertical: node.constraints?.vertical || 'TOP_BOTTOM'
        },
        layoutMode: node.layoutMode,
        primaryAxisAlignItems: node.primaryAxisAlignItems,
        counterAxisAlignItems: node.counterAxisAlignItems,
        itemSpacing: node.itemSpacing,
        paddingLeft: node.paddingLeft,
        paddingRight: node.paddingRight,
        paddingTop: node.paddingTop,
        paddingBottom: node.paddingBottom
      });
    }
  }
  
  if (node.children) {
    node.children.forEach(child => extractResponsiveLayouts(child, responsive));
  }
  
  return responsive;
}

async function getResponsiveLayouts() {
  try {
    console.log('📱 Searching for responsive layouts...');
    
    // Get entire file to search for responsive frames
    const fileData = await makeRequest(`/v1/files/${FILE_KEY}`);
    
    // Extract responsive layouts
    const responsiveLayouts = extractResponsiveLayouts(fileData.document);
    
    console.log('🔍 Found responsive layouts:');
    Object.entries(responsiveLayouts).forEach(([breakpoint, layouts]) => {
      console.log(`   ${breakpoint}: ${layouts.length} layouts`);
      layouts.forEach(layout => {
        console.log(`     - ${layout.name} (${layout.width}×${layout.height})`);
      });
    });
    
    // Generate responsive CSS utilities
    const responsiveCSS = generateResponsiveCSS(responsiveLayouts);
    
    const outputData = {
      extractedAt: new Date().toISOString(),
      fileKey: FILE_KEY,
      responsiveLayouts: responsiveLayouts,
      breakpoints: {
        mobile: { min: 0, max: 480 },
        tablet: { min: 481, max: 768 },
        desktop: { min: 769, max: 1200 },
        large: { min: 1201, max: null }
      },
      responsiveCSS: responsiveCSS,
      recommendations: generateResponsiveRecommendations(responsiveLayouts)
    };
    
    // Save responsive data
    const filesDir = path.join(__dirname, '../files');
    if (!fs.existsSync(filesDir)) {
      fs.mkdirSync(filesDir, { recursive: true });
    }
    
    const outputPath = path.join(filesDir, 'responsive-layouts.json');
    fs.writeFileSync(outputPath, JSON.stringify(outputData, null, 2));
    
    console.log(`✅ Responsive data saved to: ${outputPath}`);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

function generateResponsiveCSS(responsiveLayouts) {
  const css = {
    tailwindBreakpoints: {
      'sm': '640px',   // mobile
      'md': '768px',   // tablet
      'lg': '1024px',  // desktop
      'xl': '1280px'   // large
    },
    mediaQueries: {},
    utilityClasses: {}
  };
  
  Object.entries(responsiveLayouts).forEach(([breakpoint, layouts]) => {
    layouts.forEach(layout => {
      const className = `.${layout.name.toLowerCase().replace(/\s+/g, '-')}`;
      
      css.utilityClasses[className] = {
        width: `${layout.width}px`,
        height: `${layout.height}px`,
        maxWidth: '100%',
        margin: '0 auto'
      };
      
      if (layout.layoutMode === 'VERTICAL') {
        css.utilityClasses[className].display = 'flex';
        css.utilityClasses[className].flexDirection = 'column';
      } else if (layout.layoutMode === 'HORIZONTAL') {
        css.utilityClasses[className].display = 'flex';
        css.utilityClasses[className].flexDirection = 'row';
      }
      
      if (layout.itemSpacing) {
        css.utilityClasses[className].gap = `${layout.itemSpacing}px`;
      }
    });
  });
  
  return css;
}

function generateResponsiveRecommendations(responsiveLayouts) {
  const recommendations = [];
  
  const breakpointCounts = Object.keys(responsiveLayouts).length;
  
  if (breakpointCounts < 2) {
    recommendations.push({
      type: 'warning',
      message: 'Consider creating layouts for multiple breakpoints (mobile, tablet, desktop)',
      priority: 'high'
    });
  }
  
  if (!responsiveLayouts.mobile) {
    recommendations.push({
      type: 'warning',
      message: 'No mobile layouts detected. Mobile-first design is recommended.',
      priority: 'high'
    });
  }
  
  // Check for consistent spacing
  const spacingValues = [];
  Object.values(responsiveLayouts).flat().forEach(layout => {
    if (layout.itemSpacing) spacingValues.push(layout.itemSpacing);
  });
  
  const uniqueSpacing = [...new Set(spacingValues)];
  if (uniqueSpacing.length > 6) {
    recommendations.push({
      type: 'suggestion',
      message: 'Consider using a consistent spacing scale (8px, 16px, 24px, 32px)',
      priority: 'medium'
    });
  }
  
  recommendations.push({
    type: 'info',
    message: `Found ${Object.values(responsiveLayouts).flat().length} responsive layouts across ${breakpointCounts} breakpoints`,
    priority: 'info'
  });
  
  return recommendations;
}

getResponsiveLayouts();