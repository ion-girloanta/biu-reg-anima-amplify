import https from 'https';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

const FIGMA_TOKEN = process.env.FIGMA_TOKEN;
const FILE_KEY = process.env.FIGMA_VARIABLES_FILE_KEY;

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

async function getVariables() {
  try {
    console.log('🔍 Fetching Figma variables...');
    
    const response = await makeRequest(`/v1/files/${FILE_KEY}/variables/local`);
    
    if (response.meta && response.meta.variables) {
      const variables = response.meta.variables;
      console.log(`✅ Found ${Object.keys(variables).length} variables`);
      
      // Create a mapping of variable ID to name and value
      const variableMap = {};
      
      Object.entries(variables).forEach(([id, variable]) => {
        variableMap[id] = {
          name: variable.name,
          resolvedType: variable.resolvedType,
          description: variable.description || '',
          scopes: variable.scopes || [],
          hiddenFromPublishing: variable.hiddenFromPublishing || false
        };
        
        // Add values if they exist
        if (variable.valuesByMode) {
          variableMap[id].values = variable.valuesByMode;
        }
        
        console.log(`📝 ${variable.name} (${variable.resolvedType})`);
      });
      
      // Save to file
      fs.writeFileSync('../files/figma-variables.json', JSON.stringify({
        fileKey: FILE_KEY,
        lastUpdated: new Date().toISOString(),
        totalVariables: Object.keys(variables).length,
        variables: variableMap
      }, null, 2));
      
      console.log(`✅ Variables saved to ../files/figma-variables.json`);
      
      // Search for DSM-related variables
      const dsmVariables = Object.entries(variableMap).filter(([id, variable]) => 
        variable.name.includes('DSM') || variable.name.includes('BTN')
      );
      
      if (dsmVariables.length > 0) {
        console.log(`\n🎨 Found ${dsmVariables.length} DSM-related variables:`);
        dsmVariables.forEach(([id, variable]) => {
          console.log(`   - ${variable.name} (ID: ${id})`);
        });
      }
      
    } else {
      console.log('❌ No variables found in response');
    }
    
  } catch (error) {
    console.error('❌ Error fetching variables:', error.message);
  }
}

getVariables();