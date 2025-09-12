const fs = require('fs');
require('dotenv').config();
const path = require('path');

// Assets directory
const assetsDir = path.join(__dirname, '..', 'src', 'assets');

// Function to clean and create safe filename from asset name
function createCleanFilename(nodeName, assetType) {
  let cleanName = nodeName
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '') // Remove special chars except spaces and hyphens
    .replace(/\s+/g, '-') // Replace spaces with hyphens  
    .replace(/-+/g, '-') // Replace multiple hyphens with single
    .replace(/^-|-$/g, ''); // Remove leading/trailing hyphens
  
  // Handle special cases
  if (cleanName === 'icon') cleanName = 'generic-icon';
  if (cleanName === 'logo') cleanName = 'logo-icon';
  if (cleanName === 'rectangle-16918') cleanName = 'placeholder-image';
  if (cleanName === 'main-logo') cleanName = 'main-logo';
  if (cleanName === 'headerlogo-only') cleanName = 'header-logo';
  if (cleanName === 'arrow-right') cleanName = 'arrow-right';
  if (cleanName === 'icon-plus') cleanName = 'plus-icon';
  if (cleanName === '16x16-icon-outline') cleanName = 'outline-icon';
  if (cleanName === 'card-icons') cleanName = 'card-icons';
  if (cleanName === 'mdi-lightclock') cleanName = 'clock-icon';
  if (cleanName === 'iconamooncheck-bold') cleanName = 'check-icon';
  
  return `${cleanName}.png`;
}

async function renameAssets() {
  try {
    console.log('🔄 Renaming assets to use clean names...');
    
    // Read the manifest
    const manifestPath = path.join(assetsDir, 'downloaded-assets.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    
    const renamedAssets = [];
    const renameOperations = [];
    
    // Process each asset
    manifest.downloadedAssets.forEach(asset => {
      const oldFilename = asset.filename;
      const newFilename = createCleanFilename(asset.nodeName, asset.assetType);
      
      renameOperations.push({
        oldPath: path.join(assetsDir, oldFilename),
        newPath: path.join(assetsDir, newFilename),
        oldFilename,
        newFilename,
        asset
      });
    });
    
    // Check for filename conflicts
    const filenameCount = new Map();
    renameOperations.forEach(op => {
      const count = filenameCount.get(op.newFilename) || 0;
      filenameCount.set(op.newFilename, count + 1);
    });
    
    // Resolve conflicts by adding numbers
    const finalOperations = [];
    const usedNames = new Map();
    
    renameOperations.forEach(op => {
      let finalName = op.newFilename;
      
      if (filenameCount.get(op.newFilename) > 1) {
        const count = (usedNames.get(op.newFilename) || 0) + 1;
        usedNames.set(op.newFilename, count);
        
        if (count > 1) {
          const namePart = finalName.replace('.png', '');
          finalName = `${namePart}-${count}.png`;
        }
      }
      
      finalOperations.push({
        ...op,
        newFilename: finalName,
        newPath: path.join(assetsDir, finalName)
      });
    });
    
    // Perform the renames
    console.log(`📋 Renaming ${finalOperations.length} assets...`);
    
    for (const op of finalOperations) {
      try {
        if (fs.existsSync(op.oldPath)) {
          fs.renameSync(op.oldPath, op.newPath);
          console.log(`✅ ${op.oldFilename} → ${op.newFilename}`);
          
          renamedAssets.push({
            ...op.asset,
            filename: op.newFilename
          });
        } else {
          console.log(`⚠️ File not found: ${op.oldFilename}`);
        }
      } catch (error) {
        console.log(`❌ Error renaming ${op.oldFilename}: ${error.message}`);
      }
    }
    
    // Update the manifest
    const updatedManifest = {
      ...manifest,
      updatedAt: new Date().toISOString(),
      method: 'selected_images_and_key_icons_renamed',
      downloadedAssets: renamedAssets
    };
    
    fs.writeFileSync(manifestPath, JSON.stringify(updatedManifest, null, 2));
    
    console.log(`\n📊 RENAME RESULTS:`);
    console.log(`✅ Successfully renamed: ${renamedAssets.length} assets`);
    console.log(`📋 Updated manifest: downloaded-assets.json`);
    
    // List the new filenames
    console.log(`\n📁 New Asset Names:`);
    console.log(`${'='.repeat(50)}`);
    
    const images = renamedAssets.filter(a => a.assetType === 'image');
    const icons = renamedAssets.filter(a => a.assetType === 'icon');
    
    if (images.length > 0) {
      console.log(`\n🖼️ Images (${images.length}):`);
      images.forEach(asset => {
        console.log(`   • ${asset.filename} - ${asset.nodeName}`);
      });
    }
    
    if (icons.length > 0) {
      console.log(`\n🎨 Icons (${icons.length}):`);
      icons.forEach(asset => {
        console.log(`   • ${asset.filename} - ${asset.nodeName}`);
      });
    }
    
    return updatedManifest;
    
  } catch (error) {
    console.error('💥 Error renaming assets:', error);
    throw error;
  }
}

// Run the rename operation
renameAssets().catch(console.error);