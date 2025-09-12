import https from 'https';
import fs from 'fs';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

const FIGMA_TOKEN = process.env.FIGMA_TOKEN;
const FILE_KEY = process.env.FIGMA_FILE_ID;

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

  // Add additional properties based on node type
  if (node.absoluteBoundingBox) {
    structure.boundingBox = node.absoluteBoundingBox;
  }

  if (node.fills && node.fills.length > 0) {
    structure.fills = node.fills;
  }

  if (node.strokes && node.strokes.length > 0) {
    structure.strokes = node.strokes;
  }

  if (node.constraints) {
    structure.constraints = node.constraints;
  }

  if (node.layoutMode) {
    structure.layoutMode = node.layoutMode;
  }

  if (node.primaryAxisAlignItems) {
    structure.primaryAxisAlignItems = node.primaryAxisAlignItems;
  }

  if (node.counterAxisAlignItems) {
    structure.counterAxisAlignItems = node.counterAxisAlignItems;
  }

  if (node.itemSpacing !== undefined) {
    structure.itemSpacing = node.itemSpacing;
  }

  if (node.paddingLeft !== undefined) {
    structure.padding = {
      left: node.paddingLeft,
      right: node.paddingRight,
      top: node.paddingTop,
      bottom: node.paddingBottom
    };
  }

  // Text properties
  if (node.characters) {
    structure.text = node.characters;
  }

  if (node.style) {
    structure.style = node.style;
  }

  // Add children if they exist
  if (node.children && node.children.length > 0) {
    structure.children = node.children.map(child => extractNodeStructure(child, depth + 1));
  }

  return structure;
}

async function getFileStructure() {
  try {
    console.log('🔍 Fetching Figma file structure...');
    
    // Get basic file info with depth=1 to get pages
    const response = await makeRequest(`/v1/files/${FILE_KEY}?depth=1`);
    
    if (!response.document) {
      throw new Error('No document found in response');
    }

    const fileStructure = {
      fileKey: FILE_KEY,
      name: response.name,
      lastModified: response.lastModified,
      version: response.version,
      thumbnailUrl: response.thumbnailUrl,
      document: extractNodeStructure(response.document),
      pages: [],
      totalPages: 0
    };

    console.log(`📄 File: ${response.name}`);
    console.log(`📅 Last Modified: ${response.lastModified}`);
    console.log(`🔢 Version: ${response.version}`);

    if (response.document.children) {
      console.log(`\n📑 Found ${response.document.children.length} pages:`);
      
      fileStructure.totalPages = response.document.children.length;
      
      // Process each page
      for (const [index, page] of response.document.children.entries()) {
        console.log(`  ${index + 1}. ${page.name} (ID: ${page.id})`);
        
        // Get detailed page structure
        console.log(`     🔍 Fetching detailed structure for page: ${page.name}`);
        
        try {
          const pageResponse = await makeRequest(`/v1/files/${FILE_KEY}/nodes?ids=${page.id}&depth=3`);
          
          if (pageResponse.nodes && pageResponse.nodes[page.id]) {
            const detailedPage = pageResponse.nodes[page.id];
            const pageStructure = extractNodeStructure(detailedPage.document);
            pageStructure.pageIndex = index;
            fileStructure.pages.push(pageStructure);
            
            console.log(`     ✅ Page structure extracted (${detailedPage.document.children?.length || 0} top-level children)`);
          }
        } catch (pageError) {
          console.log(`     ⚠️  Error fetching page details: ${pageError.message}`);
          // Add basic page info even if detailed fetch fails
          const basicPageStructure = extractNodeStructure(page);
          basicPageStructure.pageIndex = index;
          basicPageStructure.error = pageError.message;
          fileStructure.pages.push(basicPageStructure);
        }
      }
    }

    // Ensure the files directory exists
    const filesDir = path.join(__dirname, '../files');
    if (!fs.existsSync(filesDir)) {
      fs.mkdirSync(filesDir, { recursive: true });
    }

    // Save to file
    const outputPath = path.join(filesDir, 'figma-file-structure.json');
    fs.writeFileSync(outputPath, JSON.stringify(fileStructure, null, 2));
    
    console.log(`\n✅ File structure saved to: ${outputPath}`);
    console.log(`📊 Summary:`);
    console.log(`   - Total pages: ${fileStructure.totalPages}`);
    console.log(`   - Pages with detailed structure: ${fileStructure.pages.filter(p => !p.error).length}`);
    console.log(`   - Pages with errors: ${fileStructure.pages.filter(p => p.error).length}`);
    
    // Create a summary of key registration pages
    const registrationPages = fileStructure.pages.filter(page => 
      page.name.includes('הרשמה') || page.name.includes('registration')
    );
    
    if (registrationPages.length > 0) {
      console.log(`\n🎓 Registration Pages Found:`);
      registrationPages.forEach(page => {
        console.log(`   - ${page.name} (ID: ${page.id})`);
      });
    }
    
  } catch (error) {
    console.error('❌ Error fetching file structure:', error.message);
  }
}

getFileStructure();