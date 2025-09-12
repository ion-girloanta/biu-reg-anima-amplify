import https from 'https';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

const options = {
  hostname: 'api.figma.com',
  port: 443,
  path: `/v1/files/${process.env.FIGMA_FILE_ID}?depth=1`,
  method: 'GET',
  headers: {
    'X-FIGMA-TOKEN': process.env.FIGMA_TOKEN
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
      if (json.document && json.document.children) {
        console.log('Pages in Figma file:');
        json.document.children.forEach((page, index) => {
          console.log(`${index + 1}. ${page.name} (ID: ${page.id})`);
        });
      } else {
        console.log('Unexpected response structure:', data);
      }
    } catch (error) {
      console.error('Error parsing JSON:', error);
      console.log('Raw response:', data);
    }
  });
});

req.on('error', (error) => {
  console.error('Request error:', error);
});

req.end();