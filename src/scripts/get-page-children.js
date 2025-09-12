import https from 'https';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

const FIGMA_TOKEN = process.env.FIGMA_TOKEN;
const FILE_KEY = process.env.FIGMA_FILE_ID;
const PAGE_ID = '2033:13526'; // הרשמה תואר ראשון (28+)

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

async function getPageChildren() {
  try {
    console.log(`🔍 Fetching page children for ID: ${PAGE_ID}...`);
    
    // Get specific nodes using the nodes endpoint
    const nodeData = await makeRequest(`/v1/files/${FILE_KEY}/nodes?ids=${PAGE_ID}`);
    
    const page = nodeData.nodes[PAGE_ID]?.document;
    
    if (!page) {
      console.error(`❌ Page with ID ${PAGE_ID} not found`);
      return;
    }
    
    console.log(`📄 Page: ${page.name} (ID: ${page.id})`);
    console.log(`📊 Type: ${page.type}`);
    
    if (page.children && page.children.length > 0) {
      console.log(`\n👶 Children (${page.children.length}):`);
      page.children.forEach((child, index) => {
        console.log(`  ${index + 1}. ${child.name} (ID: ${child.id}) - Type: ${child.type}`);
        if (child.absoluteBoundingBox) {
          const bbox = child.absoluteBoundingBox;
          console.log(`     📐 Size: ${Math.round(bbox.width)}×${Math.round(bbox.height)} at (${Math.round(bbox.x)}, ${Math.round(bbox.y)})`);
        }
      });
      
      // Save detailed children info to JSON file
      const outputPath = path.join(__dirname, '../files/page-2033-13526-children.json');
      const fs = await import('fs');
      
      const outputData = {
        pageId: PAGE_ID,
        pageName: page.name,
        pageType: page.type,
        childrenCount: page.children.length,
        children: page.children.map(child => ({
          id: child.id,
          name: child.name,
          type: child.type,
          absoluteBoundingBox: child.absoluteBoundingBox,
          visible: child.visible,
          hasChildren: child.children && child.children.length > 0 ? child.children.length : 0
        })),
        extractedAt: new Date().toISOString()
      };
      
      fs.writeFileSync(outputPath, JSON.stringify(outputData, null, 2));
      console.log(`\n✅ Children data saved to: ${outputPath}`);
      
    } else {
      console.log(`\n📝 No children found for this page`);
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

getPageChildren();