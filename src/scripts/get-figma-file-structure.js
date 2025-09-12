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

  // No design info needed - keeping only structural information

  // Add children if they exist
  if (node.children && node.children.length > 0) {
    structure.children = node.children.map(child => extractNodeStructure(child, depth + 1));
  }

  return structure;
}

async function getFileStructure() {
  try {
    console.log('🔍 Fetching Figma file structure (depth=2)...');
    
    // Get file info with depth=2 - pages and their children (frames/components)
    const response = await makeRequest(`/v1/files/${FILE_KEY}?depth=2`);
    
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
      totalPages: 0,
      extractedAt: new Date().toISOString(),
      depth: 2
    };

    console.log(`📄 File: ${response.name}`);
    console.log(`📅 Last Modified: ${response.lastModified}`);
    console.log(`🔢 Version: ${response.version}`);

    if (response.document.children) {
      console.log(`\n📑 Found ${response.document.children.length} pages:`);
      
      fileStructure.totalPages = response.document.children.length;
      
      // Process each page with depth=1 structure (already fetched)
      response.document.children.forEach((page, index) => {
        console.log(`  ${index + 1}. ${page.name} (ID: ${page.id}) - ${page.children?.length || 0} children`);
        
        const pageStructure = extractNodeStructure(page);
        pageStructure.pageIndex = index;
        fileStructure.pages.push(pageStructure);
      });
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
    
    // Get file size
    const stats = fs.statSync(outputPath);
    const fileSizeInBytes = stats.size;
    const fileSizeInMB = (fileSizeInBytes / (1024 * 1024)).toFixed(2);
    
    console.log(`📊 Summary:`);
    console.log(`   - Total pages: ${fileStructure.totalPages}`);
    console.log(`   - File size: ${fileSizeInMB} MB`);
    console.log(`   - Depth: ${fileStructure.depth}`);
    console.log(`   - Processing time: Medium (depth=2 API call)`);
    
    // Create a summary of key registration pages
    const registrationPages = fileStructure.pages.filter(page => 
      page.name.includes('הרשמה') || page.name.includes('registration')
    );
    
    if (registrationPages.length > 0) {
      console.log(`\n🎓 Registration Pages Found:`);
      registrationPages.forEach(page => {
        console.log(`   - ${page.name} (ID: ${page.id}) - ${page.children?.length || 0} children`);
      });
    }

    // Summary of pages by type/category
    const pagesByCategory = {
      registration: fileStructure.pages.filter(p => p.name.includes('הרשמה')),
      calculator: fileStructure.pages.filter(p => p.name.includes('מחשבון')),
      design: fileStructure.pages.filter(p => p.name.includes('Design') || p.name.includes('Brand')),
      separators: fileStructure.pages.filter(p => p.name === '---'),
      other: fileStructure.pages.filter(p => 
        !p.name.includes('הרשמה') && 
        !p.name.includes('מחשבון') && 
        !p.name.includes('Design') && 
        !p.name.includes('Brand') && 
        p.name !== '---'
      )
    };

    console.log(`\n📋 Pages by Category:`);
    console.log(`   - Registration: ${pagesByCategory.registration.length}`);
    console.log(`   - Calculator: ${pagesByCategory.calculator.length}`);
    console.log(`   - Design/Brand: ${pagesByCategory.design.length}`);
    console.log(`   - Separators: ${pagesByCategory.separators.length}`);
    console.log(`   - Other: ${pagesByCategory.other.length}`);
    
  } catch (error) {
    console.error('❌ Error fetching file structure:', error.message);
  }
}

getFileStructure();